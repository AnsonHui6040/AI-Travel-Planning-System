-- T38：Incident Mode（第 2.6、2.9 節，D10）。Owner、Companion 經 start_incident 進入：
-- 建立 incident 與同一即時分支、同一 base version 的待批准提案；不改動行程項目；
-- 批准其中一個方案後其餘失效（commit_proposal）。
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(18);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'io@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'ic@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'iv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c4', 'ix@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status, current_version) values
  ('c1000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000c1', 'in_progress', 7),
  ('c1000000-0000-0000-0000-000000000002', '別的行程', '00000000-0000-0000-0000-0000000000c1', 'in_progress', 0),
  ('c1000000-0000-0000-0000-000000000003', '規劃中', '00000000-0000-0000-0000-0000000000c1', 'planning', 0);
insert into public.trip_members (trip_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'companion'),
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c3', 'viewer');

create function pg_temp.item(p_id uuid, p_trip uuid, p_life text, p_date date, p_start time, p_end time) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status,
    scheduled_date, scheduled_start, scheduled_end)
  values (p_id, p_trip, '項目', 'attraction', 60, 3, 'high', '測試', 0, 0, 0, 0, 0, 0, 0, 0, 'verified',
    p_life::public.lifecycle_status, p_date, p_start, p_end);
$$;
-- 13:00 戶外攝影、候選室內博物館、另一個行程的項目
select pg_temp.item('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'locked', '2026-12-10', '13:00', '15:00');
select pg_temp.item('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'verified', null, null, null);
select pg_temp.item('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002', 'verified', null, null, null);

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

-- 方案：攝影移回候選清單，候選排入同一時段
create function pg_temp.alt(p_kind text, p_item uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'tier', 'same_zone',
    'change', jsonb_build_object('changeKind', p_kind, 'versionKind', 'minor', 'summary', '大雨，同區域：改為室內博物館',
      'operations', jsonb_build_array(
        jsonb_build_object('op', 'schedule_item', 'itemId', 'c2000000-0000-0000-0000-000000000001', 'date', null, 'start', null, 'end', null),
        jsonb_build_object('op', 'schedule_item', 'itemId', p_item, 'date', '2026-12-10', 'start', '13:20', 'end', '14:50'))),
    'impactScope', jsonb_build_object('dates', jsonb_build_array('2026-12-10'), 'from', '13:00', 'until', '18:45'),
    'transport', null,
    'comparison', jsonb_build_object('newActivity', jsonb_build_array('室內博物館'), 'recommended', true));
$$;
create function pg_temp.drop_alt() returns jsonb language sql as $$
  select jsonb_build_object(
    'tier', 'drop',
    'change', jsonb_build_object('changeKind', 'incident_L3', 'versionKind', 'minor', 'summary', '大雨，刪減活動',
      'operations', jsonb_build_array(
        jsonb_build_object('op', 'schedule_item', 'itemId', 'c2000000-0000-0000-0000-000000000001', 'date', null, 'start', null, 'end', null))),
    'impactScope', jsonb_build_object('dates', jsonb_build_array('2026-12-10'), 'from', '13:00', 'until', '18:45'),
    'transport', null,
    'comparison', jsonb_build_object('newActivity', jsonb_build_array(), 'recommended', false));
$$;
create function pg_temp.snap() returns jsonb language sql as $$
  select jsonb_build_object('trigger', jsonb_build_object('type', 'heavy_rain'), 'snapshot', jsonb_build_object('time', '13:00'));
$$;
grant execute on function pg_temp.alt(text, uuid), pg_temp.drop_alt(), pg_temp.snap() to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.drop_alt()))$$, '42501', null, 'Viewer 不可進入 Incident Mode');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.drop_alt()))$$, '42501', null, '非成員不可進入 Incident Mode');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000003', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.drop_alt()))$$, '55000', null, '尚未鎖定的行程不可進入');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  '[]'::jsonb)$$, '22023', null, '至少一個方案');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.drop_alt(), pg_temp.drop_alt(), pg_temp.drop_alt(), pg_temp.drop_alt()))$$, '22023', null, '最多三個方案');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.alt('approved_fact_invalidated', 'c2000000-0000-0000-0000-000000000002')))$$, '22023', null,
  '不可使用自動套用類別');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.alt('incident_L3', 'c2000000-0000-0000-0000-000000000003')))$$, '22023', null,
  '不可調整其他行程的項目');
select throws_ok($$select public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3',
  jsonb_build_object('pad', repeat('x', 40000)), 345, jsonb_build_array(pg_temp.drop_alt()))$$, '23514', null, 'Snapshot 上限 32 KB');

select isnt(public.start_incident('c1000000-0000-0000-0000-000000000001', 'L3', pg_temp.snap(), 345,
  jsonb_build_array(pg_temp.alt('incident_L3', 'c2000000-0000-0000-0000-000000000002'), pg_temp.drop_alt())) ->> 'incident_id',
  null, 'Companion 進入 Incident Mode');
reset role;

select results_eq($$select level::text, created_by::text, available_minutes, jsonb_array_length(snapshot -> 'alternatives')
  from public.incidents where trip_id = 'c1000000-0000-0000-0000-000000000001'$$,
  $$values ('L3', '00000000-0000-0000-0000-0000000000c2', 345, 2)$$, '保存 Snapshot 與方案比較');
select results_eq($$select count(*)::int, count(distinct live_branch_id)::int, min(base_version), bool_and(status = 'pending'),
  bool_and(proposer_member_id = '00000000-0000-0000-0000-0000000000c2')
  from public.proposals where trip_id = 'c1000000-0000-0000-0000-000000000001'$$,
  $$values (2, 1, 7, true, true)$$, '兩個方案為同一即時分支、同一 base version 的待批准提案');
select results_eq($$select (i.snapshot -> 'alternatives' -> 0 ->> 'proposalId')::uuid = p.id
  from public.incidents i join public.proposals p on p.live_branch_id = i.live_branch_id
  where p.change ->> 'summary' like '%博物館%'$$, $$values (true)$$, '比較表對應到提案');
select results_eq($$select scheduled_date::text, current_version from public.itinerary_items i join public.trips t on t.id = i.trip_id
  where i.id = 'c2000000-0000-0000-0000-000000000001'$$, $$values ('2026-12-10', 7)$$, '未經批准不寫入：項目與版本不變');
select results_eq($$select count(*) > 0, bool_and(recipient_id <> '00000000-0000-0000-0000-0000000000c2')
  from public.notifications where kind = 'incident_started'$$, $$values (true, true)$$,
  '通知其他成員（進入者本人除外）');

-- 批准同區域方案：寫入並建立新版本，同一分支的其他方案失效
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.approve_proposal((select id from public.proposals where change ->> 'summary' like '%博物館%')) ->> 'outcome',
  'applied', 'Owner 批准方案');
reset role;
select results_eq($$select scheduled_date::text, scheduled_start::text from public.itinerary_items
  where id = 'c2000000-0000-0000-0000-000000000002'$$, $$values ('2026-12-10', '13:20:00')$$, '批准後候選排入時段');
select results_eq($$select status::text from public.proposals where change ->> 'summary' = '大雨，刪減活動'$$,
  $$values ('invalidated')$$, '同一即時分支的其他方案失效');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select is(public.start_incident('c1000000-0000-0000-0000-000000000001', null, pg_temp.snap(), null,
  jsonb_build_array(pg_temp.drop_alt())) ->> 'live_branch_id' is not null, true, '提早完成、取消時段可不分級');
reset role;

select * from finish();
rollback;
