-- T09：applyChange 的寫入角色、版本檢查（SH-04）、即時分支、通知與未讀（SH-06）
-- O = Owner、C = Companion、V = Viewer、X = 非成員
begin;
select plan(46);

create function public.__affected(sql text) returns integer
language plpgsql security invoker as $f$
declare n integer;
begin
  execute sql;
  get diagnostics n = row_count;
  return n;
end;
$f$;
grant execute on function public.__affected(text) to authenticated;

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'o9@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'c9@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'v9@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c4', 'x9@example.test', 'authenticated', 'authenticated');

insert into public.trips (id, name, owner_id, current_version) values
  ('21000000-0000-0000-0000-000000000001', '大阪四日', '00000000-0000-0000-0000-0000000000c1', 1),
  ('21000000-0000-0000-0000-000000000002', '別人的行程', '00000000-0000-0000-0000-0000000000c4', 0);
insert into public.trip_members (trip_id, user_id, role) values
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'companion'),
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c3', 'viewer');

insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
  recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost,
  score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability,
  scheduled_date, scheduled_start, scheduled_end)
values
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '大阪城', 'attraction',
    90, 3, 'medium', '天守閣與公園', 4, 4, 3, 3, 4, 2, 2, 1, '2026-12-01', '10:00', '11:30'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '別人的景點', 'attraction',
    60, 3, 'low', '測試', 1, 1, 1, 1, 1, 1, 1, 1, null, null, null);
insert into public.versions (trip_id, major, minor, kind, summary, impact_scope, old_arrangement, new_arrangement, base_version) values
  ('21000000-0000-0000-0000-000000000001', 1, 0, 'major', '建立行程', '{}', '{}', '{}', 0);

-- 提案（以 postgres 建立，相當於成員或 AI 提出）
insert into public.proposals (id, trip_id, proposer_member_id, proposer_role, base_version, change, impact_scope, live_branch_id) values
  ('41000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', null, 1,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"大阪城改到下午","operations":[{"op":"schedule_item","itemId":"31000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"14:00","end":"15:30"}]}', '{}', null),
  ('41000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', null, 1,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"大阪城改到傍晚","operations":[{"op":"schedule_item","itemId":"31000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"16:00","end":"17:30"}]}', '{}', null),
  ('41000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', null, 'live_planner', 2,
    '{"changeKind":"incident_L2","versionKind":"minor","summary":"方案一","operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000001","atRisk":true}]}', '{}', '61000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000001', null, 'live_planner', 2,
    '{"changeKind":"incident_L2","versionKind":"minor","summary":"方案二","operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000001","atRisk":false}]}', '{}', '61000000-0000-0000-0000-000000000001'),
  ('41000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', null, 3,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"要否決的提案","operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000001","atRisk":true}]}', '{}', null),
  ('41000000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', null, 3,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"改別人行程的項目","operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000002","atRisk":true}]}', '{}', null),
  ('41000000-0000-0000-0000-000000000007', '21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', null, 3,
    '{"changeKind":"major_version","versionKind":"major","summary":"更換飯店","structural":["hotel"],"operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000001","atRisk":true}]}', '{}', null),
  ('41000000-0000-0000-0000-000000000008', '21000000-0000-0000-0000-000000000001', null, 'live_planner', 4,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"需批准卻要求自動套用","operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000001","atRisk":false}]}', '{}', null),
  ('41000000-0000-0000-0000-000000000009', '21000000-0000-0000-0000-000000000001', null, 'live_planner', 4,
    '{"changeKind":"approved_fact_invalidated","versionKind":"minor","summary":"臨時休館，標示 At Risk","operations":[{"op":"set_at_risk","itemId":"31000000-0000-0000-0000-000000000001","atRisk":true}]}', '{}', null),
  ('41000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-000000000001', null, 'live_planner', 5,
    '{"changeKind":"approved_fact_invalidated","versionKind":"minor","summary":"未知操作","operations":[{"op":"drop_trip","itemId":"31000000-0000-0000-0000-000000000001"}]}', '{}', null),
  ('41000000-0000-0000-0000-00000000000b', '21000000-0000-0000-0000-000000000001', null, 'live_planner', 5,
    '{"changeKind":"incident_L1","versionKind":"minor","summary":"延誤 15 分鐘，壓縮緩衝","operations":[{"op":"schedule_item","itemId":"31000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"14:15","end":"15:30"}]}', '{}', null);

-- 寫入角色 -------------------------------------------------------------
select has_role('atps_change_writer', 'applyChange 使用的寫入角色存在');
select ok(not (select rolcanlogin from pg_roles where rolname = 'atps_change_writer'), '寫入角色不可登入');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'),
  '通知表經 Realtime 推送（SH-06）');

-- Companion 不可直接寫入正式行程表（S-01） -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select throws_ok($$update public.itinerary_items set scheduled_start = '09:00'$$, '42501', null, 'C：不可直接修改行程項目');
select throws_ok($$insert into public.versions (trip_id, major, minor, kind, summary, impact_scope, old_arrangement, new_arrangement, base_version)
  values ('21000000-0000-0000-0000-000000000001', 9, 0, 'major', 'x', '{}', '{}', '{}', 1)$$, '42501', null, 'C：不可直接寫入版本');
select throws_ok($$update public.versions set summary = 'x'$$, '42501', null, 'C：不可修改 Change Log');
select throws_ok($q$update public.trips set current_version = 99$q$, '42501', null, 'C：不可修改目前版本（T23 起沒有 trips 的 UPDATE 權限）');
select throws_ok($$update public.proposals set status = 'applied'$$, '42501', null, 'C：不可直接改提案狀態');
select throws_ok($$update public.days set status = 'approved'$$, '42501', null, 'C：不可直接改每日狀態');
select throws_ok($$insert into public.notifications (recipient_id, kind) values ('00000000-0000-0000-0000-0000000000c1', 'x')$$,
  '42501', null, 'C：不可直接寫入通知');
select throws_ok($$select private.commit_proposal('41000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2')$$,
  '42501', null, 'C：不可直接呼叫內部寫入函式');
select throws_ok($$select public.auto_apply_proposal('41000000-0000-0000-0000-000000000009')$$,
  '42501', null, 'C：不可呼叫自動套用（只限伺服器）');
reset role;

-- 寫入角色可寫入正式行程表 ---------------------------------------------
set local role atps_change_writer;
update public.itinerary_items set scheduled_end = '11:45' where id = '31000000-0000-0000-0000-000000000001';
reset role;
select is((select scheduled_end::text from public.itinerary_items where id = '31000000-0000-0000-0000-000000000001'),
  '11:45:00', '寫入角色可修改行程項目');

-- Viewer 與非成員不可批准、否決 ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select throws_ok($$select public.approve_proposal('41000000-0000-0000-0000-000000000001')$$, '42501', null, 'V：不可批准');
select throws_ok($$select public.reject_proposal('41000000-0000-0000-0000-000000000005')$$, '42501', null, 'V：不可否決');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true);
select throws_ok($$select public.approve_proposal('41000000-0000-0000-0000-000000000001')$$, '42501', null, 'X：不可批准');
reset role;
set local role anon;
select throws_ok($$select public.approve_proposal('41000000-0000-0000-0000-000000000001')$$, '42501', null, '未登入：不可批准');
reset role;

-- 先到先得加版本檢查（SH-04） -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is(public.approve_proposal('41000000-0000-0000-0000-000000000001'),
  '{"outcome":"applied","major":1,"minor":1,"invalidated_ids":[]}'::jsonb, 'C：批准第一個提案，版本 v1.1');
reset role;
select is((select current_version from public.trips where id = '21000000-0000-0000-0000-000000000001'), 2, '目前版本加一');
select is((select scheduled_start::text from public.itinerary_items where id = '31000000-0000-0000-0000-000000000001'),
  '14:00:00', '行程項目已更新');
select results_eq($$select kind::text, approved_by, proposal_id, base_version, summary from public.versions
  where trip_id = '21000000-0000-0000-0000-000000000001' and major = 1 and minor = 1$$,
  $$values ('minor', '00000000-0000-0000-0000-0000000000c2'::uuid, '41000000-0000-0000-0000-000000000001'::uuid, 1, '大阪城改到下午')$$,
  'Change Log 記錄類型、批准者、提案、base version、修改內容');
select is((select old_arrangement -> 0 ->> 'start' from public.versions where trip_id = '21000000-0000-0000-0000-000000000001' and minor = 1),
  '10:00:00', 'Change Log 記錄舊安排');
select is((select new_arrangement -> 0 ->> 'start' from public.versions where trip_id = '21000000-0000-0000-0000-000000000001' and minor = 1),
  '14:00', 'Change Log 記錄新安排');
select results_eq($$select status::text, decided_by from public.proposals where id = '41000000-0000-0000-0000-000000000001'$$,
  $$values ('applied', '00000000-0000-0000-0000-0000000000c2'::uuid)$$, '提案已套用並記錄批准者');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select is(public.approve_proposal('41000000-0000-0000-0000-000000000002'), '{"outcome":"invalidated"}'::jsonb,
  'O：同一 base version 的第二個提案批准時失效');
select throws_ok($$select public.approve_proposal('41000000-0000-0000-0000-000000000001')$$, '22023', null, '已套用的提案不可再批准');
reset role;
select is((select status::text from public.proposals where id = '41000000-0000-0000-0000-000000000002'), 'invalidated', '第二個提案狀態為已失效');
select is((select current_version from public.trips where id = '21000000-0000-0000-0000-000000000001'), 2, '失效不改變版本');
select is((select scheduled_start::text from public.itinerary_items where id = '31000000-0000-0000-0000-000000000001'),
  '14:00:00', '失效不改變行程項目');

-- 即時分支：套用一個方案後其餘失效（第 2.9 節） ------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is(public.approve_proposal('41000000-0000-0000-0000-000000000003'),
  '{"outcome":"applied","major":1,"minor":2,"invalidated_ids":["41000000-0000-0000-0000-000000000004"]}'::jsonb,
  'C：套用即時分支的方案一');
reset role;
select is((select status::text from public.proposals where id = '41000000-0000-0000-0000-000000000004'), 'invalidated', '同分支的方案二失效');

-- 否決、跨行程、Major ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select lives_ok($$select public.reject_proposal('41000000-0000-0000-0000-000000000005')$$, 'O：否決提案');
select throws_ok($$select public.approve_proposal('41000000-0000-0000-0000-000000000006')$$, '42501', null,
  '提案不可修改其他行程的項目');
select is(public.approve_proposal('41000000-0000-0000-0000-000000000007'),
  '{"outcome":"applied","major":2,"minor":0,"invalidated_ids":[]}'::jsonb, 'O：Major 變更，版本 v2.0');
reset role;
select results_eq($$select status::text, decided_by from public.proposals where id = '41000000-0000-0000-0000-000000000005'$$,
  $$values ('rejected', '00000000-0000-0000-0000-0000000000c1'::uuid)$$, '提案已否決並記錄否決者');

-- 自動套用（伺服器，第 2.6 節自動類別） ---------------------------------
set local role service_role;
select throws_ok($$select private.commit_proposal('41000000-0000-0000-0000-000000000008', null)$$, '42501', null,
  '伺服器也不可繞過自動套用檢查呼叫內部寫入函式');
select throws_ok($$select public.auto_apply_proposal('41000000-0000-0000-0000-000000000008')$$, '42501', null,
  '需批准的變更不可自動套用（D10）');
select is(public.auto_apply_proposal('41000000-0000-0000-0000-000000000009'),
  '{"outcome":"applied","major":2,"minor":1,"invalidated_ids":[]}'::jsonb, '事實失效標示 At Risk 自動套用，版本 v2.1');
select throws_ok($$select public.auto_apply_proposal('41000000-0000-0000-0000-00000000000b')$$, '42501', null,
  'L1 壓縮緩衝不可自動套用（決策 0005）');
select throws_ok($$select public.auto_apply_proposal('41000000-0000-0000-0000-00000000000a')$$, '22023', null, '未知操作被拒');
reset role;
select is((select approved_by from public.versions where trip_id = '21000000-0000-0000-0000-000000000001' and major = 2 and minor = 1),
  null, '自動套用沒有批准者');

-- 通知與未讀（SH-06） ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
select results_eq($$select kind, ref_id from public.notifications where read_at is null order by created_at, kind, ref_id$$,
  $$values
    ('proposal_applied', '41000000-0000-0000-0000-000000000001'::uuid),
    ('proposal_applied', '41000000-0000-0000-0000-000000000003'::uuid),
    ('proposal_applied', '41000000-0000-0000-0000-000000000007'::uuid),
    ('proposal_applied', '41000000-0000-0000-0000-000000000009'::uuid),
    ('proposal_invalidated', '41000000-0000-0000-0000-000000000002'::uuid),
    ('proposal_invalidated', '41000000-0000-0000-0000-000000000004'::uuid),
    ('proposal_rejected', '41000000-0000-0000-0000-000000000005'::uuid)$$,
  'V：依成員查詢未讀的批准、否決、失效通知');
select is((select count(*)::int from public.notifications where recipient_id <> '00000000-0000-0000-0000-0000000000c3'), 0,
  'V：看不到他人的通知');
update public.notifications set read_at = now() where ref_id = '41000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notifications where read_at is null), 6, 'V：標示已讀後未讀減少');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is((select count(*)::int from public.notifications where ref_id = '41000000-0000-0000-0000-000000000001'), 0,
  'C：自己批准的提案不通知自己');
select is((select count(*)::int from public.notifications where ref_id = '41000000-0000-0000-0000-000000000005'), 1,
  'C：收到 Owner 否決的通知');
reset role;

select * from finish();
rollback;
