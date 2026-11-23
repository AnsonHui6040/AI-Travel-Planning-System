-- T17：敏感欄位（全名、電話、電子郵件）、三個開關、當事人控制、加密儲存（S-07、D18、SH-07）
-- 值以 Supabase Vault 加密儲存，資料表只存 Vault secret 編號與開關。
-- 使用者只經下列函式存取；函式以 session 的使用者判斷當事人與角色，不接受呼叫者傳入的使用者編號。
-- 送往 AI 的欄位只經 ai_sensitive_fields（只授權 service_role），只回傳開啟「提供給 AI」的欄位。

create type public.sensitive_field as enum ('full_name', 'phone', 'email');

create table public.member_sensitive_fields (
  trip_id uuid not null,
  user_id uuid not null,
  field public.sensitive_field not null,
  vault_secret_id uuid not null unique,
  share_ai boolean not null default false,
  share_members boolean not null default false,
  share_viewers boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id, field),
  -- SH-07：移除成員或刪除行程時一併刪除
  foreign key (trip_id, user_id) references public.trip_members (trip_id, user_id) on delete cascade
);
alter table public.member_sensitive_fields enable row level security;

-- 使用者只看得到自己的紀錄（只有開關，沒有值）；寫入只經函式
revoke all on public.member_sensitive_fields from anon, authenticated;
grant select on public.member_sensitive_fields to authenticated;
create policy sensitive_select_own on public.member_sensitive_fields for select to authenticated
  using (user_id = (select auth.uid()));

-- 函式擁有者，只具備 Vault 與本表所需的權限
create role atps_pii_keeper nologin;
grant atps_pii_keeper to postgres;
grant usage on schema vault, public, private to atps_pii_keeper;
grant execute on function vault.create_secret(text, text, text, uuid) to atps_pii_keeper;
grant execute on function vault.update_secret(uuid, text, text, text, uuid) to atps_pii_keeper;
grant select on vault.decrypted_secrets to atps_pii_keeper;
grant execute on function vault._crypto_aead_det_decrypt(bytea, bytea, bigint, bytea, bytea) to atps_pii_keeper;
grant select, delete on vault.secrets to atps_pii_keeper;
grant select, insert, update, delete on public.member_sensitive_fields to atps_pii_keeper;
grant select on public.trip_members to atps_pii_keeper;
create policy keeper_all on public.member_sensitive_fields for all to atps_pii_keeper using (true) with check (true);
create policy pii_keeper_select on public.trip_members for select to atps_pii_keeper using (true);

-- 目前 session 的使用者以 T09 的 private.session_user_id() 取得（函式擁有者沒有 auth schema 的權限）

-- 與 packages/schemas 的 parseSensitiveValue 相同
create function private.valid_sensitive_value(p_field public.sensitive_field, p_value text) returns boolean
language sql immutable set search_path = '' as $$
  select p_value is not null
    and char_length(p_value) > 0
    and p_value !~ '[[:cntrl:]]'
    and case p_field
      when 'full_name' then char_length(p_value) <= 80
      when 'phone' then p_value ~ '^\+?[0-9 ()-]{6,25}$'
        and char_length(regexp_replace(p_value, '[^0-9]', '', 'g')) between 6 and 15
      when 'email' then char_length(p_value) <= 254
        and p_value ~ '^[^@[:space:]]{1,64}@[^@[:space:].]+(\.[^@[:space:].]+)+$'
    end;
$$;

-- 當事人儲存自己在某行程的欄位；空值刪除。訊息不含輸入值
create function public.save_sensitive_field(p_trip uuid, p_field public.sensitive_field, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.session_user_id();
  v_value text := btrim(coalesce(p_value, ''));
  v_secret uuid;
begin
  if v_user is null or not exists (
    select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = v_user
  ) then
    raise exception '不是此行程的成員' using errcode = '42501';
  end if;

  select f.vault_secret_id into v_secret
    from public.member_sensitive_fields f
    where f.trip_id = p_trip and f.user_id = v_user and f.field = p_field
    for update;

  if v_value = '' then
    delete from public.member_sensitive_fields
      where trip_id = p_trip and user_id = v_user and field = p_field;
    return;
  end if;

  if not private.valid_sensitive_value(p_field, v_value) then
    raise exception '敏感欄位格式不正確' using errcode = '22023';
  end if;

  if v_secret is null then
    v_secret := vault.create_secret(v_value, 'pii:' || p_trip || ':' || v_user || ':' || p_field, 'member sensitive field');
    insert into public.member_sensitive_fields (trip_id, user_id, field, vault_secret_id)
      values (p_trip, v_user, p_field, v_secret);
  else
    perform vault.update_secret(v_secret, v_value);
    update public.member_sensitive_fields set updated_at = now()
      where trip_id = p_trip and user_id = v_user and field = p_field;
  end if;
end;
$$;

-- 當事人設定自己欄位的三個開關
create function public.set_sensitive_sharing(
  p_trip uuid,
  p_field public.sensitive_field,
  p_share_ai boolean,
  p_share_members boolean,
  p_share_viewers boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.member_sensitive_fields
    set share_ai = coalesce(p_share_ai, false),
        share_members = coalesce(p_share_members, false),
        share_viewers = coalesce(p_share_viewers, false),
        updated_at = now()
    where trip_id = p_trip and user_id = private.session_user_id() and field = p_field;
  if not found then
    raise exception '沒有這個欄位' using errcode = 'P0002';
  end if;
end;
$$;

-- 第 6 節權限表「檢視他人敏感欄位：依當事人開關」。
-- 自己：全部欄位與開關；Owner、Companion：他人開啟「提供給其他成員」的欄位；Viewer：他人開啟「提供給 Viewer 與唯讀連結」的欄位。
-- 他人的開關不回傳。
create function public.list_trip_sensitive_fields(p_trip uuid)
returns table (
  user_id uuid,
  field public.sensitive_field,
  value text,
  share_ai boolean,
  share_members boolean,
  share_viewers boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.role from public.trip_members m where m.trip_id = p_trip and m.user_id = private.session_user_id()
  )
  select f.user_id,
         f.field,
         d.decrypted_secret,
         case when f.user_id = private.session_user_id() then f.share_ai end,
         case when f.user_id = private.session_user_id() then f.share_members end,
         case when f.user_id = private.session_user_id() then f.share_viewers end
    from public.member_sensitive_fields f
    join vault.decrypted_secrets d on d.id = f.vault_secret_id
    cross join me
    where f.trip_id = p_trip
      and (
        f.user_id = private.session_user_id()
        or (me.role in ('owner', 'companion') and f.share_members)
        or (me.role = 'viewer' and f.share_viewers)
      )
    order by f.user_id, f.field;
$$;

-- 伺服器建立 AI payload：只回傳開啟「提供給 AI」的欄位；請求者必須是能觸發 AI 的成員（Owner、Companion）
create function public.ai_sensitive_fields(p_trip uuid, p_requester uuid)
returns table (user_id uuid, field public.sensitive_field, value text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.user_id, f.field, d.decrypted_secret
    from public.member_sensitive_fields f
    join vault.decrypted_secrets d on d.id = f.vault_secret_id
    where f.trip_id = p_trip
      and f.share_ai
      and exists (
        select 1 from public.trip_members m
          where m.trip_id = p_trip and m.user_id = p_requester and m.role in ('owner', 'companion')
      )
    order by f.user_id, f.field;
$$;

-- 刪除紀錄（清空、移除成員、刪除行程、刪除帳號）時刪除 Vault secret
create function private.delete_sensitive_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

create trigger delete_sensitive_secret
  after delete on public.member_sensitive_fields
  for each row execute function private.delete_sensitive_secret();

grant create on schema public, private to atps_pii_keeper;
alter function public.save_sensitive_field(uuid, public.sensitive_field, text) owner to atps_pii_keeper;
alter function public.set_sensitive_sharing(uuid, public.sensitive_field, boolean, boolean, boolean) owner to atps_pii_keeper;
alter function public.list_trip_sensitive_fields(uuid) owner to atps_pii_keeper;
alter function public.ai_sensitive_fields(uuid, uuid) owner to atps_pii_keeper;
alter function private.delete_sensitive_secret() owner to atps_pii_keeper;
revoke create on schema public, private from atps_pii_keeper;

revoke all on function private.valid_sensitive_value(public.sensitive_field, text) from public, anon, authenticated;
grant execute on function private.session_user_id() to atps_pii_keeper;
grant execute on function private.valid_sensitive_value(public.sensitive_field, text) to atps_pii_keeper;
revoke all on function public.save_sensitive_field(uuid, public.sensitive_field, text) from public, anon;
revoke all on function public.set_sensitive_sharing(uuid, public.sensitive_field, boolean, boolean, boolean) from public, anon;
revoke all on function public.list_trip_sensitive_fields(uuid) from public, anon;
revoke all on function public.ai_sensitive_fields(uuid, uuid) from public, anon, authenticated;
revoke all on function private.delete_sensitive_secret() from public, anon, authenticated;
grant execute on function public.save_sensitive_field(uuid, public.sensitive_field, text) to authenticated;
grant execute on function public.set_sensitive_sharing(uuid, public.sensitive_field, boolean, boolean, boolean) to authenticated;
grant execute on function public.list_trip_sensitive_fields(uuid) to authenticated;
grant execute on function public.ai_sensitive_fields(uuid, uuid) to service_role;
