-- T11：feature flag 表（F-05）。新功能預設關閉；只有登入者可讀，任何使用者都不能修改
begin;
select plan(10);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'ff@example.test', 'authenticated', 'authenticated');

select has_table('public', 'feature_flags', 'feature_flags 存在');
select col_default_is('public', 'feature_flags', 'enabled', 'false', '新功能預設關閉');

select is(
  (select count(*)::int from public.feature_flags where enabled),
  0,
  '第 7.1 節預留功能全部關閉'
);
select is(
  (select count(*)::int from public.feature_flags
    where key in ('expense_ledger', 'calendar_export', 'push_notifications', 'location_reminders', 'booking_import')),
  5,
  '第 7.1 節 F-01–F-04 的功能都已登記'
);

select throws_ok(
  $$insert into public.feature_flags (key, description) values ('Bad Key', 'x')$$,
  '23514', null, 'key 只接受小寫英文、數字與底線'
);

set local role anon;
select throws_ok($$select * from public.feature_flags$$, '42501', null, '未登入不可讀取 feature flag');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select is((select count(*)::int from public.feature_flags), 5, '登入者可讀取 feature flag');
select throws_ok(
  $$insert into public.feature_flags (key, description) values ('new_feature', 'x')$$,
  '42501', null, '登入者不可新增 feature flag'
);
select throws_ok(
  $$update public.feature_flags set enabled = true where key = 'expense_ledger'$$,
  '42501', null, '登入者不可開啟 feature flag'
);
select throws_ok(
  $$delete from public.feature_flags where key = 'expense_ledger'$$,
  '42501', null, '登入者不可刪除 feature flag'
);

select * from finish();
rollback;
