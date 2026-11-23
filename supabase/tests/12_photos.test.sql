-- T21：照片（S-09、D14）。Storage 只由伺服器在移除 EXIF 後寫入；成員可讀；Commons 照片的授權、作者、來源必填
-- O：Owner；V：Viewer；X：非成員
begin;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f7', 'po@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f8', 'pv@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f9', 'px@example.test', 'authenticated', 'authenticated');
insert into public.trips (id, name, owner_id) values
  ('b1000000-0000-0000-0000-000000000001', '照片測試', '00000000-0000-0000-0000-0000000000f7'),
  ('b1000000-0000-0000-0000-000000000002', '另一個行程', '00000000-0000-0000-0000-0000000000f9');
insert into public.trip_members (trip_id, user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f8', 'viewer');
insert into public.itinerary_items (id, trip_id, name_zh, type, suggested_stay_minutes, recommendation_reason, priority, weather_dependency,
  score_personal_value, score_uniqueness, score_geographic_fit, score_time_cost, score_transport_cost,
  score_weather_dependency, score_time_slot_dependency, score_substitutability) values
  ('b1000000-0000-0000-0000-0000000000e1', 'b1000000-0000-0000-0000-000000000001', '淺草寺', 'attraction', 60, '測試', 3, 'low', 3, 3, 3, 3, 3, 3, 3, 3),
  ('b1000000-0000-0000-0000-0000000000e2', 'b1000000-0000-0000-0000-000000000002', '別處', 'attraction', 60, '測試', 3, 'low', 3, 3, 3, 3, 3, 3, 3, 3);

select is((select public from storage.buckets where id = 'trip-photos'), false, '照片 bucket 不公開');
select results_eq($$select file_size_limit::bigint, allowed_mime_types from storage.buckets where id = 'trip-photos'$$,
  $$values (5242880::bigint, array['image/jpeg', 'image/png', 'image/webp'])$$, 'bucket 限制大小與檔案類型');

-- 伺服器（service role）寫入物件
insert into storage.objects (bucket_id, name, owner_id)
  values ('trip-photos', 'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a1.jpg', null);

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end;
$$;

-- Owner 也不能直接上傳到 Storage（必須經伺服器移除 EXIF） -----------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('trip-photos', 'b1000000-0000-0000-0000-000000000001/x.jpg')$$,
  '42501', null, 'Owner 不可直接上傳物件');
update storage.objects set name = 'b1000000-0000-0000-0000-000000000001/y.jpg' where bucket_id = 'trip-photos' and name like 'b1000000-0000-0000-0000-000000000001/%';
reset role;
select is((select name from storage.objects where bucket_id = 'trip-photos' and name like 'b1000000-0000-0000-0000-000000000001/%'),
  'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a1.jpg', '不可修改物件');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
select is((select count(*)::int from storage.objects where bucket_id = 'trip-photos' and name like 'b1000000-0000-0000-0000-000000000001/%'), 1, 'Owner 可讀行程照片');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f8');
select is((select count(*)::int from storage.objects where bucket_id = 'trip-photos' and name like 'b1000000-0000-0000-0000-000000000001/%'), 1, 'Viewer 可讀行程照片');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f9');
select is((select count(*)::int from storage.objects where bucket_id = 'trip-photos' and name like 'b1000000-0000-0000-0000-000000000001/%'), 0, '非成員讀不到');

-- 照片紀錄的限制 -----------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f7');
select lives_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'user_upload', '本人拍攝', '小明',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a1.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '使用者上傳的照片');
select lives_ok($$insert into public.photos (trip_id, item_id, source, license, author, source_url, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'wikimedia_commons', 'CC BY-SA 4.0', 'Example Author',
    'https://commons.wikimedia.org/wiki/File:Sensoji_example.jpg',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a2.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  'Commons 照片附授權、作者、來源');

select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'wikimedia_commons', 'CC BY 4.0', 'Example Author',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a3.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23514', null, 'Commons 照片缺來源時拒絕');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, source_url, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'wikimedia_commons', '保留所有權利', 'Example Author',
    'https://commons.wikimedia.org/wiki/File:x.jpg',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a4.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23514', null, 'Commons 照片的授權不是 CC 或公有領域時拒絕');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, source_url, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'wikimedia_commons', 'CC BY 4.0', '   ',
    'https://commons.wikimedia.org/wiki/File:x.jpg',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a5.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23514', null, '作者只有空白時拒絕');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, source_url, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'wikimedia_commons', 'CC BY 4.0', 'A',
    'https://evil.example/File:x.jpg',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a6.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23514', null, 'Commons 來源不是 commons.wikimedia.org 時拒絕');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'user_upload', '本人拍攝', '小明',
    'b1000000-0000-0000-0000-000000000002/b1000000-0000-0000-0000-0000000000a7.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23514', null, 'Storage 路徑必須在本行程的資料夾');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'user_upload', '本人拍攝', '小明',
    'b1000000-0000-0000-0000-000000000001/../x.svg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23514', null, 'Storage 路徑格式不合時拒絕');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e2', 'user_upload', '本人拍攝', '小明',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a8.jpg', '00000000-0000-0000-0000-0000000000f7')$$,
  '23503', null, '項目必須屬於同一個行程');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f8');
select throws_ok($$insert into public.photos (trip_id, item_id, source, license, author, storage_path, uploaded_by)
  values ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-0000000000e1', 'user_upload', '本人拍攝', '小華',
    'b1000000-0000-0000-0000-000000000001/b1000000-0000-0000-0000-0000000000a9.jpg', '00000000-0000-0000-0000-0000000000f8')$$,
  '42501', null, 'Viewer 不可新增照片');

select * from finish();
rollback;
