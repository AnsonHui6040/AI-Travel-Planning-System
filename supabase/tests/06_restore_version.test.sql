-- T10A：復原任何舊版本（D10、決策 0005、SH-04）
-- O = Owner、C = Companion、V = Viewer、X = 非成員
begin;
select plan(25);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'o10@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'c10@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'v10@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', 'x10@example.test', 'authenticated', 'authenticated');

insert into public.trips (id, name, owner_id, current_version) values
  ('22000000-0000-0000-0000-000000000001', '京都三日', '00000000-0000-0000-0000-0000000000d1', 0);
insert into public.trip_members (trip_id, user_id, role) values
  ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'companion'),
  ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d3', 'viewer');

insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
  recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost,
  score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability,
  scheduled_date, scheduled_start, scheduled_end)
values
  ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '清水寺', 'attraction',
    90, 3, 'medium', '早上人少', 4, 4, 3, 3, 4, 2, 2, 1, '2026-12-01', '09:00', '10:30'),
  ('32000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', '錦市場', 'attraction',
    60, 3, 'low', '午餐', 3, 3, 3, 3, 3, 1, 2, 2, '2026-12-01', '13:00', '14:00');

insert into public.proposals (id, trip_id, proposer_member_id, proposer_role, base_version, change, impact_scope, live_branch_id) values
  ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', null, 0,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"清水寺改十點","operations":[{"op":"schedule_item","itemId":"32000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"10:00","end":"11:30"}]}', '{}', null),
  ('42000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', null, 1,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"清水寺改下午","operations":[{"op":"schedule_item","itemId":"32000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"14:00","end":"15:30"}]}', '{}', null),
  ('42000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', null, 2,
    '{"changeKind":"major_version","versionKind":"major","summary":"錦市場改到第二天","operations":[{"op":"schedule_item","itemId":"32000000-0000-0000-0000-000000000002","date":"2026-12-02","start":"12:00","end":"13:00"}]}', '{}', null),
  ('42000000-0000-0000-0000-000000000004', '22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', null, 3,
    '{"changeKind":"minor_non_incident","versionKind":"minor","summary":"復原前提出的提案","operations":[{"op":"schedule_item","itemId":"32000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"16:00","end":"17:30"}]}', '{}', null);

-- 以 Owner 批准三個提案：v1.0、v1.1、v2.0
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select public.approve_proposal('42000000-0000-0000-0000-000000000001');
select public.approve_proposal('42000000-0000-0000-0000-000000000002');
select public.approve_proposal('42000000-0000-0000-0000-000000000003');
reset role;

-- 每個版本保存完整行程快照 ---------------------------------------------
select has_column('public', 'versions', 'snapshot', '版本有完整行程快照欄位');
select has_column('public', 'versions', 'restored_from', '版本記錄復原來源');
select is((select snapshot from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0),
  '[{"itemId":"32000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"10:00","end":"11:30"},
    {"itemId":"32000000-0000-0000-0000-000000000002","date":"2026-12-01","start":"13:00","end":"14:00"}]'::jsonb,
  'v1.0 快照包含行程所有項目');
select is((select snapshot -> 1 from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 2),
  '{"itemId":"32000000-0000-0000-0000-000000000002","date":"2026-12-02","start":"12:00","end":"13:00"}'::jsonb,
  'v2.0 快照反映改到第二天');

-- 事實失效標示 At Risk（復原不應清除）
update public.itinerary_items set at_risk = true where id = '32000000-0000-0000-0000-000000000001';

-- 權限 ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
select throws_ok($$select public.restore_version((select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0), 3)$$,
  '42501', null, 'V：不可復原');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
select throws_ok($$select public.restore_version((select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0), 3)$$,
  '42501', null, 'X：不可復原別人行程的版本');
select throws_ok($$select public.restore_version('00000000-0000-0000-0000-000000000000', 3)$$,
  '42501', null, 'X：不存在的版本與沒有權限的回應相同');
reset role;
set local role anon;
select throws_ok($$select public.restore_version('00000000-0000-0000-0000-000000000000', 3)$$, '42501', null, '未登入：不可復原');
reset role;

-- base version 不符（SH-04） -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select throws_ok($$select public.restore_version((select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0), 2)$$,
  '40001', null, 'C：base version 不符時失敗');
reset role;
select is((select current_version from public.trips where id = '22000000-0000-0000-0000-000000000001'), 3, '失敗時目前版本不變');

-- Companion 復原到 v1.0 ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select is((public.restore_version((select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0), 3)
  - 'version_id'), '{"outcome":"restored","major":3,"minor":0}'::jsonb, 'C：復原成功，項目換日所以為 Major v3.0');
reset role;

select results_eq($$select id::text, scheduled_date::text, scheduled_start::text, scheduled_end::text from public.itinerary_items
  where trip_id = '22000000-0000-0000-0000-000000000001' order by id$$,
  $$values ('32000000-0000-0000-0000-000000000001', '2026-12-01', '10:00:00', '11:30:00'),
           ('32000000-0000-0000-0000-000000000002', '2026-12-01', '13:00:00', '14:00:00')$$,
  '行程項目與 v1.0 相同');
select ok((select at_risk from public.itinerary_items where id = '32000000-0000-0000-0000-000000000001'),
  'At Risk 標示屬於事實資料，復原後保留');
select is((select current_version from public.trips where id = '22000000-0000-0000-0000-000000000001'), 4, '目前版本加一');
select results_eq($$select kind::text, summary, proposal_id, approved_by, base_version, restored_from from public.versions
  where trip_id = '22000000-0000-0000-0000-000000000001' and major = 3$$,
  $$values ('major', '復原至 v1.0', null::uuid, '00000000-0000-0000-0000-0000000000d2'::uuid, 3,
    (select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0))$$,
  'Change Log 記錄復原者與來源版本');
select is((select snapshot from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 3),
  (select snapshot from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0),
  '新版本快照與 v1.0 相同');
select is((select old_arrangement from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 3),
  '[{"itemId":"32000000-0000-0000-0000-000000000001","date":"2026-12-01","start":"14:00","end":"15:30"},
    {"itemId":"32000000-0000-0000-0000-000000000002","date":"2026-12-02","start":"12:00","end":"13:00"}]'::jsonb,
  '舊安排只列出有改動的項目');
select is((select count(*)::integer from public.versions where trip_id = '22000000-0000-0000-0000-000000000001'), 4,
  '原有版本紀錄保留，新增一個版本');
select is((select snapshot -> 1 ->> 'date' from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 2),
  '2026-12-02', '原有版本內容不變');
select results_eq($$select recipient_id, kind, ref_table, ref_id from public.notifications
  where trip_id = '22000000-0000-0000-0000-000000000001' and kind = 'version_restored' order by recipient_id$$,
  $$select m.id, 'version_restored'::text, 'versions'::text, v.id
    from (values ('00000000-0000-0000-0000-0000000000d1'::uuid), ('00000000-0000-0000-0000-0000000000d3'::uuid)) m(id),
         public.versions v where v.trip_id = '22000000-0000-0000-0000-000000000001' and v.major = 3 order by m.id$$,
  '通知其他成員，復原者本人除外');

-- 復原前提出的提案因版本已變更而失效 ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is(public.approve_proposal('42000000-0000-0000-0000-000000000004'), '{"outcome":"invalidated"}'::jsonb,
  'O：復原前的提案批准時失效（SH-04）');

-- 已與所選版本相同 ------------------------------------------------------
select throws_ok($$select public.restore_version((select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 0), 4)$$,
  '22023', null, 'O：行程已與所選版本相同時不建立新版本');

-- 復原到中間版本 v1.1：同一天改時間為 Minor -----------------------------
select is((public.restore_version((select id from public.versions where trip_id = '22000000-0000-0000-0000-000000000001' and major = 1 and minor = 1), 4)
  - 'version_id'), '{"outcome":"restored","major":3,"minor":1}'::jsonb, 'O：可選任何舊版本；同一天改時間為 Minor');
reset role;

-- 沒有快照的版本（T10A 之前建立的紀錄） --------------------------------
insert into public.versions (id, trip_id, major, minor, kind, summary, impact_scope, old_arrangement, new_arrangement, base_version) values
  ('52000000-0000-0000-0000-000000000009', '22000000-0000-0000-0000-000000000001', 9, 0, 'major', '舊紀錄', '{}', '{}', '{}', 0);
select is((select jsonb_array_length(snapshot) from public.versions where id = '52000000-0000-0000-0000-000000000009'), 2,
  '任何寫入路徑新增的版本都自動記錄快照');
update public.versions set snapshot = null where id = '52000000-0000-0000-0000-000000000009';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select throws_ok($$select public.restore_version('52000000-0000-0000-0000-000000000009', 5)$$,
  '22023', null, 'O：沒有完整行程紀錄的版本不可復原');
reset role;

select * from finish();
rollback;
