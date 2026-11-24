-- T30：可行性驗證與鎖定。
-- 1. set_item_availability：核實結果的營業時段與預約需求（service_role，背景 job，atps_verification_writer）
-- 2. approve_day：成員批准一天（Owner、Companion）。以 atps_change_writer 身分執行：比對 base version、
--    寫入時段與可移動範圍、項目由已核實進入已批准、建立新 Master Version；所有日期都批准後行程與項目進入已鎖定。
-- 可行性由伺服器以 core 的 planFeasibleDays 重新計算後才送出；資料庫再檢查狀態、重疊與所屬行程。

-- 1 ----------------------------------------------------------------------------------------------
grant update (availability, reservation_requirement) on public.itinerary_items to atps_verification_writer;

create function public.set_item_availability(p_job uuid, p_item uuid, p_availability jsonb, p_reservation text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid := private.research_job_trip(p_job);
  v_item public.itinerary_items%rowtype;
  v_slot jsonb;
begin
  if coalesce(jsonb_typeof(p_availability), '') <> 'array' or jsonb_array_length(p_availability) > 50
     or p_reservation is null or p_reservation not in ('none', 'recommended', 'required') then
    raise exception '營業時段格式不正確' using errcode = '22023';
  end if;
  for v_slot in select value from jsonb_array_elements(p_availability) loop
    if coalesce(v_slot ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_slot ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_slot ->> 'start' >= v_slot ->> 'end'
       or (v_slot ? 'weekday' and (jsonb_typeof(v_slot -> 'weekday') <> 'number' or (v_slot ->> 'weekday')::int not between 0 and 6))
       or (v_slot ? 'date' and coalesce(v_slot ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$')
       or (select count(*) from jsonb_object_keys(v_slot) k where k not in ('date', 'weekday', 'start', 'end')) > 0 then
      raise exception '營業時段格式不正確' using errcode = '22023';
    end if;
  end loop;
  select * into v_item from public.itinerary_items where id = p_item and trip_id = v_trip;
  if v_item.id is null then
    raise exception '項目不屬於此行程' using errcode = '42501';
  end if;
  if v_item.lifecycle_status not in ('candidate', 'pending_verification', 'verified') then
    raise exception '已進入行程的項目改由變更提案處理' using errcode = '55000';
  end if;
  update public.itinerary_items
    set availability = p_availability, reservation_requirement = p_reservation::public.reservation_requirement
    where id = p_item;
end;
$$;

grant create on schema public to atps_verification_writer;
alter function public.set_item_availability(uuid, uuid, jsonb, text) owner to atps_verification_writer;
revoke create on schema public from atps_verification_writer;
revoke all on function public.set_item_availability(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_item_availability(uuid, uuid, jsonb, text) to service_role;

-- 2 ----------------------------------------------------------------------------------------------
grant update (status) on public.trips to atps_change_writer;
grant update (movable_from, movable_to, lifecycle_status) on public.itinerary_items to atps_change_writer;
grant select on public.trip_baselines to atps_change_writer;
grant select, insert, update (status) on public.days to atps_change_writer;
create policy writer_select on public.trip_baselines for select to atps_change_writer using (true);
create policy writer_select on public.days for select to atps_change_writer using (true);
create policy writer_insert on public.days for insert to atps_change_writer with check (true);
create policy writer_update on public.days for update to atps_change_writer using (true) with check (true);

create function public.approve_day(p_trip uuid, p_date date, p_entries jsonb, p_base_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip public.trips;
  v_base jsonb;
  v_start date;
  v_end date;
  v_entry jsonb;
  v_item public.itinerary_items;
  v_prev_end time;
  v_major integer;
  v_approved integer;
  v_locked boolean := false;
  v_hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if v_actor is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '沒有批准權限' using errcode = '42501';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status <> 'planning' then
    raise exception '只有規劃中的行程可以批准每日行程' using errcode = '55000';
  end if;
  -- SH-04：批准時版本已變更，請重新產生草案
  if p_base_version is null or p_base_version <> v_trip.current_version then
    return jsonb_build_object('outcome', 'invalidated');
  end if;

  select data into v_base from public.trip_baselines where trip_id = p_trip and version = 1 and confirmed_at is not null;
  if v_base is null then
    raise exception '尚未確認 Trip Baseline v1' using errcode = '55000';
  end if;
  v_start := (v_base ->> 'start_date')::date;
  v_end := (v_base ->> 'end_date')::date;
  if p_date is null or p_date not between v_start and v_end then
    raise exception '日期不在行程期間內' using errcode = '22023';
  end if;
  if exists (select 1 from public.days where trip_id = p_trip and date = p_date and status <> 'draft') then
    raise exception '這天已經批准' using errcode = '55000';
  end if;

  if coalesce(jsonb_typeof(p_entries), '') <> 'array' or jsonb_array_length(p_entries) not between 1 and 50 then
    raise exception '每日行程格式不正確' using errcode = '22023';
  end if;
  -- 依開始時間檢查格式、可移動範圍與重疊
  for v_entry in select value from jsonb_array_elements(p_entries) order by value ->> 'start' loop
    if coalesce(v_entry ->> 'start', '') !~ v_hhmm or coalesce(v_entry ->> 'end', '') !~ v_hhmm
       or coalesce(v_entry ->> 'movable_from', '') !~ v_hhmm or coalesce(v_entry ->> 'movable_to', '') !~ v_hhmm
       or v_entry ->> 'start' >= v_entry ->> 'end'
       or not (v_entry ->> 'movable_from' <= v_entry ->> 'start' and v_entry ->> 'start' <= v_entry ->> 'movable_to') then
      raise exception '每日行程格式不正確' using errcode = '22023';
    end if;
    if v_prev_end is not null and (v_entry ->> 'start')::time < v_prev_end then
      raise exception '時段重疊' using errcode = '22023';
    end if;
    v_prev_end := (v_entry ->> 'end')::time;

    select * into v_item from public.itinerary_items where id = (v_entry ->> 'item_id')::uuid and trip_id = p_trip for update;
    if v_item.id is null then
      raise exception '項目不屬於此行程' using errcode = '42501';
    end if;
    -- D07：只有 Verified 與 Partially Verified 的 Primary 候選可以進入行程；Backup 只列清單
    if v_item.lifecycle_status <> 'verified' or v_item.verification_status not in ('verified', 'partially_verified')
       or v_item.candidate_role <> 'primary' then
      raise exception '只有已核實的 Primary 候選可以排入行程' using errcode = '55000';
    end if;
    update public.itinerary_items set
      scheduled_date = p_date,
      scheduled_start = (v_entry ->> 'start')::time,
      scheduled_end = (v_entry ->> 'end')::time,
      movable_from = (v_entry ->> 'movable_from')::time,
      movable_to = (v_entry ->> 'movable_to')::time,
      lifecycle_status = 'approved'
    where id = v_item.id;
  end loop;

  insert into public.days (trip_id, date, status) values (p_trip, p_date, 'approved')
    on conflict (trip_id, date) do update set status = 'approved';

  -- 第 2.8 節：批准該日建立新 Master Version（第一版 v1.0，其後主版號加一）
  select max(major) into v_major from public.versions where trip_id = p_trip;
  v_major := coalesce(v_major + 1, 1);
  update public.trips set current_version = current_version + 1 where id = p_trip;
  insert into public.versions (trip_id, major, minor, kind, summary, approved_by, impact_scope, old_arrangement,
    new_arrangement, base_version)
  values (p_trip, v_major, 0, 'major', '批准 ' || p_date::text || ' 的每日行程', v_actor,
    jsonb_build_object('dates', jsonb_build_array(p_date)), '[]'::jsonb, p_entries, p_base_version);

  -- 所有日期都批准後，行程與已批准的項目進入已鎖定
  select count(*) into v_approved from public.days
    where trip_id = p_trip and date between v_start and v_end and status <> 'draft';
  if v_approved = (v_end - v_start + 1) then
    update public.trips set status = 'locked' where id = p_trip;
    update public.itinerary_items set lifecycle_status = 'locked' where trip_id = p_trip and lifecycle_status = 'approved';
    v_locked := true;
  end if;

  insert into public.notifications (recipient_id, trip_id, kind, ref_table, ref_id)
  select m.user_id, p_trip, case when v_locked then 'trip_locked' else 'day_approved' end, 'trips', p_trip
  from public.trip_members m where m.trip_id = p_trip and m.user_id is distinct from v_actor;

  return jsonb_build_object('outcome', 'approved', 'major', v_major, 'minor', 0, 'locked', v_locked);
end;
$$;

grant create on schema public to atps_change_writer;
alter function public.approve_day(uuid, date, jsonb, integer) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;
revoke all on function public.approve_day(uuid, date, jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.approve_day(uuid, date, jsonb, integer) to authenticated;
