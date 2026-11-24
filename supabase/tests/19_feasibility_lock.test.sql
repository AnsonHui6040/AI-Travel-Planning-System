-- T30：可行性驗證與鎖定。approve_day 由 Owner、Companion 批准一天；所有日期批准後行程鎖定。
-- 鎖定後新研究只進 Candidate List。set_item_availability 只給 service_role（背景 job）。
-- O：Owner；C：Companion；V：Viewer；X：非成員
begin;
select plan(24);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'do@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'dc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'dv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', 'dx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('d2000000-0000-0000-0000-000000000001', '東京兩日', '00000000-0000-0000-0000-0000000000d1', 'planning'),
  ('d2000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000d1', 'planning');
insert into public.trip_members (trip_id, user_id, role) values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'companion'),
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d3', 'viewer');
insert into public.trip_baselines (trip_id, version, data, confirmed_at) values
  ('d2000000-0000-0000-0000-000000000001', 1, jsonb_build_object('start_date', '2026-12-01', 'end_date', '2026-12-02'), now()),
  ('d2000000-0000-0000-0000-000000000002', 1, jsonb_build_object('start_date', '2026-12-01', 'end_date', '2026-12-01'), now());
insert into public.background_jobs (id, kind, initiator_id, trip_id, status) values
  ('d3000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000d1', 'd2000000-0000-0000-0000-000000000001', 'running');

create function pg_temp.item(p_id uuid, p_trip uuid, p_status text, p_life text, p_role text) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status, candidate_role)
  values (p_id, p_trip, '候選', 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0,
    p_status::public.verification_status, p_life::public.lifecycle_status, p_role::public.candidate_role);
$$;
select pg_temp.item('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'verified', 'verified', 'primary');
select pg_temp.item('d4000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'partially_verified', 'verified', 'primary');
select pg_temp.item('d4000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000001', 'unverified', 'candidate', 'primary');
select pg_temp.item('d4000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001', 'verified', 'verified', 'backup');
select pg_temp.item('d4000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000002', 'verified', 'verified', 'primary');
select pg_temp.item('d4000000-0000-0000-0000-000000000006', 'd2000000-0000-0000-0000-000000000001', 'verified', 'verified', 'primary');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.entry(p_item text, p_start text, p_end text) returns jsonb language sql as $$
  select jsonb_build_object('item_id', p_item, 'start', p_start, 'end', p_end, 'movable_from', p_start, 'movable_to', p_start);
$$;
grant execute on function pg_temp.entry(text, text, text) to authenticated;

-- set_item_availability -------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.set_item_availability(uuid, uuid, jsonb, text)', 'execute'), false,
  'authenticated 不可寫入營業時段');
set local role service_role;
select lives_ok($$select public.set_item_availability('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  '[{"weekday": 2, "start": "09:00", "end": "17:00"}]', 'required')$$, '背景 job 寫入營業時段與預約需求');
select throws_ok($$select public.set_item_availability('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  '[{"weekday": 2, "start": "18:00", "end": "17:00"}]', 'none')$$, '22023', null, '結束時間須晚於開始時間');
select throws_ok($$select public.set_item_availability('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  '[{"weekday": 2, "start": "09:00", "end": "17:00", "note": "x"}]', 'none')$$, '22023', null, '不接受多餘欄位');
select throws_ok($$select public.set_item_availability('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000005',
  '[]', 'none')$$, '42501', null, '不可寫入其他行程的項目');
reset role;
select results_eq($$select availability ->> 0, reservation_requirement::text from public.itinerary_items where id = 'd4000000-0000-0000-0000-000000000001'$$,
  $$values ('{"end": "17:00", "start": "09:00", "weekday": 2}', 'required')$$, '營業時段已寫入');

-- approve_day：權限與檢查 ---------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000001', '09:00', '10:00')), 0)$$, '42501', null, 'Viewer 不可批准');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000001', '09:00', '10:00')), 0)$$, '42501', null, '非成員不可批准');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000003', '09:00', '10:00')), 0)$$, '55000', null, 'Unverified 不可排入');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000004', '09:00', '10:00')), 0)$$, '55000', null, 'Backup 不可排入');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000005', '09:00', '10:00')), 0)$$, '42501', null, '不可排入其他行程的項目');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000001', '09:00', '10:30'),
    pg_temp.entry('d4000000-0000-0000-0000-000000000002', '10:00', '11:00')), 0)$$, '22023', null, '時段重疊');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-05',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000001', '09:00', '10:00')), 0)$$, '22023', null, '日期不在行程期間內');
select is(public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000001', '09:00', '10:00')), 7) ->> 'outcome', 'invalidated',
  'base version 不同時不寫入');

-- approve_day：批准第一天 ----------------------------------------------------------
select is(public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000001', '09:00', '10:00'),
    pg_temp.entry('d4000000-0000-0000-0000-000000000002', '10:30', '11:30')), 0),
  '{"major": 1, "minor": 0, "locked": false, "outcome": "approved"}'::jsonb, 'Companion 批准第一天，建立 v1.0');
reset role;
select results_eq($$select id::text, lifecycle_status::text, scheduled_date::text, scheduled_start::text from public.itinerary_items
  where id in ('d4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000002') order by id$$,
  $$values ('d4000000-0000-0000-0000-000000000001', 'approved', '2026-12-01', '09:00:00'),
    ('d4000000-0000-0000-0000-000000000002', 'approved', '2026-12-01', '10:30:00')$$, '項目進入已批准並寫入時段');
select results_eq($$select d.status::text, t.status::text, t.current_version from public.days d join public.trips t on t.id = d.trip_id
  where d.trip_id = 'd2000000-0000-0000-0000-000000000001'$$, $$values ('approved', 'planning', 1)$$, '該日已批准，行程仍在規劃中');
select is((select count(*)::int from public.notifications where trip_id = 'd2000000-0000-0000-0000-000000000001' and kind = 'day_approved'), 2,
  '通知其他成員');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000006', '13:00', '14:00')), 1)$$, '55000', null, '已批准的日期不可再批准');

-- 批准最後一天：行程鎖定 ---------------------------------------------------------------
select is(public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-02',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000006', '09:00', '10:00')), 1) ->> 'locked', 'true',
  '所有日期都批准後鎖定');
reset role;
select results_eq($$select t.status::text, (select array_agg(distinct lifecycle_status::text) from public.itinerary_items
  where trip_id = t.id and scheduled_date is not null) from public.trips t where t.id = 'd2000000-0000-0000-0000-000000000001'$$,
  $$values ('locked', array['locked'])$$, '行程與排入的項目依序進入已鎖定');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.approve_day('d2000000-0000-0000-0000-000000000001', '2026-12-02',
  jsonb_build_array(pg_temp.entry('d4000000-0000-0000-0000-000000000006', '09:00', '10:00')), 2)$$, '55000', null, '鎖定後不可再批准');
reset role;

-- 鎖定後新研究只進 Candidate List ----------------------------------------------------------
set local role service_role;
select is(public.add_research_candidates('d3000000-0000-0000-0000-000000000001', 'A', jsonb_build_array(jsonb_build_object(
  'name_zh', '新咖啡店', 'name_local', null, 'area', '淺草', 'type', 'restaurant', 'recommendation_reason', '測試',
  'suggested_stay_minutes', 45, 'constraint_note', null, 'place_id', null,
  'sources', jsonb_build_array(jsonb_build_object('url', 'https://www.example.jp/', 'fetched_at', '2026-11-24T10:00:00+09:00', 'grade', 'facility_official')),
  'generated_by', jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5')))), 1, '鎖定後仍可加入候選');
reset role;
select results_eq($$select lifecycle_status::text, scheduled_date from public.itinerary_items where name_zh = '新咖啡店'$$,
  $$values ('candidate', null::date)$$, '新研究只進 Candidate List，不排入行程');

select * from finish();
rollback;
