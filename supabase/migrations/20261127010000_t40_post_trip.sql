-- T40：旅後狀態標記（第 2.5、2.8 節）。行程已結束後，Owner、Companion 經 set_post_trip_status 標記
-- 「需要標記的項目」：排入過某一天（scheduled_date 不是 null）或有 Actual Timeline 紀錄的項目。
-- 實際去過（最後一筆紀錄為完成，與 T39 相同）才可標為完成或不推薦；沒有去過只可標為略過、取消或再訪。
-- 需要標記的項目全部標記後行程進入已封存（決策 0003），之後不可再修改。函式以 atps_change_writer 身分執行。

grant update (post_trip_status) on public.itinerary_items to atps_change_writer;

create function private.post_trip_pending(p_trip uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.itinerary_items i
  where i.trip_id = p_trip and i.post_trip_status is null
    and (i.scheduled_date is not null
         or exists (select 1 from public.actual_timeline_entries e where e.trip_id = p_trip and e.item_id = i.id));
$$;

create function public.set_post_trip_status(p_trip uuid, p_item uuid, p_status public.post_trip_status)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip public.trips;
  v_item public.itinerary_items;
  v_visited boolean;
  v_remaining integer;
  v_status public.trip_status;
begin
  if v_actor is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '只有 Owner 與 Companion 可以標記旅後狀態' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception '旅後狀態不正確' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  if v_trip.status <> 'ended' then
    raise exception '只有已結束、尚未封存的行程可以標記旅後狀態' using errcode = '55000';
  end if;
  select * into v_item from public.itinerary_items where id = p_item and trip_id = p_trip for update;
  if v_item.id is null then
    raise exception '只能標記同一行程的項目' using errcode = '22023';
  end if;
  select l.completion = 'completed' into v_visited from (
    select e.completion from public.actual_timeline_entries e
    where e.trip_id = p_trip and e.item_id = p_item
    order by e.created_at desc, e.id desc limit 1
  ) l;
  if v_item.scheduled_date is null and v_visited is null then
    raise exception '沒有排入過、也沒有紀錄的候選不需標記' using errcode = '22023';
  end if;
  v_visited := coalesce(v_visited, false);
  if (v_visited and p_status not in ('completed', 'revisit', 'not_recommended'))
     or (not v_visited and p_status not in ('skipped', 'cancelled', 'revisit')) then
    raise exception '旅後狀態與實際紀錄不符' using errcode = '22023';
  end if;

  update public.itinerary_items set post_trip_status = p_status where id = p_item;
  v_remaining := private.post_trip_pending(p_trip);
  v_status := case when v_remaining = 0 then 'archived' else 'ended' end;
  if v_status <> v_trip.status then
    update public.trips set status = v_status where id = p_trip;
  end if;
  return jsonb_build_object('trip_status', v_status, 'remaining', v_remaining);
end;
$$;

grant create on schema public, private to atps_change_writer;
alter function private.post_trip_pending(uuid) owner to atps_change_writer;
alter function public.set_post_trip_status(uuid, uuid, public.post_trip_status) owner to atps_change_writer;
revoke create on schema public, private from atps_change_writer;
revoke all on function private.post_trip_pending(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_post_trip_status(uuid, uuid, public.post_trip_status) from public, anon, authenticated, service_role;
grant execute on function public.set_post_trip_status(uuid, uuid, public.post_trip_status) to authenticated;
