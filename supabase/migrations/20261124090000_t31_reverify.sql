-- T31：旅前自動再核實（D25、C-12、SH-06）。
-- 1. trips.reverify_enabled：只有 Owner 經 set_reverify_schedule 開關（預設關閉，可隨時關閉）。
-- 2. reverify_runs：每個行程的 T-7、T-1 各執行一次。
-- 3. start_reverification（service_role，排程端點）：已開啟排程時建立 job，發起人固定為行程 Owner，
--    所以 job 只能解密 Owner 的 key（C-12）；未開啟時回傳 null、不建立 job。
-- 4. submit_reverify_at_risk（service_role）：問題項目以 approved_fact_invalidated 提案標示 At Risk，
--    經 commit_proposal 自動套用（第 2.6 節），Change Log 記錄提出者，並通知所有成員（未讀）。
-- 函式以 atps_change_writer 身分執行。

alter table public.trips add column reverify_enabled boolean not null default false;

create table public.reverify_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null check (kind in ('T-7', 'T-1')),
  job_id uuid references public.background_jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, kind)
);
alter table public.reverify_runs enable row level security;
create policy select_member on public.reverify_runs for select to authenticated using (private.is_trip_member(trip_id));
grant select on public.reverify_runs to authenticated;

grant update (reverify_enabled) on public.trips to atps_change_writer;
grant select, insert on public.reverify_runs, public.background_jobs to atps_change_writer;
grant insert on public.proposals to atps_change_writer;
create policy writer_all on public.reverify_runs for all to atps_change_writer using (true) with check (true);
create policy writer_select on public.background_jobs for select to atps_change_writer using (true);
create policy writer_insert on public.background_jobs for insert to atps_change_writer with check (true);
create policy writer_insert on public.proposals for insert to atps_change_writer with check (true);

-- 1 -------------------------------------------------------------------------------------------
create function public.set_reverify_schedule(p_trip uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
begin
  if v_actor is null or p_enabled is null or not exists (
    select 1 from public.trip_members where trip_id = p_trip and user_id = v_actor and role = 'owner'
  ) then
    raise exception '只有 Owner 可以設定旅前再核實排程' using errcode = '42501';
  end if;
  update public.trips set reverify_enabled = p_enabled where id = p_trip;
end;
$$;

-- 3 -------------------------------------------------------------------------------------------
create function public.start_reverification(p_trip uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_job uuid;
begin
  if p_kind is null or p_kind not in ('T-7', 'T-1') then
    raise exception '再核實種類不正確' using errcode = '22023';
  end if;
  select * into v_trip from public.trips where id = p_trip for update;
  -- 未開啟排程或不在規劃中、已鎖定時不執行
  if v_trip.id is null or not v_trip.reverify_enabled or v_trip.status not in ('planning', 'locked') then
    return null;
  end if;
  if exists (select 1 from public.reverify_runs where trip_id = p_trip and kind = p_kind) then
    return null;
  end if;
  insert into public.background_jobs (kind, initiator_id, trip_id, status)
    values ('reverify', v_trip.owner_id, p_trip, 'running') returning id into v_job;
  insert into public.reverify_runs (trip_id, kind, job_id) values (p_trip, p_kind, v_job);
  return v_job;
end;
$$;

-- 4 -------------------------------------------------------------------------------------------
create function public.submit_reverify_at_risk(p_job uuid, p_change jsonb, p_by jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.background_jobs;
  v_version integer;
  v_op jsonb;
  v_id uuid;
begin
  select * into v_job from public.background_jobs where id = p_job;
  if v_job.id is null or v_job.kind <> 'reverify' or v_job.status <> 'running' or v_job.trip_id is null then
    raise exception '不是執行中的再核實 job' using errcode = '42501';
  end if;
  if p_change ->> 'changeKind' is distinct from 'approved_fact_invalidated'
     or coalesce(jsonb_typeof(p_change -> 'operations'), '') <> 'array'
     or jsonb_array_length(p_change -> 'operations') not between 1 and 50
     or coalesce(jsonb_typeof(p_by), '') <> 'object'
     or p_by ->> 'provider' is null or p_by ->> 'provider' not in ('anthropic', 'google', 'openai')
     or char_length(coalesce(p_by ->> 'model', '')) not between 1 and 100 then
    raise exception '再核實結果格式不正確' using errcode = '22023';
  end if;
  for v_op in select value from jsonb_array_elements(p_change -> 'operations') loop
    if v_op ->> 'op' is distinct from 'set_at_risk' or v_op ->> 'atRisk' is distinct from 'true' then
      raise exception '再核實只能標示 At Risk' using errcode = '22023';
    end if;
    if not exists (select 1 from public.itinerary_items where id = (v_op ->> 'itemId')::uuid and trip_id = v_job.trip_id) then
      raise exception '項目不屬於此行程' using errcode = '42501';
    end if;
  end loop;

  select current_version into v_version from public.trips where id = v_job.trip_id;
  insert into public.proposals (trip_id, proposer_role, proposer_provider, proposer_model, base_version, change, impact_scope)
  values (v_job.trip_id, 'verification', (p_by ->> 'provider')::public.ai_provider, p_by ->> 'model', v_version, p_change,
    jsonb_build_object('reverify', true))
  returning id into v_id;
  return private.commit_proposal(v_id, null);
end;
$$;

grant create on schema public to atps_change_writer;
alter function public.set_reverify_schedule(uuid, boolean) owner to atps_change_writer;
alter function public.start_reverification(uuid, text) owner to atps_change_writer;
alter function public.submit_reverify_at_risk(uuid, jsonb, jsonb) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;

revoke all on function public.set_reverify_schedule(uuid, boolean), public.start_reverification(uuid, text),
  public.submit_reverify_at_risk(uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_reverify_schedule(uuid, boolean) to authenticated;
grant execute on function public.start_reverification(uuid, text), public.submit_reverify_at_risk(uuid, jsonb, jsonb) to service_role;
