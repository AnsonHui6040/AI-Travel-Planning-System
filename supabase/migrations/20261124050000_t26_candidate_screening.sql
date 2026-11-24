-- T26：候選篩選（決策 0007）。評分由伺服器（packages/core screenCandidates）計算，
-- 只經 apply_candidate_scores 寫入（只給 service_role，背景 job），以 atps_verification_writer 身分執行。
-- 值域由欄位的 check 約束檢查（各維度 0–5、優先度 1–5）。

grant update (score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
  score_weather_dependency, score_time_slot_dependency, score_substitutability, candidate_role, priority, weather_dependency)
  on public.itinerary_items to atps_verification_writer;

-- 回傳寫入筆數；項目必須屬於 job 的行程且尚未進入行程草案
create function public.apply_candidate_scores(p_job uuid, p_scores jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid := private.research_job_trip(p_job);
  v_entry jsonb;
  v_scores jsonb;
  v_count integer := 0;
  v_rows integer;
begin
  if coalesce(jsonb_typeof(p_scores), '') <> 'array' or jsonb_array_length(p_scores) > 500 then
    raise exception '評分格式不正確' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_scores) loop
    v_scores := v_entry -> 'scores';
    if coalesce(jsonb_typeof(v_scores), '') <> 'object' then
      raise exception '評分格式不正確' using errcode = '22023';
    end if;
    update public.itinerary_items
      set score_personal_value = (v_scores ->> 'personal_value')::smallint,
          score_uniqueness = (v_scores ->> 'uniqueness')::smallint,
          score_geographic_fit = (v_scores ->> 'geographic_fit')::smallint,
          score_time_cost = (v_scores ->> 'time_cost')::smallint,
          score_transport_cost = (v_scores ->> 'transport_cost')::smallint,
          score_weather_dependency = (v_scores ->> 'weather_dependency')::smallint,
          score_time_slot_dependency = (v_scores ->> 'time_slot_dependency')::smallint,
          score_substitutability = (v_scores ->> 'substitutability')::smallint,
          candidate_role = (v_entry ->> 'candidate_role')::public.candidate_role,
          priority = (v_entry ->> 'priority')::integer,
          weather_dependency = (v_entry ->> 'weather_dependency')::public.level3
      where id = (v_entry ->> 'item_id')::uuid and trip_id = v_trip
        and lifecycle_status in ('candidate', 'pending_verification', 'verified');
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception '項目不屬於此行程，或已進入行程' using errcode = '42501';
    end if;
    v_count := v_count + v_rows;
  end loop;
  return v_count;
end;
$$;

grant create on schema public to atps_verification_writer;
alter function public.apply_candidate_scores(uuid, jsonb) owner to atps_verification_writer;
revoke create on schema public from atps_verification_writer;

revoke all on function public.apply_candidate_scores(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_candidate_scores(uuid, jsonb) to service_role;
