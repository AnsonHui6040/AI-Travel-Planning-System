-- T32：邀請、角色變更、移除成員（SH-01、SH-02、SH-07）。
-- 邀請：只有 Owner 建立連結（create_trip_invitation 回傳一次 token 原文，只保存 SHA-256），7 天到期、只能使用一次、可撤銷；
-- 受邀者以本人登入後經 accept_trip_invitation 加入。authenticated 不再能直接新增 trip_members（不可未經同意加入他人）。
-- 角色變更與移除沿用 T03 的 RLS（只有 Owner；不可改為或移除 Owner；Companion、Viewer 可自行退出）。
-- SH-07：成員被移除或退出時，刪除其在該行程的行程記憶與通知；敏感欄位已由外鍵 cascade 刪除（T17）。
-- 函式以 atps_member_manager 身分執行。

create role atps_member_manager nologin;
grant atps_member_manager to postgres;

create table public.trip_invitations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  role public.trip_role not null check (role in ('companion', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index trip_invitations_trip_idx on public.trip_invitations (trip_id);
alter table public.trip_invitations enable row level security;

-- Owner 可列出邀請（不含 token 雜湊）；寫入只經函式
-- Supabase 的預設權限會授予整張表，先全部收回再只開放欄位
revoke all on public.trip_invitations from anon, authenticated, service_role;
create policy owner_select on public.trip_invitations for select to authenticated using (private.is_trip_owner(trip_id));
grant select (id, trip_id, role, created_by, expires_at, accepted_by, accepted_at, revoked_at, created_at)
  on public.trip_invitations to authenticated;

-- 成員只經邀請加入
drop policy members_insert on public.trip_members;
revoke insert on public.trip_members from authenticated;

grant usage on schema public, private, extensions to atps_member_manager;
grant execute on function extensions.digest(text, text), extensions.gen_random_bytes(integer) to atps_member_manager;
grant execute on function private.session_user_id() to atps_member_manager;
grant select, insert, update on public.trip_invitations to atps_member_manager;
grant select, insert on public.trip_members to atps_member_manager;
grant select on public.trips to atps_member_manager;
create policy manager_all on public.trip_invitations for all to atps_member_manager using (true) with check (true);
create policy manager_select on public.trip_members for select to atps_member_manager using (true);
create policy manager_insert on public.trip_members for insert to atps_member_manager with check (role <> 'owner');
create policy manager_select on public.trips for select to atps_member_manager using (true);

create function private.invitation_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

create function private.is_owner_of(p_trip uuid, p_user uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.trip_members where trip_id = p_trip and user_id = p_user and role = 'owner');
$$;

-- 回傳 token 原文（只此一次）；每個行程最多 20 個未使用的有效邀請
create function public.create_trip_invitation(p_trip uuid, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_token text;
begin
  if v_actor is null or p_trip is null or not private.is_owner_of(p_trip, v_actor) then
    raise exception '只有 Owner 可以邀請成員' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('companion', 'viewer') then
    raise exception '邀請的角色只能是 Companion 或 Viewer' using errcode = '22023';
  end if;
  if (select count(*) from public.trip_invitations where trip_id = p_trip and accepted_at is null and revoked_at is null
      and expires_at > now()) >= 20 then
    raise exception '有效的邀請太多，請先撤銷' using errcode = '54000';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.trip_invitations (trip_id, role, token_hash, created_by, expires_at)
    values (p_trip, p_role::public.trip_role, private.invitation_hash(v_token), v_actor, now() + interval '7 days');
  return v_token;
end;
$$;

create function public.revoke_trip_invitation(p_invitation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip uuid;
begin
  select trip_id into v_trip from public.trip_invitations where id = p_invitation;
  if v_actor is null or v_trip is null or not private.is_owner_of(v_trip, v_actor) then
    raise exception '只有 Owner 可以撤銷邀請' using errcode = '42501';
  end if;
  update public.trip_invitations set revoked_at = now() where id = p_invitation and revoked_at is null and accepted_at is null;
end;
$$;

-- 受邀者在接受前看到行程名稱與角色；無效時只回傳 invalid，不透露原因
create function public.invitation_preview(p_token text)
returns table (trip_name text, role text, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_inv public.trip_invitations;
begin
  if v_actor is null then
    raise exception '需要登入' using errcode = '42501';
  end if;
  select * into v_inv from public.trip_invitations where token_hash = private.invitation_hash(coalesce(p_token, ''))
    and accepted_at is null and revoked_at is null and expires_at > now();
  if v_inv.id is null then
    return query select null::text, null::text, 'invalid'::text;
    return;
  end if;
  return query select t.name, v_inv.role::text,
    case when exists (select 1 from public.trip_members m where m.trip_id = v_inv.trip_id and m.user_id = v_actor)
      then 'member' else 'valid' end
    from public.trips t where t.id = v_inv.trip_id;
end;
$$;

create function public.accept_trip_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_inv public.trip_invitations;
begin
  if v_actor is null then
    raise exception '需要登入' using errcode = '42501';
  end if;
  select * into v_inv from public.trip_invitations where token_hash = private.invitation_hash(coalesce(p_token, '')) for update;
  if v_inv.id is null or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    raise exception '邀請連結無效或已過期' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_members where trip_id = v_inv.trip_id and user_id = v_actor) then
    raise exception '你已經是這個行程的成員' using errcode = '22023';
  end if;
  insert into public.trip_members (trip_id, user_id, role) values (v_inv.trip_id, v_actor, v_inv.role);
  update public.trip_invitations set accepted_by = v_actor, accepted_at = now() where id = v_inv.id;
  return v_inv.trip_id;
end;
$$;

grant create on schema public, private to atps_member_manager;
alter function private.invitation_hash(text) owner to atps_member_manager;
alter function private.is_owner_of(uuid, uuid) owner to atps_member_manager;
alter function public.create_trip_invitation(uuid, text) owner to atps_member_manager;
alter function public.revoke_trip_invitation(uuid) owner to atps_member_manager;
alter function public.invitation_preview(text) owner to atps_member_manager;
alter function public.accept_trip_invitation(text) owner to atps_member_manager;
revoke create on schema public, private from atps_member_manager;

revoke all on function private.invitation_hash(text), private.is_owner_of(uuid, uuid), public.create_trip_invitation(uuid, text),
  public.revoke_trip_invitation(uuid), public.invitation_preview(text), public.accept_trip_invitation(text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_trip_invitation(uuid, text), public.revoke_trip_invitation(uuid),
  public.invitation_preview(text), public.accept_trip_invitation(text) to authenticated;

-- SH-07 ------------------------------------------------------------------------------------
create function private.cleanup_removed_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.memories where owner_id = old.user_id and trip_id = old.trip_id;
  delete from public.notifications where recipient_id = old.user_id and trip_id = old.trip_id;
  return old;
end;
$$;
revoke all on function private.cleanup_removed_member() from public, anon, authenticated, service_role;
create trigger cleanup_removed_member
  after delete on public.trip_members
  for each row execute function private.cleanup_removed_member();
