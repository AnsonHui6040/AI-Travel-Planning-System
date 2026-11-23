-- T12：API key 以 Supabase Vault 加密儲存（C-02、C-04、C-05、C-12）
-- 儲存與解密只經下列函式，只授權 service_role（伺服器）執行；ownerId 由伺服器取自已驗證的 session。
-- 使用者只能檢視（末四碼）與刪除本人的紀錄；刪除紀錄時 Vault secret 一併刪除。
-- 函式擁有者為 atps_key_keeper，只具備 Vault 與 api_key_records 所需的權限。

create role atps_key_keeper nologin;
grant atps_key_keeper to postgres;

grant usage on schema vault, public to atps_key_keeper;
grant execute on function vault.create_secret(text, text, text, uuid) to atps_key_keeper;
grant execute on function vault.update_secret(uuid, text, text, text, uuid) to atps_key_keeper;
grant select on vault.decrypted_secrets to atps_key_keeper;
-- decrypted_secrets 以呼叫者權限執行解密函式
grant execute on function vault._crypto_aead_det_decrypt(bytea, bytea, bigint, bytea, bytea) to atps_key_keeper;
grant select, delete on vault.secrets to atps_key_keeper;

grant select, insert, update on public.api_key_records to atps_key_keeper;
grant select on public.background_jobs to atps_key_keeper;
create policy keeper_select on public.api_key_records for select to atps_key_keeper using (true);
create policy keeper_insert on public.api_key_records for insert to atps_key_keeper with check (true);
create policy keeper_update on public.api_key_records for update to atps_key_keeper using (true) with check (true);
create policy keeper_select on public.background_jobs for select to atps_key_keeper using (true);

-- 儲存或更新 key。同一使用者、同一供應商只保留一筆，更新時沿用同一個 Vault secret
create function public.save_api_key(
  p_owner uuid,
  p_provider public.key_provider,
  p_secret text,
  p_tested_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_owner is null or p_provider is null then
    raise exception '缺少擁有者或供應商' using errcode = '22023';
  end if;
  -- 與 packages/core 的 isValidApiKeyFormat 相同：可列印 ASCII、不含空白，8–512 字元。訊息不含 key
  if p_secret is null or p_secret !~ '^[!-~]+$' or char_length(p_secret) not between 8 and 512 then
    raise exception 'API key 格式不正確' using errcode = '22023';
  end if;

  select r.vault_secret_id into v_secret_id
    from public.api_key_records r
    where r.owner_id = p_owner and r.provider = p_provider
    for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_secret, 'api_key:' || p_owner || ':' || p_provider, 'BYOK API key');
    insert into public.api_key_records (owner_id, provider, vault_secret_id, last4, last_tested_at)
      values (p_owner, p_provider, v_secret_id, right(p_secret, 4), p_tested_at);
  else
    perform vault.update_secret(v_secret_id, p_secret);
    update public.api_key_records
      set last4 = right(p_secret, 4), last_tested_at = p_tested_at
      where owner_id = p_owner and provider = p_provider;
  end if;
end;
$$;

-- 伺服器請求：解密請求者本人的 key（伺服器傳入 session 的使用者編號）
create function public.decrypt_api_key(p_owner uuid, p_provider public.key_provider)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
    from public.api_key_records r
    join vault.decrypted_secrets d on d.id = r.vault_secret_id
    where r.owner_id = p_owner and r.provider = p_provider;
$$;

-- 背景 job：只能解密發起人的 key（C-12），不接受擁有者參數
create function public.decrypt_job_api_key(p_job_id uuid, p_provider public.key_provider)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
    from public.background_jobs j
    join public.api_key_records r on r.owner_id = j.initiator_id and r.provider = p_provider
    join vault.decrypted_secrets d on d.id = r.vault_secret_id
    where j.id = p_job_id;
$$;

-- 刪除紀錄（使用者刪除、帳號刪除的 cascade）時刪除 Vault secret
create function private.delete_api_key_secret()
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

create trigger delete_api_key_secret
  after delete on public.api_key_records
  for each row execute function private.delete_api_key_secret();

grant usage on schema private to atps_key_keeper;
grant create on schema public, private to atps_key_keeper;
alter function public.save_api_key(uuid, public.key_provider, text, timestamptz) owner to atps_key_keeper;
alter function public.decrypt_api_key(uuid, public.key_provider) owner to atps_key_keeper;
alter function public.decrypt_job_api_key(uuid, public.key_provider) owner to atps_key_keeper;
alter function private.delete_api_key_secret() owner to atps_key_keeper;
revoke create on schema public, private from atps_key_keeper;

revoke all on function public.save_api_key(uuid, public.key_provider, text, timestamptz) from public, anon, authenticated;
revoke all on function public.decrypt_api_key(uuid, public.key_provider) from public, anon, authenticated;
revoke all on function public.decrypt_job_api_key(uuid, public.key_provider) from public, anon, authenticated;
revoke all on function private.delete_api_key_secret() from public, anon, authenticated;
grant execute on function public.save_api_key(uuid, public.key_provider, text, timestamptz) to service_role;
grant execute on function public.decrypt_api_key(uuid, public.key_provider) to service_role;
grant execute on function public.decrypt_job_api_key(uuid, public.key_provider) to service_role;
