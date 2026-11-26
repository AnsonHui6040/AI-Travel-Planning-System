-- T39：Actual Timeline（第 2.8、2.9 節）。只記錄實際發生的事。
-- 成員（Owner、Companion 本人）直接寫入 actual_timeline_entries；trigger 檢查項目屬於同一行程、時間不晚於現在、
-- 該日尚未完成。每日結束由 produce_actual_timeline（擁有者 atps_change_writer）產生 Planned vs Actual：
-- 伺服器以 core 的 actualTimeline 計算後送出，資料庫再確認「已去過」的項目最後一筆紀錄為完成，
-- 只有這些項目成為已完成；部分完成、略過、沒有紀錄的項目維持原狀（未完成的景點不會標為已去過）。
-- 該日進入已完成；最後一日產生後行程進入已結束（決策 0003）。

alter table public.days add column actual_timeline jsonb check (actual_timeline is null
  or (jsonb_typeof(actual_timeline) = 'object' and pg_column_size(actual_timeline) <= 32768));
alter table public.days add column timeline_produced_at timestamptz;
alter table public.days add column timeline_produced_by uuid references auth.users (id) on delete set null;
grant update (actual_timeline, timeline_produced_at, timeline_produced_by) on public.days to atps_change_writer;
grant select on public.actual_timeline_entries to atps_change_writer;
create policy writer_select on public.actual_timeline_entries for select to atps_change_writer using (true);

create index actual_timeline_entries_item_idx on public.actual_timeline_entries (trip_id, item_id, created_at);

-- 記錄的檢查 -----------------------------------------------------------------
create function private.check_actual_timeline_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
begin
  select i.scheduled_date into v_date from public.itinerary_items i where i.id = new.item_id and i.trip_id = new.trip_id;
  if not found then
    raise exception '只能記錄同一行程的項目' using errcode = '22023';
  end if;
  if (new.arrived_at is not null and new.arrived_at > now() + interval '5 minutes')
     or (new.departed_at is not null and new.departed_at > now() + interval '5 minutes') then
    raise exception '實際時間不可晚於現在' using errcode = '22023';
  end if;
  if v_date is not null and exists (select 1 from public.days d where d.trip_id = new.trip_id and d.date = v_date and d.status = 'completed') then
    raise exception '這天的 Actual Timeline 已產生' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.check_actual_timeline_entry() from public, anon, authenticated, service_role;
create trigger check_actual_timeline_entry before insert on public.actual_timeline_entries
  for each row execute function private.check_actual_timeline_entry();

-- 產生 Actual Timeline --------------------------------------------------------
create function public.produce_actual_timeline(p_trip uuid, p_date date, p_timeline jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip public.trips;
  v_day public.days;
  v_status public.trip_status;
  v_visited uuid[];
begin
  if v_actor is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '只有 Owner 與 Companion 可以產生 Actual Timeline' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_timeline), '') <> 'object' or coalesce(jsonb_typeof(p_timeline -> 'rows'), '') <> 'array'
     or jsonb_array_length(p_timeline -> 'rows') > 200 or pg_column_size(p_timeline) > 32768 then
    raise exception 'Actual Timeline 格式不正確' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status not in ('locked', 'in_progress') then
    raise exception '行程尚未鎖定' using errcode = '55000';
  end if;
  select * into v_day from public.days where trip_id = p_trip and date = p_date for update;
  if v_day.id is null or v_day.status not in ('approved', 'day_ready', 'in_progress') then
    raise exception '只有已批准、尚未完成的日期可以產生 Actual Timeline' using errcode = '55000';
  end if;

  -- 已去過：同一行程、最後一筆紀錄為完成
  select coalesce(array_agg(l.item_id), '{}') into v_visited from (
    select distinct on (e.item_id) e.item_id, e.completion
    from public.actual_timeline_entries e
    where e.trip_id = p_trip
    order by e.item_id, e.created_at desc, e.id desc
  ) l where l.completion = 'completed';

  if exists (
    select 1 from jsonb_array_elements(p_timeline -> 'rows') r
    where coalesce(jsonb_typeof(r), '') <> 'object'
       or ((r ->> 'visited') = 'true' and not coalesce((r ->> 'itemId') = any(v_visited::text[]), false))
  ) then
    raise exception '只有最後一筆紀錄為完成的項目可以標為已去過' using errcode = '22023';
  end if;

  update public.itinerary_items i set lifecycle_status = 'completed'
  where i.trip_id = p_trip
    and i.lifecycle_status in ('approved', 'locked', 'change_proposed', 'modified')
    and i.id = any(v_visited)
    and i.id::text in (select r ->> 'itemId' from jsonb_array_elements(p_timeline -> 'rows') r where (r ->> 'visited') = 'true');

  update public.days set status = 'completed', actual_timeline = p_timeline,
    timeline_produced_at = now(), timeline_produced_by = v_actor
  where id = v_day.id;

  -- 決策 0003：產生 Actual Timeline 表示行程已開始；最後一日產生後行程進入已結束
  v_status := case when v_trip.end_date is not null and p_date >= v_trip.end_date then 'ended' else 'in_progress' end;
  if v_status <> v_trip.status then
    update public.trips set status = v_status where id = p_trip;
  end if;

  insert into public.notifications (recipient_id, trip_id, kind, ref_table, ref_id)
  select m.user_id, p_trip, 'timeline_produced', 'days', v_day.id
  from public.trip_members m where m.trip_id = p_trip and m.user_id <> v_actor;

  return jsonb_build_object('day_status', 'completed', 'trip_status', v_status);
end;
$$;

grant create on schema public to atps_change_writer;
alter function public.produce_actual_timeline(uuid, date, jsonb) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;
revoke all on function public.produce_actual_timeline(uuid, date, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.produce_actual_timeline(uuid, date, jsonb) to authenticated;
