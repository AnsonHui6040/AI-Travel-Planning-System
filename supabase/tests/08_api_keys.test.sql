-- T12：API key 以 Vault 加密儲存（C-02、C-04、C-05、C-12）
-- A、B 為兩位使用者；儲存與解密只限伺服器（service_role），使用者只能檢視與刪除本人的紀錄
begin;
select plan(26);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'ka@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'kb@example.test', 'authenticated', 'authenticated');

insert into public.background_jobs (id, kind, initiator_id) values
  ('91000000-0000-0000-0000-000000000001', 'research', '00000000-0000-0000-0000-0000000000f1'),
  ('91000000-0000-0000-0000-000000000002', 'research', '00000000-0000-0000-0000-0000000000f2');

-- 使用者不可呼叫儲存與解密函式，也不可讀 Vault
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select throws_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f1', 'openai', 'sk-test-AAAA1111', null)$$,
  '42501', null, '使用者不可直接儲存 key');
select throws_ok($$select public.decrypt_api_key('00000000-0000-0000-0000-0000000000f1', 'openai')$$,
  '42501', null, '使用者不可解密 key');
select throws_ok($$select public.decrypt_job_api_key('91000000-0000-0000-0000-000000000001', 'openai')$$,
  '42501', null, '使用者不可以背景 job 解密 key');
select throws_ok($$select * from vault.decrypted_secrets$$, '42501', null, '使用者不可讀取解密後的 Vault');
select throws_ok($$insert into public.api_key_records (owner_id, provider, vault_secret_id, last4)
  values ('00000000-0000-0000-0000-0000000000f1', 'openai', gen_random_uuid(), '1111')$$,
  '42501', null, '使用者不可直接新增 key 紀錄');

-- 伺服器儲存
reset role;
set local role service_role;

select lives_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f1', 'openai', 'sk-test-AAAA1111', now())$$,
  'A 儲存 OpenAI key');
select lives_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f2', 'openai', 'sk-test-BBBB2222', null)$$,
  'B 儲存 OpenAI key');
select lives_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f2', 'google_maps', 'AIza-test-BBBB3333', null)$$,
  'B 儲存 Google Maps key');

select is((select last4::text from public.api_key_records
  where owner_id = '00000000-0000-0000-0000-0000000000f1' and provider = 'openai'), '1111', '只保存末四碼');
select is((select last_tested_at is not null from public.api_key_records
  where owner_id = '00000000-0000-0000-0000-0000000000f1' and provider = 'openai'), true, '記錄測試時間');

reset role;
select is((select count(*)::int from vault.secrets s join public.api_key_records r on r.vault_secret_id = s.id
  where s.secret like '%AAAA1111%'), 0, 'Vault 內為密文，不含明文 key');
set local role service_role;

select is(public.decrypt_api_key('00000000-0000-0000-0000-0000000000f1', 'openai'), 'sk-test-AAAA1111', '解密本人的 key');
select is(public.decrypt_api_key('00000000-0000-0000-0000-0000000000f1', 'google_maps'), null, '沒有該 key 時回傳 null');

-- 更新：同一 provider 只保留一筆，沿用同一個 Vault secret
select lives_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f1', 'openai', 'sk-test-AAAA9999', null)$$,
  'A 更新 OpenAI key');
select is((select count(*)::int from public.api_key_records
  where owner_id = '00000000-0000-0000-0000-0000000000f1' and provider = 'openai'), 1, '更新後仍只有一筆');
select is(public.decrypt_api_key('00000000-0000-0000-0000-0000000000f1', 'openai'), 'sk-test-AAAA9999', '更新後解密為新 key');
select is((select count(*)::int from vault.secrets where name like 'api_key:00000000-0000-0000-0000-0000000000f1:%'), 1,
  '更新不留下舊的 Vault secret');

-- 格式錯誤：錯誤訊息不含 key
select throws_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f1', 'anthropic', 'short', null)$$,
  '22023', 'API key 格式不正確', '過短的 key 被拒，訊息不含 key');
select throws_ok($$select public.save_api_key('00000000-0000-0000-0000-0000000000f1', 'anthropic', 'sk test with space', null)$$,
  '22023', 'API key 格式不正確', '含空白的 key 被拒');

-- 背景 job 只能解密發起人的 key（C-12）
select is(public.decrypt_job_api_key('91000000-0000-0000-0000-000000000001', 'openai'), 'sk-test-AAAA9999',
  'A 發起的 job 取得 A 的 key');
select is(public.decrypt_job_api_key('91000000-0000-0000-0000-000000000002', 'openai'), 'sk-test-BBBB2222',
  'B 發起的 job 取得 B 的 key，不會取得 A 的');
select is(public.decrypt_job_api_key('91000000-0000-0000-0000-000000000001', 'google_maps'), null,
  'A 沒有 Google Maps key 時，A 的 job 不會借用 B 的（C-05）');

-- 使用者只能檢視、刪除本人的紀錄
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select is((select count(*)::int from public.api_key_records), 1, 'A 只看到自己的 key 紀錄');
delete from public.api_key_records where owner_id = '00000000-0000-0000-0000-0000000000f2';
delete from public.api_key_records where provider = 'openai';

reset role;
select is((select count(*)::int from public.api_key_records where owner_id = '00000000-0000-0000-0000-0000000000f2'), 2,
  'A 刪不到 B 的 key');
select is((select count(*)::int from vault.secrets where name like 'api_key:00000000-0000-0000-0000-0000000000f1:%'), 0,
  'A 刪除紀錄後 Vault secret 一併刪除');

-- 帳號刪除時，key 與 Vault secret 一併刪除
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f2';
select is((select count(*)::int from vault.secrets where name like 'api_key:00000000-0000-0000-0000-0000000000f2:%'), 0,
  '帳號刪除後 Vault secret 一併刪除');

select * from finish();
rollback;
