-- T41：第 5 節記憶。MEM-03 寫入途徑只有手動與旅後提案經擁有者批准，AI（service_role）沒有寫入權；
-- MEM-06 刪除後不再讀出；MEM-07 共同行程合併所有成員的記憶，身分與聯絡資料不寫入；MEM-08 不顯示來源成員；
-- MEM-09 成員離開後不再讀出；MEM-10 單趟 context 不帶入其他行程。
-- A：Owner；B：Companion；V：Viewer；X：非成員
begin;
select plan(28);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'ma@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'mb@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'mv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f4', 'mx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('f1000000-0000-0000-0000-000000000001', '東京', '00000000-0000-0000-0000-0000000000f1', 'ended'),
  ('f1000000-0000-0000-0000-000000000002', '大阪', '00000000-0000-0000-0000-0000000000f1', 'planning');
insert into public.trip_members (trip_id, user_id, role) values
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'companion'),
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'viewer');
insert into public.memories (id, owner_id, layer, trip_id, kind, item, value, unit, source) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'personal', null, 'constraint', '每日步行上限', '12', '公里', 'manual'),
  ('f2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000f2', 'personal', null, 'constraint', '每日步行上限', '8', '公里', 'manual'),
  ('f2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000f2', 'trip_context', 'f1000000-0000-0000-0000-000000000001', 'constraint', '最早出發', '09:30', null, 'manual'),
  ('f2000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000f1', 'trip_context', 'f1000000-0000-0000-0000-000000000002', 'preference', '大阪的偏好', '吃章魚燒', null, 'manual'),
  ('f2000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000f4', 'personal', null, 'constraint', '每日步行上限', '3', '公里', 'manual'),
  ('f2000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000f3', 'planning_rules', null, 'preference', '喜歡的活動類型', '攝影', null, 'manual');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

-- 手動新增與 MEM-07 ------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$insert into public.memories (owner_id, layer, kind, item, value, unit, source)
  values ('00000000-0000-0000-0000-0000000000f1', 'personal', 'constraint', '飲食限制', '不吃牛肉', null, 'manual')$$, '擁有者手動新增記憶');
select throws_ok($$insert into public.memories (owner_id, layer, kind, item, value, source)
  values ('00000000-0000-0000-0000-0000000000f1', 'personal', 'preference', '聯絡方式', 'a@example.com', 'manual')$$,
  '22023', null, '電子郵件不寫入記憶');
select throws_ok($$insert into public.memories (owner_id, layer, kind, item, value, source)
  values ('00000000-0000-0000-0000-0000000000f1', 'personal', 'preference', '緊急聯絡', '0912-345-678', 'manual')$$,
  '22023', null, '電話不寫入記憶');
select throws_ok($$insert into public.memories (owner_id, layer, kind, item, value, source)
  values ('00000000-0000-0000-0000-0000000000f1', 'personal', 'preference', '姓名', '王小明', 'manual')$$,
  '22023', null, '姓名不寫入記憶');
select throws_ok($$update public.memories set value = 'a@example.com' where id = 'f2000000-0000-0000-0000-000000000001'$$,
  '22023', null, '修改時同樣檢查');
select throws_ok($$insert into public.memories (owner_id, layer, kind, item, value, source)
  values ('00000000-0000-0000-0000-0000000000f1', 'personal', 'preference', '偽造', '旅後', 'post_trip_proposal')$$,
  '42501', null, '使用者不可自行標示為旅後提案來源');
select is((select count(*)::int from public.memories), 3, '只看得到自己的記憶');

-- 合併讀取（MEM-07、MEM-08、MEM-10） --------------------------------------------
select results_eq($$select item, value from public.trip_memories('f1000000-0000-0000-0000-000000000001') order by value collate "C"$$,
  $$values ('最早出發', '09:30'), ('每日步行上限', '12'), ('每日步行上限', '8'), ('飲食限制', '不吃牛肉'), ('喜歡的活動類型', '攝影')$$,
  '合併所有成員（含 Viewer）的個人、Planning Rules 與本趟 context；不含其他行程的 context 與非成員');
select is((select count(*)::int from information_schema.routines r
  join information_schema.parameters p on p.specific_name = r.specific_name
  where r.routine_name = 'trip_memories' and p.parameter_mode = 'OUT' and p.parameter_name = 'owner_id'), 0, '讀取結果不含來源成員');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f4');
select throws_ok($$select * from public.trip_memories('f1000000-0000-0000-0000-000000000001')$$, '42501', null, '非成員不可讀取');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.trip_memories('f1000000-0000-0000-0000-000000000002') where item = '最早出發'), 0,
  '單趟 context 不帶入其他行程');

-- MEM-06 刪除 --------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$delete from public.memories where id = 'f2000000-0000-0000-0000-000000000001'$$, '擁有者刪除記憶');
select is((select count(*)::int from public.trip_memories('f1000000-0000-0000-0000-000000000001') where value = '12'), 0, '刪除後不再讀出');

-- MEM-09 成員離開 ----------------------------------------------------------------
reset role;
delete from public.trip_members where trip_id = 'f1000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.trip_memories('f1000000-0000-0000-0000-000000000001') where item in ('每日步行上限', '最早出發')), 0,
  '成員離開後其記憶不再讀出');

-- MEM-03 AI 沒有寫入權 -----------------------------------------------------------
reset role;
set local role service_role;
select throws_ok($$insert into public.memories (owner_id, layer, kind, item, value, source)
  values ('00000000-0000-0000-0000-0000000000f1', 'personal', 'preference', 'AI', '寫入', 'manual')$$, '42501', null, 'service_role（AI）不可新增記憶');
select throws_ok($$update public.memories set value = 'x' where id = 'f2000000-0000-0000-0000-000000000006'$$, '42501', null, 'service_role 不可修改記憶');
select throws_ok($$delete from public.memories where id = 'f2000000-0000-0000-0000-000000000006'$$, '42501', null, 'service_role 不可刪除記憶');
reset role;

-- 旅後提案（MEM-03、MEM-04） -------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.create_post_trip_memory_proposals('f1000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  '42501', null, '離開的成員不可建立提案');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$select public.create_post_trip_memory_proposals('f1000000-0000-0000-0000-000000000002',
  '[{"layer":"planning_rules","kind":"preference","item":"停留時間調整","value":"25","unit":"分鐘","reason":"平均多停留 25 分鐘"}]')$$,
  '55000', null, '行程結束前不可建立旅後提案');
select throws_ok($$select public.create_post_trip_memory_proposals('f1000000-0000-0000-0000-000000000001',
  '[{"layer":"planning_rules","kind":"preference","item":"聯絡","value":"a@example.com","unit":null,"reason":"x"}]')$$,
  '22023', null, '提案同樣不含身分與聯絡資料');
select is(public.create_post_trip_memory_proposals('f1000000-0000-0000-0000-000000000001',
  '[{"layer":"planning_rules","kind":"preference","item":"停留時間調整","value":"25","unit":"分鐘","reason":"平均多停留 25 分鐘"},
    {"layer":"planning_rules","kind":"preference","item":"交通估算額外緩衝","value":"15","unit":"分鐘","reason":"平均多 15 分鐘"}]'),
  2, '建立兩個待批准提案（擁有者為本人）');
select is((select count(*)::int from public.memories where item = '停留時間調整'), 0, '提案在批准前不寫入記憶');
select lives_ok($$select public.decide_memory_proposal((select id from public.memory_proposals where item = '停留時間調整'), true)$$,
  '擁有者批准提案');
select results_eq($$select layer::text, source::text, source_proposal_id is not null from public.memories where item = '停留時間調整'$$,
  $$values ('planning_rules', 'post_trip_proposal', true)$$, '批准後寫入記憶，來源為旅後提案編號');
select lives_ok($$select public.decide_memory_proposal((select id from public.memory_proposals where item = '交通估算額外緩衝'), false)$$,
  '擁有者否決提案');
select is((select count(*)::int from public.memories where item = '交通估算額外緩衝'), 0, '否決的提案不寫入');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from public.memory_proposals), 0, '看不到他人的提案');
select throws_ok($$insert into public.memory_proposals (owner_id, trip_id, layer, kind, item, value, reason)
  values ('00000000-0000-0000-0000-0000000000f3', 'f1000000-0000-0000-0000-000000000001', 'personal', 'preference', 'x', 'y', 'z')$$,
  '42501', null, '不可直接建立提案');
reset role;

select * from finish();
rollback;
