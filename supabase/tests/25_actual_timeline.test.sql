-- T39：Actual Timeline（第 2.8、2.9 節）。成員記錄實際到達、離開與完成狀態；
-- produce_actual_timeline 產生當日 Planned vs Actual：只有最後一筆紀錄為完成的項目成為已完成（已去過），
-- 該日進入已完成，最後一日產生後行程進入已結束。
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'to@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'tc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'tv@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status, start_date, end_date, current_version) values
  ('d1000000-0000-0000-0000-000000000001', '東京兩日', '00000000-0000-0000-0000-0000000000d1', 'in_progress', '2026-11-20', '2026-11-21', 3),
  ('d1000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000d1', 'in_progress', '2026-11-20', '2026-11-20', 0);
insert into public.trip_members (trip_id, user_id, role) values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'companion'),
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d3', 'viewer');
insert into public.days (trip_id, date, status) values
  ('d1000000-0000-0000-0000-000000000001', '2026-11-20', 'day_ready'),
  ('d1000000-0000-0000-0000-000000000001', '2026-11-21', 'approved');

create function pg_temp.item(p_id uuid, p_trip uuid, p_date date, p_start time) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status,
    scheduled_date, scheduled_start, scheduled_end)
  values (p_id, p_trip, '項目', 'attraction', 60, 3, 'low', '測試', 0, 0, 0, 0, 0, 0, 0, 0, 'verified',
    case when p_date is null then 'verified' else 'locked' end::public.lifecycle_status,
    p_date, p_start, p_start + interval '1 hour');
$$;
-- 第一天：完成、部分完成、略過、沒有紀錄；第二天一個項目；另一個行程的項目
select pg_temp.item('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', '2026-11-20', '09:00');
select pg_temp.item('d2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', '2026-11-20', '11:00');
select pg_temp.item('d2000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', '2026-11-20', '14:00');
select pg_temp.item('d2000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001', '2026-11-20', '16:00');
select pg_temp.item('d2000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001', '2026-11-21', '10:00');
select pg_temp.item('d2000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-000000000002', '2026-11-20', '10:00');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.rows(p_visited uuid[]) returns jsonb language sql as $$
  select jsonb_build_object('date', '2026-11-20', 'rows',
    coalesce((select jsonb_agg(jsonb_build_object('itemId', v, 'visited', true)) from unnest(p_visited) v), '[]'::jsonb));
$$;
grant execute on function pg_temp.rows(uuid[]) to authenticated;

-- 記錄（直接寫入 actual_timeline_entries，RLS 限 Owner、Companion 本人）
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select lives_ok($$insert into public.actual_timeline_entries (trip_id, item_id, arrived_at, departed_at, completion, recorded_by) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', '2026-11-20T00:05:00Z', '2026-11-20T01:00:00Z', 'completed', '00000000-0000-0000-0000-0000000000d2'),
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', '2026-11-20T02:10:00Z', '2026-11-20T02:30:00Z', 'partial', '00000000-0000-0000-0000-0000000000d2'),
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000003', null, null, 'completed', '00000000-0000-0000-0000-0000000000d2')$$,
  'Companion 記錄實際到達、離開與完成狀態');
-- 後來改為略過：以最後一筆為準
select lives_ok($$insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by, created_at) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000003', 'skipped', '00000000-0000-0000-0000-0000000000d2', now() + interval '1 second')$$,
  '同一項目可再記錄');
select throws_ok($$insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000009', 'completed', '00000000-0000-0000-0000-0000000000d2')$$,
  '22023', null, '不可記錄其他行程的項目');
select throws_ok($$insert into public.actual_timeline_entries (trip_id, item_id, arrived_at, completion, recorded_by) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004', now() + interval '1 hour', 'completed', '00000000-0000-0000-0000-0000000000d2')$$,
  '22023', null, '實際時間不可晚於現在');
select throws_ok($$insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004', 'completed', '00000000-0000-0000-0000-0000000000d1')$$,
  '42501', null, '不可以他人名義記錄');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20', pg_temp.rows('{}'))$$,
  '42501', null, 'Viewer 不可產生 Actual Timeline');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20', '[]'::jsonb)$$,
  '22023', null, '格式不正確');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20',
  pg_temp.rows(array['d2000000-0000-0000-0000-000000000002'::uuid]))$$,
  '22023', null, '部分完成的項目不可標為已去過');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20',
  pg_temp.rows(array['d2000000-0000-0000-0000-000000000003'::uuid]))$$,
  '22023', null, '最後一筆為略過的項目不可標為已去過');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20',
  pg_temp.rows(array['d2000000-0000-0000-0000-000000000004'::uuid]))$$,
  '22023', null, '沒有紀錄的項目不可標為已去過');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-19', pg_temp.rows('{}'))$$,
  '55000', null, '沒有批准的日期不可產生');

select is(public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20',
  pg_temp.rows(array['d2000000-0000-0000-0000-000000000001'::uuid])) ->> 'day_status', 'completed', 'Companion 產生第一天的 Actual Timeline');
reset role;

select results_eq($$select id::text, lifecycle_status::text from public.itinerary_items
  where trip_id = 'd1000000-0000-0000-0000-000000000001' and scheduled_date = '2026-11-20' order by id$$,
  $$values ('d2000000-0000-0000-0000-000000000001', 'completed'), ('d2000000-0000-0000-0000-000000000002', 'locked'),
    ('d2000000-0000-0000-0000-000000000003', 'locked'), ('d2000000-0000-0000-0000-000000000004', 'locked')$$,
  '只有完成的項目成為已完成；部分完成、略過、沒有紀錄的項目不標為已去過');
select results_eq($$select status::text, actual_timeline ->> 'date', timeline_produced_by::text from public.days
  where trip_id = 'd1000000-0000-0000-0000-000000000001' and date = '2026-11-20'$$,
  $$values ('completed', '2026-11-20', '00000000-0000-0000-0000-0000000000d2')$$, '該日進入已完成並保存 Planned vs Actual');
select is((select status::text from public.trips where id = 'd1000000-0000-0000-0000-000000000001'), 'in_progress', '不是最後一日：行程維持進行中');
select results_eq($$select count(*) > 0, bool_and(recipient_id <> '00000000-0000-0000-0000-0000000000d2')
  from public.notifications where kind = 'timeline_produced' and trip_id = 'd1000000-0000-0000-0000-000000000001'$$,
  $$values (true, true)$$, '通知其他成員（產生者本人除外）');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-20', pg_temp.rows('{}'))$$,
  '55000', null, '已完成的日期不可再次產生');
select throws_ok($$insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by) values
  ('d1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004', 'completed', '00000000-0000-0000-0000-0000000000d2')$$,
  '55000', null, '已完成日期的項目不可再記錄');

-- 最後一日：沒有任何紀錄也可產生，項目不標為已去過；行程進入已結束
select is(public.produce_actual_timeline('d1000000-0000-0000-0000-000000000001', '2026-11-21',
  jsonb_build_object('date', '2026-11-21', 'rows', '[]'::jsonb)) ->> 'trip_status', 'ended', '最後一日產生後行程進入已結束');
reset role;
select is((select lifecycle_status::text from public.itinerary_items where id = 'd2000000-0000-0000-0000-000000000005'), 'locked',
  '最後一日沒有紀錄的項目不標為已去過');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select is((select count(*)::int from public.days where trip_id = 'd1000000-0000-0000-0000-000000000001' and actual_timeline is not null), 2,
  'Viewer 可讀 Actual Timeline');
select throws_ok($$update public.days set status = 'completed' where trip_id = 'd1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'authenticated 不可直接修改每日狀態');
reset role;

select * from finish();
rollback;
