-- T14：每位使用者的角色模型與備援次序設定（D06、C-08、S-06），以及 AI 用量紀錄（S-06）
-- 沒有儲存的角色使用決策 0006 的預設值（由應用程式補上）

create table public.ai_role_settings (
  owner_id uuid not null references auth.users (id) on delete cascade,
  role public.ai_role not null,
  chain jsonb not null check (jsonb_typeof(chain) = 'array' and jsonb_array_length(chain) between 1 and 3),
  max_steps integer not null check (max_steps between 1 and 100),
  max_tokens integer not null check (max_tokens between 1000 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, role)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.background_jobs (id) on delete set null,
  role public.ai_role not null,
  provider public.ai_provider not null,
  model text not null check (char_length(model) between 1 and 100),
  steps integer not null check (steps between 0 and 100),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  outcome text not null check (outcome in ('completed', 'output_invalid', 'limit_reached', 'provider_failed')),
  created_at timestamptz not null default now()
);

create index ai_usage_owner_created on public.ai_usage (owner_id, created_at desc);

alter table public.ai_role_settings enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_role_settings, public.ai_usage from anon, authenticated;

-- 設定：只限本人
create policy own_select on public.ai_role_settings for select to authenticated using (owner_id = (select auth.uid()));
create policy own_insert on public.ai_role_settings for insert to authenticated with check (owner_id = (select auth.uid()));
create policy own_update on public.ai_role_settings for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy own_delete on public.ai_role_settings for delete to authenticated using (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.ai_role_settings to authenticated;

-- 用量：本人可讀與新增，紀錄不可修改或刪除
create policy own_select on public.ai_usage for select to authenticated using (owner_id = (select auth.uid()));
create policy own_insert on public.ai_usage for insert to authenticated with check (owner_id = (select auth.uid()));
grant select, insert on public.ai_usage to authenticated;
