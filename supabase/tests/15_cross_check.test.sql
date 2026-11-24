-- T25：去重與交叉核查。只經 merge_duplicate_candidates、apply_verification（service_role，背景 job）寫入
begin;
select plan(20);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'vo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'vv@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('d2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000d1', 'planning'),
  ('d2000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000d1', 'planning');
insert into public.trip_members (trip_id, user_id, role) values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'viewer');
insert into public.background_jobs (id, kind, initiator_id, trip_id, status) values
  ('d3000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000d1', 'd2000000-0000-0000-0000-000000000001', 'running'),
  ('d3000000-0000-0000-0000-000000000002', 'research', '00000000-0000-0000-0000-0000000000d2', 'd2000000-0000-0000-0000-000000000001', 'running'),
  ('d3000000-0000-0000-0000-000000000003', 'research', '00000000-0000-0000-0000-0000000000d1', 'd2000000-0000-0000-0000-000000000001', 'completed');

create function pg_temp.item(p_id uuid, p_trip uuid, p_name text, p_url text, p_lifecycle text default 'candidate') returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, sources, generated_by, lifecycle_status, fact_claims)
  values (p_id, p_trip, p_name, 'attraction', 60, 3, 'medium', '早上人少', 0, 0, 0, 0, 0, 0, 0, 0,
    jsonb_build_array(jsonb_build_object('url', p_url, 'fetched_at', '2026-11-23T10:00:00+09:00', 'grade', 'reliable_third_party')),
    jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5'), p_lifecycle::public.lifecycle_status,
    jsonb_build_array(jsonb_build_object('field', 'opening_hours', 'value', '10:00–18:00',
      'source', jsonb_build_object('url', p_url, 'fetched_at', '2026-11-23T10:00:00+09:00', 'grade', 'reliable_third_party'),
      'by', jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5'))));
$$;
select pg_temp.item('d4000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', '淺草寺', 'https://a.example/');
select pg_temp.item('d4000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', '浅草寺', 'https://b.example/');
select pg_temp.item('d4000000-0000-0000-0000-000000000003', 'd2000000-0000-0000-0000-000000000001', '雷門', 'https://c.example/');
select pg_temp.item('d4000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000002', '別處', 'https://d.example/');
select pg_temp.item('d4000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000001', '已排程', 'https://e.example/', 'draft');

create function pg_temp.verified_facts() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('field', 'opening_hours', 'status', 'resolved', 'value', '09:00–17:00', 'grade', 'facility_official'));
$$;
create function pg_temp.claims() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('field', 'opening_hours', 'value', '09:00–17:00',
    'source', jsonb_build_object('url', 'https://www.senso-ji.jp/', 'fetched_at', '2026-11-24T10:00:00+09:00', 'grade', 'facility_official'),
    'by', jsonb_build_object('provider', 'google', 'model', 'gemini-model')));
$$;
grant execute on function pg_temp.verified_facts(), pg_temp.claims() to service_role;

-- 權限 ---------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.merge_duplicate_candidates(uuid, uuid, uuid[])', 'execute'), false, 'authenticated 不可合併');
select is(has_function_privilege('authenticated', 'public.apply_verification(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)', 'execute'), false,
  'authenticated 不可寫入核實結果');
select is(has_function_privilege('service_role', 'public.apply_verification(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)', 'execute'), true,
  'service_role 可寫入核實結果');

set local role service_role;
-- 合併 ---------------------------------------------------------------------
select is(public.merge_duplicate_candidates('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  array['d4000000-0000-0000-0000-000000000002']::uuid[]), 1, '合併一筆重複候選');
select is((select count(*)::int from public.itinerary_items where id = 'd4000000-0000-0000-0000-000000000002'), 0, '重複的一筆已刪除');
select results_eq($$select jsonb_array_length(sources), jsonb_array_length(fact_claims) from public.itinerary_items where id = 'd4000000-0000-0000-0000-000000000001'$$,
  $$values (2, 2)$$, '來源與事實主張併入保留的一筆');
select throws_ok($$select public.merge_duplicate_candidates('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  array['d4000000-0000-0000-0000-000000000004']::uuid[])$$, '22023', null, '不可合併其他行程的項目');
select throws_ok($$select public.merge_duplicate_candidates('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  array['d4000000-0000-0000-0000-000000000005']::uuid[])$$, '22023', null, '已進入行程草案的項目不可合併');
select throws_ok($$select public.merge_duplicate_candidates('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001',
  array['d4000000-0000-0000-0000-000000000001']::uuid[])$$, '22023', null, '不可與自己合併');
select throws_ok($$select public.merge_duplicate_candidates('d3000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000001',
  array['d4000000-0000-0000-0000-000000000003']::uuid[])$$, '42501', null, 'Viewer 發起的 job 不可合併');

-- 核實 ---------------------------------------------------------------------
select lives_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'verified',
  pg_temp.verified_facts(), pg_temp.claims(), jsonb_build_array(jsonb_build_object('url', 'https://www.senso-ji.jp/', 'fetched_at', '2026-11-24T10:00:00+09:00', 'grade', 'facility_official')),
  jsonb_build_object('provider', 'google', 'model', 'gemini-model'))$$, '寫入 Verified');
select results_eq($$select verification_status::text, lifecycle_status::text, verified_by ->> 'provider', last_verified_at is not null,
    facts -> 0 ->> 'value', jsonb_array_length(fact_claims), jsonb_array_length(sources)
  from public.itinerary_items where id = 'd4000000-0000-0000-0000-000000000001'$$,
  $$values ('verified', 'verified', 'google', true, '09:00–17:00', 3, 3)$$, 'Verified：生命週期為已核實，事實與來源附加');

select lives_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003', 'verified',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, jsonb_build_object('provider', 'anthropic', 'model', 'claude-opus-5-5'))$$, '同一家核實');
select is((select verification_status::text from public.itinerary_items where id = 'd4000000-0000-0000-0000-000000000003'), 'partially_verified',
  '同一家時資料庫也限制為 Partially Verified（D07）');

select lives_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000003', 'conflict',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, jsonb_build_object('provider', 'google', 'model', 'gemini-model'))$$, '寫入 Conflict');
select results_eq($$select verification_status::text, lifecycle_status::text from public.itinerary_items where id = 'd4000000-0000-0000-0000-000000000003'$$,
  $$values ('conflict', 'pending_verification')$$, 'Conflict：留在待核實，不進入行程');

select throws_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000005', 'verified',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, jsonb_build_object('provider', 'google', 'model', 'gemini-model'))$$, '55000', null,
  '已進入行程草案的項目不經此函式改變');
select throws_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000004', 'verified',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, jsonb_build_object('provider', 'google', 'model', 'gemini-model'))$$, '42501', null,
  '不可核實其他行程的項目');
select throws_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000003', 'd4000000-0000-0000-0000-000000000001', 'verified',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, jsonb_build_object('provider', 'google', 'model', 'gemini-model'))$$, '55000', null,
  '已結束的 job 不可寫入');
select throws_ok($$select public.apply_verification('d3000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'approved',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, jsonb_build_object('provider', 'google', 'model', 'gemini-model'))$$, '22023', null,
  '核實狀態只限四種');
reset role;

select * from finish();
rollback;
