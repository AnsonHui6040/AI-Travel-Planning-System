-- T06：第 6 節權限表中，T06 建立之資料表相關的每一格
-- O = Owner、C = Companion、V = Viewer、X = 非成員
begin;
select plan(39);

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
  ('00000000-0000-0000-0000-0000000000b1', 'o@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'c@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'v@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b4', 'x@example.test', 'authenticated', 'authenticated');

-- 測試資料（以 postgres 建立，相當於 applyChange 與伺服器函式）
insert into public.trips (id, name, owner_id) values
  ('20000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000b1');
insert into public.trip_members (trip_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'companion'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'viewer');
insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
  recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost,
  score_transport_cost, score_weather_dependency, score_time_slot_dependency, score_substitutability)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '淺草寺', 'attraction',
  60, 3, 'medium', '東京最古老的寺院', 4, 5, 3, 3, 4, 2, 2, 1);
insert into public.trip_baselines (trip_id, version, data) values ('20000000-0000-0000-0000-000000000001', 1, '{}');
insert into public.days (trip_id, date) values ('20000000-0000-0000-0000-000000000001', '2026-12-01');
insert into public.mobility_segments (trip_id, from_item_id, to_item_id, buffer_minutes) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 10);
insert into public.versions (trip_id, major, minor, kind, summary, impact_scope, old_arrangement, new_arrangement, base_version) values
  ('20000000-0000-0000-0000-000000000001', 1, 0, 'major', '建立行程', '{}', '{}', '{}', 0);
insert into public.notifications (recipient_id, trip_id, kind) values
  ('00000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-000000000001', 'proposal_applied');
insert into public.memories (owner_id, layer, kind, item, value, source) values
  ('00000000-0000-0000-0000-0000000000b2', 'personal', 'constraint', '每日步行上限', '15000', 'manual');
insert into public.api_key_records (owner_id, provider, vault_secret_id, last4) values
  ('00000000-0000-0000-0000-0000000000b2', 'anthropic', gen_random_uuid(), 'abcd');
insert into public.readonly_links (trip_id, token_hash, expires_at, created_by) values
  ('20000000-0000-0000-0000-000000000001', repeat('a', 64), now() + interval '7 days', '00000000-0000-0000-0000-0000000000b1');
insert into public.background_jobs (kind, initiator_id) values ('research', '00000000-0000-0000-0000-0000000000b2');

-- Companion ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*)::int from public.itinerary_items), 1, 'C：檢視行程項目');
select is((select count(*)::int from public.trip_baselines), 1, 'C：檢視旅行基線');
select is((select count(*)::int from public.days), 1, 'C：檢視每日');
select is((select count(*)::int from public.mobility_segments), 1, 'C：檢視移動段');
select is((select count(*)::int from public.versions), 1, 'C：檢視 Change Log');
select throws_ok($$insert into public.itinerary_items (trip_id) values ('20000000-0000-0000-0000-000000000001')$$, '42501', null, 'C：不可直接寫入正式行程項目（S-01）');
select throws_ok($$update public.itinerary_items set priority = 1$$, '42501', null, 'C：不可直接修改正式行程項目（S-01）');
select lives_ok($$insert into public.proposals (trip_id, proposer_member_id, base_version, change, impact_scope)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 0, '{}', '{}')$$, 'C：手動提出修改');
select throws_ok($$insert into public.proposals (trip_id, proposer_member_id, base_version, change, impact_scope, status)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 0, '{}', '{}', 'applied')$$, '42501', null, 'C：不可建立已套用的提案');
select lives_ok($$insert into public.incidents (trip_id, level, snapshot, created_by)
  values ('20000000-0000-0000-0000-000000000001', 'L2', '{}', '00000000-0000-0000-0000-0000000000b2')$$, 'C：觸發 Incident Mode');
select lives_ok($$insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by)
  values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'completed', '00000000-0000-0000-0000-0000000000b2')$$, 'C：記錄活動完成');
select lives_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'user_upload', '本人拍攝', '使用者', '20000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-0000000000a1.jpg', '00000000-0000-0000-0000-0000000000b2')$$, 'C：上傳照片');
select throws_ok($$insert into public.readonly_links (trip_id, token_hash, expires_at, created_by)
  values ('20000000-0000-0000-0000-000000000001', repeat('b', 64), now() + interval '1 day', '00000000-0000-0000-0000-0000000000b2')$$, '42501', null, 'C：不可建立唯讀連結');
select is((select count(*)::int from public.notifications), 1, 'C：看得到自己的通知');
select is(public.__affected($q$update public.notifications set read_at = now()$q$), 1, 'C：可將自己的通知標示已讀');
select throws_ok($$update public.notifications set kind = 'x'$$, '42501', null, 'C：不可修改通知內容');
select is((select count(*)::int from public.memories), 1, 'C：看得到自己的記憶');
select is((select count(*)::int from public.api_key_records), 1, 'C：看得到自己的 API key 紀錄');
select lives_ok($$insert into public.background_jobs (kind, initiator_id, trip_id)
  values ('research', '00000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-000000000001')$$, 'C：以本人名義建立背景 job');
select throws_ok($$insert into public.background_jobs (kind, initiator_id)
  values ('research', '00000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'C：不可以他人名義建立背景 job（C-12）');
reset role;

-- Viewer ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select is((select count(*)::int from public.itinerary_items), 1, 'V：檢視行程項目');
select is((select count(*)::int from public.versions), 1, 'V：檢視 Change Log');
select throws_ok($$insert into public.proposals (trip_id, proposer_member_id, base_version, change, impact_scope)
  values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 0, '{}', '{}')$$, '42501', null, 'V：不可提出修改');
select throws_ok($$insert into public.incidents (trip_id, level, snapshot, created_by)
  values ('20000000-0000-0000-0000-000000000001', 'L2', '{}', '00000000-0000-0000-0000-0000000000b3')$$, '42501', null, 'V：不可觸發 Incident Mode');
select throws_ok($$insert into public.actual_timeline_entries (trip_id, item_id, completion, recorded_by)
  values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'completed', '00000000-0000-0000-0000-0000000000b3')$$, '42501', null, 'V：不可記錄活動完成');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'user_upload', '本人拍攝', '使用者', '20000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-0000000000a2.jpg', '00000000-0000-0000-0000-0000000000b3')$$, '42501', null, 'V：不可上傳照片');
select is((select count(*)::int from public.notifications), 0, 'V：看不到他人的通知');
select is((select count(*)::int from public.memories), 0, 'V：看不到他人的記憶');
select is((select count(*)::int from public.api_key_records), 0, 'V：看不到他人的 API key 紀錄');
select is((select count(*)::int from public.background_jobs), 0, 'V：看不到他人的背景 job');
reset role;

-- 非成員 ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
select is((select count(*)::int from public.itinerary_items), 0, 'X：看不到行程項目');
select is((select count(*)::int from public.proposals), 0, 'X：看不到提案');
select is((select count(*)::int from public.versions), 0, 'X：看不到 Change Log');
reset role;

-- Owner ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok($$insert into public.readonly_links (trip_id, token_hash, expires_at, created_by)
  values ('20000000-0000-0000-0000-000000000001', repeat('c', 64), now() + interval '1 day', '00000000-0000-0000-0000-0000000000b1')$$, 'O：建立唯讀連結');
select is((select count(*)::int from public.readonly_links), 2, 'O：檢視唯讀連結');
select is(public.__affected($q$update public.readonly_links set revoked_at = now()$q$), 2, 'O：撤銷唯讀連結');
select throws_ok($$delete from public.itinerary_items$$, '42501', null, 'O：不可直接刪除正式行程項目（S-01）');
reset role;

-- 未登入 ---------------------------------------------------------------
set local role anon;
select throws_ok($$select count(*) from public.itinerary_items$$, '42501', null, '未登入：讀取行程項目被拒');
select throws_ok($$select count(*) from public.memories$$, '42501', null, '未登入：讀取記憶被拒');
reset role;

select * from finish();
rollback;
