-- T14：角色的模型與備援設定、AI 用量紀錄（S-06、C-08）
-- A、B 為兩位使用者；設定與用量只限本人
begin;
select plan(14);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'sa@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'sb@example.test', 'authenticated', 'authenticated');

select has_table('public', 'ai_role_settings', 'ai_role_settings 存在');
select has_table('public', 'ai_usage', 'ai_usage 存在');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$insert into public.ai_role_settings (owner_id, role, chain, max_steps, max_tokens)
  values ('00000000-0000-0000-0000-0000000000a1', 'research',
    '[{"provider":"anthropic","model":"claude-opus-5-5"},{"provider":"google","model":null}]', 6, 200000)$$,
  'A 儲存自己的角色設定');
select lives_ok($$update public.ai_role_settings set max_steps = 8
  where owner_id = '00000000-0000-0000-0000-0000000000a1' and role = 'research'$$, 'A 修改自己的設定');
select throws_ok($$insert into public.ai_role_settings (owner_id, role, chain, max_steps, max_tokens)
  values ('00000000-0000-0000-0000-0000000000a2', 'research', '[{"provider":"openai","model":null}]', 6, 200000)$$,
  '42501', null, 'A 不可替 B 建立設定');
select throws_ok($$insert into public.ai_role_settings (owner_id, role, chain, max_steps, max_tokens)
  values ('00000000-0000-0000-0000-0000000000a1', 'verification', '[{"provider":"openai","model":null}]', 0, 200000)$$,
  '23514', null, '步數上限必須 1–100（S-06）');
select throws_ok($$insert into public.ai_role_settings (owner_id, role, chain, max_steps, max_tokens)
  values ('00000000-0000-0000-0000-0000000000a1', 'transport', '[]', 6, 120000)$$,
  '23514', null, '備援次序至少一家');
select throws_ok($$insert into public.ai_role_settings (owner_id, role, chain, max_steps, max_tokens)
  values ('00000000-0000-0000-0000-0000000000a1', 'transport', '[{"provider":"x"},{"provider":"y"},{"provider":"z"},{"provider":"w"}]', 6, 120000)$$,
  '23514', null, '備援次序最多三家');

select lives_ok($$insert into public.ai_usage (owner_id, role, provider, model, steps, input_tokens, output_tokens, outcome)
  values ('00000000-0000-0000-0000-0000000000a1', 'research', 'anthropic', 'claude-opus-5-5', 2, 3000, 500, 'completed')$$,
  'A 記錄自己的用量');
select throws_ok($$insert into public.ai_usage (owner_id, role, provider, model, steps, input_tokens, output_tokens, outcome)
  values ('00000000-0000-0000-0000-0000000000a2', 'research', 'anthropic', 'm', 1, 1, 1, 'completed')$$,
  '42501', null, 'A 不可替 B 記錄用量');
select throws_ok($$update public.ai_usage set input_tokens = 0$$, '42501', null, '用量紀錄不可修改');

-- B 看不到 A 的設定與用量
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.ai_role_settings), 0, 'B 看不到 A 的設定');
select is((select count(*)::int from public.ai_usage), 0, 'B 看不到 A 的用量');

set local role anon;
select throws_ok($$select * from public.ai_usage$$, '42501', null, '未登入不可讀取用量');

select * from finish();
rollback;
