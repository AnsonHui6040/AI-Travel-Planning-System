-- T26：候選篩選。評分與 Primary／Backup 只經 apply_candidate_scores（service_role，背景 job）寫入
begin;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'so@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('e2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000e1', 'planning'),
  ('e2000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000e1', 'planning');
insert into public.background_jobs (id, kind, initiator_id, trip_id, status) values
  ('e3000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000e1', 'e2000000-0000-0000-0000-000000000001', 'running');

create function pg_temp.item(p_id uuid, p_trip uuid, p_lifecycle text default 'candidate') returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, lifecycle_status)
  values (p_id, p_trip, '候選', 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0, p_lifecycle::public.lifecycle_status);
$$;
select pg_temp.item('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001');
select pg_temp.item('e4000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002');
select pg_temp.item('e4000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', 'draft');

create function pg_temp.score(p_item uuid, p_value int, p_role text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'candidate_role', p_role, 'priority', 4, 'weather_dependency', 'high',
    'scores', jsonb_build_object('personal_value', p_value, 'uniqueness', 4, 'geographic_fit', 5, 'time_cost', 5, 'transport_cost', 3,
      'weather_dependency', 1, 'time_slot_dependency', 2, 'substitutability', 3)));
$$;
grant execute on function pg_temp.score(uuid, int, text) to service_role;

select is(has_function_privilege('authenticated', 'public.apply_candidate_scores(uuid, jsonb)', 'execute'), false, 'authenticated 不可寫入評分');
select is(has_function_privilege('service_role', 'public.apply_candidate_scores(uuid, jsonb)', 'execute'), true, 'service_role 可寫入評分');

set local role service_role;
select is(public.apply_candidate_scores('e3000000-0000-0000-0000-000000000001', pg_temp.score('e4000000-0000-0000-0000-000000000001', 5, 'backup')), 1,
  '寫入一個候選的評分');
select results_eq($$select score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, candidate_role::text, priority, weather_dependency::text
  from public.itinerary_items where id = 'e4000000-0000-0000-0000-000000000001'$$,
  $$values (5::smallint, 4::smallint, 5::smallint, 5::smallint, 3::smallint, 1::smallint, 2::smallint, 3::smallint, 'backup', 4, 'high')$$,
  '八個維度、候選角色、優先度與天氣依賴度');
select throws_ok($$select public.apply_candidate_scores('e3000000-0000-0000-0000-000000000001', pg_temp.score('e4000000-0000-0000-0000-000000000002', 5, 'primary'))$$,
  '42501', null, '不可評分其他行程的項目');
select throws_ok($$select public.apply_candidate_scores('e3000000-0000-0000-0000-000000000001', pg_temp.score('e4000000-0000-0000-0000-000000000003', 5, 'primary'))$$,
  '42501', null, '已進入行程草案的項目不經此函式改變');
select throws_ok($$select public.apply_candidate_scores('e3000000-0000-0000-0000-000000000001', pg_temp.score('e4000000-0000-0000-0000-000000000001', 6, 'primary'))$$,
  '23514', null, '評分超出 0–5 時拒絕');
select throws_ok($$select public.apply_candidate_scores('e3000000-0000-0000-0000-000000000001', pg_temp.score('e4000000-0000-0000-0000-000000000001', 5, 'standby'))$$,
  '22P02', null, '候選角色只限 Primary 與 Backup');
select throws_ok($$select public.apply_candidate_scores('e3000000-0000-0000-0000-000000000001', '{}'::jsonb)$$,
  '22023', null, '評分必須是陣列');
reset role;

select * from finish();
rollback;
