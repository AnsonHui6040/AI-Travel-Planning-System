-- 決策 0010 X：記帳與分帳。
-- 權限：Owner、Companion 可新增修改，Viewer 唯讀，非成員看不到（RLS 以 private.is_trip_member、private.can_edit_trip 判斷）。
-- 主幣別、匯率、結算由成員以本人 session 直接寫入（RLS 限 Owner、Companion，更新者必須是本人）；
-- 花費與分攤只經 save_expense（擁有者 atps_expense_writer）寫入：分攤總和等於金額、付款人與分攤成員是行程成員、
--   關聯項目屬於同一行程、金額符合幣別小數位數（與 @atps/core 的 currencyDecimals 相同）。刪除花費時分攤一併刪除。
-- 匯率由使用者輸入（1 單位外幣 = rate 單位主幣別），不呼叫外部匯率服務。
-- 不送 AI：AI 在伺服器以 service_role 執行，service_role 沒有記帳資料的任何權限。

create type public.expense_category as enum ('food', 'transport', 'lodging', 'tickets', 'shopping', 'other');

create role atps_expense_writer nologin;
grant atps_expense_writer to postgres;
grant usage on schema public, private to atps_expense_writer;
grant execute on function private.session_user_id() to atps_expense_writer;
grant execute on function private.can_edit_trip(uuid) to atps_expense_writer;

-- 幣別的小數位數：TWD 依台灣日常使用不用小數
create function private.currency_decimals(p_currency text) returns integer
language sql immutable set search_path = '' as $$
  select case
    when p_currency in ('TWD', 'JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF') then 0
    when p_currency in ('BHD', 'KWD', 'OMR', 'JOD', 'TND') then 3
    else 2
  end;
$$;
revoke all on function private.currency_decimals(text) from public, anon, authenticated, service_role;
-- check constraint 以寫入者的權限執行（結算由 authenticated 直接寫入）
grant execute on function private.currency_decimals(text) to atps_expense_writer, authenticated;

-- 目前的行程成員（擁有者 postgres，供 atps_expense_writer 與 trigger 使用）
create function private.is_member_user(p_trip uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = p_user);
$$;
revoke all on function private.is_member_user(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_member_user(uuid, uuid) to atps_expense_writer;

create function private.item_in_trip(p_item uuid, p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.itinerary_items i where i.id = p_item and i.trip_id = p_trip);
$$;
revoke all on function private.item_in_trip(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.item_in_trip(uuid, uuid) to atps_expense_writer;

-- 資料表 ----------------------------------------------------------------------
create table public.expense_settings (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now()
);

create table public.expense_rates (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  rate numeric(18, 8) not null check (rate > 0 and rate <= 1000000),
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (trip_id, currency)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  amount numeric(14, 3) not null check (amount > 0 and amount <= 10000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_by uuid not null references auth.users (id),
  spent_on date not null,
  category public.expense_category not null,
  item_id uuid references public.itinerary_items (id) on delete set null,
  note text check (char_length(note) between 1 and 200),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount = round(amount, private.currency_decimals(currency)))
);
create index expenses_trip_idx on public.expenses (trip_id, spent_on desc, created_at desc);

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  amount numeric(14, 3) not null check (amount >= 0 and amount <= 10000000),
  primary key (expense_id, user_id)
);
create index expense_shares_trip_idx on public.expense_shares (trip_id);

create table public.expense_settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  from_user uuid not null references auth.users (id),
  to_user uuid not null references auth.users (id),
  amount numeric(14, 3) not null check (amount > 0 and amount <= 10000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null,
  recorded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (from_user <> to_user),
  check (amount = round(amount, private.currency_decimals(currency)))
);
create index expense_settlements_trip_idx on public.expense_settlements (trip_id, paid_on);

-- RLS 與權限：先撤銷（Supabase 預設權限會授予整張表），再授權 ---------------------------
alter table public.expense_settings enable row level security;
alter table public.expense_rates enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.expense_settlements enable row level security;

revoke all on public.expense_settings, public.expense_rates, public.expenses, public.expense_shares, public.expense_settlements
  from anon, authenticated, service_role;

-- 讀取：行程成員（含 Viewer）
create policy select_member on public.expense_settings for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.expense_rates for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.expenses for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.expense_shares for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.expense_settlements for select to authenticated using (private.is_trip_member(trip_id));
grant select on public.expense_settings, public.expense_rates, public.expenses, public.expense_shares, public.expense_settlements to authenticated;

-- 主幣別：Owner、Companion 本人
create policy insert_editor on public.expense_settings for insert to authenticated
  with check (private.can_edit_trip(trip_id) and updated_by = (select auth.uid()));
create policy update_editor on public.expense_settings for update to authenticated
  using (private.can_edit_trip(trip_id)) with check (private.can_edit_trip(trip_id) and updated_by = (select auth.uid()));
grant insert (trip_id, currency, updated_by), update (currency, updated_by, updated_at) on public.expense_settings to authenticated;

-- 匯率：Owner、Companion 本人
create policy insert_editor on public.expense_rates for insert to authenticated
  with check (private.can_edit_trip(trip_id) and updated_by = (select auth.uid()));
create policy update_editor on public.expense_rates for update to authenticated
  using (private.can_edit_trip(trip_id)) with check (private.can_edit_trip(trip_id) and updated_by = (select auth.uid()));
create policy delete_editor on public.expense_rates for delete to authenticated using (private.can_edit_trip(trip_id));
grant insert (trip_id, currency, rate, updated_by), update (rate, updated_by, updated_at), delete on public.expense_rates to authenticated;

-- 花費：Owner、Companion 可刪除（分攤 on delete cascade）；新增修改只經 save_expense
create policy delete_editor on public.expenses for delete to authenticated using (private.can_edit_trip(trip_id));
grant delete on public.expenses to authenticated;

-- 結算：Owner、Companion 本人記錄或刪除
create policy insert_editor on public.expense_settlements for insert to authenticated
  with check (private.can_edit_trip(trip_id) and recorded_by = (select auth.uid()));
create policy delete_editor on public.expense_settlements for delete to authenticated using (private.can_edit_trip(trip_id));
grant insert (trip_id, from_user, to_user, amount, currency, paid_on, recorded_by), delete on public.expense_settlements to authenticated;

create function private.check_expense_settlement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 雙方是目前的成員，或是這個行程花費的付款人、分攤成員（已離開的成員仍可結清）
  if not ((private.is_member_user(new.trip_id, new.from_user)
           or exists (select 1 from public.expenses e where e.trip_id = new.trip_id and e.paid_by = new.from_user)
           or exists (select 1 from public.expense_shares s where s.trip_id = new.trip_id and s.user_id = new.from_user))
      and (private.is_member_user(new.trip_id, new.to_user)
           or exists (select 1 from public.expenses e where e.trip_id = new.trip_id and e.paid_by = new.to_user)
           or exists (select 1 from public.expense_shares s where s.trip_id = new.trip_id and s.user_id = new.to_user))) then
    raise exception '結算雙方必須是行程成員' using errcode = '22023';
  end if;
  if (select count(*) from public.expense_settlements s where s.trip_id = new.trip_id) >= 1000 then
    raise exception '結算紀錄已達上限' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function private.check_expense_settlement() from public, anon, authenticated, service_role;
create trigger check_expense_settlement before insert on public.expense_settlements
  for each row execute function private.check_expense_settlement();

-- 寫入花費 --------------------------------------------------------------------
grant select, insert, update (amount, currency, paid_by, spent_on, category, item_id, note, updated_at) on public.expenses to atps_expense_writer;
grant select, insert, delete on public.expense_shares to atps_expense_writer;
create policy writer_all on public.expenses for all to atps_expense_writer using (true) with check (true);
create policy writer_all on public.expense_shares for all to atps_expense_writer using (true) with check (true);

-- p_expense 為 null 時新增，否則修改同一行程的花費並以新的分攤取代
create function public.save_expense(p_trip uuid, p_expense uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_id uuid;
  v_amount numeric;
  v_currency text;
  v_paid_by uuid;
  v_item uuid;
  v_decimals integer;
  v_shares jsonb;
  v_share jsonb;
  v_users uuid[] := '{}';
  v_user uuid;
  v_share_amount numeric;
  v_sum numeric := 0;
begin
  if v_actor is null or p_trip is null or not private.can_edit_trip(p_trip) then
    raise exception '只有 Owner 與 Companion 可以記帳' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_data), '') <> 'object' or pg_column_size(p_data) > 16384 then
    raise exception '花費格式不正確' using errcode = '22023';
  end if;
  v_amount := (p_data ->> 'amount')::numeric;
  v_currency := p_data ->> 'currency';
  v_paid_by := (p_data ->> 'paid_by')::uuid;
  v_item := nullif(p_data ->> 'item_id', '')::uuid;
  v_shares := p_data -> 'shares';
  if v_amount is null or v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception '花費格式不正確' using errcode = '22023';
  end if;
  v_decimals := private.currency_decimals(v_currency);
  if v_amount <= 0 or v_amount <> round(v_amount, v_decimals) then
    raise exception '金額不符合幣別的小數位數' using errcode = '22023';
  end if;
  if v_paid_by is null or not private.is_member_user(p_trip, v_paid_by) then
    raise exception '付款人必須是行程成員' using errcode = '22023';
  end if;
  if v_item is not null and not private.item_in_trip(v_item, p_trip) then
    raise exception '關聯項目必須屬於同一行程' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(v_shares), '') <> 'array' or jsonb_array_length(v_shares) not between 1 and 50 then
    raise exception '至少要有一位分攤成員' using errcode = '22023';
  end if;
  for v_share in select value from jsonb_array_elements(v_shares) loop
    v_user := (v_share ->> 'user_id')::uuid;
    v_share_amount := (v_share ->> 'amount')::numeric;
    if v_user is null or v_share_amount is null or v_share_amount < 0 or v_share_amount <> round(v_share_amount, v_decimals)
       or v_user = any (v_users) or not private.is_member_user(p_trip, v_user) then
      raise exception '分攤成員必須是行程成員，金額不可為負' using errcode = '22023';
    end if;
    v_users := v_users || v_user;
    v_sum := v_sum + v_share_amount;
  end loop;
  if v_sum <> v_amount then
    raise exception '分攤總和必須等於金額' using errcode = '22023';
  end if;

  if p_expense is null then
    if (select count(*) from public.expenses e where e.trip_id = p_trip) >= 5000 then
      raise exception '花費已達上限' using errcode = '54000';
    end if;
    insert into public.expenses (trip_id, amount, currency, paid_by, spent_on, category, item_id, note, created_by)
    values (p_trip, v_amount, v_currency, v_paid_by, (p_data ->> 'spent_on')::date, (p_data ->> 'category')::public.expense_category,
      v_item, nullif(p_data ->> 'note', ''), v_actor)
    returning id into v_id;
  else
    update public.expenses set amount = v_amount, currency = v_currency, paid_by = v_paid_by,
      spent_on = (p_data ->> 'spent_on')::date, category = (p_data ->> 'category')::public.expense_category,
      item_id = v_item, note = nullif(p_data ->> 'note', ''), updated_at = now()
    where id = p_expense and trip_id = p_trip
    returning id into v_id;
    if v_id is null then
      raise exception '找不到這筆花費' using errcode = '42501';
    end if;
    delete from public.expense_shares where expense_id = v_id;
  end if;
  insert into public.expense_shares (expense_id, trip_id, user_id, amount)
  select v_id, p_trip, (s ->> 'user_id')::uuid, (s ->> 'amount')::numeric from jsonb_array_elements(v_shares) s;
  return v_id;
exception
  when invalid_text_representation or not_null_violation or check_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception '花費格式不正確' using errcode = '22023';
end;
$$;
grant create on schema public to atps_expense_writer;
alter function public.save_expense(uuid, uuid, jsonb) owner to atps_expense_writer;
revoke create on schema public from atps_expense_writer;
revoke all on function public.save_expense(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_expense(uuid, uuid, jsonb) to authenticated;
