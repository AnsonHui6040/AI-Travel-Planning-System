-- C-11：每位使用者每個端點的速率限制
begin;
select plan(6);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'rl1@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'rl2@example.test', 'authenticated', 'authenticated');

set local role anon;
select throws_ok(
  $$select public.check_rate_limit('trips.create', 2, 60)$$,
  '42501', null, '未登入不可呼叫'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.check_rate_limit('trips.create', 2, 60), true, '第 1 次允許');
select is(public.check_rate_limit('trips.create', 2, 60), true, '第 2 次允許');
select is(public.check_rate_limit('trips.create', 2, 60), false, '第 3 次超過上限');
select is(public.check_rate_limit('trips.list', 2, 60), true, '不同端點分開計算');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(public.check_rate_limit('trips.create', 2, 60), true, '不同使用者分開計算');
reset role;

select * from finish();
rollback;
