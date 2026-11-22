-- T03：使用者、行程、trip_members 基本表；RLS helper；第 6 節權限表；C-11 速率限制
-- private schema 不經 PostgREST 公開，只放 helper 與內部表

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.trip_role as enum ('owner', 'companion', 'viewer');
create type public.trip_status as enum ('baseline', 'planning', 'locked', 'in_progress', 'ended', 'archived');

-- 使用者 ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- 行程 -----------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  destination text check (char_length(destination) <= 120),
  start_date date,
  end_date date,
  timezone text not null default 'Asia/Tokyo',
  status public.trip_status not null default 'baseline',
  current_version integer not null default 0 check (current_version >= 0),
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
alter table public.trips enable row level security;

create table public.trip_members (
  trip_id uuid not null references public.trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.trip_role not null,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
alter table public.trip_members enable row level security;
create unique index trip_members_one_owner on public.trip_members (trip_id) where role = 'owner';
create index trip_members_user_idx on public.trip_members (user_id);

-- RLS helper：security definer 避免 policy 互相遞迴 -----------------------
create function private.trip_role_of(p_trip uuid) returns public.trip_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.trip_members m
  where m.trip_id = p_trip and m.user_id = (select auth.uid());
$$;

create function private.is_trip_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.trip_role_of(p_trip) is not null;
$$;

create function private.is_trip_owner(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.trip_role_of(p_trip) = 'owner', false);
$$;

create function private.shares_trip_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_members a
    join public.trip_members b on a.trip_id = b.trip_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

revoke all on function private.trip_role_of(uuid), private.is_trip_member(uuid),
  private.is_trip_owner(uuid), private.shares_trip_with(uuid) from public;
grant execute on function private.trip_role_of(uuid), private.is_trip_member(uuid),
  private.is_trip_owner(uuid), private.shares_trip_with(uuid) to authenticated;

-- 建立者自動成為 Owner
create function private.add_trip_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.trip_members (trip_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger on_trip_created
  after insert on public.trips
  for each row execute function private.add_trip_owner();

-- policy：profiles -----------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_trip_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- policy：trips（檢視：所有成員；建立：本人；刪除：Owner）---------------
-- 行程內容的修改經提案與 applyChange（T09），不開放直接 update
create policy trips_select on public.trips for select to authenticated
  using (private.is_trip_member(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy trips_delete on public.trips for delete to authenticated
  using (private.is_trip_owner(id));

-- policy：trip_members --------------------------------------------------
create policy members_select on public.trip_members for select to authenticated
  using (private.is_trip_member(trip_id));
-- 邀請：Owner；不可直接指定 Owner
create policy members_insert on public.trip_members for insert to authenticated
  with check (private.is_trip_owner(trip_id) and role <> 'owner');
-- 變更角色：Owner；不可改為或改掉 Owner，須經 transfer_trip_ownership
create policy members_update on public.trip_members for update to authenticated
  using (private.is_trip_owner(trip_id) and role <> 'owner')
  with check (role <> 'owner');
-- 移除成員：Owner 移除他人；自行退出：Companion 與 Viewer
create policy members_delete on public.trip_members for delete to authenticated
  using (
    role <> 'owner'
    and (private.is_trip_owner(trip_id) or user_id = (select auth.uid()))
  );

grant select, insert, delete on public.trips to authenticated;
grant select, insert, update, delete on public.trip_members to authenticated;
grant select, update on public.profiles to authenticated;
revoke all on public.trips, public.trip_members, public.profiles from anon;

-- 轉移 Owner：只有目前 Owner，對象須為成員 -----------------------------
create function public.transfer_trip_ownership(p_trip uuid, p_new_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not private.is_trip_owner(p_trip) then
    raise exception '只有 Owner 可以轉移 Owner' using errcode = '42501';
  end if;
  if p_new_owner = v_caller then
    return;
  end if;
  if not exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_new_owner) then
    raise exception '新 Owner 必須是行程成員' using errcode = '22023';
  end if;
  update public.trip_members set role = 'companion' where trip_id = p_trip and user_id = v_caller;
  update public.trip_members set role = 'owner' where trip_id = p_trip and user_id = p_new_owner;
  update public.trips set owner_id = p_new_owner where id = p_trip;
end;
$$;
revoke all on function public.transfer_trip_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_trip_ownership(uuid, uuid) to authenticated;

-- C-11 速率限制：固定時間窗，每位使用者每個端點 ------------------------
create table private.rate_limit_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 1 and 100),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, endpoint, window_start)
);
alter table private.rate_limit_counters enable row level security;

create function public.check_rate_limit(p_endpoint text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_window timestamptz;
  v_hits integer;
begin
  if v_user is null then
    raise exception '需要登入' using errcode = '42501';
  end if;
  if p_max < 1 or p_window_seconds < 1 then
    raise exception '速率限制參數無效' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limit_counters (user_id, endpoint, window_start, hits)
    values (v_user, p_endpoint, v_window, 1)
  on conflict (user_id, endpoint, window_start)
    do update set hits = private.rate_limit_counters.hits + 1
  returning hits into v_hits;
  delete from private.rate_limit_counters
    where user_id = v_user and endpoint = p_endpoint and window_start < v_window;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated;
