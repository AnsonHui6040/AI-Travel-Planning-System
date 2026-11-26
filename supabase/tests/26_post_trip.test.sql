-- T40：旅後狀態標記（第 2.5、2.8 節）。行程已結束後，Owner、Companion 經 set_post_trip_status 標記
-- 排入過或有實際紀錄的項目；實際去過（最後一筆紀錄為完成）才可標為完成或不推薦，沒有去過不可標為完成或不推薦。
-- 全部標記後行程進入已封存，之後不可再修改。
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(16);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'po@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'pc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 'pv@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status, start_date, end_date) values
  ('e1000000-0000-0000-0000-000000000001', '東京一日', '00000000-0000-0000-0000-0000000000e1', 'ended', '2026-11-20', '2026-11-20'),
  ('e1000000-0000-0000-0000-000000000002', '進行中', '00000000-0000-0000-0000-0000000000e1', 'in_progress', '2026-11-20', '2026-11-22');
insert into public.trip_members (trip_id, user_id, role) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'companion'),
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'viewer');

create function pg_temp.item(p_id uuid, p_trip uuid, p_life text, p_date date) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status,
    scheduled_date, scheduled_start, scheduled_end)
  values (p_id, p_trip, '項目', 'attraction', 60, 3, 'low', '測試', 0, 0, 0, 0, 0, 0, 0, 0, 'verified',
    p_life::public.lifecycle_status, p_date, case when p_date is null then null else time '10:00' end,
    case when p_date is null then null else time '11:00' end);
$$;
-- v：去過；s：略過；n：沒有紀錄；u：計畫外的 Backup（去過）；c：從未排入的候選；x：另一個行程
select pg_temp.item('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'completed', '2026-11-20');
select pg_temp.item('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'locked', '2026-11-20');
select pg_temp.item('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'locked', '2026-11-20');
select pg_temp.item('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'verified', null);
select pg_temp.item('e2000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'verified', null);
select pg_temp.item('e2000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000002', 'locked', '2026-11-20');
insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by) values
  ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'completed', '00000000-0000-0000-0000-0000000000e2'),
  ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 'skipped', '00000000-0000-0000-0000-0000000000e2'),
  ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000004', 'completed', '00000000-0000-0000-0000-0000000000e2');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'completed')$$,
  '42501', null, 'Viewer 不可標記旅後狀態');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000009', 'completed')$$,
  '55000', null, '行程尚未結束時不可標記');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'skipped')$$,
  '22023', null, '去過的項目不可標為略過');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'completed')$$,
  '22023', null, '沒有紀錄的項目不可標為完成');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 'not_recommended')$$,
  '22023', null, '略過的項目不可標為不推薦');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000005', 'skipped')$$,
  '22023', null, '從未排入、沒有紀錄的候選不需標記');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000009', 'skipped')$$,
  '22023', null, '不可標記其他行程的項目');

select is(public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'revisit') ->> 'trip_status',
  'ended', 'Companion 標記：還有項目未標記，行程維持已結束');
select is(public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 'skipped') ->> 'remaining',
  '2', '回傳尚未標記的項目數');
select lives_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000003', 'cancelled')$$,
  '沒有去過的項目可標為取消');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000004', 'completed') ->> 'trip_status',
  'archived', '全部標記後行程進入已封存');
reset role;

select results_eq($$select id::text, post_trip_status::text from public.itinerary_items
  where trip_id = 'e1000000-0000-0000-0000-000000000001' order by id$$,
  $$values ('e2000000-0000-0000-0000-000000000001', 'revisit'), ('e2000000-0000-0000-0000-000000000002', 'skipped'),
    ('e2000000-0000-0000-0000-000000000003', 'cancelled'), ('e2000000-0000-0000-0000-000000000004', 'completed'),
    ('e2000000-0000-0000-0000-000000000005', null)$$, '保存旅後狀態；候選不標記');
select is((select status::text from public.trips where id = 'e1000000-0000-0000-0000-000000000001'), 'archived', '行程已封存');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select public.set_post_trip_status('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'completed')$$,
  '55000', null, '已封存後不可再修改');
select throws_ok($$update public.itinerary_items set post_trip_status = 'completed' where id = 'e2000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'authenticated 不可直接修改旅後狀態');
reset role;
select is((select count(*)::int from public.itinerary_items where trip_id = 'e1000000-0000-0000-0000-000000000002' and post_trip_status is not null), 0,
  '其他行程不受影響');

select * from finish();
rollback;
