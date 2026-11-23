-- T10A：復原任何舊版本（D10、決策 0005、SH-04）
-- 每個版本保存寫入當下的完整排程快照；復原把排程改回所選版本的快照並建立新版本，原有版本紀錄不變。
-- 只復原排程，At Risk 屬事實資料不隨復原改動。

alter table public.versions add column snapshot jsonb;
alter table public.versions add column restored_from uuid references public.versions (id);

-- 新增版本時自動記錄行程所有項目的排程（commit_proposal、restore_version 都經此填入）
create function private.set_version_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.snapshot is null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'itemId', i.id,
        'date', i.scheduled_date,
        'start', to_char(i.scheduled_start, 'HH24:MI'),
        'end', to_char(i.scheduled_end, 'HH24:MI')
      ) order by i.id), '[]')
      into new.snapshot
    from public.itinerary_items i
    where i.trip_id = new.trip_id;
  end if;
  return new;
end;
$$;
revoke all on function private.set_version_snapshot() from public, anon, authenticated, service_role;

create trigger versions_snapshot before insert on public.versions
  for each row execute function private.set_version_snapshot();

-- Owner、Companion 復原到同一行程的任何舊版本
create function public.restore_version(p_version_id uuid, p_base_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_trip uuid;
  v_current integer;
  v_target public.versions;
  v_item public.itinerary_items;
  v_slot jsonb;
  v_date date;
  v_start time;
  v_end time;
  v_old jsonb := '[]';
  v_new jsonb := '[]';
  v_ids jsonb := '[]';
  v_dates jsonb := '[]';
  v_moves_day boolean := false;
  v_kind public.version_kind;
  v_major integer;
  v_minor integer;
  v_version_id uuid;
begin
  select trip_id into v_trip from public.versions where id = p_version_id;
  if v_actor is null or v_trip is null or not private.can_edit_trip(v_trip) then
    raise exception '沒有復原權限' using errcode = '42501';
  end if;

  -- 與 commit_proposal 相同，先鎖行程列
  select current_version into v_current from public.trips where id = v_trip for update;
  if p_base_version is distinct from v_current then
    raise exception '行程版本已變更，請重新整理後再選擇' using errcode = '40001';
  end if;

  select * into v_target from public.versions where id = p_version_id;
  if v_target.snapshot is null or jsonb_typeof(v_target.snapshot) <> 'array' then
    raise exception '此版本沒有完整行程紀錄' using errcode = '22023';
  end if;

  for v_item in select * from public.itinerary_items where trip_id = v_trip order by id for update loop
    -- 所選版本之後才加入的項目，在該版本未排程
    v_slot := null;
    select s into v_slot from jsonb_array_elements(v_target.snapshot) s where s ->> 'itemId' = v_item.id::text;
    v_date := (v_slot ->> 'date')::date;
    v_start := (v_slot ->> 'start')::time;
    v_end := (v_slot ->> 'end')::time;

    if v_item.scheduled_date is distinct from v_date or v_item.scheduled_start is distinct from v_start
       or v_item.scheduled_end is distinct from v_end then
      v_old := v_old || jsonb_build_object('itemId', v_item.id, 'date', v_item.scheduled_date,
        'start', to_char(v_item.scheduled_start, 'HH24:MI'), 'end', to_char(v_item.scheduled_end, 'HH24:MI'));
      v_new := v_new || jsonb_build_object('itemId', v_item.id, 'date', v_date,
        'start', to_char(v_start, 'HH24:MI'), 'end', to_char(v_end, 'HH24:MI'));
      v_ids := v_ids || to_jsonb(v_item.id);
      -- 未排程（null）也算一個日期，與 core classifyVersionKind 相同
      if not v_dates @> jsonb_build_array(v_item.scheduled_date) then
        v_dates := v_dates || jsonb_build_array(v_item.scheduled_date);
      end if;
      if v_item.scheduled_date is distinct from v_date then
        v_moves_day := true;
      end if;
      update public.itinerary_items set scheduled_date = v_date, scheduled_start = v_start, scheduled_end = v_end
        where id = v_item.id;
    end if;
  end loop;

  if jsonb_array_length(v_ids) = 0 then
    raise exception '目前行程已與此版本相同' using errcode = '22023';
  end if;

  -- 第 2.7 節：換日或同時影響兩天以上為 Major
  v_kind := case when v_moves_day or jsonb_array_length(v_dates) > 1 then 'major' else 'minor' end;

  select v.major, v.minor into v_major, v_minor from public.versions v
    where v.trip_id = v_trip order by v.major desc, v.minor desc limit 1;
  if v_kind = 'major' then
    v_major := v_major + 1; v_minor := 0;
  else
    v_minor := v_minor + 1;
  end if;

  update public.trips set current_version = current_version + 1 where id = v_trip;
  insert into public.versions (trip_id, major, minor, kind, summary, reason, proposal_id, approved_by,
    impact_scope, old_arrangement, new_arrangement, base_version, restored_from)
  values (v_trip, v_major, v_minor, v_kind, format('復原至 v%s.%s', v_target.major, v_target.minor), null, null, v_actor,
    jsonb_build_object('itemIds', v_ids), v_old, v_new, p_base_version, v_target.id)
  returning id into v_version_id;

  insert into public.notifications (recipient_id, trip_id, kind, ref_table, ref_id)
  select m.user_id, v_trip, 'version_restored', 'versions', v_version_id
  from public.trip_members m
  where m.trip_id = v_trip and m.user_id is distinct from v_actor;

  return jsonb_build_object('outcome', 'restored', 'major', v_major, 'minor', v_minor, 'version_id', v_version_id);
end;
$$;

grant create on schema public to atps_change_writer;
alter function public.restore_version(uuid, integer) owner to atps_change_writer;
revoke create on schema public from atps_change_writer;

revoke all on function public.restore_version(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.restore_version(uuid, integer) to authenticated;
