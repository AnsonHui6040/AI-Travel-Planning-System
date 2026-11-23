-- T06：第 2.4 節與第 2.11 節全部實體。欄位與 packages/schemas 的 row schema 一致（tooling/schema-migration-consistency.test.ts）。
-- 數值上下限見 docs/decisions/0002-field-validation.md。
-- 正式行程資料（基線、項目、每日、移動段、版本）不開放 authenticated 直接寫入，只由 applyChange（T09）寫入（S-01）。

create type public.item_type as enum ('attraction', 'restaurant', 'shopping', 'photography', 'activity');
create type public.constraint_class as enum ('hard_constraint', 'strong_preference', 'flexible');
create type public.level3 as enum ('low', 'medium', 'high');
create type public.reservation_requirement as enum ('none', 'recommended', 'required');
create type public.candidate_role as enum ('primary', 'backup');
create type public.verification_status as enum ('verified', 'partially_verified', 'unverified', 'conflict');
create type public.lifecycle_status as enum ('candidate', 'pending_verification', 'verified', 'draft', 'approved', 'locked', 'change_proposed', 'modified', 'rejected', 'completed', 'cancelled');
create type public.post_trip_status as enum ('completed', 'skipped', 'cancelled', 'revisit', 'not_recommended');
create type public.day_status as enum ('draft', 'approved', 'day_ready', 'in_progress', 'completed');
create type public.proposal_status as enum ('pending', 'applied', 'rejected', 'invalidated');
create type public.version_kind as enum ('major', 'minor');
create type public.incident_level as enum ('L1', 'L2', 'L3', 'L4');
create type public.transport_mode as enum ('walk', 'rail', 'bus', 'taxi', 'drive');
create type public.ai_role as enum ('research', 'verification', 'transport', 'master_planner', 'live_planner');
create type public.ai_provider as enum ('anthropic', 'google', 'openai');
create type public.memory_layer as enum ('personal', 'planning_rules', 'trip_context');
create type public.memory_kind as enum ('constraint', 'preference');
create type public.memory_source as enum ('manual', 'post_trip_proposal');
create type public.key_provider as enum ('anthropic', 'google_ai', 'openai', 'google_maps', 'odpt');
create type public.job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.photo_source as enum ('user_upload', 'wikimedia_commons');
create type public.completion as enum ('completed', 'partial', 'skipped');

-- Owner 或 Companion
create function private.can_edit_trip(p_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.trip_role_of(p_trip) in ('owner', 'companion'), false);
$$;
revoke all on function private.can_edit_trip(uuid) from public;
grant execute on function private.can_edit_trip(uuid) to authenticated;

create table public.trip_baselines (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  version integer not null check (version between 1 and 1000),
  data jsonb not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id, version)
);

create table public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name_zh text not null check (char_length(name_zh) between 1 and 80),
  name_local text check (char_length(name_local) between 1 and 120),
  place_id text check (char_length(place_id) between 1 and 300),
  type public.item_type not null,
  address text check (char_length(address) between 1 and 200),
  area text check (char_length(area) between 1 and 80),
  coord_lat double precision check (coord_lat between -90 and 90),
  coord_lng double precision check (coord_lng between -180 and 180),
  coord_fetched_at timestamptz,
  suggested_stay_minutes integer not null check (suggested_stay_minutes between 5 and 600),
  availability jsonb not null default '[]',
  reservation_requirement public.reservation_requirement not null default 'none',
  reservation_note text check (char_length(reservation_note) between 1 and 200),
  constraint_class public.constraint_class not null default 'flexible',
  is_fixed boolean not null default false,
  priority integer not null check (priority between 1 and 5),
  weather_dependency public.level3 not null,
  candidate_role public.candidate_role not null default 'primary',
  recommendation_reason text not null check (char_length(recommendation_reason) between 1 and 300),
  constraint_note text check (char_length(constraint_note) between 1 and 300),
  score_personal_value smallint not null check (score_personal_value between 0 and 5),
  score_uniqueness smallint not null check (score_uniqueness between 0 and 5),
  score_geographic_fit smallint not null check (score_geographic_fit between 0 and 5),
  score_time_cost smallint not null check (score_time_cost between 0 and 5),
  score_transport_cost smallint not null check (score_transport_cost between 0 and 5),
  score_weather_dependency smallint not null check (score_weather_dependency between 0 and 5),
  score_time_slot_dependency smallint not null check (score_time_slot_dependency between 0 and 5),
  score_substitutability smallint not null check (score_substitutability between 0 and 5),
  scheduled_date date,
  scheduled_start time,
  scheduled_end time,
  movable_from time,
  movable_to time,
  verification_status public.verification_status not null default 'unverified',
  last_verified_at timestamptz,
  sources jsonb not null default '[]',
  generated_by jsonb,
  verified_by jsonb,
  lifecycle_status public.lifecycle_status not null default 'candidate',
  at_risk boolean not null default false,
  standby boolean not null default false,
  post_trip_status public.post_trip_status,
  estimated_cost_amount numeric(12, 2) check (estimated_cost_amount between 0 and 10000000),
  estimated_cost_currency char(3) check (estimated_cost_currency ~ '^[A-Z]{3}$'),
  actual_cost_amount numeric(12, 2) check (actual_cost_amount between 0 and 10000000),
  actual_cost_currency char(3) check (actual_cost_currency ~ '^[A-Z]{3}$'),
  payer_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index itinerary_items_trip_idx on public.itinerary_items (trip_id);

create table public.days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  date date not null,
  status public.day_status not null default 'draft',
  offline_pack_version integer not null default 0 check (offline_pack_version >= 0),
  created_at timestamptz not null default now(),
  unique (trip_id, date)
);

create table public.mobility_segments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  from_item_id uuid not null references public.itinerary_items (id) on delete cascade,
  to_item_id uuid not null references public.itinerary_items (id) on delete cascade,
  estimates jsonb not null default '[]',
  buffer_minutes integer not null check (buffer_minutes between 0 and 240),
  recommended_mode public.transport_mode,
  source_urls jsonb not null default '[]',
  maps_url text check (maps_url like 'https://%' and char_length(maps_url) <= 2048),
  created_at timestamptz not null default now()
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  proposer_member_id uuid references auth.users (id),
  proposer_role public.ai_role,
  proposer_provider public.ai_provider,
  proposer_model text check (char_length(proposer_model) between 1 and 100),
  base_version integer not null check (base_version >= 0),
  change jsonb not null,
  impact_scope jsonb not null,
  status public.proposal_status not null default 'pending',
  live_branch_id uuid,
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (proposer_member_id is not null or proposer_role is not null)
);
create index proposals_trip_idx on public.proposals (trip_id, status);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  major integer not null check (major between 1 and 1000),
  minor integer not null check (minor between 0 and 1000),
  kind public.version_kind not null,
  summary text not null check (char_length(summary) between 1 and 500),
  reason text check (char_length(reason) between 1 and 500),
  proposal_id uuid references public.proposals (id),
  approved_by uuid references auth.users (id),
  impact_scope jsonb not null,
  old_arrangement jsonb not null,
  new_arrangement jsonb not null,
  base_version integer not null check (base_version >= 0),
  created_at timestamptz not null default now(),
  unique (trip_id, major, minor)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  level public.incident_level not null,
  snapshot jsonb not null,
  available_minutes integer check (available_minutes between 0 and 1440),
  live_branch_id uuid not null default gen_random_uuid(),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.actual_timeline_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id) on delete cascade,
  arrived_at timestamptz,
  departed_at timestamptz,
  completion public.completion not null,
  recorded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (departed_at is null or arrived_at is null or departed_at >= arrived_at)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 50),
  ref_table text check (char_length(ref_table) between 1 and 50),
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  layer public.memory_layer not null,
  trip_id uuid references public.trips (id) on delete cascade,
  kind public.memory_kind not null,
  item text not null check (char_length(item) between 1 and 80),
  value text not null check (char_length(value) between 1 and 200),
  unit text check (char_length(unit) between 1 and 20),
  source public.memory_source not null,
  source_proposal_id uuid references public.proposals (id),
  approved_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  check ((layer = 'trip_context') = (trip_id is not null))
);

create table public.api_key_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider public.key_provider not null,
  vault_secret_id uuid not null,
  last4 char(4) not null,
  created_at timestamptz not null default now(),
  last_tested_at timestamptz,
  unique (owner_id, provider)
);

create table public.readonly_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 1 and 50),
  initiator_id uuid not null references auth.users (id) on delete cascade,
  trip_id uuid references public.trips (id) on delete cascade,
  status public.job_status not null default 'queued',
  workflow_run_id text check (char_length(workflow_run_id) between 1 and 100),
  steps_used integer not null default 0 check (steps_used >= 0),
  tokens_used integer not null default 0 check (tokens_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  item_id uuid not null references public.itinerary_items (id) on delete cascade,
  source public.photo_source not null,
  license text not null check (char_length(license) between 1 and 100),
  author text not null check (char_length(author) between 1 and 200),
  source_url text check (source_url like 'https://%' and char_length(source_url) <= 2048),
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- RLS ------------------------------------------------------------------
alter table public.trip_baselines enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.days enable row level security;
alter table public.mobility_segments enable row level security;
alter table public.proposals enable row level security;
alter table public.versions enable row level security;
alter table public.incidents enable row level security;
alter table public.actual_timeline_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.memories enable row level security;
alter table public.api_key_records enable row level security;
alter table public.readonly_links enable row level security;
alter table public.background_jobs enable row level security;
alter table public.photos enable row level security;

revoke all on public.trip_baselines, public.itinerary_items, public.days, public.mobility_segments,
  public.proposals, public.versions, public.incidents, public.actual_timeline_entries,
  public.notifications, public.memories, public.api_key_records, public.readonly_links,
  public.background_jobs, public.photos from anon, authenticated;

-- 檢視行程：所有成員可讀行程內容與 Change Log（versions）
create policy select_member on public.trip_baselines for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.itinerary_items for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.days for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.mobility_segments for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.proposals for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.versions for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.incidents for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.actual_timeline_entries for select to authenticated using (private.is_trip_member(trip_id));
create policy select_member on public.photos for select to authenticated using (private.is_trip_member(trip_id));
grant select on public.trip_baselines, public.itinerary_items, public.days, public.mobility_segments,
  public.proposals, public.versions, public.incidents, public.actual_timeline_entries, public.photos to authenticated;

-- 手動提出修改：Owner、Companion 以本人名義建立待批准提案；AI 提案由伺服器函式建立
create policy insert_editor on public.proposals for insert to authenticated
  with check (private.can_edit_trip(trip_id) and proposer_member_id = (select auth.uid())
    and proposer_role is null and status = 'pending' and decided_by is null and decided_at is null);
-- 觸發 Incident Mode：Owner、Companion
create policy insert_editor on public.incidents for insert to authenticated
  with check (private.can_edit_trip(trip_id) and created_by = (select auth.uid()));
-- 記錄活動完成：Owner、Companion
create policy insert_editor on public.actual_timeline_entries for insert to authenticated
  with check (private.can_edit_trip(trip_id) and recorded_by = (select auth.uid()));
-- 上傳照片：Owner、Companion
create policy insert_editor on public.photos for insert to authenticated
  with check (private.can_edit_trip(trip_id) and uploaded_by = (select auth.uid()));
grant insert on public.proposals, public.incidents, public.actual_timeline_entries, public.photos to authenticated;

-- 通知：只有收件者可讀，且只能標示已讀
create policy select_own on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy update_own on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- 記憶：只有擁有者可檢視、新增、修改、刪除（MEM-06）
create policy own_all on public.memories for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.memories to authenticated;

-- API key 紀錄：只有擁有者可檢視與刪除；新增由伺服器在 Vault 儲存成功後寫入（T12）
create policy own_select on public.api_key_records for select to authenticated using (owner_id = (select auth.uid()));
create policy own_delete on public.api_key_records for delete to authenticated using (owner_id = (select auth.uid()));
grant select, delete on public.api_key_records to authenticated;

-- 唯讀連結：建立、撤銷、檢視只限 Owner
create policy owner_select on public.readonly_links for select to authenticated using (private.is_trip_owner(trip_id));
create policy owner_insert on public.readonly_links for insert to authenticated
  with check (private.is_trip_owner(trip_id) and created_by = (select auth.uid()) and revoked_at is null);
create policy owner_revoke on public.readonly_links for update to authenticated
  using (private.is_trip_owner(trip_id)) with check (private.is_trip_owner(trip_id));
grant select, insert on public.readonly_links to authenticated;
grant update (revoked_at) on public.readonly_links to authenticated;

-- 背景 job：發起人本人可檢視；建立時發起人須為本人（C-12）
create policy own_select on public.background_jobs for select to authenticated using (initiator_id = (select auth.uid()));
create policy own_insert on public.background_jobs for insert to authenticated
  with check (initiator_id = (select auth.uid()) and (trip_id is null or private.can_edit_trip(trip_id)));
grant select, insert on public.background_jobs to authenticated;
