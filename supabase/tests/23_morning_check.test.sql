-- T36：Morning Check（第 2.8 節 Day Ready）。Owner、Companion 經 complete_morning_check 完成；
-- At Risk 以 approved_fact_invalidated 提案自動套用（Change Log 記錄提出者），Standby 提升同行程的候選，
-- 該日由已批准進入 Day Ready，結果保存於 morning_checks。
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000b7', 'mo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b8', 'mc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b9', 'mv@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status, current_version) values
  ('b7000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000b7', 'locked', 5),
  ('b7000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000b7', 'locked', 0);
insert into public.trip_members (trip_id, user_id, role) values
  ('b7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b8', 'companion'),
  ('b7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b9', 'viewer');
insert into public.days (trip_id, date, status) values
  ('b7000000-0000-0000-0000-000000000001', '2026-12-10', 'approved'),
  ('b7000000-0000-0000-0000-000000000001', '2026-12-11', 'draft');

create function pg_temp.item(p_id uuid, p_trip uuid, p_life text, p_date date) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status,
    scheduled_date, scheduled_start, scheduled_end)
  values (p_id, p_trip, '項目', 'attraction', 60, 3, 'high', '測試', 0, 0, 0, 0, 0, 0, 0, 0, 'verified',
    p_life::public.lifecycle_status, p_date, case when p_date is null then null else '13:00'::time end,
    case when p_date is null then null else '15:00'::time end);
$$;
select pg_temp.item('b8000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'locked', '2026-12-10');
select pg_temp.item('b8000000-0000-0000-0000-000000000002', 'b7000000-0000-0000-0000-000000000001', 'verified', null);
select pg_temp.item('b8000000-0000-0000-0000-000000000003', 'b7000000-0000-0000-0000-000000000002', 'verified', null);
select pg_temp.item('b8000000-0000-0000-0000-000000000004', 'b7000000-0000-0000-0000-000000000001', 'locked', '2026-12-11');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.result() returns jsonb language sql as $$
  select jsonb_build_object('checks', jsonb_build_array(jsonb_build_object('check', 'weather', 'status', 'attention', 'detail', '13:00–18:00 預報有雨')));
$$;
grant execute on function pg_temp.result() to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
select throws_ok($$select public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', pg_temp.result(),
  array[]::uuid[], array[]::uuid[])$$, '42501', null, 'Viewer 不可執行 Morning Check');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
select throws_ok($$select public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-11', pg_temp.result(),
  array[]::uuid[], array[]::uuid[])$$, '55000', null, '只有已批准的日期可以執行');
select throws_ok($$select public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', pg_temp.result(),
  array['b8000000-0000-0000-0000-000000000004']::uuid[], array[]::uuid[])$$, '22023', null, 'At Risk 只能是當天排入的項目');
select throws_ok($$select public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', pg_temp.result(),
  array[]::uuid[], array['b8000000-0000-0000-0000-000000000003']::uuid[])$$, '22023', null, 'Standby 只能是同行程尚未排入的候選');
select throws_ok($$select public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', pg_temp.result(),
  array[]::uuid[], array['b8000000-0000-0000-0000-000000000001']::uuid[])$$, '22023', null, '已排入的項目不可設為 Standby');
select throws_ok($$select public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', '"x"'::jsonb,
  array[]::uuid[], array[]::uuid[])$$, '22023', null, '結果格式不正確');

select is(public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', pg_temp.result(),
  array['b8000000-0000-0000-0000-000000000001']::uuid[], array['b8000000-0000-0000-0000-000000000002']::uuid[]) ->> 'status',
  'day_ready', 'Companion 完成 Morning Check');
reset role;

select results_eq($$select at_risk from public.itinerary_items where id = 'b8000000-0000-0000-0000-000000000001'$$, $$values (true)$$, '項目標示 At Risk');
select results_eq($$select standby from public.itinerary_items where id = 'b8000000-0000-0000-0000-000000000002'$$, $$values (true)$$, '候選提升為 Standby');
select results_eq($$select status::text from public.days where trip_id = 'b7000000-0000-0000-0000-000000000001' and date = '2026-12-10'$$,
  $$values ('day_ready')$$, '該日進入 Day Ready');
select results_eq($$select p.status::text, p.change ->> 'changeKind', p.proposer_member_id::text, v.approved_by is null, t.current_version
  from public.proposals p join public.versions v on v.proposal_id = p.id join public.trips t on t.id = p.trip_id
  where p.trip_id = 'b7000000-0000-0000-0000-000000000001'$$,
  $$values ('applied', 'approved_fact_invalidated', '00000000-0000-0000-0000-0000000000b8', true, 6)$$,
  'At Risk 經提案自動套用，Change Log 記錄提出者');
select results_eq($$select checked_by::text, result -> 'checks' -> 0 ->> 'check' from public.morning_checks
  where trip_id = 'b7000000-0000-0000-0000-000000000001' and date = '2026-12-10'$$,
  $$values ('00000000-0000-0000-0000-0000000000b8', 'weather')$$, '保存結果與執行者');
select is((select count(*)::int from public.notifications where trip_id = 'b7000000-0000-0000-0000-000000000001'
  and kind = 'proposal_applied'), 3, '通知成員');

-- Day Ready 當天可再次執行（例如出發前再看一次）；沒有 At Risk 時不建立提案
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is(public.complete_morning_check('b7000000-0000-0000-0000-000000000001', '2026-12-10', pg_temp.result(),
  array[]::uuid[], array[]::uuid[]) ->> 'status', 'day_ready', 'Owner 可再次執行');
reset role;
select is((select count(*)::int from public.proposals where trip_id = 'b7000000-0000-0000-0000-000000000001'), 1, '沒有 At Risk 時不建立提案');
select is((select count(*)::int from public.morning_checks where trip_id = 'b7000000-0000-0000-0000-000000000001'), 2, '每次執行都保存結果');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
select is((select count(*)::int from public.morning_checks), 2, 'Viewer 可檢視 Morning Check 結果');
reset role;

select * from finish();
rollback;
