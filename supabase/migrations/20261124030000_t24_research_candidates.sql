-- T24：多 AI 獨立研究。Research A–D 的輸出只經 add_research_candidates 寫入 Candidate List（S-01、S-16）。
-- 函式只給 service_role（背景 job），以 atps_candidate_writer 身分執行：只有 itinerary_items 的新增權。
-- 輸出格式、圖片網址與 place_id 解析由伺服器（packages/core gateRoleOutput、toCandidateRows）處理；
-- 函式另外檢查 job、發起人權限與行程狀態，並固定候選的生命週期與核實狀態。

alter table public.itinerary_items add column research_track text check (research_track in ('A', 'B', 'C', 'D'));
alter table public.itinerary_items add column research_job_id uuid references public.background_jobs (id) on delete set null;
create index itinerary_items_research_job_idx on public.itinerary_items (research_job_id, research_track);

create role atps_candidate_writer nologin;
grant atps_candidate_writer to postgres;

grant usage on schema public, private to atps_candidate_writer;
grant select on public.trips, public.trip_members, public.background_jobs to atps_candidate_writer;
grant select, insert on public.itinerary_items to atps_candidate_writer;

create policy candidate_writer_select on public.trips for select to atps_candidate_writer using (true);
create policy candidate_writer_select on public.trip_members for select to atps_candidate_writer using (true);
create policy candidate_writer_select on public.background_jobs for select to atps_candidate_writer using (true);
create policy candidate_writer_select on public.itinerary_items for select to atps_candidate_writer using (true);
create policy candidate_writer_insert on public.itinerary_items for insert to atps_candidate_writer
  with check (lifecycle_status = 'candidate' and verification_status = 'unverified' and research_job_id is not null);

-- 回傳寫入筆數。同一 job 同一方向已寫入時回傳 0（workflow step 重試不重複寫入）
create function public.add_research_candidates(p_job uuid, p_track text, p_candidates jsonb) returns integer
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

  -- 篩選分數與優先度於 T26 評分；這裡先填中間值與 0
  insert into public.itinerary_items (
    trip_id, name_zh, name_local, place_id, type, area, suggested_stay_minutes, priority, weather_dependency,
    recommendation_reason, constraint_note, score_personal_value, score_uniqueness, score_geographic_fit,
    score_time_cost, score_transport_cost, score_weather_dependency, score_time_slot_dependency,
    score_substitutability, verification_status, sources, generated_by, lifecycle_status, research_track, research_job_id
  )
  select v_job.trip_id, c ->> 'name_zh', c ->> 'name_local', c ->> 'place_id', (c ->> 'type')::public.item_type, c ->> 'area',
    (c ->> 'suggested_stay_minutes')::integer, 3, 'medium', c ->> 'recommendation_reason', c ->> 'constraint_note',
    0, 0, 0, 0, 0, 0, 0, 0, 'unverified', coalesce(c -> 'sources', '[]'::jsonb), c -> 'generated_by', 'candidate',
    p_track, p_job
  from jsonb_array_elements(p_candidates) c;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant create on schema public to atps_candidate_writer;
alter function public.add_research_candidates(uuid, text, jsonb) owner to atps_candidate_writer;
revoke create on schema public from atps_candidate_writer;

revoke all on function public.add_research_candidates(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.add_research_candidates(uuid, text, jsonb) to service_role;
