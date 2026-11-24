-- T24：Research A–D 的輸出只經 add_research_candidates 寫入 Candidate List（service_role，背景 job）
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(18);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'ro@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'rc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'rv@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('c2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000c1', 'planning'),
  ('c2000000-0000-0000-0000-000000000002', '還在基線', '00000000-0000-0000-0000-0000000000c1', 'baseline');
insert into public.trip_members (trip_id, user_id, role) values
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'companion'),
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c3', 'viewer');
insert into public.background_jobs (id, kind, initiator_id, trip_id, status) values
  ('c3000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000c2', 'c2000000-0000-0000-0000-000000000001', 'running'),
  ('c3000000-0000-0000-0000-000000000002', 'research', '00000000-0000-0000-0000-0000000000c3', 'c2000000-0000-0000-0000-000000000001', 'running'),
  ('c3000000-0000-0000-0000-000000000003', 'research', '00000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-000000000001', 'completed'),
  ('c3000000-0000-0000-0000-000000000004', 'verification', '00000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-000000000001', 'running'),
  ('c3000000-0000-0000-0000-000000000005', 'research', '00000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-000000000002', 'running');

create function pg_temp.candidate(p_name text, p_place text) returns jsonb language sql as $$
  select jsonb_build_object('name_zh', p_name, 'name_local', null, 'area', '淺草', 'type', 'attraction',
    'recommendation_reason', '早上人少', 'suggested_stay_minutes', 60, 'constraint_note', null,
    'sources', jsonb_build_array(jsonb_build_object('url', 'https://www.senso-ji.jp/', 'fetched_at', '2026-11-23T10:00:00+09:00', 'grade', 'facility_official')),
    'generated_by', jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5'),
    'place_id', p_place, 'verification_status', 'verified');
$$;
grant execute on function pg_temp.candidate(text, text) to service_role;

-- 權限 ---------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.add_research_candidates(uuid, text, jsonb)', 'execute'), false,
  'authenticated 不可呼叫');
select is(has_function_privilege('service_role', 'public.add_research_candidates(uuid, text, jsonb)', 'execute'), true,
  'service_role 可呼叫');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
select throws_ok($$insert into public.itinerary_items (trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
  recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
  score_weather_dependency, score_time_slot_dependency, score_substitutability)
  values ('c2000000-0000-0000-0000-000000000001', 'x', 'attraction', 60, 3, 'low', 'x', 0, 0, 0, 0, 0, 0, 0, 0)$$,
  '42501', null, '使用者不可直接寫入項目');
reset role;

set local role service_role;
-- 寫入 --------------------------------------------------------------------
select is(public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'B',
  jsonb_build_array(pg_temp.candidate('淺草寺', 'ChIJ_senso'), pg_temp.candidate('雷門', null))), 2,
  'Companion 發起的研究 job 寫入兩個候選');
select results_eq($$select name_zh, place_id, lifecycle_status::text, verification_status::text, research_track, research_job_id::text,
    generated_by ->> 'provider'
  from public.itinerary_items where trip_id = 'c2000000-0000-0000-0000-000000000001' order by name_zh$$,
  $$values ('淺草寺', 'ChIJ_senso', 'candidate', 'unverified', 'B', 'c3000000-0000-0000-0000-000000000001', 'anthropic'),
           ('雷門', null, 'candidate', 'unverified', 'B', 'c3000000-0000-0000-0000-000000000001', 'anthropic')$$,
  '只進 Candidate List，核實狀態一律 Unverified（不採用輸入的 verified）');
select is(public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'B',
  jsonb_build_array(pg_temp.candidate('淺草寺', 'ChIJ_senso'))), 0, '同一 job 同一方向重送（step 重試）不重複寫入');
select is((select count(*)::int from public.itinerary_items where trip_id = 'c2000000-0000-0000-0000-000000000001'), 2, '仍為兩筆');
select is(public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'C',
  jsonb_build_array(pg_temp.candidate('隅田川夜景', null))), 1, '其他方向可寫入');

-- 拒絕 --------------------------------------------------------------------
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000002', 'A', jsonb_build_array(pg_temp.candidate('x', null)))$$,
  '42501', null, 'Viewer 發起的 job 不可寫入');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000003', 'A', jsonb_build_array(pg_temp.candidate('x', null)))$$,
  '55000', null, '已結束的 job 不可寫入');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000004', 'A', jsonb_build_array(pg_temp.candidate('x', null)))$$,
  '42501', null, '非研究 job 不可寫入');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000005', 'A', jsonb_build_array(pg_temp.candidate('x', null)))$$,
  '55000', null, '行程未確認基線時不可寫入');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-0000000000ff', 'A', jsonb_build_array(pg_temp.candidate('x', null)))$$,
  '42501', null, '不存在的 job');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'E', jsonb_build_array(pg_temp.candidate('x', null)))$$,
  '22023', null, '研究方向只限 A–D');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'D', '[]'::jsonb)$$,
  '22023', null, '候選不可為空');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'D', '{}'::jsonb)$$,
  '22023', null, '候選必須是陣列');
select throws_ok($$select public.add_research_candidates('c3000000-0000-0000-0000-000000000001', 'D',
  (select jsonb_agg(pg_temp.candidate('x' || g, null)) from generate_series(1, 31) g))$$,
  '22023', null, '每個方向最多 30 個');
reset role;

-- 成員可讀 -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.itinerary_items where lifecycle_status = 'candidate'), 3, 'Viewer 可讀 Candidate List');
reset role;

select * from finish();
rollback;
