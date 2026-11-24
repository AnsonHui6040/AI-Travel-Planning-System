-- T33：唯讀連結（C-10、SH-08）。
-- 建立與撤銷：只有 Owner，經 create_readonly_link（256 位元隨機 token，只回傳一次，資料庫只存 SHA-256，1–30 天）
-- 與 revoke_readonly_link（擁有者 atps_member_manager）。authenticated 不再能自行寫入 token 雜湊。
-- 讀取：readonly_trip(token) 不需登入，只回傳已排入行程的內容（不含 place_id、座標），以及當事人開啟
-- 「提供給 Viewer 與唯讀連結」的敏感欄位；撤銷、過期或錯誤的 token 回傳 null。擁有者 atps_readonly_reader，
-- 只有讀取權限，不能觸發任何 AI 或外部 API（資料庫內沒有這類呼叫；網頁端另以靜態測試檢查）。

drop policy owner_insert on public.readonly_links;
revoke insert on public.readonly_links from authenticated;
revoke all on public.readonly_links from anon;

grant select, insert, update on public.readonly_links to atps_member_manager;
create policy manager_all on public.readonly_links for all to atps_member_manager using (true) with check (true);

create function public.create_readonly_link(p_trip uuid, p_days integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_token text;
begin
  if v_actor is null or p_trip is null or not private.is_owner_of(p_trip, v_actor) then
    raise exception '只有 Owner 可以建立唯讀連結' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 30 then
    raise exception '期限為 1 到 30 天' using errcode = '22023';
  end if;
  if (select count(*) from public.readonly_links where trip_id = p_trip and revoked_at is null and expires_at > now()) >= 10 then
    raise exception '有效的唯讀連結太多，請先撤銷' using errcode = '54000';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.readonly_links (trip_id, token_hash, expires_at, created_by)
    values (p_trip, private.invitation_hash(v_token), now() + make_interval(days => p_days), v_actor);
  return v_token;
end;
$$;

create function public.revoke_readonly_link(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip uuid;
begin
  select trip_id into v_trip from public.readonly_links where id = p_link;
  if v_actor is null or v_trip is null or not private.is_owner_of(v_trip, v_actor) then
    raise exception '只有 Owner 可以撤銷唯讀連結' using errcode = '42501';
  end if;
  update public.readonly_links set revoked_at = now() where id = p_link and revoked_at is null;
end;
$$;

grant create on schema public to atps_member_manager;
alter function public.create_readonly_link(uuid, integer) owner to atps_member_manager;
alter function public.revoke_readonly_link(uuid) owner to atps_member_manager;
revoke create on schema public from atps_member_manager;
revoke all on function public.create_readonly_link(uuid, integer), public.revoke_readonly_link(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_readonly_link(uuid, integer), public.revoke_readonly_link(uuid) to authenticated;

-- 讀取 ------------------------------------------------------------------------------------------
create role atps_readonly_reader nologin;
grant atps_readonly_reader to postgres;
grant usage on schema public, private, extensions, vault to atps_readonly_reader;
grant execute on function extensions.digest(text, text), private.invitation_hash(text) to atps_readonly_reader;
grant select on vault.decrypted_secrets, vault.secrets to atps_readonly_reader;
grant execute on function vault._crypto_aead_det_decrypt(bytea, bytea, bigint, bytea, bytea) to atps_readonly_reader;
grant select on public.readonly_links, public.trips, public.days, public.itinerary_items, public.member_sensitive_fields,
  public.profiles to atps_readonly_reader;
create policy reader_select on public.readonly_links for select to atps_readonly_reader using (true);
create policy reader_select on public.trips for select to atps_readonly_reader using (true);
create policy reader_select on public.days for select to atps_readonly_reader using (true);
create policy reader_select on public.itinerary_items for select to atps_readonly_reader using (true);
create policy reader_select on public.member_sensitive_fields for select to atps_readonly_reader using (true);
create policy reader_select on public.profiles for select to atps_readonly_reader using (true);

create function public.readonly_trip(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_trip uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select trip_id into v_trip from public.readonly_links
    where token_hash = private.invitation_hash(p_token) and revoked_at is null and expires_at > now();
  if v_trip is null then
    return null;
  end if;
  return jsonb_build_object(
    'trip', (select jsonb_build_object('name', t.name, 'destination', t.destination, 'start_date', t.start_date,
        'end_date', t.end_date, 'timezone', t.timezone, 'status', t.status)
      from public.trips t where t.id = v_trip),
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', d.date, 'status', d.status) order by d.date)
      from public.days d where d.trip_id = v_trip), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name_zh', i.name_zh, 'name_local', i.name_local,
        'address', i.address, 'type', i.type, 'scheduled_date', i.scheduled_date,
        'scheduled_start', to_char(i.scheduled_start, 'HH24:MI'), 'scheduled_end', to_char(i.scheduled_end, 'HH24:MI'),
        'verification_status', i.verification_status, 'at_risk', i.at_risk)
        order by i.scheduled_date, i.scheduled_start)
      from public.itinerary_items i
      where i.trip_id = v_trip and i.scheduled_date is not null
        and i.lifecycle_status in ('approved', 'locked', 'change_proposed', 'modified', 'completed')), '[]'::jsonb),
    -- SH-08：只附開啟「提供給 Viewer 與唯讀連結」的欄位
    'sensitive', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(p.display_name, '成員'), 'field', f.field,
        'value', s.decrypted_secret) order by p.display_name, f.field)
      from public.member_sensitive_fields f
      join vault.decrypted_secrets s on s.id = f.vault_secret_id
      left join public.profiles p on p.id = f.user_id
      where f.trip_id = v_trip and f.share_viewers), '[]'::jsonb)
  );
end;
$$;

grant create on schema public to atps_readonly_reader;
alter function public.readonly_trip(text) owner to atps_readonly_reader;
revoke create on schema public from atps_readonly_reader;
revoke all on function public.readonly_trip(text) from public, service_role;
grant execute on function public.readonly_trip(text) to anon, authenticated;
