-- T19：Google 座標最多保存 30 日（D28、Places API 政策：place_id 可永久保存，座標最多 30 個日曆日）。
-- 名稱、地址、評分、照片只即時顯示，不寫入資料庫；name_local 與 address 只存官方網站的資料（D28）。

-- 座標必須成對、有取得時間，並對應 place_id
alter table public.itinerary_items
  add constraint itinerary_items_coord_pair check ((coord_lat is null) = (coord_lng is null)),
  add constraint itinerary_items_coord_fetched check (coord_lat is null or coord_fetched_at is not null),
  add constraint itinerary_items_coord_place check (coord_lat is null or place_id is not null);

-- 清除取得超過 30 日的座標，保留 place_id；回傳清除筆數
create function private.purge_expired_coordinates() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.itinerary_items
    set coord_lat = null, coord_lng = null, coord_fetched_at = null
    where coord_fetched_at is not null and coord_fetched_at <= now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.purge_expired_coordinates() from public, anon, authenticated;

-- 每日排程（UTC 18:17，台灣與日本的深夜）
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-expired-coordinates', '17 18 * * *', 'select private.purge_expired_coordinates()');
