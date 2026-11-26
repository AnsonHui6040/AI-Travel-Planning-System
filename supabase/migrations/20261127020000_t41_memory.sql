-- T41：第 5 節記憶（MEM-01–MEM-11，決策 0009）。
-- MEM-03：寫入途徑只有兩種。使用者以本人 session 手動新增、修改、刪除（T06 的 own_all policy，來源只能是 manual）；
--   旅後提案（memory_proposals，由 create_post_trip_memory_proposals 為本人建立）經擁有者以 decide_memory_proposal 批准後寫入。
--   AI 在伺服器以 service_role 執行，撤銷 service_role 對 memories 的寫入權。
-- MEM-07：身分與聯絡資料（姓名、電話、電子郵件、地址、證件號碼）不寫入記憶，trigger 與提案函式都檢查。
-- MEM-07、MEM-08、MEM-09、MEM-10：trip_memories 只回傳目前成員的個人、Planning Rules 與本趟 context，不含擁有者；
--   最保守值由 @atps/memory 的 mergeMemories 依決策 0009 計算。
-- 函式以 atps_memory_writer 身分執行。

create role atps_memory_writer nologin;
grant atps_memory_writer to postgres;
grant usage on schema public, private to atps_memory_writer;
grant execute on function private.session_user_id() to atps_memory_writer;

-- 身分與聯絡資料（與 @atps/memory 的 identityViolation 相同規則）
create function private.identity_violation(p_item text, p_value text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_item, '') ~* '(姓名|名字|全名|電話|手機|電子郵件|e-?mail|信箱|地址|住址|護照|身分證|身份證|證件|聯絡)'
    or coalesce(p_value, '') ~* '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'
    or (coalesce(p_value, '') ~ '^[+0-9()[:space:].-]+$'
        and (length(regexp_replace(p_value, '[^0-9]', '', 'g')) >= 9
             or (p_value ~ '^[[:space:]]*[+0]' and length(regexp_replace(p_value, '[^0-9]', '', 'g')) >= 8)));
$$;
revoke all on function private.identity_violation(text, text) from public, anon, authenticated, service_role;
grant execute on function private.identity_violation(text, text) to atps_memory_writer;

-- 旅後提案 --------------------------------------------------------------------
create type public.memory_proposal_status as enum ('pending', 'approved', 'rejected');
create table public.memory_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  layer public.memory_layer not null check (layer in ('personal', 'planning_rules')),
  kind public.memory_kind not null,
  item text not null check (char_length(item) between 1 and 80),
  value text not null check (char_length(value) between 1 and 200),
  unit text check (char_length(unit) between 1 and 20),
  reason text not null check (char_length(reason) between 1 and 300),
  status public.memory_proposal_status not null default 'pending',
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index memory_proposals_owner_idx on public.memory_proposals (owner_id, status);
alter table public.memory_proposals enable row level security;
revoke all on public.memory_proposals from anon, authenticated, service_role;
create policy select_own on public.memory_proposals for select to authenticated using (owner_id = (select auth.uid()));
grant select on public.memory_proposals to authenticated;
grant select, insert, delete, update (status, decided_at) on public.memory_proposals to atps_memory_writer;
create policy writer_all on public.memory_proposals for all to atps_memory_writer using (true) with check (true);

-- 來源提案編號改指向旅後記憶提案
alter table public.memories drop constraint memories_source_proposal_id_fkey;
alter table public.memories add constraint memories_source_proposal_id_fkey
  foreign key (source_proposal_id) references public.memory_proposals (id) on delete set null;
alter table public.memories add constraint memories_source_matches
  check ((source = 'manual') = (source_proposal_id is null));

-- MEM-03：AI（service_role）沒有記憶寫入權
revoke insert, update, delete on public.memories from service_role;
grant select, insert on public.memories to atps_memory_writer;
create policy writer_insert on public.memories for insert to atps_memory_writer with check (true);
create policy writer_select on public.memories for select to atps_memory_writer using (true);

create function private.check_memory_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.identity_violation(new.item, new.value) or private.identity_violation(new.unit, new.unit) then
    raise exception '身分與聯絡資料不寫入記憶' using errcode = '22023';
  end if;
  -- 旅後提案來源只能經 decide_memory_proposal 寫入
  if current_user <> 'atps_memory_writer'
     and (new.source <> 'manual' or new.source_proposal_id is not null)
     and (tg_op = 'INSERT' or new.source is distinct from old.source or new.source_proposal_id is distinct from old.source_proposal_id) then
    raise exception '旅後提案的記憶只能經擁有者批准寫入' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.check_memory_write() from public, anon, service_role;
grant execute on function private.identity_violation(text, text) to authenticated;
create trigger check_memory_write before insert or update on public.memories
  for each row execute function private.check_memory_write();

-- 合併讀取 --------------------------------------------------------------------
create function public.trip_memories(p_trip uuid)
returns table (layer public.memory_layer, kind public.memory_kind, item text, value text, unit text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_trip is null or not private.is_trip_member(p_trip) then
    raise exception '只有成員可以讀取行程記憶' using errcode = '42501';
  end if;
  return query
    select m.layer, m.kind, m.item, m.value, m.unit
    from public.memories m
    where m.owner_id in (select tm.user_id from public.trip_members tm where tm.trip_id = p_trip)
      and (m.layer in ('personal', 'planning_rules') or (m.layer = 'trip_context' and m.trip_id = p_trip))
    order by m.layer, m.kind, m.item, m.created_at;
end;
$$;
revoke all on function public.trip_memories(uuid) from public, anon, authenticated, service_role;
grant execute on function public.trip_memories(uuid) to authenticated;

create function public.create_post_trip_memory_proposals(p_trip uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_status public.trip_status;
  v_count integer := 0;
  v_item jsonb;
begin
  if v_actor is null or p_trip is null or not exists (select 1 from public.trip_members m where m.trip_id = p_trip and m.user_id = v_actor) then
    raise exception '只有成員可以建立旅後記憶提案' using errcode = '42501';
  end if;
  select t.status into v_status from public.trips t where t.id = p_trip;
  if v_status not in ('ended', 'archived') then
    raise exception '行程結束後才能建立旅後記憶提案' using errcode = '55000';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception '旅後記憶提案格式不正確' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(jsonb_typeof(v_item), '') <> 'object'
       or private.identity_violation(v_item ->> 'item', v_item ->> 'value') then
      raise exception '旅後記憶提案不可包含身分與聯絡資料' using errcode = '22023';
    end if;
  end loop;
  -- 同一行程重新產生時，取代本人尚未決定的提案
  delete from public.memory_proposals where owner_id = v_actor and trip_id = p_trip and status = 'pending';
  insert into public.memory_proposals (owner_id, trip_id, layer, kind, item, value, unit, reason)
  select v_actor, p_trip, (e ->> 'layer')::public.memory_layer, (e ->> 'kind')::public.memory_kind,
    e ->> 'item', e ->> 'value', nullif(e ->> 'unit', ''), e ->> 'reason'
  from jsonb_array_elements(p_items) e;
  get diagnostics v_count = row_count;
  return v_count;
exception
  when invalid_text_representation or not_null_violation or check_violation then
    raise exception '旅後記憶提案格式不正確' using errcode = '22023';
end;
$$;

create function public.decide_memory_proposal(p_proposal uuid, p_approve boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_p public.memory_proposals;
  v_memory uuid;
begin
  select * into v_p from public.memory_proposals where id = p_proposal and owner_id = v_actor for update;
  if v_actor is null or v_p.id is null then
    raise exception '只有擁有者可以決定自己的旅後記憶提案' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' or p_approve is null then
    raise exception '這個提案已經決定' using errcode = '55000';
  end if;
  update public.memory_proposals
    set status = (case when p_approve then 'approved' else 'rejected' end)::public.memory_proposal_status, decided_at = now()
  where id = p_proposal;
  if p_approve then
    insert into public.memories (owner_id, layer, kind, item, value, unit, source, source_proposal_id)
    values (v_actor, v_p.layer, v_p.kind, v_p.item, v_p.value, v_p.unit, 'post_trip_proposal', v_p.id)
    returning id into v_memory;
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'memory_id', v_memory);
end;
$$;

grant create on schema public to atps_memory_writer;
alter function public.create_post_trip_memory_proposals(uuid, jsonb) owner to atps_memory_writer;
alter function public.decide_memory_proposal(uuid, boolean) owner to atps_memory_writer;
revoke create on schema public from atps_memory_writer;
grant select on public.trip_members, public.trips to atps_memory_writer;
create policy memory_writer_select on public.trip_members for select to atps_memory_writer using (true);
create policy memory_writer_select on public.trips for select to atps_memory_writer using (true);
revoke all on function public.create_post_trip_memory_proposals(uuid, jsonb), public.decide_memory_proposal(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_post_trip_memory_proposals(uuid, jsonb), public.decide_memory_proposal(uuid, boolean) to authenticated;
