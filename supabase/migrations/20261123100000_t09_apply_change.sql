-- T09：applyChange 的寫入角色、版本檢查（SH-04）、Change Log、即時分支、通知（SH-06）
-- S-01：正式行程表只有 atps_change_writer 可寫入。authenticated 只能經下列函式批准或否決，
-- 函式以寫入角色身分執行，批准者取自 session，不接受呼叫者傳入。

create role atps_change_writer nologin;
grant atps_change_writer to postgres;

grant usage on schema public, private to atps_change_writer;
grant select on public.trips, public.trip_members, public.itinerary_items, public.proposals, public.versions
  to atps_change_writer;
grant update (current_version) on public.trips to atps_change_writer;
grant update (scheduled_date, scheduled_start, scheduled_end, at_risk) on public.itinerary_items to atps_change_writer;
grant update (status, decided_by, decided_at) on public.proposals to atps_change_writer;
grant insert on public.versions, public.notifications to atps_change_writer;
grant execute on function private.can_edit_trip(uuid) to atps_change_writer;

create policy writer_select on public.trips for select to atps_change_writer using (true);
create policy writer_update on public.trips for update to atps_change_writer using (true) with check (true);
create policy writer_select on public.trip_members for select to atps_change_writer using (true);
create policy writer_select on public.itinerary_items for select to atps_change_writer using (true);
create policy writer_update on public.itinerary_items for update to atps_change_writer using (true) with check (true);
create policy writer_select on public.proposals for select to atps_change_writer using (true);
create policy writer_update on public.proposals for update to atps_change_writer using (true) with check (true);
create policy writer_select on public.versions for select to atps_change_writer using (true);
create policy writer_insert on public.versions for insert to atps_change_writer with check (true);
create policy writer_insert on public.notifications for insert to atps_change_writer with check (true);

-- SH-06：批准、否決、失效即時推送；Realtime 依 notifications 的 RLS 只推給收件人
alter publication supabase_realtime add table public.notifications;

-- 呼叫者（session 的 sub），等同 auth.uid()
create function private.session_user_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

-- 通知行程所有成員，動作者本人除外
create function private.notify_members(p_trip uuid, p_kind text, p_proposal uuid, p_actor uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, trip_id, kind, ref_table, ref_id)
  select m.user_id, p_trip, p_kind, 'proposals', p_proposal
  from public.trip_members m
  where m.trip_id = p_trip and m.user_id is distinct from p_actor;
$$;

-- 套用提案：鎖定行程列後比對 base version；相同則寫入，不同則提案失效
create function private.commit_proposal(p_proposal_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.proposals;
  v_trip_id uuid;
  v_current integer;
  v_kind public.version_kind;
  v_op jsonb;
  v_item public.itinerary_items;
  v_old jsonb := '[]';
  v_new jsonb := '[]';
  v_major integer;
  v_minor integer;
  v_invalidated uuid[];
  v_id uuid;
begin
  -- 一律先鎖行程列再鎖提案列，避免同時批准同分支提案時死結
  select trip_id into v_trip_id from public.proposals where id = p_proposal_id;
  if not found then
    raise exception '找不到提案' using errcode = '42501';
  end if;
  select current_version into v_current from public.trips where id = v_trip_id for update;
  select * into v_p from public.proposals where id = p_proposal_id for update;
  if v_p.status <> 'pending' then
    raise exception '只有待批准的提案可以批准' using errcode = '22023';
  end if;

  -- SH-04：批准時正式行程版本已變更，提案失效
  if v_p.base_version <> v_current then
    update public.proposals set status = 'invalidated', decided_by = p_actor, decided_at = now() where id = v_p.id;
    perform private.notify_members(v_p.trip_id, 'proposal_invalidated', v_p.id, p_actor);
    return jsonb_build_object('outcome', 'invalidated');
  end if;

  v_kind := (v_p.change ->> 'versionKind')::public.version_kind;
  if v_kind is null or jsonb_typeof(v_p.change -> 'operations') <> 'array'
     or jsonb_array_length(v_p.change -> 'operations') = 0 then
    raise exception '提案內容不完整' using errcode = '22023';
  end if;

  for v_op in select value from jsonb_array_elements(v_p.change -> 'operations') loop
    select * into v_item from public.itinerary_items
      where id = (v_op ->> 'itemId')::uuid and trip_id = v_p.trip_id for update;
    if not found then
      raise exception '提案只能修改同一行程的項目' using errcode = '42501';
    end if;

    case v_op ->> 'op'
      when 'schedule_item' then
        v_old := v_old || jsonb_build_object('itemId', v_item.id, 'date', v_item.scheduled_date,
          'start', v_item.scheduled_start, 'end', v_item.scheduled_end);
        update public.itinerary_items set
          scheduled_date = (v_op ->> 'date')::date,
          scheduled_start = (v_op ->> 'start')::time,
          scheduled_end = (v_op ->> 'end')::time
        where id = v_item.id;
        v_new := v_new || jsonb_build_object('itemId', v_item.id, 'date', v_op -> 'date',
          'start', v_op -> 'start', 'end', v_op -> 'end');
      when 'set_at_risk' then
        v_old := v_old || jsonb_build_object('itemId', v_item.id, 'atRisk', v_item.at_risk);
        update public.itinerary_items set at_risk = (v_op ->> 'atRisk')::boolean where id = v_item.id;
        v_new := v_new || jsonb_build_object('itemId', v_item.id, 'atRisk', v_op -> 'atRisk');
      else
        raise exception '未知的變更操作' using errcode = '22023';
    end case;
  end loop;

  -- 第 2.7 節版本號：第一版 v1.0；Major 主版號加一、次版號歸零；Minor 次版號加一
  select v.major, v.minor into v_major, v_minor from public.versions v
    where v.trip_id = v_p.trip_id order by v.major desc, v.minor desc limit 1;
  if v_major is null then
    v_major := 1; v_minor := 0;
  elsif v_kind = 'major' then
    v_major := v_major + 1; v_minor := 0;
  else
    v_minor := v_minor + 1;
  end if;

  update public.trips set current_version = current_version + 1 where id = v_p.trip_id;
  insert into public.versions (trip_id, major, minor, kind, summary, reason, proposal_id, approved_by,
    impact_scope, old_arrangement, new_arrangement, base_version)
  values (v_p.trip_id, v_major, v_minor, v_kind, v_p.change ->> 'summary', v_p.change ->> 'reason', v_p.id, p_actor,
    v_p.impact_scope, v_old, v_new, v_p.base_version);
  update public.proposals set status = 'applied', decided_by = p_actor, decided_at = now() where id = v_p.id;
  perform private.notify_members(v_p.trip_id, 'proposal_applied', v_p.id, p_actor);

  -- 第 2.9 節：同一即時分支的其他提案失效
  with invalidated as (
    update public.proposals set status = 'invalidated', decided_at = now()
    where v_p.live_branch_id is not null and live_branch_id = v_p.live_branch_id
      and status = 'pending' and id <> v_p.id
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_invalidated from invalidated;
  foreach v_id in array v_invalidated loop
    perform private.notify_members(v_p.trip_id, 'proposal_invalidated', v_id, p_actor);
  end loop;

  return jsonb_build_object('outcome', 'applied', 'major', v_major, 'minor', v_minor,
    'invalidated_ids', to_jsonb(v_invalidated));
end;
$$;

-- 成員批准：Owner、Companion
create function public.approve_proposal(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip uuid;
begin
  select trip_id into v_trip from public.proposals where id = p_proposal_id;
  if v_actor is null or v_trip is null or not private.can_edit_trip(v_trip) then
    raise exception '沒有批准權限' using errcode = '42501';
  end if;
  return private.commit_proposal(p_proposal_id, v_actor);
end;
$$;

-- 成員否決：Owner、Companion
create function public.reject_proposal(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip uuid;
  v_p public.proposals;
begin
  select trip_id into v_trip from public.proposals where id = p_proposal_id;
  if v_actor is null or v_trip is null or not private.can_edit_trip(v_trip) then
    raise exception '沒有否決權限' using errcode = '42501';
  end if;
  perform 1 from public.trips where id = v_trip for update;
  select * into v_p from public.proposals where id = p_proposal_id for update;
  if not found then
    raise exception '沒有否決權限' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    raise exception '只有待批准的提案可以否決' using errcode = '22023';
  end if;
  update public.proposals set status = 'rejected', decided_by = v_actor, decided_at = now() where id = v_p.id;
  perform private.notify_members(v_p.trip_id, 'proposal_rejected', v_p.id, v_actor);
end;
$$;

-- 伺服器自動套用：只限第 2.6 節自動套用類別（與 packages/core approvalRule 一致，由工具測試比對）
create function public.auto_apply_proposal(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
begin
  select change ->> 'changeKind' into v_kind from public.proposals where id = p_proposal_id;
  if v_kind is null or v_kind not in (
    'new_candidate', 'candidate_verification_update', 'fact_correction', 'approved_fact_invalidated', 'incident_L1'
  ) then
    raise exception '此類變更需成員批准' using errcode = '42501';
  end if;
  return private.commit_proposal(p_proposal_id, null);
end;
$$;

-- 變更擁有者需要 schema 的 CREATE 權限，完成後收回
grant create on schema public, private to atps_change_writer;
alter function private.session_user_id() owner to atps_change_writer;
alter function private.notify_members(uuid, text, uuid, uuid) owner to atps_change_writer;
alter function private.commit_proposal(uuid, uuid) owner to atps_change_writer;
alter function public.approve_proposal(uuid) owner to atps_change_writer;
alter function public.reject_proposal(uuid) owner to atps_change_writer;
alter function public.auto_apply_proposal(uuid) owner to atps_change_writer;
revoke create on schema public, private from atps_change_writer;

revoke all on function private.session_user_id(), private.notify_members(uuid, text, uuid, uuid),
  private.commit_proposal(uuid, uuid), public.approve_proposal(uuid), public.reject_proposal(uuid),
  public.auto_apply_proposal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.approve_proposal(uuid), public.reject_proposal(uuid) to authenticated;
grant execute on function public.auto_apply_proposal(uuid) to service_role;
