-- T27：地理分區（D29）。分區由 AI 依自行搜尋的資料與交通估算產生，經伺服器（gateZoningOutput）檢查後
-- 只經 apply_zoning 寫入（只給 service_role，背景 job），以 atps_verification_writer 身分執行。成員可讀。

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  research_job_id uuid references public.background_jobs (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  base_area text check (char_length(base_area) between 1 and 80),
  rationale text not null check (char_length(rationale) between 1 and 300),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 10),
  created_at timestamptz not null default now()
);
create index zones_trip_idx on public.zones (trip_id);

alter table public.zones enable row level security;
revoke all on public.zones from anon, authenticated;
grant select on public.zones to authenticated;
create policy select_member on public.zones for select to authenticated using (private.is_trip_member(trip_id));

alter table public.itinerary_items add column zone_id uuid references public.zones (id) on delete set null;
alter table public.itinerary_items add column zone_transfers smallint check (zone_transfers between 0 and 10);
alter table public.itinerary_items add column zone_minutes integer check (zone_minutes between 1 and 1440);

grant select, insert, delete on public.zones to atps_verification_writer;
grant update (zone_id, zone_transfers, zone_minutes) on public.itinerary_items to atps_verification_writer;
create policy verification_writer_all on public.zones for all to atps_verification_writer using (true) with check (true);

-- 取代行程現有的分區。回傳寫入的分區數；項目必須屬於 job 的行程且尚未進入行程草案。
-- p_roles：為主要區域補上 Backup 的候選角色變更
create function public.apply_zoning(p_job uuid, p_zones jsonb, p_roles jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid := private.research_job_trip(p_job);
  v_zone jsonb;
  v_item jsonb;
  v_zone_id uuid;
  v_count integer := 0;
  v_rows integer;
begin
  if coalesce(jsonb_typeof(p_zones), '') <> 'array' or jsonb_array_length(p_zones) not between 1 and 15
     or coalesce(jsonb_typeof(p_roles), '') <> 'array' or jsonb_array_length(p_roles) > 100 then
    raise exception '分區格式不正確' using errcode = '22023';
  end if;

  update public.itinerary_items set zone_id = null, zone_transfers = null, zone_minutes = null
    where trip_id = v_trip and zone_id is not null and lifecycle_status in ('candidate', 'pending_verification', 'verified');
  delete from public.zones where trip_id = v_trip;

  for v_zone in select value from jsonb_array_elements(p_zones) loop
    insert into public.zones (trip_id, research_job_id, name, base_area, rationale, sources)
      values (v_trip, p_job, v_zone ->> 'name', v_zone ->> 'base_area', v_zone ->> 'rationale', coalesce(v_zone -> 'sources', '[]'::jsonb))
      returning id into v_zone_id;
    v_count := v_count + 1;
    for v_item in select value from jsonb_array_elements(coalesce(v_zone -> 'items', '[]'::jsonb)) loop
      update public.itinerary_items
        set zone_id = v_zone_id,
            zone_transfers = (v_item ->> 'transfers_from_base')::smallint,
            zone_minutes = (v_item ->> 'minutes_from_base')::integer
        where id = (v_item ->> 'item_id')::uuid and trip_id = v_trip
          and lifecycle_status in ('candidate', 'pending_verification', 'verified');
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception '項目不屬於此行程，或已進入行程' using errcode = '42501';
      end if;
    end loop;
  end loop;

  for v_item in select value from jsonb_array_elements(p_roles) loop
    update public.itinerary_items set candidate_role = (v_item ->> 'candidate_role')::public.candidate_role
      where id = (v_item ->> 'item_id')::uuid and trip_id = v_trip
        and lifecycle_status in ('candidate', 'pending_verification', 'verified');
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception '項目不屬於此行程，或已進入行程' using errcode = '42501';
    end if;
  end loop;
  return v_count;
end;
$$;

grant create on schema public to atps_verification_writer;
alter function public.apply_zoning(uuid, jsonb, jsonb) owner to atps_verification_writer;
revoke create on schema public from atps_verification_writer;

revoke all on function public.apply_zoning(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_zoning(uuid, jsonb, jsonb) to service_role;
