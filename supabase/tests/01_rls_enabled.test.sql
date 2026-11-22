-- C-09：所有資料表啟用 RLS
begin;
select plan(2);

select is(
  (select count(*)::int from pg_tables
    where schemaname in ('public', 'private') and not rowsecurity),
  0,
  'public 與 private schema 的所有資料表均已啟用 RLS'
);

select is(
  (select count(*)::int from pg_tables
    where schemaname = 'public' and tablename in ('profiles', 'trips', 'trip_members')),
  3,
  '使用者、行程、trip_members 三張基本表存在'
);

select * from finish();
rollback;
