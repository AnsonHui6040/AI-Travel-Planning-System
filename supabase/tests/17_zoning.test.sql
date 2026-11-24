-- T27：地理分區。只經 apply_zoning（service_role，背景 job）寫入；成員可讀
begin;
select plan(12);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'zo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'zv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'zx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('f2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000f1', 'planning'),
  ('f2000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000f1', 'planning');
insert into public.trip_members (trip_id, user_id, role) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'viewer');
insert into public.background_jobs (id, kind, initiator_id, trip_id, status) values
  ('f3000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000f1', 'f2000000-0000-0000-0000-000000000001', 'running');

create function pg_temp.item(p_id uuid, p_trip uuid, p_lifecycle text default 'candidate') returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, lifecycle_status)
  values (p_id, p_trip, '候選', 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0, p_lifecycle::public.lifecycle_status);
$$;
select pg_temp.item('f4000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001');
select pg_temp.item('f4000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001');
select pg_temp.item('f4000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000002');
select pg_temp.item('f4000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-000000000001', 'draft');

create function pg_temp.zones(p_item uuid) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('name', '新宿與直達沿線', 'base_area', '新宿', 'rationale', '直達',
      'sources', jsonb_build_array(jsonb_build_object('url', 'https://railway.example.jp/', 'fetched_at', '2026-11-24T10:00:00+09:00', 'grade', 'official_transport_tourism')),
      'items', jsonb_build_array(jsonb_build_object('item_id', p_item, 'transfers_from_base', 0, 'minutes_from_base', 25))),
    jsonb_build_object('name', '甲區', 'base_area', null, 'rationale', '需轉乘兩次', 'sources', '[]'::jsonb,
      'items', jsonb_build_array(jsonb_build_object('item_id', 'f4000000-0000-0000-0000-000000000002', 'transfers_from_base', 2, 'minutes_from_base', 35))));
$$;
grant execute on function pg_temp.zones(uuid) to service_role;

select is(has_function_privilege('authenticated', 'public.apply_zoning(uuid, jsonb, jsonb)', 'execute'), false, 'authenticated 不可寫入分區');

set local role service_role;
select is(public.apply_zoning('f3000000-0000-0000-0000-000000000001', pg_temp.zones('f4000000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('item_id', 'f4000000-0000-0000-0000-000000000002', 'candidate_role', 'backup'))), 2, '寫入兩個分區');
select results_eq($$select z.name, i.zone_transfers, i.zone_minutes from public.itinerary_items i join public.zones z on z.id = i.zone_id
  where i.trip_id = 'f2000000-0000-0000-0000-000000000001' order by z.name$$,
  $$values ('新宿與直達沿線', 0::smallint, 25), ('甲區', 2::smallint, 35)$$, '項目記錄分區、轉乘次數與分鐘數');
select is((select candidate_role::text from public.itinerary_items where id = 'f4000000-0000-0000-0000-000000000002'), 'backup',
  '主要區域補上 Backup');
select is(public.apply_zoning('f3000000-0000-0000-0000-000000000001', pg_temp.zones('f4000000-0000-0000-0000-000000000001'), '[]'::jsonb), 2,
  '重新分區');
select is((select count(*)::int from public.zones where trip_id = 'f2000000-0000-0000-0000-000000000001'), 2, '舊分區被取代');
select throws_ok($$select public.apply_zoning('f3000000-0000-0000-0000-000000000001', pg_temp.zones('f4000000-0000-0000-0000-000000000003'), '[]'::jsonb)$$,
  '42501', null, '不可把其他行程的項目放入分區');
select throws_ok($$select public.apply_zoning('f3000000-0000-0000-0000-000000000001', pg_temp.zones('f4000000-0000-0000-0000-000000000004'), '[]'::jsonb)$$,
  '42501', null, '已進入行程草案的項目不經此函式改變');
select throws_ok($$select public.apply_zoning('f3000000-0000-0000-0000-000000000001', '[]'::jsonb, '[]'::jsonb)$$,
  '22023', null, '至少一個分區');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.zones), 2, 'Viewer 可讀分區');
select throws_ok($$insert into public.zones (trip_id, name, rationale) values ('f2000000-0000-0000-0000-000000000001', 'x', 'x')$$,
  '42501', null, '使用者不可直接寫入分區');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.zones), 0, '非成員讀不到分區');
reset role;

select * from finish();
rollback;
