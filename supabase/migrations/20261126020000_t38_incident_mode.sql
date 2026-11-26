-- T38：Incident Mode（第 2.6、2.9 節，D10）。
-- Owner、Companion 經 start_incident 進入：伺服器以 core 的 planIncident 計算後送出 Snapshot 與最多三個替代方案。
-- 以目前版本建立即時分支：各方案為同一 base version、同一 live_branch_id 的待批准提案（提出者為成員本人），
-- 套用其一後其餘失效（commit_proposal）。本函式不改動行程項目；寫入只在批准後經 approve_proposal。
-- 函式以 atps_change_writer 身分執行。

-- 提早完成、取消時段等現場變更不屬於 L1–L4
alter table public.incidents alter column level drop not null;
alter table public.incidents add constraint incidents_snapshot_check
  check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 32768);

grant select, insert on public.incidents to atps_change_writer;
create policy writer_select on public.incidents for select to atps_change_writer using (true);
create policy writer_insert on public.incidents for insert to atps_change_writer with check (true);

create function public.start_incident(p_trip uuid, p_level public.incident_level, p_snapshot jsonb,
  p_available_minutes integer, p_alternatives jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip public.trips;
  v_alt jsonb;
  v_op jsonb;
  v_ids uuid[] := '{}';
  v_saved jsonb := '[]';
  v_id uuid;
  v_incident uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_i integer := 0;
begin
  if v_actor is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '只有 Owner 與 Companion 可以進入 Incident Mode' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_snapshot), '') <> 'object' or coalesce(jsonb_typeof(p_alternatives), '') <> 'array'
     or jsonb_array_length(p_alternatives) not between 1 and 3
     or (p_available_minutes is not null and p_available_minutes not between 0 and 1440) then
    raise exception 'Incident Mode 內容格式不正確' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status not in ('locked', 'in_progress') then
    raise exception '行程尚未鎖定' using errcode = '55000';
  end if;

  for v_alt in select value from jsonb_array_elements(p_alternatives) loop
    -- 第 2.6 節：Incident Mode 的方案一律需批准，不可使用自動套用類別
    if coalesce(jsonb_typeof(v_alt), '') <> 'object'
       or coalesce(v_alt -> 'change' ->> 'changeKind', '') not in
         ('incident_L1', 'incident_L2', 'incident_L3', 'incident_L4', 'add_candidate_to_gap', 'minor_non_incident', 'major_version')
       or coalesce(v_alt -> 'change' ->> 'versionKind', '') not in ('major', 'minor')
       or coalesce(jsonb_typeof(v_alt -> 'change' -> 'operations'), '') <> 'array'
       or jsonb_array_length(v_alt -> 'change' -> 'operations') not between 1 and 50
       or coalesce(jsonb_typeof(v_alt -> 'impactScope'), '') <> 'object'
       or coalesce(jsonb_typeof(v_alt -> 'comparison'), '') <> 'object' then
      raise exception '替代方案格式不正確' using errcode = '22023';
    end if;
    for v_op in select value from jsonb_array_elements(v_alt -> 'change' -> 'operations') loop
      if coalesce(v_op ->> 'op', '') <> 'schedule_item'
         or not exists (select 1 from public.itinerary_items i where i.id = (v_op ->> 'itemId')::uuid and i.trip_id = p_trip) then
        raise exception '替代方案只能調整同一行程的項目' using errcode = '22023';
      end if;
    end loop;
    v_id := gen_random_uuid();
    v_ids := v_ids || v_id;
    v_saved := v_saved || jsonb_build_object('proposalId', v_id, 'tier', v_alt -> 'tier',
      'comparison', v_alt -> 'comparison', 'transport', v_alt -> 'transport');
  end loop;

  insert into public.incidents (id, trip_id, level, snapshot, available_minutes, live_branch_id, created_by)
  values (v_incident, p_trip, p_level, p_snapshot || jsonb_build_object('alternatives', v_saved), p_available_minutes, v_branch, v_actor);

  for v_alt in select value from jsonb_array_elements(p_alternatives) loop
    v_i := v_i + 1;
    insert into public.proposals (id, trip_id, proposer_member_id, base_version, change, impact_scope, live_branch_id)
    values (v_ids[v_i], p_trip, v_actor, v_trip.current_version, v_alt -> 'change', v_alt -> 'impactScope', v_branch);
  end loop;
  perform private.notify_members(p_trip, 'incident_started', v_ids[1], v_actor);
  return jsonb_build_object('incident_id', v_incident, 'live_branch_id', v_branch, 'proposal_ids', to_jsonb(v_ids));
end;
$$;

grant create on schema public to atps_change_writer;
alter function public.start_incident(uuid, public.incident_level, jsonb, integer, jsonb) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;
revoke all on function public.start_incident(uuid, public.incident_level, jsonb, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.start_incident(uuid, public.incident_level, jsonb, integer, jsonb) to authenticated;

-- 行程鎖定後，生命週期隨排程同步（第 2.5 節）：候選經提案排入某一天為已修改；
-- 已排入的項目經提案移回候選清單（刪減活動、航班改期）為已核實（未核實者回到待核實），可再被選用。
-- 同一個更新已自行設定生命週期時（例如 approve_day）不介入。
create function private.sync_lifecycle_with_schedule() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.lifecycle_status is distinct from old.lifecycle_status
     or not exists (select 1 from public.trips t where t.id = new.trip_id and t.status in ('locked', 'in_progress')) then
    return new;
  end if;
  if old.scheduled_date is null and new.scheduled_date is not null
     and old.lifecycle_status in ('candidate', 'pending_verification', 'verified')
     and old.verification_status in ('verified', 'partially_verified') then
    new.lifecycle_status := 'modified';
  elsif old.scheduled_date is not null and new.scheduled_date is null
     and old.lifecycle_status in ('approved', 'locked', 'change_proposed', 'modified') then
    new.lifecycle_status := case when old.verification_status in ('verified', 'partially_verified')
      then 'verified' else 'pending_verification' end;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_lifecycle_with_schedule() from public, anon, authenticated, service_role;
grant execute on function private.sync_lifecycle_with_schedule() to atps_change_writer;

create trigger sync_lifecycle_with_schedule before update of scheduled_date on public.itinerary_items
  for each row execute function private.sync_lifecycle_with_schedule();
