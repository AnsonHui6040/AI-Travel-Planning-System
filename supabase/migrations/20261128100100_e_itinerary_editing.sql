-- 決策 0010 E：行程編輯。成員可以自行新增、修改、刪除、排序與移動項目。
-- 行程鎖定前（且影響的日期都是草案）經本檔的函式直接寫入，擁有者 atps_item_editor，只限 Owner、Companion；
-- 鎖定後（或該日已批准）同一個編輯畫面送出待批准提案，以 commit_proposal 的 add_item、update_item、remove_item 套用。
-- 成員新增的項目來源為 user、核實狀態為 user_confirmed，兩者以 check constraint 綁定：AI 核實（apply_verification）
-- 無法把成員的項目改為其他狀態，也無法把 AI 的項目標為使用者確認。

-- 1 欄位 ------------------------------------------------------------------------------------------
create type public.item_origin as enum ('ai', 'user');
alter table public.itinerary_items add column origin public.item_origin not null default 'ai';
alter table public.itinerary_items add column added_by uuid references auth.users (id) on delete set null;
alter table public.itinerary_items add column note text check (char_length(note) between 1 and 500);
alter table public.itinerary_items add constraint itinerary_items_user_confirmed
  check ((origin = 'user') = (verification_status = 'user_confirmed'));
-- 成員手動排過每日行程後，草案日只顯示資料庫中的排程（畫面不再自動排入）
alter table public.trips add column manual_schedule boolean not null default false;

-- 2 寫入角色 --------------------------------------------------------------------------------------
create role atps_item_editor nologin;
grant atps_item_editor to postgres;
grant usage on schema public, private to atps_item_editor;
grant select on public.trips, public.trip_members, public.trip_baselines, public.days, public.itinerary_items to atps_item_editor;
grant insert, delete on public.itinerary_items to atps_item_editor;
grant update (name_zh, type, address, place_id, suggested_stay_minutes, note, scheduled_date, scheduled_start, scheduled_end)
  on public.itinerary_items to atps_item_editor;
grant update (manual_schedule, current_version) on public.trips to atps_item_editor;
grant execute on function private.can_edit_trip(uuid), private.session_user_id() to atps_item_editor;

create policy item_editor_select on public.trips for select to atps_item_editor using (true);
create policy item_editor_update on public.trips for update to atps_item_editor using (true) with check (true);
create policy item_editor_select on public.trip_members for select to atps_item_editor using (true);
create policy item_editor_select on public.trip_baselines for select to atps_item_editor using (true);
create policy item_editor_select on public.days for select to atps_item_editor using (true);
create policy item_editor_select on public.itinerary_items for select to atps_item_editor using (true);
create policy item_editor_insert on public.itinerary_items for insert to atps_item_editor
  with check (origin = 'user' and verification_status = 'user_confirmed');
create policy item_editor_update on public.itinerary_items for update to atps_item_editor using (true) with check (true);
create policy item_editor_delete on public.itinerary_items for delete to atps_item_editor using (true);

-- 3 共用檢查 --------------------------------------------------------------------------------------

-- 權限、行程狀態與影響的日期。回傳鎖定的行程列
create function private.item_edit_trip(p_trip uuid, p_dates date[]) returns public.trips
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
begin
  if private.session_user_id() is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '沒有編輯權限' using errcode = '42501';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status not in ('baseline', 'planning') then
    raise exception '行程已鎖定，請改為提出變更' using errcode = '55000';
  end if;
  if exists (select 1 from public.days where trip_id = p_trip and date = any (coalesce(p_dates, '{}')) and status <> 'draft') then
    raise exception '這天已批准，請改為提出變更' using errcode = '55000';
  end if;
  return v_trip;
end;
$$;

-- 成員可以填寫的欄位；只接受這些鍵，數值範圍由資料表的 check constraint 再檢查一次
create function private.item_fields_valid(p_fields jsonb, p_all boolean) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_fields) = 'object'
    and not exists (select 1 from jsonb_object_keys(p_fields) k
      where k not in ('name_zh', 'type', 'address', 'suggested_stay_minutes', 'note', 'place_id'))
    and (not p_all or (p_fields ? 'name_zh' and p_fields ? 'type' and p_fields ? 'suggested_stay_minutes'))
    and (not p_fields ? 'place_id' or jsonb_typeof(p_fields -> 'place_id') = 'null'
      or ((p_fields ->> 'place_id') ~ '^[A-Za-z0-9_-]+$' and char_length(p_fields ->> 'place_id') between 10 and 300));
$$;

-- 寫入排程：每個時段為 {itemId, date, start, end}；date 為 null 時移回候選清單。
-- 只有尚未批准的項目；排入某天時須為已核實、部分核實或使用者確認的 Primary，日期在基線期間內且該日仍是草案
create function private.apply_item_slots(p_trip public.trips, p_slots jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_base jsonb;
  v_slot jsonb;
  v_item public.itinerary_items;
  v_date date;
  v_count integer := 0;
  v_hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if coalesce(jsonb_typeof(p_slots), '') <> 'array' or jsonb_array_length(p_slots) > 200 then
    raise exception '排程格式不正確' using errcode = '22023';
  end if;
  select data into v_base from public.trip_baselines where trip_id = p_trip.id and version = 1 and confirmed_at is not null;
  for v_slot in select value from jsonb_array_elements(p_slots) loop
    if jsonb_typeof(v_slot) <> 'object' or exists (select 1 from jsonb_object_keys(v_slot) k where k not in ('itemId', 'date', 'start', 'end')) then
      raise exception '排程格式不正確' using errcode = '22023';
    end if;
    select * into v_item from public.itinerary_items where id = (v_slot ->> 'itemId')::uuid and trip_id = p_trip.id for update;
    if v_item.id is null then
      raise exception '項目不屬於此行程' using errcode = '42501';
    end if;
    if v_item.lifecycle_status not in ('candidate', 'pending_verification', 'verified') then
      raise exception '已批准的項目請改為提出變更' using errcode = '55000';
    end if;
    v_date := (v_slot ->> 'date')::date;
    if v_date is null then
      if coalesce(v_slot ->> 'start', v_slot ->> 'end') is not null then
        raise exception '排程格式不正確' using errcode = '22023';
      end if;
    else
      if coalesce(v_slot ->> 'start', '') !~ v_hhmm or coalesce(v_slot ->> 'end', '') !~ v_hhmm
         or v_slot ->> 'start' >= v_slot ->> 'end' then
        raise exception '排程格式不正確' using errcode = '22023';
      end if;
      if v_base is null or v_date not between (v_base ->> 'start_date')::date and (v_base ->> 'end_date')::date then
        raise exception '日期不在行程期間內' using errcode = '22023';
      end if;
      if exists (select 1 from public.days where trip_id = p_trip.id and date = v_date and status <> 'draft') then
        raise exception '這天已批准，請改為提出變更' using errcode = '55000';
      end if;
      -- D07：Unverified 與 Conflict 不得進入行程；Backup 只列清單
      if v_item.verification_status not in ('verified', 'partially_verified', 'user_confirmed') or v_item.candidate_role <> 'primary' then
        raise exception '只有已核實或使用者確認的 Primary 項目可以排入' using errcode = '55000';
      end if;
    end if;
    update public.itinerary_items set
      scheduled_date = v_date,
      scheduled_start = (v_slot ->> 'start')::time,
      scheduled_end = (v_slot ->> 'end')::time
    where id = v_item.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 第一次手動排程時先寫入畫面上的自動草案（p_draft），之後草案日只顯示資料庫中的排程
create function private.begin_manual_schedule(p_trip public.trips, p_draft jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not p_trip.manual_schedule then
    perform private.apply_item_slots(p_trip, coalesce(p_draft, '[]'::jsonb));
    update public.trips set manual_schedule = true where id = p_trip.id;
  end if;
end;
$$;

-- 4 直接寫入（鎖定前） ----------------------------------------------------------------------------

-- 新增：p_slot 為 null 時放進候選清單；回傳項目編號
create function public.add_trip_item(p_trip uuid, p_item jsonb, p_slot jsonb, p_draft jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_id uuid;
  v_date date := (p_slot ->> 'date')::date;
begin
  v_trip := private.item_edit_trip(p_trip, array[v_date]);
  if p_item is null or not private.item_fields_valid(p_item, true) then
    raise exception '項目內容不正確' using errcode = '22023';
  end if;
  insert into public.itinerary_items (trip_id, name_zh, type, address, place_id, suggested_stay_minutes, note,
    priority, weather_dependency, recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit,
    score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability,
    verification_status, lifecycle_status, origin, added_by)
  values (p_trip, p_item ->> 'name_zh', (p_item ->> 'type')::public.item_type, p_item ->> 'address', p_item ->> 'place_id',
    (p_item ->> 'suggested_stay_minutes')::integer, p_item ->> 'note',
    3, 'medium', '成員新增', 3, 3, 3, 3, 3, 3, 3, 3,
    'user_confirmed', 'verified', 'user', private.session_user_id())
  returning id into v_id;
  if v_date is not null then
    perform private.begin_manual_schedule(v_trip, p_draft);
    perform private.apply_item_slots(v_trip, jsonb_build_array(jsonb_build_object('itemId', v_id, 'date', p_slot -> 'date',
      'start', p_slot -> 'start', 'end', p_slot -> 'end')));
  end if;
  update public.trips set current_version = current_version + 1 where id = p_trip;
  return v_id;
end;
$$;

-- 修改名稱、類型、地址、停留、備註、place_id。已排入時依新的停留時間調整結束時間
create function public.update_trip_item(p_item uuid, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.itinerary_items;
  v_end time;
begin
  select * into v_item from public.itinerary_items where id = p_item;
  if v_item.id is null then
    raise exception '沒有編輯權限' using errcode = '42501';
  end if;
  perform private.item_edit_trip(v_item.trip_id, array[v_item.scheduled_date]);
  if p_fields is null or not private.item_fields_valid(p_fields, false) or p_fields = '{}'::jsonb then
    raise exception '項目內容不正確' using errcode = '22023';
  end if;
  if v_item.lifecycle_status not in ('candidate', 'pending_verification', 'verified') then
    raise exception '已批准的項目請改為提出變更' using errcode = '55000';
  end if;
  if v_item.scheduled_start is not null and p_fields ? 'suggested_stay_minutes' then
    if extract(hour from v_item.scheduled_start) * 60 + extract(minute from v_item.scheduled_start)
       + (p_fields ->> 'suggested_stay_minutes')::integer > 23 * 60 + 59 then
      raise exception '停留時間超過當天' using errcode = '22023';
    end if;
    v_end := v_item.scheduled_start + make_interval(mins => (p_fields ->> 'suggested_stay_minutes')::integer);
  end if;
  update public.itinerary_items set
    name_zh = case when p_fields ? 'name_zh' then p_fields ->> 'name_zh' else name_zh end,
    type = case when p_fields ? 'type' then (p_fields ->> 'type')::public.item_type else type end,
    address = case when p_fields ? 'address' then p_fields ->> 'address' else address end,
    place_id = case when p_fields ? 'place_id' then p_fields ->> 'place_id' else place_id end,
    suggested_stay_minutes = case when p_fields ? 'suggested_stay_minutes' then (p_fields ->> 'suggested_stay_minutes')::integer else suggested_stay_minutes end,
    note = case when p_fields ? 'note' then p_fields ->> 'note' else note end,
    scheduled_end = coalesce(v_end, scheduled_end)
  where id = p_item;
  update public.trips set current_version = current_version + 1 where id = v_item.trip_id;
end;
$$;

-- 刪除尚未批准的項目（畫面以 window.confirm 確認）
create function public.delete_trip_item(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.itinerary_items;
begin
  select * into v_item from public.itinerary_items where id = p_item;
  if v_item.id is null then
    raise exception '沒有編輯權限' using errcode = '42501';
  end if;
  perform private.item_edit_trip(v_item.trip_id, array[v_item.scheduled_date]);
  if v_item.lifecycle_status not in ('candidate', 'pending_verification', 'verified') then
    raise exception '已批准的項目請改為提出變更' using errcode = '55000';
  end if;
  delete from public.itinerary_items where id = p_item;
  update public.trips set current_version = current_version + 1 where id = v_item.trip_id;
end;
$$;

-- 排序、移到另一天或移回候選清單（一次寫入多個時段，例如上移時交換兩項）
create function public.schedule_trip_items(p_trip uuid, p_slots jsonb, p_draft jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_count integer;
begin
  v_trip := private.item_edit_trip(p_trip, '{}');
  if coalesce(jsonb_typeof(p_slots), '') <> 'array' or jsonb_array_length(p_slots) not between 1 and 50 then
    raise exception '排程格式不正確' using errcode = '22023';
  end if;
  perform private.begin_manual_schedule(v_trip, p_draft);
  v_count := private.apply_item_slots(v_trip, p_slots);
  update public.trips set current_version = current_version + 1 where id = p_trip;
  return v_count;
end;
$$;

-- 5 排程與生命週期同步（取代 T38 修正版） ------------------------------------------------------------
-- 鎖定後：與 T38 相同；成員新增的項目（使用者確認）排入時同樣成為已修改，移回候選清單時回到已核實、不需重新核實。
-- 規劃中（決策 0010）：經提案排入已批准的日期成為已批准；由已批准的日期移出（移回候選清單或移到草案日）回到已核實
create or replace function private.sync_lifecycle_with_schedule() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status public.trip_status;
  v_day_open boolean;
begin
  if new.lifecycle_status is distinct from old.lifecycle_status then
    return new;
  end if;
  select t.status into v_status from public.trips t where t.id = new.trip_id;
  if v_status in ('locked', 'in_progress') then
    if old.scheduled_date is null and new.scheduled_date is not null
       and old.lifecycle_status in ('candidate', 'pending_verification', 'verified')
       and old.verification_status in ('verified', 'partially_verified', 'user_confirmed') then
      new.lifecycle_status := 'modified';
    elsif old.scheduled_date is not null and new.scheduled_date is null
       and old.lifecycle_status in ('approved', 'locked', 'change_proposed', 'modified') then
      if new.verification_status = 'user_confirmed' then
        new.lifecycle_status := 'verified';
      else
        new.lifecycle_status := 'pending_verification';
        -- Conflict 保留為 Conflict，其餘一律回到未核實
        if new.verification_status <> 'conflict' then
          new.verification_status := 'unverified';
        end if;
      end if;
    end if;
  elsif v_status = 'planning' then
    v_day_open := new.scheduled_date is null or not exists (
      select 1 from public.days d where d.trip_id = new.trip_id and d.date = new.scheduled_date and d.status <> 'draft');
    if old.lifecycle_status in ('candidate', 'pending_verification', 'verified') and not v_day_open then
      new.lifecycle_status := 'approved';
    elsif old.lifecycle_status = 'approved' and v_day_open then
      new.lifecycle_status := 'verified';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_lifecycle_with_schedule() from public, anon, authenticated, service_role;
grant execute on function private.sync_lifecycle_with_schedule() to atps_change_writer, atps_item_editor;

-- 6 提案：成員的新增、修改、刪除（取代 T09 的 commit_proposal） ----------------------------------------
grant insert, delete on public.itinerary_items to atps_change_writer;
grant update (name_zh, type, address, place_id, suggested_stay_minutes, note) on public.itinerary_items to atps_change_writer;
grant select on public.days to atps_change_writer;
create policy writer_insert on public.itinerary_items for insert to atps_change_writer
  with check (origin = 'user' and verification_status = 'user_confirmed');
create policy writer_delete on public.itinerary_items for delete to atps_change_writer using (true);

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
begin
  -- 一律先鎖行程列再鎖提案列，避免同時批准同分支提案時死結
  select trip_id into v_trip_id from public.proposals where id = p_proposal_id;
  if not found then
    raise exception '找不到提案' using errcode = '42501';
  end if;
  select current_version, status into v_current, v_trip_status from public.trips where id = v_trip_id for update;
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
    -- 決策 0010：新增、修改、刪除只接受成員提出的提案（AI 只能改排程與 At Risk）
    if v_op ->> 'op' in ('add_item', 'update_item', 'remove_item') and v_p.proposer_member_id is null then
      raise exception '只有成員可以提出新增、修改或刪除' using errcode = '42501';
    end if;

    if v_op ->> 'op' = 'add_item' then
      v_fields := v_op -> 'item';
      if v_fields is null or not private.item_fields_valid(v_fields, true) then
        raise exception '提案內容不完整' using errcode = '22023';
      end if;
      insert into public.itinerary_items (id, trip_id, name_zh, type, address, place_id, suggested_stay_minutes, note,
        priority, weather_dependency, recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit,
        score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability,
        verification_status, lifecycle_status, origin, added_by, scheduled_date, scheduled_start, scheduled_end)
      values ((v_op ->> 'itemId')::uuid, v_p.trip_id, v_fields ->> 'name_zh', (v_fields ->> 'type')::public.item_type,
        v_fields ->> 'address', v_fields ->> 'place_id', (v_fields ->> 'suggested_stay_minutes')::integer, v_fields ->> 'note',
        3, 'medium', '成員新增', 3, 3, 3, 3, 3, 3, 3, 3, 'user_confirmed',
        (case when v_op ->> 'date' is null then 'verified'
              when v_trip_status in ('locked', 'in_progress') then 'modified' else 'approved' end)::public.lifecycle_status,
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
        -- 沒有排入過的候選直接刪除；排入過的項目保留紀錄、改為已取消
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

-- 7 批准每日行程：成員的項目（使用者確認）也可以排入（取代 T30 的 approve_day） -----------------------------
create or replace function public.approve_day(p_trip uuid, p_date date, p_entries jsonb, p_base_version integer) returns jsonb
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
    -- D07：只有 Verified 與 Partially Verified 的 Primary 候選可以進入行程；Backup 只列清單。
    -- 決策 0010：成員自行新增的項目（使用者確認）也可以
    if v_item.lifecycle_status <> 'verified' or v_item.verification_status not in ('verified', 'partially_verified', 'user_confirmed')
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
-- 8 擁有者與權限 ----------------------------------------------------------------------------------
grant create on schema public, private to atps_item_editor;
alter function private.item_edit_trip(uuid, date[]) owner to atps_item_editor;
alter function private.apply_item_slots(public.trips, jsonb) owner to atps_item_editor;
alter function private.begin_manual_schedule(public.trips, jsonb) owner to atps_item_editor;
alter function public.add_trip_item(uuid, jsonb, jsonb, jsonb) owner to atps_item_editor;
alter function public.update_trip_item(uuid, jsonb) owner to atps_item_editor;
alter function public.delete_trip_item(uuid) owner to atps_item_editor;
alter function public.schedule_trip_items(uuid, jsonb, jsonb) owner to atps_item_editor;
revoke create on schema public, private from atps_item_editor;

revoke all on function private.item_edit_trip(uuid, date[]), private.apply_item_slots(public.trips, jsonb),
  private.begin_manual_schedule(public.trips, jsonb), public.add_trip_item(uuid, jsonb, jsonb, jsonb),
  public.update_trip_item(uuid, jsonb), public.delete_trip_item(uuid), public.schedule_trip_items(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.item_fields_valid(jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function private.item_fields_valid(jsonb, boolean) to atps_item_editor, atps_change_writer;
grant execute on function public.add_trip_item(uuid, jsonb, jsonb, jsonb), public.update_trip_item(uuid, jsonb),
  public.delete_trip_item(uuid), public.schedule_trip_items(uuid, jsonb, jsonb) to authenticated;
