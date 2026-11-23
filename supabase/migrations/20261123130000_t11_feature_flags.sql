-- T11：功能開關（F-05）。新功能預設關閉；登入者只可讀取，開關只經 migration 修改
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  enabled boolean not null default false,
  description text not null check (char_length(description) between 1 and 200),
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

revoke all on public.feature_flags from anon, authenticated;
grant select on public.feature_flags to authenticated;

create policy feature_flags_select on public.feature_flags
  for select to authenticated using (true);

-- 第 7.1 節預留功能，第一版全部關閉
insert into public.feature_flags (key, description) values
  ('expense_ledger', '預算與記帳（F-01）'),
  ('calendar_export', '日曆與地圖匯出（F-02）'),
  ('push_notifications', '推播提醒（F-03）'),
  ('location_reminders', '定位提醒（F-03）'),
  ('booking_import', '訂票與訂位匯入（F-04）');
