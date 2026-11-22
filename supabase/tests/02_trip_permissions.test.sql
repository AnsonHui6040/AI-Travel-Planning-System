-- SH-01、SH-02：第 6 節權限表中，trips 與 trip_members 相關的每一格
-- 使用者：O = Owner、C = Companion、V = Viewer、X = 非成員
begin;
select plan(31);

-- 以目前角色執行 DML 並回傳影響筆數（受 RLS 限制）；transaction 結束時 rollback
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
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'companion@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'outsider@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000e', 'invitee@example.test', 'authenticated', 'authenticated');

select is((select count(*)::int from public.profiles), 5, '新使用者自動建立 profile');

-- 未登入
set local role anon;
select throws_ok($$select count(*) from public.trips$$, '42501', null, '未登入：讀取行程被拒');
select throws_ok(
  $$insert into public.trips (id, name, owner_id) values ('10000000-0000-0000-0000-000000000001', 'x', '00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, '未登入：無法建立行程'
);
reset role;

-- O 建立行程，自動成為 Owner
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.trips (id, name, destination, timezone, owner_id) values ('10000000-0000-0000-0000-000000000001', '東京五日', '東京', 'Asia/Tokyo', '00000000-0000-0000-0000-00000000000a')$$,
  'O 可建立行程'
);
select is(
  (select role::text from public.trip_members where trip_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000000a'),
  'owner', '建立者自動成為 Owner'
);
select throws_ok(
  $$insert into public.trips (id, name, owner_id) values ('10000000-0000-0000-0000-000000000002', 'x', '00000000-0000-0000-0000-00000000000b')$$,
  '42501', null, '不可替他人建立行程'
);

-- 邀請成員：Owner 可
select lives_ok(
  $$insert into public.trip_members (trip_id, user_id, role) values
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'companion'),
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'viewer')$$,
  '邀請成員：Owner 可'
);
select throws_ok(
  $$insert into public.trip_members (trip_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'owner')$$,
  '42501', null, '邀請時不可直接指定為 Owner'
);

-- 檢視行程
select is((select count(*)::int from public.trips), 1, '檢視行程：Owner 可');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.trips), 1, '檢視行程：Companion 可');
select is((select count(*)::int from public.trip_members), 3, 'Companion 可看到同行程成員');
select throws_ok(
  $$insert into public.trip_members (trip_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'viewer')$$,
  '42501', null, '邀請成員：Companion 不可'
);
select is(
  public.__affected($q$update public.trip_members set role = 'companion' where user_id = '00000000-0000-0000-0000-00000000000c'$q$),
  0, '變更角色：Companion 不可'
);
select is(
  public.__affected($q$delete from public.trip_members where user_id = '00000000-0000-0000-0000-00000000000c'$q$),
  0, '移除成員：Companion 不可'
);
select is(
  public.__affected($q$delete from public.trips$q$),
  0, '刪除行程：Companion 不可'
);
select throws_ok(
  $$select public.transfer_trip_ownership('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')$$,
  '42501', null, '轉移 Owner：Companion 不可'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.trips), 1, '檢視行程：Viewer 可');
select throws_ok(
  $$insert into public.trip_members (trip_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'viewer')$$,
  '42501', null, '邀請成員：Viewer 不可'
);
select is(
  public.__affected($q$delete from public.trips$q$),
  0, '刪除行程：Viewer 不可'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is((select count(*)::int from public.trips), 0, '非成員看不到行程');
select is((select count(*)::int from public.trip_members), 0, '非成員看不到成員');
select throws_ok(
  $$insert into public.trip_members (trip_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'companion')$$,
  '42501', null, '非成員不可自行加入'
);
reset role;

-- 變更角色、移除成員：Owner 可
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(
  public.__affected($q$update public.trip_members set role = 'companion' where user_id = '00000000-0000-0000-0000-00000000000c'$q$),
  1, '變更角色：Owner 可'
);
select throws_ok(
  $$update public.trip_members set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000c'$$,
  '42501', null, '變更角色時不可改為 Owner，須經轉移'
);
select is(
  public.__affected($q$delete from public.trip_members where user_id = '00000000-0000-0000-0000-00000000000a'$q$),
  0, '自行退出：Owner 須先轉移 Owner 或刪除行程'
);
insert into public.trip_members (trip_id, user_id, role) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'viewer');
select is(
  public.__affected($q$delete from public.trip_members where user_id = '00000000-0000-0000-0000-00000000000e'$q$),
  1, '移除成員：Owner 可'
);
reset role;

-- 自行退出：Viewer（C 的角色已改為 companion 的 V）可
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(
  public.__affected($q$delete from public.trip_members where user_id = '00000000-0000-0000-0000-00000000000c'$q$),
  1, '自行退出：Companion 與 Viewer 可'
);
reset role;

-- 轉移 Owner：Owner 可，原 Owner 改為 Companion
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok(
  $$select public.transfer_trip_ownership('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')$$,
  '轉移 Owner：Owner 可'
);
select is(
  (select owner_id from public.trips where id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000000b'::uuid, '轉移後 trips.owner_id 更新'
);
select is(
  (select role::text from public.trip_members where user_id = '00000000-0000-0000-0000-00000000000a'),
  'companion', '原 Owner 改為 Companion'
);
reset role;

-- 刪除行程：Owner 可
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is(
  public.__affected($q$delete from public.trips where id = '10000000-0000-0000-0000-000000000001'$q$),
  1, '刪除行程：Owner 可'
);
reset role;

select * from finish();
rollback;
