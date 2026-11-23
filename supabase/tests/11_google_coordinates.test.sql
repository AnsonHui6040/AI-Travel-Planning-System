-- T19：Google 座標最多保存 30 日（D28、Places API 政策）；除 place_id 與未逾 30 日的座標外不保存 Google 內容
begin;
select plan(9);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e9', 'gm@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id) values
  ('a9000000-0000-0000-0000-000000000001', '座標測試', '00000000-0000-0000-0000-0000000000e9');

-- 以最少欄位建立項目；其餘欄位使用預設值
create function pg_temp.item(p_id uuid, p_place text, p_lat double precision, p_lng double precision, p_at timestamptz)
returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, place_id, coord_lat, coord_lng, coord_fetched_at,
    suggested_stay_minutes, recommendation_reason, priority, weather_dependency,
    score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability)
  values (p_id, 'a9000000-0000-0000-0000-000000000001', '測試地點', 'attraction', p_place, p_lat, p_lng, p_at, 60, '測試',
    3, 'low', 3, 3, 3, 3, 3, 3, 3, 3);
$$;

select lives_ok($$select pg_temp.item('a9000000-0000-0000-0000-0000000000a1', 'ChIJsynthetic-0001', 35.7, 139.8, now() - interval '29 days')$$, '29 日前取得的座標');
select lives_ok($$select pg_temp.item('a9000000-0000-0000-0000-0000000000a2', 'ChIJsynthetic-0002', 35.7, 139.8, now() - interval '31 days')$$, '31 日前取得的座標');

select throws_ok($$select pg_temp.item('a9000000-0000-0000-0000-0000000000a3', 'ChIJsynthetic-0003', 35.7, 139.8, null)$$,
  '23514', null, '有座標必須有取得時間');
select throws_ok($$select pg_temp.item('a9000000-0000-0000-0000-0000000000a4', 'ChIJsynthetic-0004', 35.7, null, now())$$,
  '23514', null, '緯度與經度必須同時存在');
select throws_ok($$select pg_temp.item('a9000000-0000-0000-0000-0000000000a5', null, 35.7, 139.8, now())$$,
  '23514', null, 'Google 座標必須對應 place_id');

select is(private.purge_expired_coordinates(), 1, '清除 1 筆超過 30 日的座標');
select results_eq(
  $$select coord_lat is null, coord_fetched_at is null, place_id from public.itinerary_items
      where trip_id = 'a9000000-0000-0000-0000-000000000001' order by id$$,
  $$values (false, false, 'ChIJsynthetic-0001'::text), (true, true, 'ChIJsynthetic-0002'::text)$$,
  '未逾 30 日的保留；逾期的清除座標，保留 place_id');

select is((select count(*)::int from cron.job where jobname = 'purge-expired-coordinates' and command like '%purge_expired_coordinates%'),
  1, '每日排程清除逾期座標');

set local role authenticated;
select throws_ok($$select private.purge_expired_coordinates()$$, '42501', null, '使用者不可呼叫清除函式');

select * from finish();
rollback;
