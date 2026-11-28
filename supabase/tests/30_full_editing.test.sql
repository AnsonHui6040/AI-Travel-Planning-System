-- 決策 0011：完整的行程編輯。鎖定後 Owner 直接套用（Change Log、通知）、Companion 只能提案；
-- 鎖定前的批次在一個交易內寫入；兩站之間的交通；行程設定（只限 Owner，日期同步基線）。
-- O：Owner；C：Companion；V：Viewer；X：非成員
begin;
select plan(36);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'fo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'fc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'fv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f4', 'fx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('f2000000-0000-0000-0000-000000000001', '規劃中', '00000000-0000-0000-0000-0000000000f1', 'planning'),
  ('f2000000-0000-0000-0000-000000000002', '已鎖定', '00000000-0000-0000-0000-0000000000f1', 'locked');
insert into public.trip_members (trip_id, user_id, role) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'companion'),
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'viewer'),
  ('f2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f2', 'companion');
insert into public.trip_baselines (trip_id, version, data, confirmed_at) values
  ('f2000000-0000-0000-0000-000000000001', 1, jsonb_build_object('start_date', '2026-12-01', 'end_date', '2026-12-03',
    'fixed_activities', '[]'::jsonb, 'lodgings', '[]'::jsonb), now()),
  ('f2000000-0000-0000-0000-000000000002', 1, jsonb_build_object('start_date', '2026-12-01', 'end_date', '2026-12-02',
    'fixed_activities', jsonb_build_array(jsonb_build_object('name', '晚餐', 'date', '2026-12-02', 'start', '19:00')),
    'lodgings', '[]'::jsonb), now());
insert into public.days (trip_id, date, status) values
  ('f2000000-0000-0000-0000-000000000001', '2026-12-03', 'approved'),
  ('f2000000-0000-0000-0000-000000000002', '2026-12-01', 'approved'),
  ('f2000000-0000-0000-0000-000000000002', '2026-12-02', 'approved');

create function pg_temp.item(p_id uuid, p_trip uuid, p_status text, p_life text) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status, candidate_role)
  values (p_id, p_trip, 'AI 候選', 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0,
    p_status::public.verification_status, p_life::public.lifecycle_status, 'primary');
$$;
-- 規劃中：a、b 已核實；u 未核實
select pg_temp.item('f4000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'verified', 'verified');
select pg_temp.item('f4000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 'verified', 'verified');
select pg_temp.item('f4000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 'unverified', 'candidate');
-- 已鎖定：l1 排在 12/01、l2 排在 12/02、u2 未核實
select pg_temp.item('f4000000-0000-0000-0000-000000000011', 'f2000000-0000-0000-0000-000000000002', 'verified', 'locked');
select pg_temp.item('f4000000-0000-0000-0000-000000000012', 'f2000000-0000-0000-0000-000000000002', 'verified', 'locked');
select pg_temp.item('f4000000-0000-0000-0000-000000000013', 'f2000000-0000-0000-0000-000000000002', 'unverified', 'candidate');
update public.itinerary_items set scheduled_date = '2026-12-01', scheduled_start = '09:00', scheduled_end = '10:00'
  where id = 'f4000000-0000-0000-0000-000000000011';
update public.itinerary_items set scheduled_date = '2026-12-02', scheduled_start = '10:00', scheduled_end = '11:00'
  where id = 'f4000000-0000-0000-0000-000000000012';

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.change(p_ops jsonb) returns jsonb language sql as $$
  select jsonb_build_object('changeKind', 'minor_non_incident', 'versionKind', 'minor', 'summary', '調整行程', 'operations', p_ops);
$$;
grant execute on function pg_temp.change(jsonb) to authenticated;
create function pg_temp.version(p_trip uuid) returns integer language sql security definer as $$
  select current_version from public.trips where id = p_trip;
$$;
grant execute on function pg_temp.version(uuid) to authenticated;

-- 權限 -----------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.apply_owner_change(uuid, integer, jsonb, date[])', 'execute'), false, 'anon 不可直接套用');
select is(has_function_privilege('service_role', 'public.edit_trip_items(uuid, jsonb, jsonb)', 'execute'), false,
  'service_role（AI 背景 job）不可批次編輯');
select is(has_function_privilege('service_role', 'public.update_trip_settings(uuid, text, text, date, date)', 'execute'), false,
  'service_role 不可修改行程設定');

-- 1 鎖定後：Owner 直接套用，Companion 不可 ------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.apply_owner_change('f2000000-0000-0000-0000-000000000002', 0,
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000011","date":"2026-12-01","start":"11:00","end":"12:00"}]'),
  '{2026-12-01}')$$, '42501', null, 'Companion 不可直接套用（照舊提案）');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.apply_owner_change('f2000000-0000-0000-0000-000000000002', 0,
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000011","date":"2026-12-01","start":"11:00","end":"12:00"}]'),
  '{2026-12-01}') ->> 'outcome', 'applied', 'Owner 在鎖定後直接套用');
reset role;
select is((select scheduled_start::text from public.itinerary_items where id = 'f4000000-0000-0000-0000-000000000011'), '11:00:00', '時間已改');
select is((select count(*)::integer from public.versions where trip_id = 'f2000000-0000-0000-0000-000000000002'), 1, '留下一筆 Change Log');
select is((select approved_by from public.versions where trip_id = 'f2000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-0000000000f1'::uuid, 'Change Log 記錄 Owner');
select is((select count(*)::integer from public.notifications where trip_id = 'f2000000-0000-0000-0000-000000000002'
  and recipient_id = '00000000-0000-0000-0000-0000000000f2' and kind = 'proposal_applied'), 1, '通知 Companion');
select is((select count(*)::integer from public.notifications where trip_id = 'f2000000-0000-0000-0000-000000000002'
  and recipient_id = '00000000-0000-0000-0000-0000000000f1'), 0, '不通知 Owner 本人');
select is((select status::text from public.proposals where trip_id = 'f2000000-0000-0000-0000-000000000002'), 'applied', '提案紀錄為已套用');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.apply_owner_change('f2000000-0000-0000-0000-000000000002', 0,
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000011","date":"2026-12-01","start":"12:00","end":"13:00"}]'),
  '{2026-12-01}') ->> 'outcome', 'invalidated', 'SH-04：版本已變更時不套用');
select throws_ok($$select public.apply_owner_change('f2000000-0000-0000-0000-000000000002', pg_temp.version('f2000000-0000-0000-0000-000000000002'),
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000013","date":"2026-12-01","start":"13:00","end":"14:00"}]'),
  '{2026-12-01}')$$, '55000', null, 'D07：未核實的項目不可排入');
select throws_ok($$select public.apply_owner_change('f2000000-0000-0000-0000-000000000002', pg_temp.version('f2000000-0000-0000-0000-000000000002'),
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000011","date":"2026-12-09","start":"13:00","end":"14:00"}]'),
  '{2026-12-09}')$$, '22023', null, '日期不在行程期間內');
select throws_ok($$select public.apply_owner_change('f2000000-0000-0000-0000-000000000002', pg_temp.version('f2000000-0000-0000-0000-000000000002'),
  pg_temp.change('[{"op":"set_at_risk","itemId":"f4000000-0000-0000-0000-000000000011","atRisk":true}]'), '{}')$$,
  '22023', null, '只接受編輯的四種操作');

-- 整天交換（Owner）：兩天的項目互換日期，時間不變
select is(public.apply_owner_change('f2000000-0000-0000-0000-000000000002', pg_temp.version('f2000000-0000-0000-0000-000000000002'),
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000011","date":"2026-12-02","start":"11:00","end":"12:00"},
                   {"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000012","date":"2026-12-01","start":"10:00","end":"11:00"}]'),
  '{2026-12-01,2026-12-02}') ->> 'outcome', 'applied', '整天交換一次套用');
reset role;
select is((select scheduled_date::text from public.itinerary_items where id = 'f4000000-0000-0000-0000-000000000012'), '2026-12-01', '交換後的日期');

-- 2 鎖定前的批次 -------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is(public.edit_trip_items('f2000000-0000-0000-0000-000000000001', '[
  {"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"09:00","end":"10:00"},
  {"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000002","date":"2026-12-01","start":"10:30","end":"11:30"},
  {"op":"add_item","itemId":"f4000000-0000-0000-0000-000000000021","item":{"name_zh":"咖啡","type":"restaurant","address":null,
    "suggested_stay_minutes":30,"note":null,"place_id":null},"date":"2026-12-01","start":"12:00","end":"12:30"}]', '[]'), 3,
  'Companion 在草案日批次寫入');
reset role;
select is((select count(*)::integer from public.itinerary_items where trip_id = 'f2000000-0000-0000-0000-000000000001'
  and scheduled_date = '2026-12-01'), 3, '三項都排入');
select is((select lifecycle_status::text from public.itinerary_items where id = 'f4000000-0000-0000-0000-000000000021'), 'verified',
  '新增在草案日為已核實');
select is((select count(*)::integer from public.versions where trip_id = 'f2000000-0000-0000-0000-000000000001'), 0, '草案不產生版本');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.edit_trip_items('f2000000-0000-0000-0000-000000000001', '[
  {"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"08:00","end":"09:00"},
  {"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000003","date":"2026-12-01","start":"13:00","end":"14:00"}]', '[]')$$,
  '55000', null, '批次中有一項不合法時整批拒絕');
reset role;
select is((select scheduled_start::text from public.itinerary_items where id = 'f4000000-0000-0000-0000-000000000001'), '09:00:00',
  '整批拒絕時前面的變更也沒有寫入');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.edit_trip_items('f2000000-0000-0000-0000-000000000001', '[
  {"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000001","date":"2026-12-03","start":"09:00","end":"10:00"}]', '[]')$$,
  '55000', null, 'Companion 改到已批准的日期要提案');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$select public.edit_trip_items('f2000000-0000-0000-0000-000000000001', '[
  {"op":"remove_item","itemId":"f4000000-0000-0000-0000-000000000002"}]', '[]')$$, '42501', null, 'Viewer 不可編輯');

-- 規劃中 Owner 改到已批准的日期：直接套用，項目成為已批准
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.apply_owner_change('f2000000-0000-0000-0000-000000000001', pg_temp.version('f2000000-0000-0000-0000-000000000001'),
  pg_temp.change('[{"op":"schedule_item","itemId":"f4000000-0000-0000-0000-000000000002","date":"2026-12-03","start":"09:00","end":"10:00"}]'),
  '{2026-12-01,2026-12-03}') ->> 'outcome', 'applied', 'Owner 規劃中改到已批准的日期直接套用');
reset role;
select is((select lifecycle_status::text from public.itinerary_items where id = 'f4000000-0000-0000-0000-000000000002'), 'approved',
  '排入已批准的日期成為已批准');

-- 3 兩站之間的交通 -------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select lives_ok($$insert into public.travel_legs (trip_id, from_item_id, to_item_id, mode, minutes)
  values ('f2000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000021', 'walk', 12)$$,
  'Companion 設定交通');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
with u as (update public.travel_legs set minutes = 1 where trip_id = 'f2000000-0000-0000-0000-000000000001' returning 1)
select is((select count(*)::integer from u), 0,
  'Viewer 的修改不影響任何列');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f4');
select is((select count(*)::integer from public.travel_legs), 0, '非成員看不到交通');

-- 4 行程設定 -----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.update_trip_settings('f2000000-0000-0000-0000-000000000001', '新名稱', null, null, null)$$,
  '42501', null, 'Companion 不可修改行程設定');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.update_trip_settings('f2000000-0000-0000-0000-000000000001', '大阪兩日', '大阪', '2026-12-02', '2026-12-03')
  ->> 'moved_to_candidates', '2', '縮短日期：排在移除日期的項目移回候選清單');
reset role;
select is((select data ->> 'start_date' from public.trip_baselines where trip_id = 'f2000000-0000-0000-0000-000000000001'), '2026-12-02',
  '日期同步寫入 Trip Baseline v1');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$select public.update_trip_settings('f2000000-0000-0000-0000-000000000002', '已鎖定', null, '2026-12-01', '2026-12-01')$$,
  '22023', null, '固定活動不在新的日期內時要先改基線');
select lives_ok($$select public.update_trip_settings('f2000000-0000-0000-0000-000000000002', '已鎖定', null, '2026-12-01', '2026-12-03')$$,
  '鎖定後延長一天');
reset role;
select is((select status::text from public.days where trip_id = 'f2000000-0000-0000-0000-000000000002' and date = '2026-12-03'), 'approved',
  '鎖定後新增的日期為已批准的空白日，行程維持已鎖定');

select * from finish();
rollback;
