-- T25：合併、去重、交叉核查（D07、第 2.5 節證據順序）。
-- 去重與核實結果只經下列函式寫入，只給 service_role（背景 job），以 atps_verification_writer 身分執行。
-- 判定（重複、證據順序、Conflict）由伺服器（packages/core findDuplicateGroups、crossCheck）處理；
-- 函式另外檢查 job、發起人權限、項目所屬行程與生命週期，並在資料庫再套用一次同一家核實的上限（D07）。

alter table public.itinerary_items add column fact_claims jsonb not null default '[]' check (jsonb_typeof(fact_claims) = 'array');
alter table public.itinerary_items add column facts jsonb not null default '[]' check (jsonb_typeof(facts) = 'array');

-- T24 的寫入函式一併保存 Research 的事實主張
create or replace function public.add_research_candidates(p_job uuid, p_track text, p_candidates jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.background_jobs%rowtype;
  v_status public.trip_status;
  v_role public.trip_role;
  v_count integer;
begin
  select * into v_job from public.background_jobs where id = p_job;
  if v_job.id is null or v_job.kind <> 'research' or v_job.trip_id is null then
    raise exception '不是研究 job' using errcode = '42501';
  end if;
  if v_job.status <> 'running' then
    raise exception '研究 job 不在執行中' using errcode = '55000';
  end if;
  select role into v_role from public.trip_members where trip_id = v_job.trip_id and user_id = v_job.initiator_id;
  if v_role is null or v_role not in ('owner', 'companion') then
    raise exception '發起人沒有編輯權限' using errcode = '42501';
  end if;
  select status into v_status from public.trips where id = v_job.trip_id;
  if v_status not in ('planning', 'locked', 'in_progress') then
    raise exception '行程尚未確認基線' using errcode = '55000';
  end if;
  if p_track is null or p_track not in ('A', 'B', 'C', 'D') then
    raise exception '研究方向不正確' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_candidates), '') <> 'array' or jsonb_array_length(p_candidates) not between 1 and 30
     or octet_length(p_candidates::text) > 262144 then
    raise exception '候選格式不正確' using errcode = '22023';
  end if;

  if exists (select 1 from public.itinerary_items where research_job_id = p_job and research_track = p_track) then
    return 0;
  end if;

  insert into public.itinerary_items (
    trip_id, name_zh, name_local, place_id, type, area, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, constraint_note, score_personal_value, score_uniqueness, score_geographic_fit,
    score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency,
    score_substitutability, verification_status, sources, generated_by, lifecycle_status, research_track, research_job_id,
    fact_claims
  )
  select v_job.trip_id, c ->> 'name_zh', c ->> 'name_local', c ->> 'place_id', (c ->> 'type')::public.item_type, c ->> 'area',
    (c ->> 'suggested_stay_minutes')::integer, 3, 'medium', c ->> 'recommendation_reason', c ->> 'constraint_note',
    0, 0, 0, 0, 0, 0, 0, 0, 'unverified', coalesce(c -> 'sources', '[]'::jsonb), c -> 'generated_by', 'candidate',
    p_track, p_job, case when jsonb_typeof(c -> 'fact_claims') = 'array' then c -> 'fact_claims' else '[]'::jsonb end
  from jsonb_array_elements(p_candidates) c;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create role atps_verification_writer nologin;
grant atps_verification_writer to postgres;

grant usage on schema public, private to atps_verification_writer;
grant select on public.trips, public.trip_members, public.background_jobs, public.itinerary_items to atps_verification_writer;
grant update (verification_status, lifecycle_status, facts, fact_claims, sources, verified_by, last_verified_at)
  on public.itinerary_items to atps_verification_writer;
grant delete on public.itinerary_items to atps_verification_writer;

create policy verification_writer_select on public.trips for select to atps_verification_writer using (true);
create policy verification_writer_select on public.trip_members for select to atps_verification_writer using (true);
create policy verification_writer_select on public.background_jobs for select to atps_verification_writer using (true);
create policy verification_writer_select on public.itinerary_items for select to atps_verification_writer using (true);
create policy verification_writer_update on public.itinerary_items for update to atps_verification_writer
  using (lifecycle_status in ('candidate', 'pending_verification', 'verified'))
  with check (lifecycle_status in ('pending_verification', 'verified', 'candidate'));
create policy verification_writer_delete on public.itinerary_items for delete to atps_verification_writer
  using (lifecycle_status in ('candidate', 'pending_verification'));

-- 執行中的研究 job、發起人仍為 Owner 或 Companion、行程已確認基線時回傳行程編號
create function private.research_job_trip(p_job uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_job public.background_jobs%rowtype;
  v_role public.trip_role;
  v_status public.trip_status;
begin
  select * into v_job from public.background_jobs where id = p_job;
  if v_job.id is null or v_job.kind <> 'research' or v_job.trip_id is null then
    raise exception '不是研究 job' using errcode = '42501';
  end if;
  if v_job.status <> 'running' then
    raise exception '研究 job 不在執行中' using errcode = '55000';
  end if;
  select role into v_role from public.trip_members where trip_id = v_job.trip_id and user_id = v_job.initiator_id;
  if v_role is null or v_role not in ('owner', 'companion') then
    raise exception '發起人沒有編輯權限' using errcode = '42501';
  end if;
  select status into v_status from public.trips where id = v_job.trip_id;
  if v_status not in ('planning', 'locked', 'in_progress') then
    raise exception '行程尚未確認基線' using errcode = '55000';
  end if;
  return v_job.trip_id;
end;
$$;

-- 依網址去重，最多 20 筆
create function private.merge_source_lists(p_a jsonb, p_b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  -- 同一網址保留先出現的一筆
  select coalesce(jsonb_agg(s order by ord), '[]'::jsonb) from (
    select s, ord from (
      select distinct on (s ->> 'url') s, ord
      from jsonb_array_elements(coalesce(p_a, '[]'::jsonb) || coalesce(p_b, '[]'::jsonb)) with ordinality as e(s, ord)
      order by s ->> 'url', ord
    ) d order by ord limit 20
  ) t;
$$;

-- 回傳刪除筆數。保留的一筆併入其餘各筆的來源與事實主張
create function public.merge_duplicate_candidates(p_job uuid, p_keep uuid, p_drop uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid := private.research_job_trip(p_job);
  v_sources jsonb;
  v_claims jsonb;
  v_count integer;
begin
  if p_drop is null or cardinality(p_drop) not between 1 and 50 or p_keep = any (p_drop) then
    raise exception '合併對象不正確' using errcode = '22023';
  end if;
  if (select count(*) from public.itinerary_items
      where id = any (p_drop || p_keep) and trip_id = v_trip and lifecycle_status in ('candidate', 'pending_verification'))
     <> cardinality(array(select distinct unnest(p_drop || p_keep))) then
    raise exception '只能合併同一行程中尚未進入行程的候選' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(src order by i.created_at, src_ord), '[]'::jsonb) into v_sources
  from public.itinerary_items i, jsonb_array_elements(i.sources) with ordinality as e(src, src_ord)
  where i.id = any (p_drop);
  select coalesce(jsonb_agg(claim order by i.created_at, claim_ord), '[]'::jsonb) into v_claims
  from public.itinerary_items i, jsonb_array_elements(i.fact_claims) with ordinality as e(claim, claim_ord)
  where i.id = any (p_drop);

  update public.itinerary_items
    set sources = private.merge_source_lists(sources, v_sources),
        fact_claims = (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select x from jsonb_array_elements(fact_claims || v_claims) with ordinality as e(x, n) order by n limit 50) t)
    where id = p_keep;
  delete from public.itinerary_items where id = any (p_drop);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.apply_verification(
  p_job uuid, p_item uuid, p_status text, p_facts jsonb, p_claims jsonb, p_sources jsonb, p_verified_by jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid := private.research_job_trip(p_job);
  v_item public.itinerary_items%rowtype;
  v_status public.verification_status;
begin
  if p_status is null or p_status not in ('verified', 'partially_verified', 'unverified', 'conflict') then
    raise exception '核實狀態不正確' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_facts), '') <> 'array' or coalesce(jsonb_typeof(p_claims), '') <> 'array'
     or coalesce(jsonb_typeof(p_sources), '') <> 'array' or coalesce(jsonb_typeof(p_verified_by), '') <> 'object'
     or jsonb_array_length(p_facts) > 10 or jsonb_array_length(p_claims) > 10 or jsonb_array_length(p_sources) > 10 then
    raise exception '核實結果格式不正確' using errcode = '22023';
  end if;
  -- FOR UPDATE 會套用 update policy（草案以後的項目讀不到），所以只讀取；寫入由 UPDATE 本身鎖定
  select * into v_item from public.itinerary_items where id = p_item and trip_id = v_trip;
  if v_item.id is null then
    raise exception '項目不屬於此行程' using errcode = '42501';
  end if;
  if v_item.lifecycle_status not in ('candidate', 'pending_verification', 'verified') then
    raise exception '已進入行程的項目改由變更提案處理' using errcode = '55000';
  end if;

  v_status := p_status::public.verification_status;
  -- D07：Research 與 Verification 為同一家時，上限為 Partially Verified
  if v_status = 'verified' and v_item.generated_by ->> 'provider' = p_verified_by ->> 'provider' then
    v_status := 'partially_verified';
  end if;

  update public.itinerary_items
    set verification_status = v_status,
        lifecycle_status = (case when v_status in ('verified', 'partially_verified') then 'verified' else 'pending_verification' end)::public.lifecycle_status,
        facts = p_facts,
        fact_claims = (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
          select x from jsonb_array_elements(v_item.fact_claims || p_claims) with ordinality as e(x, n) order by n limit 50) t),
        sources = private.merge_source_lists(v_item.sources, p_sources),
        verified_by = p_verified_by,
        last_verified_at = now()
    where id = p_item;
end;
$$;

grant create on schema public, private to atps_verification_writer;
alter function private.research_job_trip(uuid) owner to atps_verification_writer;
alter function private.merge_source_lists(jsonb, jsonb) owner to atps_verification_writer;
alter function public.merge_duplicate_candidates(uuid, uuid, uuid[]) owner to atps_verification_writer;
alter function public.apply_verification(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) owner to atps_verification_writer;
revoke create on schema public, private from atps_verification_writer;

revoke all on function private.research_job_trip(uuid), private.merge_source_lists(jsonb, jsonb),
  public.merge_duplicate_candidates(uuid, uuid, uuid[]),
  public.apply_verification(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.merge_duplicate_candidates(uuid, uuid, uuid[]),
  public.apply_verification(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to service_role;
