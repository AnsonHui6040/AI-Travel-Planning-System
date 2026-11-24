-- T33：唯讀連結（C-10、SH-08）。只有 Owner 建立（token 256 位元、只存 SHA-256、1–30 天）、可撤銷；
-- 不登入也可經 readonly_trip 讀取已排入的行程；只附當事人開啟「提供給 Viewer 與唯讀連結」的敏感欄位。
-- token 無法列舉；撤銷、過期或錯誤的 token 讀不到任何資料。
-- O：Owner；C：Companion；V：Viewer
begin;
select plan(20);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a7', 'ro@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a8', 'rc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a9', 'rv@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status, start_date, end_date, timezone) values
  ('a7000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000a7', 'locked', '2026-12-10', '2026-12-14', 'Asia/Tokyo');
insert into public.trip_members (trip_id, user_id, role) values
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a8', 'companion'),
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a9', 'viewer');
update public.profiles set display_name = '阿明' where id = '00000000-0000-0000-0000-0000000000a8';

create function pg_temp.item(p_id uuid, p_name text, p_life text, p_date date) returns void language sql as $$
  insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
    score_weather_dependency, score_time_slot_dependency, score_substitutability, verification_status, lifecycle_status,
    scheduled_date, scheduled_start, scheduled_end, place_id, coord_lat, coord_lng, coord_fetched_at)
  values (p_id, 'a7000000-0000-0000-0000-000000000001', p_name, 'attraction', 60, 3, 'medium', '測試', 0, 0, 0, 0, 0, 0, 0, 0,
    'verified', p_life::public.lifecycle_status, p_date, case when p_date is null then null else '09:00'::time end,
    case when p_date is null then null else '10:00'::time end, 'ChIJ-test-place', 35.71, 139.79, now());
$$;
select pg_temp.item('a8000000-0000-0000-0000-000000000001', '淺草寺', 'locked', '2026-12-10');
select pg_temp.item('a8000000-0000-0000-0000-000000000002', '還在候選的咖啡店', 'verified', null);
insert into public.days (trip_id, date, status) values ('a7000000-0000-0000-0000-000000000001', '2026-12-10', 'approved');

insert into public.member_sensitive_fields (trip_id, user_id, field, vault_secret_id, share_viewers) values
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a8', 'phone', vault.create_secret('0912-345-678'), true),
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a9', 'email', vault.create_secret('hidden@example.test'), false);

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;
create temp table tokens (name text primary key, token text);
grant select, insert on tokens to authenticated, anon;

-- 建立：只有 Owner -----------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
select throws_ok($$select public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 7)$$, '42501', null, 'Companion 不可建立');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select throws_ok($$select public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 7)$$, '42501', null, 'Viewer 不可建立');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select throws_ok($$select public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 0)$$, '22023', null, '期限至少 1 天');
select throws_ok($$select public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 31)$$, '22023', null, '期限最多 30 天');
insert into tokens values ('ok', public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 7));
insert into tokens values ('revoked', public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 7));
insert into tokens values ('expired', public.create_readonly_link('a7000000-0000-0000-0000-000000000001', 1));
select ok((select bool_and(token ~ '^[0-9a-f]{64}$') from tokens), 'token 為 256 位元隨機值（C-10）');
reset role;
select is((select count(*)::int from public.readonly_links l join tokens t on l.token_hash = t.token), 0, '資料庫不保存 token 原文');
update public.readonly_links set expires_at = now() - interval '1 minute'
  where token_hash = encode(extensions.digest((select token from tokens where name = 'expired'), 'sha256'), 'hex');
create temp table revoke_target as select id from public.readonly_links
  where token_hash = encode(extensions.digest((select token from tokens where name = 'revoked'), 'sha256'), 'hex');
grant select on revoke_target to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$select public.revoke_readonly_link((select id from revoke_target))$$, 'Owner 撤銷唯讀連結');
reset role;

-- token 無法列舉 -------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select token_hash from public.readonly_links$$, '42501', null, '未登入無法列出連結');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
select is((select count(*)::int from public.readonly_links), 0, 'Companion 看不到連結');
reset role;

-- 以連結讀取（不登入）--------------------------------------------------------------------------
set local role anon;
select is(public.readonly_trip((select token from tokens where name = 'ok')) -> 'trip' ->> 'name', '東京五日', '不登入可讀取行程');
select is(jsonb_array_length(public.readonly_trip((select token from tokens where name = 'ok')) -> 'items'), 1, '只有已排入行程的項目');
select is(public.readonly_trip((select token from tokens where name = 'ok')) -> 'items' -> 0 ->> 'name_zh', '淺草寺', '項目名稱');
select ok(not (public.readonly_trip((select token from tokens where name = 'ok')) -> 'items' -> 0 ?| array['place_id', 'coord_lat', 'coord_lng']),
  '不含 place_id 與座標（D28）');
select is(public.readonly_trip((select token from tokens where name = 'ok')) -> 'days' -> 0 ->> 'status', 'approved', '每日狀態');
select is(public.readonly_trip((select token from tokens where name = 'ok')) -> 'sensitive',
  '[{"name": "阿明", "field": "phone", "value": "0912-345-678"}]'::jsonb, '只附開啟「提供給 Viewer 與唯讀連結」的敏感欄位（SH-08）');
select is(public.readonly_trip((select token from tokens where name = 'revoked')), null, '撤銷後無法存取');
select is(public.readonly_trip((select token from tokens where name = 'expired')), null, '過期後無法存取');
select is(public.readonly_trip(repeat('0', 64)), null, '錯誤的 token 讀不到資料');
select is(public.readonly_trip('not-a-token'), null, '格式不符的 token 讀不到資料');
reset role;
select is(has_function_privilege('anon', 'public.create_readonly_link(uuid, integer)', 'execute'), false, '未登入不可建立連結');

select * from finish();
rollback;
