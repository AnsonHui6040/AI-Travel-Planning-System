-- T28：交通動線比較。只經 apply_mobility_segments（service_role，背景 job）寫入；成員可讀
begin;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'mo@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('a2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000a1', 'planning'),
  ('a2000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000a1', 'planning');
insert into public.background_jobs (id, kind, initiator_id, trip_id, status) values
  ('a3000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000a1', 'a2000000-0000-0000-0000-000000000001', 'running');

create function pg_temp.item(p_id uuid, p_trip uuid) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability)
  values (p_id, p_trip, '候選', 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0);
$$;
select pg_temp.item('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001');
select pg_temp.item('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001');
select pg_temp.item('a4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002');

create function pg_temp.segment(p_from uuid, p_to uuid, p_buffer int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('from_item_id', p_from, 'to_item_id', p_to, 'buffer_minutes', p_buffer,
    'recommended_mode', 'rail', 'maps_url', 'https://www.google.com/maps/dir/?api=1&destination=x',
    'source_urls', jsonb_build_array('https://railway.example.jp/route'),
    'plans', jsonb_build_object('recommended', 'rail', 'fastest', 'rail', 'cheapest', 'rail', 'comfortable', 'rail'),
    'estimates', jsonb_build_array(jsonb_build_object('mode', 'rail', 'door_to_door_minutes', 18, 'buffer_minutes', p_buffer,
      'total_minutes', 18 + p_buffer, 'source_urls', jsonb_build_array('https://railway.example.jp/route')))));
$$;
grant execute on function pg_temp.segment(uuid, uuid, int) to service_role;

select is(has_function_privilege('authenticated', 'public.apply_mobility_segments(uuid, jsonb)', 'execute'), false, 'authenticated 不可寫入交通估算');

set local role service_role;
select is(public.apply_mobility_segments('a3000000-0000-0000-0000-000000000001',
  pg_temp.segment('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 15)), 1, '寫入一段');
select is(public.apply_mobility_segments('a3000000-0000-0000-0000-000000000001',
  pg_temp.segment('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 20)), 1, '同一段重新估算');
select results_eq($$select count(*)::int, max(buffer_minutes), max(plans ->> 'fastest') from public.mobility_segments
  where trip_id = 'a2000000-0000-0000-0000-000000000001'$$, $$values (1, 20, 'rail')$$, '同一段只保留最新的估算，含緩衝與四種方案');
select throws_ok($$select public.apply_mobility_segments('a3000000-0000-0000-0000-000000000001',
  pg_temp.segment('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003', 15))$$, '42501', null, '不可連到其他行程的項目');
select throws_ok($$select public.apply_mobility_segments('a3000000-0000-0000-0000-000000000001',
  pg_temp.segment('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 15))$$, '22023', null, '起點與終點不可相同');
select throws_ok($$select public.apply_mobility_segments('a3000000-0000-0000-0000-000000000001',
  pg_temp.segment('a4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002', 300))$$, '23514', null, '緩衝超出上限');
select throws_ok($$select public.apply_mobility_segments('a3000000-0000-0000-0000-000000000001', '{}'::jsonb)$$, '22023', null, '必須是陣列');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.mobility_segments), 1, 'Owner 可讀交通估算');
reset role;

select * from finish();
rollback;
