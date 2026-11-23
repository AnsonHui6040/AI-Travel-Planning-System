-- T17：敏感欄位（全名、電話、電子郵件）、三個開關、當事人控制、加密儲存（S-07、D18、SH-07、第 6 節權限表）
-- A：Owner；B：Companion；C：Viewer；D：非成員
begin;
select plan(40);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'pa@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'pb@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c1', 'pc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d1', 'pd@example.test', 'authenticated', 'authenticated');

insert into public.trips (id, name, owner_id) values
  ('a7000000-0000-0000-0000-000000000001', '東京', '00000000-0000-0000-0000-0000000000a1');
insert into public.trip_members (trip_id, user_id, role) values
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'companion'),
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'viewer');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

-- 呼叫者看到的值（依權限過濾後）
create function pg_temp.seen(p_owner uuid, p_field text) returns text language sql as $$
  select value from public.list_trip_sensitive_fields('a7000000-0000-0000-0000-000000000001')
    where user_id = p_owner and field::text = p_field;
$$;

-- 當事人儲存 ---------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select lives_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'full_name', '王小明')$$, 'A 儲存全名');
select lives_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'phone', '+886 912-345-678')$$, 'A 儲存電話');
select lives_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'email', 'ming@example.test')$$, 'A 儲存電子郵件');

select throws_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'email', 'not-an-email')$$,
  '22023', null, '電子郵件格式不正確時拒絕');
select throws_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'phone', 'call me')$$,
  '22023', null, '電話格式不正確時拒絕');
select throws_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'full_name', repeat('名', 81))$$,
  '22023', null, '全名超過 80 字時拒絕');

select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'full_name'), '王小明', '當事人看得到自己的值');
select results_eq(
  $$select share_ai, share_members, share_viewers from public.list_trip_sensitive_fields('a7000000-0000-0000-0000-000000000001')
      where user_id = '00000000-0000-0000-0000-0000000000a1' order by field$$,
  $$values (false, false, false), (false, false, false), (false, false, false)$$,
  '三個開關預設關閉');

-- 直接存取被拒 -----------------------------------------------------------
select throws_ok($$insert into public.member_sensitive_fields (trip_id, user_id, field, vault_secret_id)
    values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'full_name', gen_random_uuid())$$,
  '42501', null, '不可直接寫入敏感欄位表');
select throws_ok($$update public.member_sensitive_fields set share_ai = true$$, '42501', null, '不可直接修改開關');
select throws_ok($$select * from vault.decrypted_secrets$$, '42501', null, '不可讀取解密後的 Vault');
select throws_ok($$select * from public.ai_sensitive_fields('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1')$$,
  '42501', null, '使用者不可呼叫 AI 用的讀取函式');

-- 預設關閉：其他人看不到 ---------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'full_name'), null, 'Companion 看不到未開放的全名');
select is((select count(*)::int from public.list_trip_sensitive_fields('a7000000-0000-0000-0000-000000000001')), 0, 'Companion 查詢結果不含任何未開放的欄位');
select is((select count(*)::int from public.member_sensitive_fields), 0, 'Companion 讀不到他人的敏感欄位紀錄');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.list_trip_sensitive_fields('a7000000-0000-0000-0000-000000000001')), 0, 'Viewer 查詢結果不含任何未開放的欄位');

-- 當事人開放：全名給其他成員、電話給 Viewer ---------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_sensitive_sharing('a7000000-0000-0000-0000-000000000001', 'full_name', false, true, false)$$, 'A 開放全名給其他成員');
select lives_ok($$select public.set_sensitive_sharing('a7000000-0000-0000-0000-000000000001', 'phone', false, false, true)$$, 'A 開放電話給 Viewer');
select lives_ok($$select public.set_sensitive_sharing('a7000000-0000-0000-0000-000000000001', 'email', true, false, false)$$, 'A 開放電子郵件給 AI');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'full_name'), '王小明', 'Companion 看得到已開放給成員的全名');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'phone'), null, 'Companion 看不到只開放給 Viewer 的電話');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'email'), null, 'Companion 看不到只開放給 AI 的電子郵件');
select results_eq(
  $$select share_ai::text, share_members::text, share_viewers::text from public.list_trip_sensitive_fields('a7000000-0000-0000-0000-000000000001')$$,
  $$values (null::text, null::text, null::text)$$,
  '他人的開關設定不顯示');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'phone'), '+886 912-345-678', 'Viewer 看得到已開放給 Viewer 的電話');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'full_name'), null, 'Viewer 看不到只開放給成員的全名');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a1', 'email'), null, 'Viewer 看不到只開放給 AI 的電子郵件');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.list_trip_sensitive_fields('a7000000-0000-0000-0000-000000000001')), 0, '非成員看不到任何欄位');
select throws_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'full_name', '路人')$$,
  '42501', null, '非成員不可在行程中儲存敏感欄位');

-- 當事人控制：別人不能改 A 的開關 -------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.set_sensitive_sharing('a7000000-0000-0000-0000-000000000001', 'phone', true, true, true)$$,
  'P0002', null, '只能修改自己的開關；B 沒有電話紀錄');
select lives_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'full_name', '林美華')$$, 'B 儲存自己的全名');
select is((select count(*)::int from public.member_sensitive_fields), 1, 'B 只看得到自己的紀錄');

-- 加密儲存 ---------------------------------------------------------------
reset role;
select is((select count(*)::int from vault.secrets s join public.member_sensitive_fields f on f.vault_secret_id = s.id
    where s.secret = '王小明' or s.secret like '%example.test%'), 0, 'Vault 中只有密文');
select hasnt_column('public', 'member_sensitive_fields', 'value', '資料表沒有明文欄位');

-- AI 用的讀取函式：只回傳開啟「提供給 AI」的欄位 -----------------------------
set local role service_role;
select results_eq(
  $$select user_id, field::text, value from public.ai_sensitive_fields('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1')$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'email', 'ming@example.test')$$,
  'AI 只取得開啟「提供給 AI」的欄位');
select is((select count(*)::int from public.ai_sensitive_fields('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1')),
  0, 'Viewer 不能觸發 AI，取不到任何欄位');
select is((select count(*)::int from public.ai_sensitive_fields('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1')),
  0, '非成員取不到任何欄位');

-- 清空值即刪除 -----------------------------------------------------------
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.save_sensitive_field('a7000000-0000-0000-0000-000000000001', 'phone', '')$$, 'A 清空電話');
reset role;
select is((select count(*)::int from public.member_sensitive_fields
    where user_id = '00000000-0000-0000-0000-0000000000a1' and field = 'phone'), 0, '清空後刪除紀錄');

-- SH-07：移除成員時刪除其在該行程的敏感欄位與 Vault secret --------------------
create temp table b_secret as
  select vault_secret_id as id from public.member_sensitive_fields where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
delete from public.trip_members
  where trip_id = 'a7000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000b1';
reset role;
select is((select count(*)::int from public.member_sensitive_fields where user_id = '00000000-0000-0000-0000-0000000000b1'),
  0, '移除成員後刪除其敏感欄位');
select is((select count(*)::int from vault.secrets where id in (select id from b_secret)), 0, '移除成員後刪除 Vault secret');

select * from finish();
rollback;
