-- T23：旅行基線。行程在「基線」狀態時，Owner、Companion 可儲存 Trip Baseline v1 草稿並確認；
-- 確認後行程進入「規劃中」（第 2.8 節），日期與時區取自基線。確認後的修改改走變更提案（第 6 節權限表）。
-- 使用者沒有基線表與行程狀態的寫入權，只能經下列函式；函式以 atps_baseline_writer 身分執行，呼叫者取自 session。
-- 內容格式與矛盾檢查由伺服器（packages/schemas、packages/core）負責，函式只檢查結構與狀態。

-- Supabase 的預設權限讓 authenticated 有 trips 的 UPDATE（RLS 沒有 update policy，原本只是更新 0 筆）。
-- 行程狀態只可經函式轉換，所以收回
revoke update on public.trips from authenticated;

create role atps_baseline_writer nologin;
grant atps_baseline_writer to postgres;

grant usage on schema public, private to atps_baseline_writer;
grant select on public.trips, public.trip_members, public.trip_baselines to atps_baseline_writer;
grant insert, update (data, confirmed_at) on public.trip_baselines to atps_baseline_writer;
grant update (status, start_date, end_date, timezone) on public.trips to atps_baseline_writer;
grant execute on function private.can_edit_trip(uuid), private.session_user_id() to atps_baseline_writer;

create policy baseline_writer_select on public.trips for select to atps_baseline_writer using (true);
create policy baseline_writer_update on public.trips for update to atps_baseline_writer using (true) with check (true);
create policy baseline_writer_select on public.trip_members for select to atps_baseline_writer using (true);
create policy baseline_writer_select on public.trip_baselines for select to atps_baseline_writer using (true);
create policy baseline_writer_insert on public.trip_baselines for insert to atps_baseline_writer with check (true);
create policy baseline_writer_update on public.trip_baselines for update to atps_baseline_writer using (true) with check (true);

-- 基線資料上限 64 KB（schema 的陣列上限內，正常資料約數 KB）
create function public.save_trip_baseline(p_trip uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_status public.trip_status;
  v_confirmed timestamptz;
begin
  if v_actor is null or not private.can_edit_trip(p_trip) then
    raise exception '沒有編輯基線的權限' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 65536
    or coalesce(jsonb_typeof(p_data -> 'start_date'), '') <> 'string' or coalesce(jsonb_typeof(p_data -> 'end_date'), '') <> 'string'
    or coalesce(jsonb_typeof(p_data -> 'timezone'), '') <> 'string' then
    raise exception '基線資料格式不正確' using errcode = '22023';
  end if;
  select status into v_status from public.trips where id = p_trip for update;
  select confirmed_at into v_confirmed from public.trip_baselines where trip_id = p_trip and version = 1;
  if v_status <> 'baseline' or v_confirmed is not null then
    raise exception '基線已確認，之後的修改請提出變更提案' using errcode = '55000';
  end if;
  insert into public.trip_baselines (trip_id, version, data) values (p_trip, 1, p_data)
  on conflict (trip_id, version) do update set data = excluded.data;
end;
$$;

create function public.confirm_trip_baseline(p_trip uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.session_user_id();
  v_status public.trip_status;
  v_data jsonb;
  v_confirmed timestamptz;
  v_start date;
  v_end date;
  v_tz text;
begin
  if v_actor is null or not private.can_edit_trip(p_trip) then
    raise exception '沒有確認基線的權限' using errcode = '42501';
  end if;
  select status into v_status from public.trips where id = p_trip for update;
  select data, confirmed_at into v_data, v_confirmed from public.trip_baselines where trip_id = p_trip and version = 1 for update;
  if v_data is null or v_confirmed is not null or v_status <> 'baseline' then
    raise exception '沒有可確認的基線草稿' using errcode = '55000';
  end if;
  begin
    v_start := (v_data ->> 'start_date')::date;
    v_end := (v_data ->> 'end_date')::date;
  exception when others then
    raise exception '基線日期格式不正確' using errcode = '22023';
  end;
  v_tz := v_data ->> 'timezone';
  if v_start is null or v_end is null or v_end < v_start
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception '基線日期或時區不正確' using errcode = '22023';
  end if;
  update public.trip_baselines set confirmed_at = now() where trip_id = p_trip and version = 1;
  update public.trips set status = 'planning', start_date = v_start, end_date = v_end, timezone = v_tz where id = p_trip;
end;
$$;

-- 變更擁有者需要 schema 的 CREATE 權限，完成後收回
grant create on schema public to atps_baseline_writer;
alter function public.save_trip_baseline(uuid, jsonb) owner to atps_baseline_writer;
alter function public.confirm_trip_baseline(uuid) owner to atps_baseline_writer;
revoke create on schema public from atps_baseline_writer;

revoke all on function public.save_trip_baseline(uuid, jsonb), public.confirm_trip_baseline(uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_trip_baseline(uuid, jsonb), public.confirm_trip_baseline(uuid) to authenticated;
