-- T36：Morning Check（第 2.8 節 Day Ready）。
-- Owner、Companion 經 complete_morning_check 完成：伺服器以 core 的 morningCheck 計算後送出結果。
-- At Risk 以 approved_fact_invalidated 提案經 commit_proposal 自動套用（第 2.6 節；Change Log 記錄提出者、通知成員），
-- Standby 提升同行程尚未排入的候選，該日由已批准進入 Day Ready（當天可再次執行），結果保存於 morning_checks。
-- 函式以 atps_change_writer 身分執行。

create table public.morning_checks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  date date not null,
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 32768),
  checked_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index morning_checks_trip_idx on public.morning_checks (trip_id, date);
alter table public.morning_checks enable row level security;
revoke all on public.morning_checks from anon, authenticated, service_role;
create policy select_member on public.morning_checks for select to authenticated using (private.is_trip_member(trip_id));
grant select on public.morning_checks to authenticated;

grant select, insert on public.morning_checks to atps_change_writer;
create policy writer_all on public.morning_checks for all to atps_change_writer using (true) with check (true);
grant update (standby) on public.itinerary_items to atps_change_writer;

create function public.complete_morning_check(p_trip uuid, p_date date, p_result jsonb, p_at_risk uuid[], p_standby uuid[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip public.trips;
  v_day public.day_status;
  v_ops jsonb;
  v_proposal uuid;
  v_kind public.version_kind := 'minor';
begin
  if v_actor is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '只有 Owner 與 Companion 可以執行 Morning Check' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_result), '') <> 'object' or coalesce(jsonb_typeof(p_result -> 'checks'), '') <> 'array'
     or coalesce(cardinality(p_at_risk), 0) > 50 or coalesce(cardinality(p_standby), 0) > 50 then
    raise exception 'Morning Check 結果格式不正確' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status not in ('locked', 'in_progress') then
    raise exception '行程尚未鎖定' using errcode = '55000';
  end if;
  select status into v_day from public.days where trip_id = p_trip and date = p_date;
  if v_day is null or v_day not in ('approved', 'day_ready') then
    raise exception '只有已批准的日期可以執行 Morning Check' using errcode = '55000';
  end if;

  -- At Risk：當天排入的項目
  if exists (select 1 from unnest(coalesce(p_at_risk, '{}')) a(id)
             where not exists (select 1 from public.itinerary_items i where i.id = a.id and i.trip_id = p_trip
                               and i.scheduled_date = p_date
                               and i.lifecycle_status in ('approved', 'locked', 'change_proposed', 'modified'))) then
    raise exception 'At Risk 只能是當天排入的項目' using errcode = '22023';
  end if;
  -- Standby：同行程、已核實、尚未排入的候選
  if exists (select 1 from unnest(coalesce(p_standby, '{}')) s(id)
             where not exists (select 1 from public.itinerary_items i where i.id = s.id and i.trip_id = p_trip
                               and i.scheduled_date is null
                               and i.lifecycle_status in ('candidate', 'pending_verification', 'verified')
                               and i.verification_status in ('verified', 'partially_verified'))) then
    raise exception 'Standby 只能是同行程尚未排入的已核實候選' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_at_risk), 0) > 0 then
    select jsonb_agg(jsonb_build_object('op', 'set_at_risk', 'itemId', id, 'atRisk', true) order by id) into v_ops
      from (select distinct id from unnest(p_at_risk) a(id)) d;
    insert into public.proposals (trip_id, proposer_member_id, base_version, change, impact_scope)
    values (p_trip, v_actor, v_trip.current_version,
      jsonb_build_object('changeKind', 'approved_fact_invalidated', 'versionKind', v_kind,
        'summary', 'Morning Check：' || jsonb_array_length(v_ops) || ' 個項目標示為 At Risk', 'operations', v_ops),
      jsonb_build_object('dates', jsonb_build_array(p_date)))
    returning id into v_proposal;
    perform private.commit_proposal(v_proposal, null);
  end if;

  update public.itinerary_items set standby = true where trip_id = p_trip and id = any(coalesce(p_standby, '{}'));
  update public.days set status = 'day_ready' where trip_id = p_trip and date = p_date;
  insert into public.morning_checks (trip_id, date, result, checked_by) values (p_trip, p_date, p_result, v_actor);
  return jsonb_build_object('status', 'day_ready', 'proposal_id', v_proposal);
end;
$$;

grant create on schema public to atps_change_writer;
alter function public.complete_morning_check(uuid, date, jsonb, uuid[], uuid[]) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;
revoke all on function public.complete_morning_check(uuid, date, jsonb, uuid[], uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.complete_morning_check(uuid, date, jsonb, uuid[], uuid[]) to authenticated;
