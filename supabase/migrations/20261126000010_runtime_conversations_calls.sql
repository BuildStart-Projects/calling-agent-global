-- Phases 3–5: voice previews cache, contacts, conversations/messages, inbound queue, calls, leads, DNC, notifications, engine events.

create table public.voice_preview_cache (
  hash text primary key,
  storage_path text not null,
  voice text not null,
  language text not null,
  created_at timestamptz not null default now()
);
alter table public.voice_preview_cache enable row level security;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone_e164 text,
  wa_jid text,
  name text,
  push_name text,
  tags text[] not null default '{}',
  notes text,
  source text not null default 'inbound' check (source in ('inbound','campaign_import','manual','playground')),
  do_not_contact boolean not null default false,
  dnc_reason text,
  dnc_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.contacts enable row level security;
create unique index contacts_ws_phone on public.contacts (workspace_id, phone_e164) where phone_e164 is not null;
create unique index contacts_ws_jid on public.contacts (workspace_id, wa_jid) where phone_e164 is null and wa_jid is not null;

create table public.dnc_list (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone_e164 text not null,
  reason text not null check (reason in ('requested_on_call','replied_stop','manual','import')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, phone_e164)
);
alter table public.dnc_list enable row level security;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  ai_paused boolean not null default false,
  paused_by text check (paused_by in ('owner_phone','inbox','handoff')),
  paused_until timestamptz,
  needs_attention boolean not null default false,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  unread_count int not null default 0,
  summary text,
  summary_message_count int not null default 0,
  welcomed boolean not null default false,
  is_test boolean not null default false,
  campaign_id uuid,
  created_at timestamptz not null default now(),
  unique (agent_id, contact_id)
);
alter table public.conversations enable row level security;
create index on public.conversations (agent_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender text not null check (sender in ('customer','ai','human','owner_phone','system')),
  type text not null default 'text',
  text text,
  media_path text,
  media_mime text,
  wa_message_id text unique,
  status text not null default 'sent' check (status in ('queued','sent','failed','received')),
  refusal boolean not null default false,
  validation_flags jsonb not null default '[]'::jsonb,
  tool_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index on public.messages (conversation_id, created_at);

create table public.inbound_queue (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','done','failed','dead','skipped')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
alter table public.inbound_queue enable row level security;
create index on public.inbound_queue (status, available_at);
create index on public.inbound_queue (conversation_id, status);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  intent text not null,
  summary text,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','contacted','qualified','won','lost')),
  urgency text not null default 'normal' check (urgency in ('low','normal','high')),
  source text not null check (source in ('call','whatsapp','manual','playground','campaign')),
  campaign_id uuid,
  is_test boolean not null default false,
  contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.leads enable row level security;
create index on public.leads (workspace_id, created_at desc);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  engine_call_id text not null unique,
  contact_id uuid references public.contacts(id) on delete set null,
  direction text not null check (direction in ('inbound','outbound','auto-callback')),
  campaign_id uuid,
  campaign_target_id uuid,
  caller_number text,
  started_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  duration_seconds int not null default 0,
  outcome text not null default 'answered' check (outcome in ('booked','ordered','lead','answered','missed','handoff','unanswered','agent_disabled')),
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  recording_key text,
  tool_invocations jsonb not null default '[]'::jsonb,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.calls enable row level security;
create index on public.calls (workspace_id, started_at desc);

create table public.engine_events (
  event_id text primary key,
  event text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.engine_events enable row level security;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index on public.notifications (workspace_id, created_at desc);

create table public.handoff_alerts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  channel text not null,
  reason text,
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.handoff_alerts enable row level security;

-- ── Queue claim: one conversation at a time, oldest first (per-conversation lock) ──
create or replace function public.claim_inbound(p_limit int default 5)
returns table (conversation_id uuid, agent_id uuid, queue_ids uuid[])
language plpgsql security definer set search_path = public as $$
begin
  update public.inbound_queue set status = 'pending', locked_at = null
  where status = 'processing' and locked_at < now() - interval '2 minutes';

  return query
  with due as (
    select distinct on (q.conversation_id) q.conversation_id, q.agent_id
    from public.inbound_queue q
    where q.status = 'pending' and q.available_at <= now()
      and not exists (select 1 from public.inbound_queue p where p.conversation_id = q.conversation_id and p.status = 'processing')
      and not exists (select 1 from public.inbound_queue n where n.conversation_id = q.conversation_id and n.status = 'pending' and n.available_at > now())
    order by q.conversation_id, q.created_at
    limit p_limit
  ),
  claimed as (
    update public.inbound_queue q set status = 'processing', locked_at = now(), attempts = q.attempts + 1
    from due where q.conversation_id = due.conversation_id and q.status = 'pending' and q.available_at <= now()
    returning q.id, q.conversation_id, q.agent_id
  )
  select c.conversation_id, min(c.agent_id::text)::uuid, array_agg(c.id) from claimed c group by c.conversation_id;
end $$;
revoke execute on function public.claim_inbound from public, anon, authenticated;

-- ── RLS ──
do $$
declare t text;
begin
  foreach t in array array['contacts','dnc_list','notifications','leads','calls'] loop
    execute format('create policy "members read" on public.%I for select using (public.is_member(workspace_id) or public.is_platform_admin())', t);
  end loop;
  foreach t in array array['conversations','handoff_alerts'] loop
    execute format('create policy "members read" on public.%I for select using (public.is_member(public.agent_workspace(agent_id)) or public.is_platform_admin())', t);
  end loop;
end $$;
create policy "members read" on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and public.is_member(public.agent_workspace(c.agent_id)))
);
create policy "members update" on public.conversations for update using (public.is_member(public.agent_workspace(agent_id))) with check (public.is_member(public.agent_workspace(agent_id)));
grant update (ai_paused, paused_by, paused_until, needs_attention, unread_count) on public.conversations to authenticated;
create policy "members update" on public.contacts for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
grant update (name, tags, notes, do_not_contact) on public.contacts to authenticated;
create policy "members update" on public.leads for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
grant update (status, contacted_at) on public.leads to authenticated;
create policy "members update" on public.notifications for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
grant update (read_at) on public.notifications to authenticated;

-- Agent pause/resume through a function (also pushes engine flags via agent-compile).
grant update (status, pause_reason) on public.agents to authenticated;

-- Realtime for live inbox / calls / notifications.
do $$ begin
  begin execute 'alter publication supabase_realtime add table public.messages, public.conversations, public.calls, public.notifications, public.agents'; exception when others then null; end;
end $$;
