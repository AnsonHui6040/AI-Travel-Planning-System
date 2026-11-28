-- 決策 0010 B：預訂與清單。
-- 權限：行程成員（含 Viewer）可讀，Owner、Companion 以本人 session 直接新增、修改、刪除（RLS 以 private.is_trip_member、
--   private.can_edit_trip 判斷），非成員看不到。
-- 預約碼（confirmation_code）只有行程成員可見：service_role（AI 在伺服器以 service_role 執行）、anon 與唯讀連結的
--   atps_readonly_reader 沒有預訂資料的任何權限；readonly_trip 不讀取預訂。
-- 時間以 timestamptz 保存，timezone 為輸入與顯示用的時區；排程時由 @atps/core 的 withBookings 換算為行程時區的固定活動。
-- 清單：每個行程可有多份（打包、待辦），項目可指定成員（必須是目前的成員）並勾選完成。成員被移除時取消指定。

create type public.booking_kind as enum ('flight', 'lodging', 'restaurant', 'ticket', 'transport', 'other');
create type public.checklist_kind as enum ('packing', 'todo');

-- 資料表 ----------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind public.booking_kind not null,
  title text not null check (char_length(title) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null check (char_length(timezone) between 1 and 64),
  location text check (char_length(location) between 1 and 200),
  confirmation_code text check (char_length(confirmation_code) between 1 and 60),
  note text check (char_length(note) between 1 and 500),
  item_id uuid references public.itinerary_items (id) on delete set null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or (ends_at >= starts_at and ends_at <= starts_at + interval '60 days'))
);
create index bookings_trip_idx on public.bookings (trip_id, starts_at);

create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind public.checklist_kind not null,
  title text not null check (char_length(title) between 1 and 40),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index checklists_trip_idx on public.checklists (trip_id, created_at);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.checklists (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 120),
  assignee uuid references auth.users (id) on delete set null,
  checked boolean not null default false,
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index checklist_items_list_idx on public.checklist_items (list_id, created_at);
create index checklist_items_trip_idx on public.checklist_items (trip_id);

-- RLS 與權限：先撤銷（Supabase 預設權限會授予整張表），再授權 ---------------------------
alter table public.bookings enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;

revoke all on public.bookings, public.checklists, public.checklist_items from anon, authenticated, service_role;

create policy select_member on public.bookings for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.checklists for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.checklist_items for select to authenticated using (private.is_trip_member(trip_id));
grant select on public.bookings, public.checklists, public.checklist_items to authenticated;

-- 預訂：Owner、Companion 本人新增；Owner、Companion 修改、刪除
create policy insert_editor on public.bookings for insert to authenticated
  with check (private.can_edit_trip(trip_id) and created_by = (select auth.uid()));
create policy update_editor on public.bookings for update to authenticated
  using (private.can_edit_trip(trip_id)) with check (private.can_edit_trip(trip_id));
create policy delete_editor on public.bookings for delete to authenticated using (private.can_edit_trip(trip_id));
grant insert (trip_id, kind, title, starts_at, ends_at, timezone, location, confirmation_code, note, item_id, created_by),
  update (kind, title, starts_at, ends_at, timezone, location, confirmation_code, note, item_id, updated_at),
  delete on public.bookings to authenticated;

-- 清單：Owner、Companion 本人新增；Owner、Companion 改名、刪除
create policy insert_editor on public.checklists for insert to authenticated
  with check (private.can_edit_trip(trip_id) and created_by = (select auth.uid()));
create policy update_editor on public.checklists for update to authenticated
  using (private.can_edit_trip(trip_id)) with check (private.can_edit_trip(trip_id));
create policy delete_editor on public.checklists for delete to authenticated using (private.can_edit_trip(trip_id));
grant insert (trip_id, kind, title, created_by), update (title), delete on public.checklists to authenticated;

-- 清單項目：Owner、Companion 本人新增；Owner、Companion 修改（內容、指定成員、勾選）、刪除
create policy insert_editor on public.checklist_items for insert to authenticated
  with check (private.can_edit_trip(trip_id) and created_by = (select auth.uid()));
create policy update_editor on public.checklist_items for update to authenticated
  using (private.can_edit_trip(trip_id)) with check (private.can_edit_trip(trip_id));
create policy delete_editor on public.checklist_items for delete to authenticated using (private.can_edit_trip(trip_id));
grant insert (list_id, trip_id, text, assignee, checked, created_by), update (text, assignee, checked), delete
  on public.checklist_items to authenticated;

-- 檢查（trigger，擁有者 postgres）---------------------------------------------------
create function private.check_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- 時區必須是資料庫認得的 IANA 名稱
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception '時區不正確' using errcode = '22023';
  end if;
  if new.item_id is not null and not private.item_in_trip(new.item_id, new.trip_id) then
    raise exception '關聯項目必須屬於同一行程' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.bookings b where b.trip_id = new.trip_id) >= 300 then
      raise exception '預訂已達上限' using errcode = '54000';
    end if;
  else
    -- 不可移到其他行程，也不可改建立者
    new.trip_id := old.trip_id;
    new.created_by := old.created_by;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.check_booking() from public, anon, authenticated, service_role;
create trigger check_booking before insert or update on public.bookings
  for each row execute function private.check_booking();

create function private.check_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.checklists l where l.trip_id = new.trip_id) >= 30 then
      raise exception '清單已達上限' using errcode = '54000';
    end if;
  else
    new.trip_id := old.trip_id;
    new.kind := old.kind;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
revoke all on function private.check_checklist() from public, anon, authenticated, service_role;
create trigger check_checklist before insert or update on public.checklists
  for each row execute function private.check_checklist();

create function private.check_checklist_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.checklists l where l.id = new.list_id and l.trip_id = new.trip_id) then
      raise exception '清單必須屬於同一行程' using errcode = '22023';
    end if;
    if (select count(*) from public.checklist_items i where i.list_id = new.list_id) >= 300 then
      raise exception '清單項目已達上限' using errcode = '54000';
    end if;
  else
    new.list_id := old.list_id;
    new.trip_id := old.trip_id;
    new.created_by := old.created_by;
  end if;
  if new.assignee is not null and (tg_op = 'INSERT' or new.assignee is distinct from old.assignee)
     and not private.is_member_user(new.trip_id, new.assignee) then
    raise exception '指定的成員必須是行程成員' using errcode = '22023';
  end if;
  -- 勾選者與時間由資料庫記錄
  if new.checked and (tg_op = 'INSERT' or not old.checked) then
    new.checked_by := private.session_user_id();
    new.checked_at := now();
  elsif not new.checked then
    new.checked_by := null;
    new.checked_at := null;
  else
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  return new;
end;
$$;
revoke all on function private.check_checklist_item() from public, anon, authenticated, service_role;
create trigger check_checklist_item before insert or update on public.checklist_items
  for each row execute function private.check_checklist_item();

-- 成員被移除或退出時，取消指定給他的清單項目
create function private.unassign_removed_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.checklist_items set assignee = null where trip_id = old.trip_id and assignee = old.user_id;
  return old;
end;
$$;
revoke all on function private.unassign_removed_member() from public, anon, authenticated, service_role;
create trigger unassign_removed_member after delete on public.trip_members
  for each row execute function private.unassign_removed_member();
