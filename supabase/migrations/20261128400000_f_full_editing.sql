-- 決策 0011：完整的行程編輯（2026-11-28 使用者選定）。
-- 1. 行程鎖定後（或該日已批准）Owner 的編輯直接套用：apply_owner_change 以 Owner 的名義建立提案並在同一個交易內
--    以 commit_proposal 套用，因此一樣寫入 Change Log（versions）、通知其他成員、遵守 SH-04；Companion 照舊建立待批准提案。
-- 2. 清單內編輯模式的批次：鎖定前（影響的日期都是草案）以 edit_trip_items 在一個交易內寫入（草案不產生版本，第 2.8 節）。
-- 3. 兩站之間的交通（travel_legs）：成員輸入的交通方式與分鐘，只存項目編號（D28：不存 Google 內容）。
-- 4. 行程設定（update_trip_settings）：名稱、目的地、日期，只限 Owner；日期同步寫入 Trip Baseline v1。

-- 1 add_item 的生命週期依日期狀態（取代 0010 E 的 commit_proposal） ------------------------------------
-- 規劃中排入草案日為已核實（之後由每日批准排入），排入已批准的日期為已批准；鎖定後為已修改
create or replace function private.commit_proposal(p_proposal_id uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.proposals;
  v_trip_id uuid;
  v_trip_status public.trip_status;
  v_current integer;
  v_kind public.version_kind;
  v_op jsonb;
  v_fields jsonb;
  v_item public.itinerary_items;
  v_old jsonb := '[]';
  v_new jsonb := '[]';
  v_major integer;
  v_minor integer;
  v_invalidated uuid[];
  v_id uuid;
  v_end time;
  v_life public.lifecycle_status;
begin
  select trip_id into v_trip_id from public.proposals where id = p_proposal_id;
  if not found then
    raise exception '找不到提案' using errcode = '42501';
  end if;
  select current_version, status into v_current, v_trip_status from public.trips where id = v_trip_id for update;
  select * into v_p from public.proposals where id = p_proposal_id for update;
  if v_p.status <> 'pending' then
    raise exception '只有待批准的提案可以批准' using errcode = '22023';
  end if;

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
    if v_op ->> 'op' in ('add_item', 'update_item', 'remove_item') and v_p.proposer_member_id is null then
      raise exception '只有成員可以提出新增、修改或刪除' using errcode = '42501';
    end if;

    if v_op ->> 'op' = 'add_item' then
      v_fields := v_op -> 'item';
      if v_fields is null or not private.item_fields_valid(v_fields, true) then
        raise exception '提案內容不完整' using errcode = '22023';
      end if;
      v_life := case
        when v_op ->> 'date' is null then 'verified'
        when v_trip_status in ('locked', 'in_progress') then 'modified'
        when exists (select 1 from public.days d where d.trip_id = v_p.trip_id and d.date = (v_op ->> 'date')::date and d.status <> 'draft')
          then 'approved'
        else 'verified' end;
      insert into public.itinerary_items (id, trip_id, name_zh, type, address, place_id, suggested_stay_minutes, note,
        priority, weather_dependency, recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit,
        score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability,
        verification_status, lifecycle_status, origin, added_by, scheduled_date, scheduled_start, scheduled_end)
      values ((v_op ->> 'itemId')::uuid, v_p.trip_id, v_fields ->> 'name_zh', (v_fields ->> 'type')::public.item_type,
        v_fields ->> 'address', v_fields ->> 'place_id', (v_fields ->> 'suggested_stay_minutes')::integer, v_fields ->> 'note',
        3, 'medium', '成員新增', 3, 3, 3, 3, 3, 3, 3, 3, 'user_confirmed', v_life,
        'user', v_p.proposer_member_id, (v_op ->> 'date')::date, (v_op ->> 'start')::time, (v_op ->> 'end')::time);
      v_new := v_new || jsonb_build_object('itemId', v_op -> 'itemId', 'added', v_fields ->> 'name_zh',
        'date', v_op -> 'date', 'start', v_op -> 'start', 'end', v_op -> 'end');
      continue;
    end if;

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
      when 'update_item' then
        v_fields := v_op -> 'fields';
        if v_fields is null or v_fields = '{}'::jsonb or not private.item_fields_valid(v_fields, false) then
          raise exception '提案內容不完整' using errcode = '22023';
        end if;
        v_end := null;
        if v_item.scheduled_start is not null and v_fields ? 'suggested_stay_minutes' then
          if extract(hour from v_item.scheduled_start) * 60 + extract(minute from v_item.scheduled_start)
             + (v_fields ->> 'suggested_stay_minutes')::integer > 23 * 60 + 59 then
            raise exception '停留時間超過當天' using errcode = '22023';
          end if;
          v_end := v_item.scheduled_start + make_interval(mins => (v_fields ->> 'suggested_stay_minutes')::integer);
        end if;
        v_old := v_old || jsonb_build_object('itemId', v_item.id, 'fields', (
          select coalesce(jsonb_object_agg(k, to_jsonb(v_item) -> k), '{}'::jsonb) from jsonb_object_keys(v_fields) k));
        update public.itinerary_items set
          name_zh = case when v_fields ? 'name_zh' then v_fields ->> 'name_zh' else name_zh end,
          type = case when v_fields ? 'type' then (v_fields ->> 'type')::public.item_type else type end,
          address = case when v_fields ? 'address' then v_fields ->> 'address' else address end,
          place_id = case when v_fields ? 'place_id' then v_fields ->> 'place_id' else place_id end,
          suggested_stay_minutes = case when v_fields ? 'suggested_stay_minutes'
            then (v_fields ->> 'suggested_stay_minutes')::integer else suggested_stay_minutes end,
          note = case when v_fields ? 'note' then v_fields ->> 'note' else note end,
          scheduled_end = coalesce(v_end, scheduled_end)
        where id = v_item.id;
        v_new := v_new || jsonb_build_object('itemId', v_item.id, 'fields', v_fields);
      when 'remove_item' then
        v_old := v_old || jsonb_build_object('itemId', v_item.id, 'name', v_item.name_zh, 'date', v_item.scheduled_date,
          'start', v_item.scheduled_start, 'end', v_item.scheduled_end);
        if v_item.lifecycle_status in ('candidate', 'pending_verification', 'verified') then
          delete from public.itinerary_items where id = v_item.id;
        else
          update public.itinerary_items set lifecycle_status = 'cancelled', scheduled_date = null, scheduled_start = null,
            scheduled_end = null where id = v_item.id;
        end if;
        v_new := v_new || jsonb_build_object('itemId', v_item.id, 'removed', true);
      else
        raise exception '未知的變更操作' using errcode = '22023';
    end case;
  end loop;

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

-- 2 Owner 直接套用 ---------------------------------------------------------------------------------
-- 只限 Owner；行程規劃中、已鎖定或旅行中。排入的日期須在基線期間內，排入的項目須為已核實、部分核實或使用者確認的 Primary（D07）。
-- 以 Owner 的名義建立提案後立即套用：Change Log、通知其他成員、SH-04（版本已變更時失效）與 Companion 的提案相同
grant insert on public.proposals to atps_change_writer;
grant select on public.trip_baselines to atps_change_writer;
grant execute on function private.is_trip_owner(uuid) to atps_change_writer;

create function public.apply_owner_change(p_trip uuid, p_base_version integer, p_change jsonb, p_dates date[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_status public.trip_status;
  v_base jsonb;
  v_op jsonb;
  v_item public.itinerary_items;
  v_date date;
  v_id uuid;
begin
  if v_actor is null or p_trip is null or not exists (
    select 1 from public.trip_members where trip_id = p_trip and user_id = v_actor and role = 'owner') then
    raise exception '只有 Owner 可以直接套用' using errcode = '42501';
  end if;
  select status into v_status from public.trips where id = p_trip for update;
  if v_status not in ('planning', 'locked', 'in_progress') then
    raise exception '行程目前不能編輯' using errcode = '55000';
  end if;
  if p_base_version is null or coalesce(jsonb_typeof(p_change -> 'operations'), '') <> 'array'
     or jsonb_array_length(p_change -> 'operations') not between 1 and 100 then
    raise exception '變更內容不完整' using errcode = '22023';
  end if;
  select data into v_base from public.trip_baselines where trip_id = p_trip and version = 1 and confirmed_at is not null;
  for v_op in select value from jsonb_array_elements(p_change -> 'operations') loop
    if v_op ->> 'op' not in ('add_item', 'update_item', 'remove_item', 'schedule_item') then
      raise exception '不支援的操作' using errcode = '22023';
    end if;
    v_date := (v_op ->> 'date')::date;
    if v_date is not null and (v_base is null or v_date not between (v_base ->> 'start_date')::date and (v_base ->> 'end_date')::date) then
      raise exception '日期不在行程期間內' using errcode = '22023';
    end if;
    if v_op ->> 'op' = 'schedule_item' and v_date is not null then
      select * into v_item from public.itinerary_items where id = (v_op ->> 'itemId')::uuid and trip_id = p_trip;
      if v_item.id is null then
        raise exception '項目不屬於此行程' using errcode = '42501';
      end if;
      if v_item.verification_status not in ('verified', 'partially_verified', 'user_confirmed') or v_item.candidate_role <> 'primary' then
        raise exception '只有已核實或使用者確認的 Primary 項目可以排入' using errcode = '55000';
      end if;
    end if;
  end loop;

  insert into public.proposals (trip_id, proposer_member_id, base_version, change, impact_scope)
  values (p_trip, v_actor, p_base_version, p_change, jsonb_build_object('dates', to_jsonb(coalesce(p_dates, '{}'))))
  returning id into v_id;
  return private.commit_proposal(v_id, v_actor) || jsonb_build_object('proposal_id', v_id);
end;
$$;

-- 3 鎖定前的批次（清單內編輯模式「完成」） -----------------------------------------------------------
-- 操作與提案相同（add_item、update_item、remove_item、schedule_item），影響的日期都須是草案；一個交易內寫入
create function public.edit_trip_items(p_trip uuid, p_ops jsonb, p_draft jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_op jsonb;
  v_dates date[] := '{}';
  v_slots jsonb := '[]';
  v_current date;
  v_count integer := 0;
begin
  if coalesce(jsonb_typeof(p_ops), '') <> 'array' or jsonb_array_length(p_ops) not between 1 and 100 then
    raise exception '變更內容不完整' using errcode = '22023';
  end if;
  for v_op in select value from jsonb_array_elements(p_ops) loop
    if v_op ->> 'op' not in ('add_item', 'update_item', 'remove_item', 'schedule_item') then
      raise exception '不支援的操作' using errcode = '22023';
    end if;
    if v_op ->> 'date' is not null then
      v_dates := v_dates || (v_op ->> 'date')::date;
    end if;
    if v_op ->> 'op' <> 'add_item' then
      v_current := (select scheduled_date from public.itinerary_items where id = (v_op ->> 'itemId')::uuid and trip_id = p_trip);
      if v_current is not null then
        v_dates := v_dates || v_current;
      end if;
    end if;
  end loop;
  v_trip := private.item_edit_trip(p_trip, v_dates);

  if exists (select 1 from jsonb_array_elements(p_ops) o where o.value ->> 'op' in ('schedule_item', 'add_item')) then
    perform private.begin_manual_schedule(v_trip, p_draft);
  end if;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    case v_op ->> 'op'
      when 'add_item' then
        if not private.item_fields_valid(v_op -> 'item', true) then
          raise exception '項目內容不正確' using errcode = '22023';
        end if;
        insert into public.itinerary_items (id, trip_id, name_zh, type, address, place_id, suggested_stay_minutes, note,
          priority, weather_dependency, recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit,
          score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability,
          verification_status, lifecycle_status, origin, added_by)
        values ((v_op ->> 'itemId')::uuid, p_trip, v_op -> 'item' ->> 'name_zh', (v_op -> 'item' ->> 'type')::public.item_type,
          v_op -> 'item' ->> 'address', v_op -> 'item' ->> 'place_id', (v_op -> 'item' ->> 'suggested_stay_minutes')::integer,
          v_op -> 'item' ->> 'note', 3, 'medium', '成員新增', 3, 3, 3, 3, 3, 3, 3, 3,
          'user_confirmed', 'verified', 'user', private.session_user_id());
        if v_op ->> 'date' is not null then
          v_slots := v_slots || jsonb_build_object('itemId', v_op -> 'itemId', 'date', v_op -> 'date', 'start', v_op -> 'start', 'end', v_op -> 'end');
        end if;
      when 'update_item' then
        perform public.update_trip_item((v_op ->> 'itemId')::uuid, v_op -> 'fields');
      when 'remove_item' then
        perform public.delete_trip_item((v_op ->> 'itemId')::uuid);
      when 'schedule_item' then
        v_slots := v_slots || jsonb_build_object('itemId', v_op -> 'itemId', 'date', v_op -> 'date', 'start', v_op -> 'start', 'end', v_op -> 'end');
    end case;
    v_count := v_count + 1;
  end loop;
  if jsonb_array_length(v_slots) > 0 then
    perform private.apply_item_slots(v_trip, v_slots);
  end if;
  update public.trips set current_version = current_version + 1 where id = p_trip;
  return v_count;
end;
$$;

grant create on schema public to atps_item_editor;
alter function public.edit_trip_items(uuid, jsonb, jsonb) owner to atps_item_editor;
revoke create on schema public from atps_item_editor;
grant create on schema public to atps_change_writer;
alter function public.apply_owner_change(uuid, integer, jsonb, date[]) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;
revoke all on function public.edit_trip_items(uuid, jsonb, jsonb), public.apply_owner_change(uuid, integer, jsonb, date[])
  from public, anon, authenticated, service_role;
grant execute on function public.edit_trip_items(uuid, jsonb, jsonb), public.apply_owner_change(uuid, integer, jsonb, date[]) to authenticated;

-- 4 兩站之間的交通 ---------------------------------------------------------------------------------
-- 成員輸入的交通方式與門到門分鐘（排程時依 withBuffer 規則加緩衝）。不存 Google 內容（D28）
create table public.travel_legs (
  trip_id uuid not null references public.trips (id) on delete cascade,
  from_item_id uuid not null references public.itinerary_items (id) on delete cascade,
  to_item_id uuid not null references public.itinerary_items (id) on delete cascade,
  mode text not null check (mode in ('walk', 'train', 'bus', 'taxi', 'car')),
  minutes integer not null check (minutes between 0 and 600),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (trip_id, from_item_id, to_item_id),
  check (from_item_id <> to_item_id)
);
alter table public.travel_legs enable row level security;
revoke all on public.travel_legs from anon, authenticated, service_role;
grant select, insert, update, delete on public.travel_legs to authenticated;
create policy select_member on public.travel_legs for select to authenticated using (private.is_trip_member(trip_id));
create policy write_editor on public.travel_legs for insert to authenticated with check (
  private.trip_role_of(trip_id) in ('owner', 'companion')
  and exists (select 1 from public.itinerary_items i where i.id = from_item_id and i.trip_id = travel_legs.trip_id)
  and exists (select 1 from public.itinerary_items i where i.id = to_item_id and i.trip_id = travel_legs.trip_id));
create policy update_editor on public.travel_legs for update to authenticated
  using (private.trip_role_of(trip_id) in ('owner', 'companion'))
  with check (private.trip_role_of(trip_id) in ('owner', 'companion'));
create policy delete_editor on public.travel_legs for delete to authenticated using (private.trip_role_of(trip_id) in ('owner', 'companion'));

-- 5 行程設定 --------------------------------------------------------------------------------------
-- 名稱、目的地、日期，只限 Owner。日期同步寫入已確認的 Trip Baseline v1（固定活動與住宿須仍在期間內，否則先改基線）；
-- 移除的日期刪除每日紀錄，排在那天的項目移回候選清單；鎖定後新增的日期以已批准的空白日加入（行程維持已鎖定）
create role atps_trip_settings_writer nologin;
grant atps_trip_settings_writer to postgres;
grant usage on schema public, private to atps_trip_settings_writer;
grant select on public.trips, public.trip_members, public.trip_baselines, public.days, public.itinerary_items to atps_trip_settings_writer;
grant update (name, destination, start_date, end_date, current_version) on public.trips to atps_trip_settings_writer;
grant update (data) on public.trip_baselines to atps_trip_settings_writer;
grant insert, delete on public.days to atps_trip_settings_writer;
grant update (scheduled_date, scheduled_start, scheduled_end, lifecycle_status, verification_status) on public.itinerary_items to atps_trip_settings_writer;
grant insert on public.notifications to atps_trip_settings_writer;
grant execute on function private.session_user_id(), private.sync_lifecycle_with_schedule() to atps_trip_settings_writer;
create policy settings_select on public.trips for select to atps_trip_settings_writer using (true);
create policy settings_update on public.trips for update to atps_trip_settings_writer using (true) with check (true);
create policy settings_select on public.trip_members for select to atps_trip_settings_writer using (true);
create policy settings_select on public.trip_baselines for select to atps_trip_settings_writer using (true);
create policy settings_update on public.trip_baselines for update to atps_trip_settings_writer using (true) with check (true);
create policy settings_select on public.days for select to atps_trip_settings_writer using (true);
create policy settings_insert on public.days for insert to atps_trip_settings_writer with check (true);
create policy settings_delete on public.days for delete to atps_trip_settings_writer using (true);
create policy settings_select on public.itinerary_items for select to atps_trip_settings_writer using (true);
create policy settings_update on public.itinerary_items for update to atps_trip_settings_writer using (true) with check (true);
create policy settings_insert on public.notifications for insert to atps_trip_settings_writer with check (true);

create function public.update_trip_settings(p_trip uuid, p_name text, p_destination text, p_start date, p_end date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip public.trips;
  v_base jsonb;
  v_old_start date;
  v_old_end date;
  v_moved integer := 0;
  v_date date;
begin
  if v_actor is null or p_trip is null or not exists (
    select 1 from public.trip_members where trip_id = p_trip and user_id = v_actor and role = 'owner') then
    raise exception '只有 Owner 可以修改行程設定' using errcode = '42501';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status in ('ended', 'archived') then
    raise exception '行程已結束，不能再修改' using errcode = '55000';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or char_length(coalesce(p_destination, '')) > 120 then
    raise exception '名稱或目的地不正確' using errcode = '22023';
  end if;
  update public.trips set name = btrim(p_name), destination = nullif(btrim(coalesce(p_destination, '')), '') where id = p_trip;

  select data into v_base from public.trip_baselines where trip_id = p_trip and version = 1 and confirmed_at is not null for update;
  if p_start is not null or p_end is not null then
    if v_base is null then
      raise exception '確認 Trip Baseline v1 後才能修改日期' using errcode = '55000';
    end if;
    if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 59 then
      raise exception '日期不正確' using errcode = '22023';
    end if;
    v_old_start := (v_base ->> 'start_date')::date;
    v_old_end := (v_base ->> 'end_date')::date;
    if p_start <> v_old_start or p_end <> v_old_end then
      if exists (select 1 from jsonb_array_elements(coalesce(v_base -> 'fixed_activities', '[]')) a
                 where (a.value ->> 'date')::date not between p_start and p_end)
         or exists (select 1 from jsonb_array_elements(coalesce(v_base -> 'lodgings', '[]')) l
                 where (l.value ->> 'check_in')::date < p_start or (l.value ->> 'check_out')::date > p_end) then
        raise exception '固定活動或住宿不在新的日期內，請先修改基線' using errcode = '22023';
      end if;
      update public.trip_baselines set data = jsonb_set(jsonb_set(data, '{start_date}', to_jsonb(p_start::text)), '{end_date}', to_jsonb(p_end::text))
        where trip_id = p_trip and version = 1;
      update public.trips set start_date = p_start, end_date = p_end where id = p_trip;
      delete from public.days where trip_id = p_trip and date not between p_start and p_end;
      with moved as (
        update public.itinerary_items set scheduled_date = null, scheduled_start = null, scheduled_end = null
        where trip_id = p_trip and scheduled_date is not null and scheduled_date not between p_start and p_end
        returning id
      )
      select count(*) into v_moved from moved;
      if v_trip.status in ('locked', 'in_progress') then
        for v_date in select generate_series(p_start, p_end, interval '1 day')::date loop
          insert into public.days (trip_id, date, status) values (p_trip, v_date, 'approved') on conflict (trip_id, date) do nothing;
        end loop;
      end if;
    end if;
  end if;

  update public.trips set current_version = current_version + 1 where id = p_trip;
  insert into public.notifications (recipient_id, trip_id, kind, ref_table, ref_id)
  select m.user_id, p_trip, 'trip_settings_changed', 'trips', p_trip
  from public.trip_members m where m.trip_id = p_trip and m.user_id is distinct from v_actor;
  return jsonb_build_object('moved_to_candidates', v_moved);
end;
$$;

grant create on schema public to atps_trip_settings_writer;
alter function public.update_trip_settings(uuid, text, text, date, date) owner to atps_trip_settings_writer;
revoke create on schema public from atps_trip_settings_writer;
revoke all on function public.update_trip_settings(uuid, text, text, date, date) from public, anon, authenticated, service_role;
grant execute on function public.update_trip_settings(uuid, text, text, date, date) to authenticated;
