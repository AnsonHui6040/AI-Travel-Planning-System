-- 決策 0010 B：預訂與清單。Owner、Companion 可新增修改刪除，Viewer 唯讀，非成員看不到；
-- 預約碼只有行程成員可見：anon、service_role（AI）、唯讀連結讀取者沒有預訂的權限，readonly_trip 不含預約碼；
-- 清單項目可指定成員（必須是目前的成員）、勾選者與時間由資料庫記錄；成員被移除時取消指定。
-- O：Owner；C：Companion；V：Viewer；X：非成員
begin;
select plan(39);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'bo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'bc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'bv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b4', 'bx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('b1000000-0000-0000-0000-000000000001', '東京', '00000000-0000-0000-0000-0000000000b1', 'planning'),
  ('b1000000-0000-0000-0000-000000000002', '大阪', '00000000-0000-0000-0000-0000000000b4', 'planning');
insert into public.trip_members (trip_id, user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'companion'),
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'viewer');
insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
  recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
  score_weather_dependency, score_time_slot_dependency, score_substitutability) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '壽司店', 'restaurant', 90, 3, 'low', '測試', 0, 0, 0, 0, 0, 0, 0, 0),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002', '大阪城', 'attraction', 60, 3, 'low', '測試', 0, 0, 0, 0, 0, 0, 0, 0);

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

-- 執行一段 SQL，回傳影響的列數（RLS 擋下時為 0）
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;

create function pg_temp.booking(p_trip uuid, p_by uuid, p_item uuid default null, p_tz text default 'Asia/Tokyo') returns void language sql as $$
  insert into public.bookings (trip_id, kind, title, starts_at, ends_at, timezone, location, confirmation_code, note, item_id, created_by)
  values (p_trip, 'restaurant', '壽司晚餐', '2027-01-10 19:00+09', '2027-01-10 20:30+09', p_tz, '銀座', 'ZX9QK2', '靠窗', p_item, p_by);
$$;

-- 結構與權限 ------------------------------------------------------------------
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.bookings'::regclass, 'public.checklists'::regclass, 'public.checklist_items'::regclass)), '預訂與清單三張資料表都啟用 RLS');
select ok(not exists (
  select 1 from unnest(array['anon', 'service_role', 'atps_readonly_reader']) r,
    unnest(array['public.bookings', 'public.checklists', 'public.checklist_items']) t, unnest(array['select', 'insert', 'update', 'delete']) p
  where has_table_privilege(r, t, p)), 'anon、service_role（AI）與唯讀連結讀取者沒有預訂與清單的任何權限');
select ok(not has_column_privilege('authenticated', 'public.bookings', 'created_by', 'update')
  and not has_column_privilege('authenticated', 'public.bookings', 'trip_id', 'update')
  and not has_column_privilege('authenticated', 'public.checklist_items', 'checked_by', 'update')
  and not has_column_privilege('authenticated', 'public.checklist_items', 'checked_by', 'insert'), '不能改建立者、行程與勾選者');

-- 預訂 ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$select pg_temp.booking('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3')$$,
  '42501', null, 'Viewer 不能新增預訂');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select throws_ok($$select pg_temp.booking('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b4')$$,
  '42501', null, '非成員不能新增預訂');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$select pg_temp.booking('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2',
  'b2000000-0000-0000-0000-000000000001')$$, 'Companion 新增預訂（關聯同一行程的項目）');
select throws_ok($$select pg_temp.booking('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, '建立者必須是本人');
select throws_ok($$select pg_temp.booking('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2',
  'b2000000-0000-0000-0000-000000000002')$$, '22023', '關聯項目必須屬於同一行程', '關聯項目必須屬於同一行程');
select throws_ok($$select pg_temp.booking('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', null, 'Mars/Base')$$,
  '22023', '時區不正確', '時區必須是 IANA 名稱');
select throws_ok($$insert into public.bookings (trip_id, kind, title, starts_at, ends_at, timezone, created_by)
  values ('b1000000-0000-0000-0000-000000000001', 'flight', '回程', '2027-01-12 10:00+09', '2027-01-12 09:00+09', 'Asia/Tokyo',
  '00000000-0000-0000-0000-0000000000b2')$$, '23514', null, '結束不可早於開始');
select throws_ok($$insert into public.bookings (trip_id, kind, title, starts_at, timezone, created_by)
  values ('b1000000-0000-0000-0000-000000000001', 'boat', '船', '2027-01-12 10:00+09', 'Asia/Tokyo', '00000000-0000-0000-0000-0000000000b2')$$,
  '22P02', null, '類型只有六種');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select is((select confirmation_code from public.bookings where trip_id = 'b1000000-0000-0000-0000-000000000001'), 'ZX9QK2', 'Viewer 可看到預約碼');
select is(pg_temp.affected('update public.bookings set title = ''改名'''), 0, 'Viewer 不能修改預訂');
select is(pg_temp.affected('delete from public.bookings'), 0, 'Viewer 不能刪除預訂');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from public.bookings), 0, '非成員看不到預訂');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$update public.bookings set title = '壽司晚餐（改）', confirmation_code = 'ZX9QK3'
  where trip_id = 'b1000000-0000-0000-0000-000000000001'$$, 'Owner 修改預訂');
select is((select created_by from public.bookings where trip_id = 'b1000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000b2'::uuid, '修改不改變建立者');

-- 預約碼不出現在唯讀連結與 service_role ------------------------------------------------------
create temp table tokens (token text);
grant select, insert on tokens to authenticated, anon;
insert into tokens values (public.create_readonly_link('b1000000-0000-0000-0000-000000000001', 7));
reset role;
update public.itinerary_items set scheduled_date = '2027-01-10', scheduled_start = '19:00', scheduled_end = '20:30', lifecycle_status = 'approved'
  where id = 'b2000000-0000-0000-0000-000000000001';
set local role anon;
select ok(public.readonly_trip((select token from tokens)) is not null, '唯讀連結可讀取行程');
select ok(public.readonly_trip((select token from tokens))::text not like '%ZX9QK%', 'readonly_trip 不含預約碼');
select throws_ok($$select confirmation_code from public.bookings$$, '42501', null, '未登入不能讀預訂');
reset role;
set local role service_role;
select throws_ok($$select confirmation_code from public.bookings$$, '42501', null, 'service_role（AI）不能讀預訂');
reset role;

-- 清單 ------------------------------------------------------------------------
create temp table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;
create function pg_temp.new_list() returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.checklists (trip_id, kind, title, created_by)
  values ('b1000000-0000-0000-0000-000000000001', 'packing', '打包', '00000000-0000-0000-0000-0000000000b1') returning id into v;
  insert into ids values ('list', v);
end;
$$;
create function pg_temp.new_item(p_assignee uuid) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.checklist_items (list_id, trip_id, text, assignee, created_by)
  values ((select id from ids where name = 'list'), 'b1000000-0000-0000-0000-000000000001', '護照', p_assignee,
    '00000000-0000-0000-0000-0000000000b1') returning id into v;
  insert into ids values ('item', v);
end;
$$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$insert into public.checklists (trip_id, kind, title, created_by)
  values ('b1000000-0000-0000-0000-000000000001', 'packing', '打包', '00000000-0000-0000-0000-0000000000b3')$$, '42501', null, 'Viewer 不能新增清單');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select pg_temp.new_list()$$, 'Owner 新增清單');
select lives_ok($$select pg_temp.new_item('00000000-0000-0000-0000-0000000000b2')$$, 'Owner 新增項目並指定 Companion');
select throws_ok($$insert into public.checklist_items (list_id, trip_id, text, assignee, created_by)
  values ((select id from ids where name = 'list'), 'b1000000-0000-0000-0000-000000000001', '雨傘', '00000000-0000-0000-0000-0000000000b4',
  '00000000-0000-0000-0000-0000000000b1')$$, '22023', '指定的成員必須是行程成員', '只能指定行程成員');
select throws_ok($$insert into public.checklist_items (list_id, trip_id, text, created_by)
  values ((select id from ids where name = 'list'), 'b1000000-0000-0000-0000-000000000002', '雨傘', '00000000-0000-0000-0000-0000000000b1')$$,
  '22023', '清單必須屬於同一行程', '不能把項目加到別人的行程');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select lives_ok($$update public.checklist_items set checked = true where id = (select id from ids where name = 'item')$$, 'Companion 勾選完成');
select is((select checked_by from public.checklist_items where id = (select id from ids where name = 'item')),
  '00000000-0000-0000-0000-0000000000b2'::uuid, '勾選者由資料庫記錄');
select ok((select checked_at is not null from public.checklist_items where id = (select id from ids where name = 'item')), '記錄勾選時間');
select lives_ok($$update public.checklist_items set checked = false where id = (select id from ids where name = 'item')$$, '取消勾選');
select ok((select checked_by is null and checked_at is null from public.checklist_items where id = (select id from ids where name = 'item')),
  '取消勾選後清除勾選者與時間');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select is((select count(*)::int from public.checklist_items), 1, 'Viewer 可讀清單項目（離線包）');
select is(pg_temp.affected('update public.checklist_items set checked = true'), 0, 'Viewer 不能勾選');
select is(pg_temp.affected('delete from public.checklists'), 0, 'Viewer 不能刪除清單');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
select is((select count(*)::int from public.checklists), 0, '非成員看不到清單');

-- 成員被移除時取消指定
reset role;
delete from public.trip_members where trip_id = 'b1000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000b2';
select is((select assignee from public.checklist_items where id = (select id from ids where name = 'item')), null::uuid, '成員被移除時取消指定');

-- 刪除
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(pg_temp.affected('delete from public.bookings where trip_id = ''b1000000-0000-0000-0000-000000000001'''), 1, 'Owner 刪除預訂');
select is(pg_temp.affected('delete from public.checklists where id = (select id from ids where name = ''list'')'), 1, 'Owner 刪除清單');
reset role;
select is((select count(*)::int from public.checklist_items where list_id = (select id from ids where name = 'list')), 0, '刪除清單時項目一併刪除');

select * from finish();
rollback;
