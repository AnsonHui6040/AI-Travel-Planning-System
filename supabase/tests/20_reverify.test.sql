-- T31：旅前自動再核實（D25、C-12）。只有 Owner 可開關排程；排程 job 以 Owner 為發起人（使用 Owner 的 key）；
-- 未開啟時不建立 job；T-7、T-1 各一次。問題項目以 approved_fact_invalidated 提案標示 At Risk 並通知成員。
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(20);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'eo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'ec@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 'ev@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status, current_version) values
  ('e2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000e1', 'locked', 2),
  ('e2000000-0000-0000-0000-000000000002', '另一個行程', '00000000-0000-0000-0000-0000000000e1', 'locked', 0);
insert into public.trip_members (trip_id, user_id, role) values
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'companion'),
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'viewer');

create function pg_temp.item(p_id uuid, p_trip uuid) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status,
    scheduled_date, scheduled_start, scheduled_end)
  values (p_id, p_trip, '咖啡店', 'restaurant', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0, 'verified', 'locked',
    '2026-12-10', '13:00', '14:00');
$$;
select pg_temp.item('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001');
select pg_temp.item('e4000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.at_risk(p_item text) returns jsonb language sql as $$
  select jsonb_build_object('changeKind', 'approved_fact_invalidated', 'versionKind', 'minor',
    'summary', '旅前再核實：1 個項目的資料可能已有變動，標示為 At Risk',
    'operations', jsonb_build_array(jsonb_build_object('op', 'set_at_risk', 'itemId', p_item, 'atRisk', true)));
$$;
grant execute on function pg_temp.at_risk(text) to service_role;

-- 開關排程 ----------------------------------------------------------------------
select is((select reverify_enabled from public.trips where id = 'e2000000-0000-0000-0000-000000000001'), false, '預設未開啟');
select is(has_function_privilege('service_role', 'public.set_reverify_schedule(uuid, boolean)', 'execute'), false,
  '開關只經使用者本人的 session');

set local role service_role;
select is(public.start_reverification('e2000000-0000-0000-0000-000000000001', 'T-7'), null, 'Owner 未開啟排程時不建立 job');
reset role;
select is((select count(*)::int from public.background_jobs where trip_id = 'e2000000-0000-0000-0000-000000000001'), 0, '沒有建立 job');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.set_reverify_schedule('e2000000-0000-0000-0000-000000000001', true)$$, '42501', null, 'Companion 不可開啟');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select throws_ok($$select public.set_reverify_schedule('e2000000-0000-0000-0000-000000000001', true)$$, '42501', null, 'Viewer 不可開啟');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$select public.set_reverify_schedule('e2000000-0000-0000-0000-000000000001', true)$$, 'Owner 開啟排程');
reset role;
select is((select reverify_enabled from public.trips where id = 'e2000000-0000-0000-0000-000000000001'), true, '已開啟');

-- 建立排程 job ---------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.start_reverification(uuid, text)', 'execute'), false,
  'authenticated 不可建立排程 job');
set local role service_role;
select isnt(public.start_reverification('e2000000-0000-0000-0000-000000000001', 'T-7'), null, '開啟後建立 T-7 job');
select is(public.start_reverification('e2000000-0000-0000-0000-000000000001', 'T-7'), null, '同一個 T-7 不重複建立');
select throws_ok($$select public.start_reverification('e2000000-0000-0000-0000-000000000001', 'T-3')$$, '22023', null, '只接受 T-7、T-1');
reset role;
select results_eq($$select j.kind, j.initiator_id::text, j.status::text from public.background_jobs j
  join public.reverify_runs r on r.job_id = j.id where r.trip_id = 'e2000000-0000-0000-0000-000000000001'$$,
  $$values ('reverify', '00000000-0000-0000-0000-0000000000e1', 'running')$$, 'job 的發起人是 Owner（C-12：使用 Owner 的 key）');

-- 標示 At Risk ---------------------------------------------------------------------
set local role service_role;
select is(public.submit_reverify_at_risk((select job_id from public.reverify_runs where trip_id = 'e2000000-0000-0000-0000-000000000001'),
  pg_temp.at_risk('e4000000-0000-0000-0000-000000000001'), '{"provider": "google", "model": "gemini-model"}') ->> 'outcome', 'applied',
  '自動套用 At Risk 提案');
select throws_ok($$select public.submit_reverify_at_risk((select job_id from public.reverify_runs where trip_id = 'e2000000-0000-0000-0000-000000000001'),
  pg_temp.at_risk('e4000000-0000-0000-0000-000000000002'), '{"provider": "google", "model": "gemini-model"}')$$, '42501', null,
  '不可標示其他行程的項目');
select throws_ok($$select public.submit_reverify_at_risk((select job_id from public.reverify_runs where trip_id = 'e2000000-0000-0000-0000-000000000001'),
  jsonb_set(pg_temp.at_risk('e4000000-0000-0000-0000-000000000001'), '{changeKind}', '"major_version"'),
  '{"provider": "google", "model": "gemini-model"}')$$, '22023', null, '只接受 At Risk 標示');
select throws_ok($$select public.submit_reverify_at_risk(gen_random_uuid(),
  pg_temp.at_risk('e4000000-0000-0000-0000-000000000001'), '{"provider": "google", "model": "gemini-model"}')$$, '42501', null,
  '必須是執行中的再核實 job');
reset role;
select results_eq($$select i.at_risk, p.status::text, p.proposer_role::text, t.current_version from public.itinerary_items i
  join public.proposals p on p.trip_id = i.trip_id join public.trips t on t.id = i.trip_id
  where i.id = 'e4000000-0000-0000-0000-000000000001'$$, $$values (true, 'applied', 'verification', 3)$$,
  '項目標示 At Risk，Change Log 記錄提出者');
-- SH-06：成員開啟 App 時看到未讀通知
select is((select count(*)::int from public.notifications where trip_id = 'e2000000-0000-0000-0000-000000000001'
  and kind = 'proposal_applied' and read_at is null), 3, '通知所有成員（未讀）');

-- Owner 可隨時關閉 ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select public.set_reverify_schedule('e2000000-0000-0000-0000-000000000001', false);
reset role;
set local role service_role;
select is(public.start_reverification('e2000000-0000-0000-0000-000000000001', 'T-1'), null, '關閉後不再建立 job');
reset role;

select * from finish();
rollback;
