-- T32：邀請、角色變更、移除成員（SH-01、SH-02、SH-07）。
-- 邀請只由 Owner 建立連結，受邀者以本人登入後接受；token 只存 SHA-256，7 天到期，只能使用一次，可撤銷。
-- 移除成員或自行退出時，刪除該成員在此行程的敏感欄位、行程記憶與通知（SH-07）。
-- O：Owner；C：Companion；V：Viewer；I：受邀者；X：非成員
begin;
select plan(28);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'fo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'fc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'fv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f4', 'fi@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f5', 'fx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id) values
  ('f2000000-0000-0000-0000-000000000001', '東京五日', '00000000-0000-0000-0000-0000000000f1');
insert into public.trip_members (trip_id, user_id, role) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'companion'),
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f3', 'viewer');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

create temp table tokens (name text primary key, token text);
grant select, insert on tokens to authenticated;

-- 建立邀請：只有 Owner ----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$select public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'viewer')$$, '42501', null, 'Companion 不可邀請');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select throws_ok($$select public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'viewer')$$, '42501', null, 'Viewer 不可邀請');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f5');
select throws_ok($$select public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'viewer')$$, '42501', null, '非成員不可邀請');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select throws_ok($$select public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'owner')$$, '22023', null, '邀請不可指定為 Owner');
insert into tokens values ('viewer', public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'viewer'));
insert into tokens values ('companion', public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'companion'));
insert into tokens values ('revoked', public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'viewer'));
insert into tokens values ('expired', public.create_trip_invitation('f2000000-0000-0000-0000-000000000001', 'viewer'));
select ok((select bool_and(token ~ '^[0-9a-f]{64}$') from tokens), 'token 為 256 位元隨機值');
select is((select count(*)::int from public.trip_invitations), 4, 'Owner 看得到行程的邀請');
select throws_ok($$select token_hash from public.trip_invitations$$, '42501', null, '看不到 token 雜湊');
reset role;
select is((select count(*)::int from public.trip_invitations i join tokens t on i.token_hash = t.token), 0, '資料庫不保存 token 原文');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((select count(*)::int from public.trip_invitations), 0, 'Companion 看不到邀請');

-- 撤銷：只有 Owner -----------------------------------------------------------------------
select throws_ok($$select public.revoke_trip_invitation((select id from public.trip_invitations limit 1))$$, '42501', null,
  'Companion 不可撤銷邀請');
reset role;
update public.trip_invitations set expires_at = now() - interval '1 minute'
  where token_hash = encode(extensions.digest((select token from tokens where name = 'expired'), 'sha256'), 'hex');
create temp table revoke_target as select id from public.trip_invitations
  where token_hash = encode(extensions.digest((select token from tokens where name = 'revoked'), 'sha256'), 'hex');
grant select on revoke_target to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$select public.revoke_trip_invitation((select id from revoke_target))$$, 'Owner 撤銷邀請');
reset role;

-- 預覽與接受 -------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f4');
select results_eq($$select trip_name, role, status from public.invitation_preview((select token from tokens where name = 'viewer'))$$,
  $$values ('東京五日', 'viewer', 'valid')$$, '受邀者可預覽行程名稱與角色');
select is((select status from public.invitation_preview('0000000000000000000000000000000000000000000000000000000000000000')), 'invalid',
  '錯誤的 token 無法預覽');
select is((select count(*)::int from public.trips), 0, '接受前看不到行程');
select is(public.accept_trip_invitation((select token from tokens where name = 'viewer')), 'f2000000-0000-0000-0000-000000000001'::uuid,
  '受邀者接受邀請');
select is((select role::text from public.trip_members where trip_id = 'f2000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-0000000000f4'), 'viewer', '以邀請的角色加入');
select is((select count(*)::int from public.trips), 1, '接受後看得到行程');
select throws_ok($$select public.accept_trip_invitation((select token from tokens where name = 'companion'))$$, '22023', null,
  '已是成員時不可再接受');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f5');
select throws_ok($$select public.accept_trip_invitation((select token from tokens where name = 'viewer'))$$, '22023', null, '邀請只能使用一次');
select throws_ok($$select public.accept_trip_invitation((select token from tokens where name = 'revoked'))$$, '22023', null, '撤銷的邀請不可接受');
select throws_ok($$select public.accept_trip_invitation((select token from tokens where name = 'expired'))$$, '22023', null, '過期的邀請不可接受');
select is((select status from public.invitation_preview((select token from tokens where name = 'expired'))), 'invalid', '過期的邀請不可預覽');
reset role;
set local role anon;
select throws_ok($$select public.accept_trip_invitation('x')$$, '42501', null, '未登入不可接受');
reset role;

-- SH-07：移除成員時刪除敏感欄位、行程記憶與通知 -------------------------------------------------
insert into public.memories (owner_id, layer, trip_id, kind, item, value, source) values
  ('00000000-0000-0000-0000-0000000000f4', 'trip_context', 'f2000000-0000-0000-0000-000000000001', 'preference', '步行', '少走路', 'manual'),
  ('00000000-0000-0000-0000-0000000000f4', 'personal', null, 'preference', '飲食', '不吃辣', 'manual');
insert into public.notifications (recipient_id, trip_id, kind) values
  ('00000000-0000-0000-0000-0000000000f4', 'f2000000-0000-0000-0000-000000000001', 'proposal_applied');
insert into public.member_sensitive_fields (trip_id, user_id, field, vault_secret_id)
  values ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f4', 'phone', vault.create_secret('0900-000-000'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select lives_ok($$delete from public.trip_members where trip_id = 'f2000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-0000000000f4'$$, 'Owner 移除成員');
reset role;
select results_eq($$select
    (select count(*)::int from public.memories where owner_id = '00000000-0000-0000-0000-0000000000f4' and layer = 'trip_context'),
    (select count(*)::int from public.memories where owner_id = '00000000-0000-0000-0000-0000000000f4' and layer = 'personal'),
    (select count(*)::int from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000f4'),
    (select count(*)::int from public.member_sensitive_fields where user_id = '00000000-0000-0000-0000-0000000000f4')$$,
  $$values (0, 1, 0, 0)$$, '刪除該行程的記憶、通知與敏感欄位，保留個人記憶');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f4');
select is((select count(*)::int from public.trips), 0, '移除後看不到行程（撤銷存取權）');

-- 自行退出也套用 SH-07
reset role;
insert into public.notifications (recipient_id, trip_id, kind) values
  ('00000000-0000-0000-0000-0000000000f3', 'f2000000-0000-0000-0000-000000000001', 'proposal_applied');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f3');
select lives_ok($$delete from public.trip_members where trip_id = 'f2000000-0000-0000-0000-000000000001'
  and user_id = '00000000-0000-0000-0000-0000000000f3'$$, 'Viewer 自行退出');
reset role;
select is((select count(*)::int from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000f3'), 0, '退出後刪除該行程的通知');

select * from finish();
rollback;
