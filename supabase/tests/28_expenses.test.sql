-- 決策 0010 X：記帳與分帳。Owner、Companion 可新增修改，Viewer 唯讀，非成員看不到；
-- 花費與分攤只經 save_expense 寫入（分攤總和等於金額、成員屬於行程、金額符合幣別小數位數）；
-- AI 在伺服器以 service_role 執行，service_role 沒有任何記帳資料的權限（不送 AI）。
-- O：Owner；C：Companion；V：Viewer；X：非成員
begin;
select plan(33);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'xo@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'xc@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'xv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'xx@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id, status) values
  ('a1000000-0000-0000-0000-000000000001', '東京', '00000000-0000-0000-0000-0000000000a1', 'planning'),
  ('a1000000-0000-0000-0000-000000000002', '大阪', '00000000-0000-0000-0000-0000000000a4', 'planning');
insert into public.trip_members (trip_id, user_id, role) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'companion'),
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'viewer');
insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, priority, weather_dependency,
  recommendation_reason, score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
  score_weather_dependency, score_time_slot_dependency, score_substitutability) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '淺草寺', 'attraction', 60, 3, 'low', '測試', 0, 0, 0, 0, 0, 0, 0, 0),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '大阪城', 'attraction', 60, 3, 'low', '測試', 0, 0, 0, 0, 0, 0, 0, 0);

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

-- 花費資料：O 付 900 TWD，三人平均
create function pg_temp.dinner(p_amount numeric, p_currency text, p_shares jsonb, p_item uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('amount', p_amount, 'currency', p_currency, 'paid_by', '00000000-0000-0000-0000-0000000000a1',
    'spent_on', '2026-12-01', 'category', 'food', 'item_id', p_item, 'note', '晚餐', 'shares', p_shares);
$$;
create function pg_temp.three(a numeric, b numeric, c numeric) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a1', 'amount', a),
    jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a2', 'amount', b),
    jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a3', 'amount', c));
$$;

-- 結構與權限 ------------------------------------------------------------------
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.expense_settings'::regclass, 'public.expense_rates'::regclass, 'public.expenses'::regclass,
   'public.expense_shares'::regclass, 'public.expense_settlements'::regclass)), '五張記帳資料表都啟用 RLS');
select ok(not exists (
  select 1 from unnest(array['anon', 'service_role']) r, unnest(array['public.expense_settings', 'public.expense_rates', 'public.expenses',
    'public.expense_shares', 'public.expense_settlements']) t, unnest(array['select', 'insert', 'update', 'delete']) p
  where has_table_privilege(r, t, p)), 'anon 與 service_role（AI）沒有記帳資料的任何權限');
select ok(not has_table_privilege('authenticated', 'public.expenses', 'insert')
  and not has_table_privilege('authenticated', 'public.expenses', 'update')
  and not has_table_privilege('authenticated', 'public.expense_shares', 'insert'), 'authenticated 不能直接寫入花費與分攤');
select ok(not has_function_privilege('anon', 'public.save_expense(uuid, uuid, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.save_expense(uuid, uuid, jsonb)', 'execute'), 'anon 與 service_role 不能呼叫 save_expense');

-- 主幣別與匯率 ----------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$insert into public.expense_settings (trip_id, currency, updated_by)
  values ('a1000000-0000-0000-0000-000000000001', 'TWD', '00000000-0000-0000-0000-0000000000a3')$$, '42501', null, 'Viewer 不能設定主幣別');
select throws_ok($$insert into public.expense_rates (trip_id, currency, rate, updated_by)
  values ('a1000000-0000-0000-0000-000000000001', 'JPY', 0.21, '00000000-0000-0000-0000-0000000000a3')$$, '42501', null, 'Viewer 不能輸入匯率');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into public.expense_settings (trip_id, currency, updated_by)
  values ('a1000000-0000-0000-0000-000000000001', 'TWD', '00000000-0000-0000-0000-0000000000a1')$$, 'Owner 設定主幣別');
select throws_ok($$insert into public.expense_settings (trip_id, currency, updated_by)
  values ('a1000000-0000-0000-0000-000000000002', 'TWD', '00000000-0000-0000-0000-0000000000a1')$$, '42501', null, '不能設定別人行程的主幣別');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$update public.expense_settings set currency = 'TWD', updated_by = '00000000-0000-0000-0000-0000000000a2', updated_at = now()
  where trip_id = 'a1000000-0000-0000-0000-000000000001'$$, 'Companion 修改主幣別');
select lives_ok($$insert into public.expense_rates (trip_id, currency, rate, updated_by)
  values ('a1000000-0000-0000-0000-000000000001', 'JPY', 0.21, '00000000-0000-0000-0000-0000000000a2')$$, 'Companion 輸入匯率');
select throws_ok($$insert into public.expense_rates (trip_id, currency, rate, updated_by)
  values ('a1000000-0000-0000-0000-000000000001', 'USD', 0, '00000000-0000-0000-0000-0000000000a2')$$, '23514', null, '匯率必須大於零');
select throws_ok($$insert into public.expense_rates (trip_id, currency, rate, updated_by)
  values ('a1000000-0000-0000-0000-000000000001', 'USD', 32, '00000000-0000-0000-0000-0000000000a1')$$, '42501', null, '更新者必須是本人');

-- 新增花費 --------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null, pg_temp.dinner(900, 'TWD', pg_temp.three(300, 300, 300)))$$,
  '42501', null, 'Viewer 不能新增花費');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null, pg_temp.dinner(900, 'TWD', pg_temp.three(300, 300, 300)))$$,
  '42501', null, '非成員不能新增花費');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null, pg_temp.dinner(900, 'TWD', pg_temp.three(300, 300, 200)))$$,
  '22023', null, '分攤總和不等於金額時拒絕');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null, pg_temp.dinner(900.5, 'JPY', pg_temp.three(300.5, 300, 300)))$$,
  '22023', null, 'JPY 不可有小數');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null, pg_temp.dinner(900, 'TWD',
  jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a1', 'amount', 450),
                    jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a4', 'amount', 450))))$$,
  '22023', null, '分攤成員必須是行程成員');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null,
  pg_temp.dinner(900, 'TWD', pg_temp.three(300, 300, 300), 'a2000000-0000-0000-0000-000000000002'))$$,
  '22023', null, '關聯項目必須屬於同一行程');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', null, pg_temp.dinner(900, 'TWD', '[]'::jsonb))$$,
  '22023', null, '沒有分攤成員時拒絕');

create temp table saved (id uuid) on commit drop;
grant all on saved to authenticated;
insert into saved select public.save_expense('a1000000-0000-0000-0000-000000000001', null,
  pg_temp.dinner(900, 'TWD', pg_temp.three(300, 300, 300), 'a2000000-0000-0000-0000-000000000001'));
select is((select count(*)::int from public.expense_shares where expense_id = (select id from saved)), 3, 'Companion 新增花費，三筆分攤');
select is((select created_by from public.expenses where id = (select id from saved)), '00000000-0000-0000-0000-0000000000a2'::uuid, '建立者為本人');

-- 讀取 ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.expenses), 1, 'Viewer 看得到花費');
select is((select count(*)::int from public.expense_shares), 3, 'Viewer 看得到分攤');
select is((select count(*)::int from public.expense_rates), 1, 'Viewer 看得到匯率');
delete from public.expenses;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.expenses), 1, 'Viewer 刪除不會生效');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.expenses) + (select count(*)::int from public.expense_shares)
  + (select count(*)::int from public.expense_rates) + (select count(*)::int from public.expense_settings), 0, '非成員看不到任何記帳資料');

-- 修改花費 --------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000001', (select id from saved),
  pg_temp.dinner(1000, 'JPY', jsonb_build_array(jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a1', 'amount', 600),
    jsonb_build_object('user_id', '00000000-0000-0000-0000-0000000000a2', 'amount', 400))))$$, 'Owner 修改花費與分攤');
select is((select string_agg(amount::int::text, ',' order by amount) from public.expense_shares where expense_id = (select id from saved)), '400,600', '分攤改為兩人自訂金額');
select throws_ok($$select public.save_expense('a1000000-0000-0000-0000-000000000002', (select id from saved),
  pg_temp.dinner(1000, 'JPY', pg_temp.three(400, 300, 300)))$$, '42501', null, '不能以別的行程修改花費');

-- 結算 ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$insert into public.expense_settlements (trip_id, from_user, to_user, amount, currency, paid_on, recorded_by)
  values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 84, 'TWD', '2026-12-03',
    '00000000-0000-0000-0000-0000000000a2')$$, 'Companion 標記已付款');
select throws_ok($$insert into public.expense_settlements (trip_id, from_user, to_user, amount, currency, paid_on, recorded_by)
  values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', 84, 'TWD', '2026-12-03',
    '00000000-0000-0000-0000-0000000000a2')$$, '22023', null, '結算雙方必須是行程成員');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$insert into public.expense_settlements (trip_id, from_user, to_user, amount, currency, paid_on, recorded_by)
  values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 10, 'TWD', '2026-12-03',
    '00000000-0000-0000-0000-0000000000a3')$$, '42501', null, 'Viewer 不能標記已付款');

-- 刪除 ------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
delete from public.expenses where id = (select id from saved);
select is((select count(*)::int from public.expenses) + (select count(*)::int from public.expense_shares), 0, 'Companion 刪除花費，分攤一併刪除');

select * from finish();
rollback;
