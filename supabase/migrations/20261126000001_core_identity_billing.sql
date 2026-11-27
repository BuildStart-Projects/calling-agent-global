-- BuildStart Global — Phase 1 core: identity, tenancy, plans, credits (lots + ledger), agents (base).
-- Conventions: money = bigint minor units; credits = numeric(14,4); every table has RLS.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────── Platform admins & helpers ─────────────────────────────
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- ───────────────────────────── Plans & top-up packs ─────────────────────────────
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  tagline text,
  price_minor bigint not null default 0 check (price_minor >= 0),
  currency text not null default 'USD',
  interval text not null default 'month' check (interval in ('month')),
  monthly_credits numeric(14,4) not null check (monthly_credits >= 0),
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '[]'::jsonb,
  badge text,
  cta_label text,
  active boolean not null default true,
  sort int not null default 0,
  stripe_product_id text,
  stripe_price_id text,
  archived_price_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plans enable row level security;

create table public.topup_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credits numeric(14,4) not null check (credits > 0),
  price_minor bigint not null check (price_minor > 0),
  currency text not null default 'USD',
  validity_days int not null default 365 check (validity_days > 0),
  badge text,
  active boolean not null default true,
  sort int not null default 0,
  stripe_product_id text,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.topup_packs enable row level security;

-- ───────────────────────────── Identity & tenancy ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  theme_pref text not null default 'system' check (theme_pref in ('light','dark','system')),
  onboarding_state jsonb not null default '{}'::jsonb,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  country text,
  timezone text not null default 'UTC',
  currency text not null default 'USD',
  locale text not null default 'en-US',
  status text not null default 'active' check (status in ('active','suspended')),
  stripe_customer_id text unique,
  notify_email text,
  plan_id uuid references public.plans(id),
  plan_period_start timestamptz,
  plan_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
create index on public.workspaces (owner_id);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
alter table public.workspace_members enable row level security;
create index on public.workspace_members (user_id);

create or replace function public.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_owner_or_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin'));
$$;

-- ───────────────────────────── Platform settings ─────────────────────────────
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;

create or replace function public.setting(k text, fallback jsonb default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.platform_settings where key = k), fallback);
$$;

-- ───────────────────────────── Credits ─────────────────────────────
create table public.credit_rules (               -- 🔒 admin only
  id uuid primary key default gen_random_uuid(),
  meter text not null,
  unit text not null check (unit in ('per_1m_input_tokens','per_1m_output_tokens','per_minute','per_unit')),
  credits numeric(14,6) not null check (credits >= 0),
  rounding text not null default 'exact' check (rounding in ('exact','ceil_second','ceil_minute')),
  effective_from timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.credit_rules enable row level security;
create index on public.credit_rules (meter, unit, effective_from desc);

create table public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('plan','topup','bonus','adjustment','debt')),
  granted numeric(14,4) not null,
  remaining numeric(14,4) not null,
  expires_at timestamptz,
  source_ref text,
  created_at timestamptz not null default now()
);
alter table public.credit_lots enable row level security;
create index on public.credit_lots (workspace_id, expires_at);

create table public.usage_events (               -- 🔒 admin only (members see aggregates via views)
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid,
  agent_kind text not null check (agent_kind in ('orchestrator','calling','messaging')),
  meter text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  seconds numeric(12,3) not null default 0,
  units numeric(12,3) not null default 0,
  model text,
  credits numeric(14,4) not null default 0,
  rule_snapshot jsonb not null default '{}'::jsonb,
  estimated boolean not null default false,
  ref_type text,
  ref_id text,
  campaign_id uuid,
  created_at timestamptz not null default now()
);
alter table public.usage_events enable row level security;
create index on public.usage_events (workspace_id, created_at desc);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lot_id uuid references public.credit_lots(id) on delete set null,
  delta numeric(14,4) not null,
  reason text not null check (reason in ('plan_grant','plan_expiry','topup','topup_expiry','bonus','usage','admin_adjust','refund_clawback','debt_settled')),
  usage_event_id uuid references public.usage_events(id) on delete set null,
  agent_kind text,
  balance_after numeric(14,4) not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.credit_ledger enable row level security;
create index on public.credit_ledger (workspace_id, created_at desc);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  stripe_subscription_id text unique,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  pending_plan_id uuid references public.plans(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('subscription','topup')),
  plan_id uuid references public.plans(id),
  topup_pack_id uuid references public.topup_packs(id),
  stripe_invoice_id text unique,
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  amount_minor bigint not null,
  currency text not null,
  status text not null check (status in ('paid','refunded','partially_refunded','disputed')),
  credits_granted numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;

create table public.stripe_events (              -- 🔒
  id text primary key,
  type text not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

create table public.provider_costs (             -- 🔒
  meter text primary key,
  cost_per_unit_usd numeric(14,8) not null,
  unit text not null,
  updated_at timestamptz not null default now()
);
alter table public.provider_costs enable row level security;

create table public.admin_audit_log (            -- 🔒
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id),
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;

-- ───────────────────────────── Agents (base; extended in later phases) ─────────────────────────────
create table public.agents (
  id uuid primary key default gen_random_uuid(),           -- = engine business_id
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  type text not null check (type in ('booking','inquiry','order')),
  status text not null default 'draft' check (status in ('draft','ready','live','paused')),
  pause_reason text check (pause_reason in ('user','no_credits','admin')),
  industry_key text,
  calling_enabled boolean not null default true,
  messaging_enabled boolean not null default true,
  handoff_phone_e164 text,
  handoff_verified_at timestamptz,
  engine_session_id text,
  wa_jid text,
  wa_phone text,
  wa_status text not null default 'not_connected' check (wa_status in ('not_connected','qr','connected','logged_out')),
  wa_connected_at timestamptz,
  engine_synced_at timestamptz,
  engine_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agents enable row level security;
create index on public.agents (workspace_id);

create or replace function public.agent_workspace(a uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from public.agents where id = a;
$$;

-- ───────────────────────────── updated_at trigger ─────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['plans','topup_packs','profiles','workspaces','subscriptions','agents'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
