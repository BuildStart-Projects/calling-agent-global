-- Phase 2: blueprint, knowledge, documents, orchestrator, booking availability, prompt templates & catalogs.

-- ───────────────────────────── Blueprint & channel configs ─────────────────────────────
create table public.agent_blueprints (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  field_meta jsonb not null default '{}'::jsonb,   -- { "business.name": {source, locked, updated_at} }
  readiness int not null default 0 check (readiness between 0 and 100),
  version int not null default 0,
  pending_compile boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.agent_blueprints enable row level security;

create table public.agent_blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,           -- {blueprint, catalog, faqs, availability}
  change_summary text,
  changed_by text not null check (changed_by in ('orchestrator','user','system')),
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);
alter table public.agent_blueprint_versions enable row level security;

create table public.channel_configs (
  agent_id uuid not null references public.agents(id) on delete cascade,
  channel text not null check (channel in ('calling','messaging')),
  language text not null default 'en-US',
  adapt_language boolean not null default true,
  voice_name text,
  persona_style text not null default 'friendly' check (persona_style in ('friendly','professional','energetic','reassuring')),
  greeting text,
  missed_call_message text,
  callback_greeting text,
  welcome_message text,
  emoji_level text not null default 'light' check (emoji_level in ('none','light','expressive')),
  off_topic_reply text,
  handoff_caller_line text,
  custom_instructions text check (char_length(custom_instructions) <= 2000),
  synced_from_calling boolean not null default false,
  compiled_prompt text,                -- hidden from members (column privilege)
  compiled_hash text,
  template_version int,
  compiled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (agent_id, channel)
);
alter table public.channel_configs enable row level security;

-- ───────────────────────────── Knowledge ─────────────────────────────
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  kind text not null check (kind in ('service','product')),
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 2000),
  price_minor bigint check (price_minor >= 0),
  price_from boolean not null default false,
  currency text,
  duration_minutes int check (duration_minutes between 1 and 1440),
  variants jsonb not null default '[]'::jsonb,
  image_paths text[] not null default '{}',
  active boolean not null default true,
  in_calling boolean not null default true,
  in_messaging boolean not null default true,
  source text not null default 'user' check (source in ('ai','user','document')),
  locked boolean not null default false,
  sort int not null default 0,
  ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, ref)
);
alter table public.catalog_items enable row level security;
create index on public.catalog_items (agent_id, sort);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) between 1 and 3000),
  in_calling boolean not null default true,
  in_messaging boolean not null default true,
  source text not null default 'user' check (source in ('ai','user','document')),
  locked boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.faqs enable row level security;
create index on public.faqs (agent_id, sort);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime text not null,
  size_bytes bigint not null default 0,
  pages int,
  status text not null default 'uploaded' check (status in ('uploaded','extracting','ready','failed')),
  raw_text text,
  digest jsonb,
  digest_summary text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.documents enable row level security;
create index on public.documents (agent_id, created_at desc);

-- ───────────────────────────── Orchestrator ─────────────────────────────
create table public.orchestrator_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  mode text not null check (mode in ('onboarding','knowledge','campaign_script')),
  campaign_id uuid,
  status text not null default 'active' check (status in ('active','completed')),
  questions_asked int not null default 0,
  max_questions int not null default 5,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.orchestrator_sessions enable row level security;
create index on public.orchestrator_sessions (agent_id, mode, created_at desc);

create table public.orchestrator_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.orchestrator_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system_note')),
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  suggestions jsonb not null default '[]'::jsonb,
  events jsonb not null default '[]'::jsonb,
  question_index int,
  refused boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.orchestrator_messages enable row level security;
create index on public.orchestrator_messages (session_id, created_at);

-- ───────────────────────────── Booking availability (filled by the Orchestrator) ─────────────────────────────
create table public.booking_settings (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  timezone text not null default 'UTC',
  slot_interval_minutes int not null default 30 check (slot_interval_minutes in (15,30,60)),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 240),
  capacity int not null default 1 check (capacity between 1 and 100),
  min_notice_minutes int not null default 120 check (min_notice_minutes >= 0),
  max_days_ahead int not null default 30 check (max_days_ahead between 1 and 365),
  auto_confirm boolean not null default true,
  default_duration_minutes int not null default 30 check (default_duration_minutes between 5 and 1440),
  updated_at timestamptz not null default now()
);
alter table public.booking_settings enable row level security;

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  source text not null default 'user' check (source in ('ai','user','document')),
  check (end_time > start_time)
);
alter table public.availability_rules enable row level security;
create index on public.availability_rules (agent_id, weekday);

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  date date not null,
  closed boolean not null default true,
  start_time time,
  end_time time,
  note text,
  unique (agent_id, date)
);
alter table public.availability_exceptions enable row level security;

-- ───────────────────────────── Prompt templates & catalogs ─────────────────────────────
create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version int not null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (key, version)
);
alter table public.prompt_templates enable row level security;
create unique index prompt_templates_one_active on public.prompt_templates (key) where active;

create table public.industry_playbooks (
  key text primary key,
  label text not null,
  match_keywords text[] not null default '{}',
  defaults jsonb not null default '{}'::jsonb,
  campaign_defaults jsonb not null default '{}'::jsonb,
  template_key text not null,
  active boolean not null default true
);
alter table public.industry_playbooks enable row level security;

create table public.voices (
  name text primary key,
  display_name text not null,
  descriptor text not null,
  tags text[] not null default '{}',
  active boolean not null default true,
  sort int not null default 0
);
alter table public.voices enable row level security;

create table public.languages (
  code text primary key,
  label text not null,
  native_label text not null,
  live_supported boolean not null default true,
  active boolean not null default true,
  sort int not null default 100
);
alter table public.languages enable row level security;

-- ───────────────────────────── Triggers ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['agent_blueprints','channel_configs','catalog_items','faqs','booking_settings'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- New agents get an empty blueprint + both channel configs (language from workspace locale).
create or replace function public.init_agent_children()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws public.workspaces;
begin
  select * into ws from public.workspaces where id = new.workspace_id;
  insert into public.agent_blueprints (agent_id, data) values (new.id, jsonb_build_object('business', jsonb_build_object('timezone', ws.timezone, 'currency', ws.currency)));
  insert into public.channel_configs (agent_id, channel, language) values (new.id, 'calling', ws.locale), (new.id, 'messaging', ws.locale);
  if new.type = 'booking' then
    insert into public.booking_settings (agent_id, timezone) values (new.id, ws.timezone);
  end if;
  return new;
end $$;
create trigger trg_agents_init after insert on public.agents for each row execute function public.init_agent_children();

-- Member edits to knowledge lock the item (Orchestrator won't overwrite) and mark the agent for recompilation.
create or replace function public.mark_user_edit()
returns trigger language plpgsql as $$
declare
  ignore text[] := array['in_calling','in_messaging','sort','active','updated_at','locked','source','created_at'];
  content_changed boolean;
begin
  content_changed := tg_op = 'INSERT'
    or (to_jsonb(new) - ignore) is distinct from (to_jsonb(old) - ignore);
  if content_changed and coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role' = 'authenticated' then
    new.source := 'user';
    new.locked := true;
  end if;
  update public.agent_blueprints set pending_compile = true where agent_id = new.agent_id;
  return new;
end $$;
create trigger trg_catalog_user_edit before insert or update on public.catalog_items for each row execute function public.mark_user_edit();
create trigger trg_faqs_user_edit before insert or update on public.faqs for each row execute function public.mark_user_edit();

-- Short, stable refs for catalog items (used in prompts instead of UUIDs).
create or replace function public.assign_catalog_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null or new.ref = '' then
    new.ref := (case when new.kind = 'service' then 's' else 'p' end) ||
               (select coalesce(max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int), 0) + 1 from public.catalog_items where agent_id = new.agent_id);
  end if;
  return new;
end $$;
create trigger trg_catalog_ref before insert on public.catalog_items for each row execute function public.assign_catalog_ref();

-- ───────────────────────────── RLS ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['agent_blueprints','agent_blueprint_versions','channel_configs','catalog_items','faqs','documents',
                           'orchestrator_sessions','booking_settings','availability_rules','availability_exceptions'] loop
    execute format('create policy "members read" on public.%I for select using (public.is_member(public.agent_workspace(agent_id)) or public.is_platform_admin())', t);
  end loop;
end $$;

create policy "members read" on public.orchestrator_messages for select using (
  exists (select 1 from public.orchestrator_sessions s where s.id = session_id and public.is_member(public.agent_workspace(s.agent_id)))
  or public.is_platform_admin()
);

-- Members can directly edit knowledge (inline editing in the blueprint panel).
do $$
declare t text;
begin
  foreach t in array array['catalog_items','faqs','availability_rules','availability_exceptions'] loop
    execute format('create policy "members write" on public.%I for insert with check (public.is_member(public.agent_workspace(agent_id)))', t);
    execute format('create policy "members update" on public.%I for update using (public.is_member(public.agent_workspace(agent_id))) with check (public.is_member(public.agent_workspace(agent_id)))', t);
    execute format('create policy "members delete" on public.%I for delete using (public.is_member(public.agent_workspace(agent_id)))', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
create policy "members update" on public.booking_settings for update using (public.is_member(public.agent_workspace(agent_id))) with check (public.is_member(public.agent_workspace(agent_id)));
grant update (timezone, slot_interval_minutes, buffer_minutes, capacity, min_notice_minutes, max_days_ahead, auto_confirm, default_duration_minutes) on public.booking_settings to authenticated;
create policy "members update" on public.channel_configs for update using (public.is_member(public.agent_workspace(agent_id))) with check (public.is_member(public.agent_workspace(agent_id)));
grant update (language, adapt_language, voice_name, persona_style, greeting, missed_call_message, callback_greeting, welcome_message, emoji_level, custom_instructions, synced_from_calling) on public.channel_configs to authenticated;

-- compiled_prompt is internal: hide the column from members.
revoke select on public.channel_configs from authenticated, anon;
grant select (agent_id, channel, language, adapt_language, voice_name, persona_style, greeting, missed_call_message, callback_greeting,
              welcome_message, emoji_level, off_topic_reply, handoff_caller_line, custom_instructions, synced_from_calling,
              compiled_hash, template_version, compiled_at, updated_at) on public.channel_configs to authenticated;

-- Catalogs readable by everyone signed in (voice/language pickers); templates admin-only.
create policy "read active" on public.voices for select using (active or public.is_platform_admin());
create policy "read active" on public.languages for select using (active or public.is_platform_admin());
create policy "read active" on public.industry_playbooks for select using (active or public.is_platform_admin());
create policy "admin only" on public.prompt_templates for select using (public.is_platform_admin());

-- Agent handoff phone is set through a validating function (must differ from the agent's WhatsApp number).
create or replace function public.set_handoff_phone(p_agent uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.agents; digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into a from public.agents where id = p_agent;
  if a.id is null or not public.is_member(a.workspace_id) then raise exception 'not_found'; end if;
  if p_phone is null or p_phone = '' then
    update public.agents set handoff_phone_e164 = null, handoff_verified_at = null where id = p_agent; return;
  end if;
  if length(digits) < 8 or length(digits) > 15 then raise exception 'invalid_phone'; end if;
  if a.wa_phone is not null and regexp_replace(a.wa_phone, '\D', '', 'g') = digits then raise exception 'same_as_agent_number'; end if;
  update public.agents set handoff_phone_e164 = '+' || digits, handoff_verified_at = null where id = p_agent;
end $$;
grant execute on function public.set_handoff_phone to authenticated;
