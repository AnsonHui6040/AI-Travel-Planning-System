-- 決策 0010 E：行程編輯。鎖定前 Owner、Companion 經 add_trip_item、update_trip_item、delete_trip_item、
-- schedule_trip_items 直接寫入（擁有者 atps_item_editor）；鎖定後以提案的 add_item、update_item、remove_item 套用。
-- 成員新增的項目為「使用者確認」，AI 核實不能改寫。O：Owner；C：Companion；V：Viewer；X：非成員
begin;
select plan(43);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'eo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'ec@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 'ev@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e4', 'ex@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('e2000000-0000-0000-0000-000000000001', '大阪兩日', '00000000-0000-0000-0000-0000000000e1', 'planning'),
  ('e2000000-0000-0000-0000-000000000002', '已鎖定', '00000000-0000-0000-0000-0000000000e1', 'locked');
insert into public.trip_members (trip_id, user_id, role) values
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e2', 'companion'),
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e3', 'viewer'),
  ('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2', 'companion');
insert into public.trip_baselines (trip_id, version, data, confirmed_at) values
  ('e2000000-0000-0000-0000-000000000001', 1, jsonb_build_object('start_date', '2026-12-01', 'end_date', '2026-12-02'), now()),
  ('e2000000-0000-0000-0000-000000000002', 1, jsonb_build_object('start_date', '2026-12-01', 'end_date', '2026-12-01'), now());

create function pg_temp.item(p_id uuid, p_trip uuid, p_status text, p_life text, p_role text) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status, candidate_role)
  values (p_id, p_trip, 'AI 候選', 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0,
    p_status::public.verification_status, p_life::public.lifecycle_status, p_role::public.candidate_role);
$$;
select pg_temp.item('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 'verified', 'verified', 'primary');
select pg_temp.item('e4000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'unverified', 'candidate', 'primary');
select pg_temp.item('e4000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', 'verified', 'verified', 'backup');
select pg_temp.item('e4000000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000002', 'verified', 'locked', 'primary');
update public.itinerary_items set scheduled_date = '2026-12-01', scheduled_start = '09:00', scheduled_end = '10:00'
  where id = 'e4000000-0000-0000-0000-000000000004';

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;
create function pg_temp.fields(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('name_zh', p_name, 'type', 'restaurant', 'address', null, 'suggested_stay_minutes', 60, 'note', '要排隊',
    'place_id', 'ChIJ51cu8IcbXWARiRtXIothAS4');
$$;
grant execute on function pg_temp.fields(text) to authenticated;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- 權限 -----------------------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.add_trip_item(uuid, jsonb, jsonb, jsonb)', 'execute'), false, 'anon 不可新增');
select is(has_function_privilege('service_role', 'public.schedule_trip_items(uuid, jsonb, jsonb)', 'execute'), false,
  'service_role（AI 背景 job）不可直接編輯行程');
select is(has_function_privilege('authenticated', 'public.delete_trip_item(uuid)', 'execute'), true, '成員經函式刪除');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000001', pg_temp.fields('咖啡'), null, '[]')$$,
  '42501', null, 'Viewer 不可新增');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000001', pg_temp.fields('咖啡'), null, '[]')$$,
  '42501', null, '非成員不可新增');
select throws_ok($$insert into public.itinerary_items (trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability)
  values ('e2000000-0000-0000-0000-000000000001', 'x', 'attraction', 60, 3, 'medium', 'x', 0, 0, 0, 0, 0, 0, 0, 0)$$,
  '42501', null, '成員不能直接寫入資料表');

-- 新增 -----------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select lives_ok($$insert into ids values ('cafe', public.add_trip_item('e2000000-0000-0000-0000-000000000001', pg_temp.fields('藏前咖啡'), null, '[]'))$$,
  'Companion 新增到候選清單');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000001',
  pg_temp.fields('x') || '{"verification_status": "verified"}', null, '[]')$$, '22023', null, '不接受其他欄位（例如核實狀態）');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000001',
  pg_temp.fields('x') || '{"place_id": "<bad>"}', null, '[]')$$, '22023', null, 'place_id 格式不正確');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000001', pg_temp.fields('x'),
  '{"date": "2026-12-09", "start": "10:00", "end": "11:00"}', '[]')$$, '22023', null, '日期不在行程期間內');
reset role;
select results_eq($$select origin::text, verification_status::text, lifecycle_status::text, added_by, note, place_id, scheduled_date
  from public.itinerary_items where id = (select id from ids where name = 'cafe')$$,
  $$values ('user', 'user_confirmed', 'verified', '00000000-0000-0000-0000-0000000000e2'::uuid, '要排隊', 'ChIJ51cu8IcbXWARiRtXIothAS4', null::date)$$,
  '來源為使用者新增、核實狀態為使用者確認、記錄新增的成員');
select is((select manual_schedule from public.trips where id = 'e2000000-0000-0000-0000-000000000001'), false,
  '只加入候選清單時仍是自動草案');

-- 排入某天：第一次手動排程時先寫入畫面上的自動草案 ---------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select lives_ok($$insert into ids values ('ramen', public.add_trip_item('e2000000-0000-0000-0000-000000000001', pg_temp.fields('拉麵'),
  '{"date": "2026-12-01", "start": "12:00", "end": "13:00"}',
  '[{"itemId": "e4000000-0000-0000-0000-000000000001", "date": "2026-12-01", "start": "09:00", "end": "10:00"}]'))$$,
  '新增並排入第一天');
reset role;
select results_eq($$select scheduled_date, to_char(scheduled_start, 'HH24:MI'), lifecycle_status::text from public.itinerary_items
  where id in ('e4000000-0000-0000-0000-000000000001', (select id from ids where name = 'ramen')) order by scheduled_start$$,
  $$values ('2026-12-01'::date, '09:00', 'verified'), ('2026-12-01'::date, '12:00', 'verified')$$,
  '自動草案與新項目都寫入，尚未批准');
select is((select manual_schedule from public.trips where id = 'e2000000-0000-0000-0000-000000000001'), true, '行程改為手動排程');

-- 排序與移動 -----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is(public.schedule_trip_items('e2000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('itemId', (select id from ids where name = 'ramen'), 'date', '2026-12-01', 'start', '09:00', 'end', '10:00'),
  jsonb_build_object('itemId', 'e4000000-0000-0000-0000-000000000001', 'date', '2026-12-01', 'start', '12:00', 'end', '13:00')), '[]'),
  2, '交換兩項的順序');
select throws_ok($$select public.schedule_trip_items('e2000000-0000-0000-0000-000000000001',
  '[{"itemId": "e4000000-0000-0000-0000-000000000002", "date": "2026-12-02", "start": "10:00", "end": "11:00"}]', '[]')$$,
  '55000', null, 'D07：Unverified 不可排入');
select throws_ok($$select public.schedule_trip_items('e2000000-0000-0000-0000-000000000001',
  '[{"itemId": "e4000000-0000-0000-0000-000000000003", "date": "2026-12-02", "start": "10:00", "end": "11:00"}]', '[]')$$,
  '55000', null, 'Backup 只列清單');
select throws_ok($$select public.schedule_trip_items('e2000000-0000-0000-0000-000000000001',
  '[{"itemId": "e4000000-0000-0000-0000-000000000001", "date": "2026-12-02", "start": "11:00", "end": "10:00"}]', '[]')$$,
  '22023', null, '結束時間須晚於開始時間');
select throws_ok($$select public.schedule_trip_items('e2000000-0000-0000-0000-000000000001',
  '[{"itemId": "e4000000-0000-0000-0000-000000000004", "date": null, "start": null, "end": null}]', '[]')$$,
  '42501', null, '不可移動其他行程的項目');
select lives_ok($$select public.schedule_trip_items('e2000000-0000-0000-0000-000000000001',
  '[{"itemId": "e4000000-0000-0000-0000-000000000001", "date": null, "start": null, "end": null}]', '[]')$$, '移回候選清單');
reset role;
select is((select scheduled_date from public.itinerary_items where id = 'e4000000-0000-0000-0000-000000000001'), null::date, '已移回候選清單');

-- 修改與刪除 -----------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select lives_ok($$select public.update_trip_item((select id from ids where name = 'ramen'), '{"name_zh": "一蘭拉麵", "suggested_stay_minutes": 45}')$$,
  'Owner 修改名稱與停留');
select throws_ok($$select public.update_trip_item((select id from ids where name = 'ramen'), '{"suggested_stay_minutes": 1000}')$$,
  '22023', null, '停留時間超過上限');
select throws_ok($$select public.update_trip_item((select id from ids where name = 'ramen'), '{"lifecycle_status": "locked"}')$$,
  '22023', null, '不接受其他欄位');
reset role;
select results_eq($$select name_zh, to_char(scheduled_end, 'HH24:MI') from public.itinerary_items where id = (select id from ids where name = 'ramen')$$,
  $$values ('一蘭拉麵', '09:45')$$, '依新的停留時間調整結束時間');

-- 已批准的日期與已鎖定的行程改為提案 ---------------------------------------------------------------
insert into public.days (trip_id, date, status) values ('e2000000-0000-0000-0000-000000000001', '2026-12-02', 'approved');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000001', pg_temp.fields('x'),
  '{"date": "2026-12-02", "start": "10:00", "end": "11:00"}', '[]')$$, '55000', null, '已批准的日期不能直接修改');
select throws_ok($$select public.add_trip_item('e2000000-0000-0000-0000-000000000002', pg_temp.fields('x'), null, '[]')$$,
  '55000', null, '已鎖定的行程不能直接修改');
select lives_ok($$select public.delete_trip_item((select id from ids where name = 'cafe'))$$, 'Companion 刪除');
reset role;
select is((select count(*)::integer from public.itinerary_items where id = (select id from ids where name = 'cafe')), 0, '已刪除');

-- 使用者確認不會被 AI 核實改寫 ---------------------------------------------------------------------
select throws_ok($$update public.itinerary_items set verification_status = 'verified' where id = (select id from ids where name = 'ramen')$$,
  '23514', null, '成員的項目不能改為其他核實狀態');
select throws_ok($$update public.itinerary_items set verification_status = 'user_confirmed' where id = 'e4000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'AI 的項目不能標為使用者確認');

-- approve_day 接受使用者確認的項目 ----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is(public.approve_day('e2000000-0000-0000-0000-000000000001', '2026-12-01',
  jsonb_build_array(jsonb_build_object('item_id', (select id from ids where name = 'ramen'), 'start', '09:00', 'end', '09:45',
    'movable_from', '09:00', 'movable_to', '09:00')),
  (select current_version from public.trips where id = 'e2000000-0000-0000-0000-000000000001')) ->> 'outcome', 'approved',
  '使用者確認的項目可以批准');
reset role;
select is((select status::text from public.trips where id = 'e2000000-0000-0000-0000-000000000001'), 'locked', '兩天都批准後鎖定');

-- 鎖定後：成員的新增、修改、刪除提案 ------------------------------------------------------------------
create function pg_temp.proposal(p_trip uuid, p_member uuid, p_ops jsonb) returns uuid language sql as $$
  insert into public.proposals (trip_id, proposer_member_id, proposer_role, base_version, change, impact_scope)
  select p_trip, p_member, case when p_member is null then 'live_planner'::public.ai_role end, t.current_version,
    jsonb_build_object('changeKind', 'minor_non_incident', 'versionKind', 'minor', 'summary', '成員編輯', 'operations', p_ops),
    jsonb_build_object('dates', jsonb_build_array('2026-12-01'))
  from public.trips t where t.id = p_trip
  returning id;
$$;
grant execute on function pg_temp.proposal(uuid, uuid, jsonb) to authenticated;
insert into ids values ('add', pg_temp.proposal('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2',
  jsonb_build_array(jsonb_build_object('op', 'add_item', 'itemId', 'e4000000-0000-0000-0000-0000000000a1', 'item', pg_temp.fields('甜點'),
    'date', '2026-12-01', 'start', '11:00', 'end', '12:00'))));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.approve_proposal((select id from ids where name = 'add')) ->> 'outcome', 'applied', '批准新增提案');
reset role;
select results_eq($$select origin::text, verification_status::text, lifecycle_status::text, added_by from public.itinerary_items
  where id = 'e4000000-0000-0000-0000-0000000000a1'$$,
  $$values ('user', 'user_confirmed', 'modified', '00000000-0000-0000-0000-0000000000e2'::uuid)$$, '新項目為使用者確認、已修改');

insert into ids values ('upd', pg_temp.proposal('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2',
  '[{"op": "update_item", "itemId": "e4000000-0000-0000-0000-000000000004", "fields": {"note": "改搭計程車", "suggested_stay_minutes": 30}}]'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.approve_proposal((select id from ids where name = 'upd')) ->> 'outcome', 'applied', '批准修改提案');
reset role;
select results_eq($$select note, to_char(scheduled_end, 'HH24:MI') from public.itinerary_items where id = 'e4000000-0000-0000-0000-000000000004'$$,
  $$values ('改搭計程車', '09:30')$$, '備註與結束時間已更新');

insert into ids values ('rm', pg_temp.proposal('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2',
  '[{"op": "remove_item", "itemId": "e4000000-0000-0000-0000-000000000004"}]'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.approve_proposal((select id from ids where name = 'rm')) ->> 'outcome', 'applied', '批准刪除提案');
reset role;
select results_eq($$select lifecycle_status::text, scheduled_date from public.itinerary_items where id = 'e4000000-0000-0000-0000-000000000004'$$,
  $$values ('cancelled', null::date)$$, '排入過的項目改為已取消，保留紀錄');

-- 鎖定後移回候選清單：使用者確認的項目回到已核實，不需重新核實
insert into ids values ('back', pg_temp.proposal('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e2',
  '[{"op": "schedule_item", "itemId": "e4000000-0000-0000-0000-0000000000a1", "date": null, "start": null, "end": null}]'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.approve_proposal((select id from ids where name = 'back')) ->> 'outcome', 'applied', '批准移回候選清單');
reset role;
select results_eq($$select lifecycle_status::text, verification_status::text from public.itinerary_items where id = 'e4000000-0000-0000-0000-0000000000a1'$$,
  $$values ('verified', 'user_confirmed')$$, '使用者確認的項目移回後維持使用者確認');

-- AI 提出的新增提案即使被批准也不寫入
insert into ids values ('ai', pg_temp.proposal('e2000000-0000-0000-0000-000000000002', null,
  jsonb_build_array(jsonb_build_object('op', 'add_item', 'itemId', 'e4000000-0000-0000-0000-0000000000a2', 'item', pg_temp.fields('AI 店'),
    'date', null, 'start', null, 'end', null))));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select public.approve_proposal((select id from ids where name = 'ai'))$$, '42501', null,
  'S-01：AI 不能提出新增、修改或刪除');

select * from finish();
rollback;
