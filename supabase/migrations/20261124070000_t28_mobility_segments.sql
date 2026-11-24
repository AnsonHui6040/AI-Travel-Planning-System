-- T28：交通動線比較（D27、決策 0008）。估算由 Transport AI 依官方資料產生，伺服器加上固定緩衝與四種方案後
-- 只經 apply_mobility_segments 寫入（只給 service_role，背景 job），以 atps_verification_writer 身分執行。成員可讀。

alter table public.mobility_segments add column plans jsonb check (plans is null or jsonb_typeof(plans) = 'object');
create unique index mobility_segments_pair_idx on public.mobility_segments (trip_id, from_item_id, to_item_id);

grant select, insert, delete on public.mobility_segments to atps_verification_writer;
create policy verification_writer_all on public.mobility_segments for all to atps_verification_writer using (true) with check (true);

-- 回傳寫入段數；同一段（起點、終點）以最新的估算取代。兩個項目都必須屬於 job 的行程
create function public.apply_mobility_segments(p_job uuid, p_segments jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid := private.research_job_trip(p_job);
  v_seg jsonb;
  v_from uuid;
  v_to uuid;
  v_count integer := 0;
begin
  if coalesce(jsonb_typeof(p_segments), '') <> 'array' or jsonb_array_length(p_segments) > 30 then
    raise exception '交通估算格式不正確' using errcode = '22023';
  end if;
  for v_seg in select value from jsonb_array_elements(p_segments) loop
    v_from := (v_seg ->> 'from_item_id')::uuid;
    v_to := (v_seg ->> 'to_item_id')::uuid;
    if v_from = v_to or coalesce(jsonb_typeof(v_seg -> 'estimates'), '') <> 'array'
       or jsonb_array_length(v_seg -> 'estimates') not between 1 and 5 then
      raise exception '交通估算格式不正確' using errcode = '22023';
    end if;
    if (select count(*) from public.itinerary_items where id in (v_from, v_to) and trip_id = v_trip) <> 2 then
      raise exception '項目不屬於此行程' using errcode = '42501';
    end if;
    delete from public.mobility_segments where trip_id = v_trip and from_item_id = v_from and to_item_id = v_to;
    insert into public.mobility_segments (trip_id, from_item_id, to_item_id, estimates, buffer_minutes, recommended_mode,
      plans, source_urls, maps_url)
    values (v_trip, v_from, v_to, v_seg -> 'estimates', (v_seg ->> 'buffer_minutes')::integer,
      (v_seg ->> 'recommended_mode')::public.transport_mode, v_seg -> 'plans', coalesce(v_seg -> 'source_urls', '[]'::jsonb),
      v_seg ->> 'maps_url');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant create on schema public to atps_verification_writer;
alter function public.apply_mobility_segments(uuid, jsonb) owner to atps_verification_writer;
revoke create on schema public from atps_verification_writer;

revoke all on function public.apply_mobility_segments(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_mobility_segments(uuid, jsonb) to service_role;
