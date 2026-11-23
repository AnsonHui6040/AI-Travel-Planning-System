-- T21：照片（S-09、D14）。
-- 檔案存於不公開的 Storage bucket；只由伺服器在移除 EXIF 後以 service role 寫入，使用者沒有上傳、修改或刪除物件的權限。
-- 成員可讀取自己行程資料夾內的照片（以 signed URL 顯示）。
-- Wikimedia Commons 照片必須有 CC 或公有領域授權、作者與 commons.wikimedia.org 的來源。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('trip-photos', 'trip-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- 路徑第一層是行程編號；不是 uuid 時回傳 null（不可讀）
create function private.photo_trip_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid end;
$$;
grant execute on function private.photo_trip_id(text) to authenticated;

create policy trip_photos_select_member on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos' and private.is_trip_member(private.photo_trip_id(name)));

-- 照片紀錄的限制 -----------------------------------------------------------
create unique index itinerary_items_id_trip_idx on public.itinerary_items (id, trip_id);

alter table public.photos
  add constraint photos_item_same_trip foreign key (item_id, trip_id) references public.itinerary_items (id, trip_id) on delete cascade,
  add constraint photos_storage_path check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' and split_part(storage_path, '/', 1) = trip_id::text
  ),
  add constraint photos_author_not_blank check (btrim(author) <> '' and btrim(license) <> ''),
  add constraint photos_commons_source check (
    source <> 'wikimedia_commons' or (
      source_url is not null
      and source_url ~ '^https://commons\.wikimedia\.org/wiki/File:[^\s]+$'
      and license ~ '^(CC0 1\.0|CC BY(-SA)? [1-4]\.0|Public domain)$'
    )
  );
