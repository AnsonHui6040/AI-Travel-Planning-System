-- T23：旅行基線。Owner、Companion 在基線階段儲存草稿；確認後產生 Trip Baseline v1，行程進入規劃中（第 2.8 節）
-- O：Owner；C：Companion；V：Viewer；X：非成員
begin;
select plan(19);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'bo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'bc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'bv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b4', 'bx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id) values
  ('b2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000b1'),
  ('b2000000-0000-0000-0000-000000000002', '沒有草稿', '00000000-0000-0000-0000-0000000000b1');
insert into public.trip_members (trip_id, user_id, role) values
  ('b2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'companion'),
  ('b2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'viewer');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

create function pg_temp.draft(p_start text, p_end text, p_tz text) returns jsonb language sql as $$
  select jsonb_build_object('start_date', p_start, 'end_date', p_end, 'timezone', p_tz, 'flights', '[]'::jsonb,
    'lodgings', '[]'::jsonb, 'companions', 1, 'stamina_note', null, 'budget', null, 'fixed_activities', '[]'::jsonb,
    'paid_items', '[]'::jsonb, 'must_visit', '[]'::jsonb, 'excluded', '[]'::jsonb, 'transport_preferences', '[]'::jsonb,
    'photography_needs', null);
$$;
grant execute on function pg_temp.draft(text, text, text) to authenticated;

-- 儲存草稿 ---------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', pg_temp.draft('2026-12-01', '2026-12-04', 'Asia/Tokyo'))$$,
  'Owner 儲存基線草稿');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', pg_temp.draft('2026-12-01', '2026-12-05', 'Asia/Tokyo'))$$,
  'Companion 修改基線草稿');
select results_eq($$select version, data ->> 'end_date', confirmed_at is null from public.trip_baselines where trip_id = 'b2000000-0000-0000-0000-000000000001'$$,
  $$values (1, '2026-12-05', true)$$, '草稿只有一筆 v1，尚未確認');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', pg_temp.draft('2026-12-01', '2026-12-05', 'Asia/Tokyo'))$$,
  '42501', null, 'Viewer 不可編輯基線');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', pg_temp.draft('2026-12-01', '2026-12-05', 'Asia/Tokyo'))$$,
  '42501', null, '非成員不可編輯基線');
select is((select count(*)::int from public.trip_baselines where trip_id = 'b2000000-0000-0000-0000-000000000001'), 0, '非成員讀不到基線');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$insert into public.trip_baselines (trip_id, version, data) values ('b2000000-0000-0000-0000-000000000001', 2, '{}')$$,
  '42501', null, '不可直接寫入基線表');
select throws_ok($$update public.trips set status = 'planning' where id = 'b2000000-0000-0000-0000-000000000001'$$,
  '42501', null, '不可直接修改行程狀態');
select throws_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  '22023', null, '基線資料必須是物件');
select throws_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', jsonb_build_object('timezone', 'Asia/Tokyo'))$$,
  '22023', null, '缺少日期時拒絕');

-- 確認 Trip Baseline v1 ----------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select public.confirm_trip_baseline('b2000000-0000-0000-0000-000000000001')$$, '42501', null, 'Viewer 不可確認基線');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.confirm_trip_baseline('b2000000-0000-0000-0000-000000000002')$$, '55000', null, '沒有草稿時不可確認');
select lives_ok($$select public.confirm_trip_baseline('b2000000-0000-0000-0000-000000000001')$$, 'Owner 確認基線');
select results_eq($$select status::text, start_date::text, end_date::text, timezone from public.trips where id = 'b2000000-0000-0000-0000-000000000001'$$,
  $$values ('planning', '2026-12-01', '2026-12-05', 'Asia/Tokyo')$$, '行程進入規劃中，日期與時區取自基線');
select isnt((select confirmed_at from public.trip_baselines where trip_id = 'b2000000-0000-0000-0000-000000000001' and version = 1), null,
  'Trip Baseline v1 記錄確認時間');
select throws_ok($$select public.confirm_trip_baseline('b2000000-0000-0000-0000-000000000001')$$, '55000', null, '已確認後不可再次確認');
select throws_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000001', pg_temp.draft('2026-12-01', '2026-12-06', 'Asia/Tokyo'))$$,
  '55000', null, '確認後的修改改走提案');

-- 時區不正確時不可確認 -----------------------------------------------------
select lives_ok($$select public.save_trip_baseline('b2000000-0000-0000-0000-000000000002', pg_temp.draft('2026-12-01', '2026-12-05', 'Mars/Base'))$$,
  '儲存另一個行程的草稿');
select throws_ok($$select public.confirm_trip_baseline('b2000000-0000-0000-0000-000000000002')$$, '22023', null, '時區不正確時不可確認');

select * from finish();
rollback;
