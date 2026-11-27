-- Phase 7: outbound call campaigns + scheduled background jobs.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  goal_type text not null default 'custom' check (goal_type in ('lead_follow_up','missed_callers','booking_confirmation','promotion','reactivation','feedback','custom')),
  script jsonb not null default '{}'::jsonb,         -- purpose, key_points[], offer, offer_validity, questions_to_ask[], success_definition, collect_fields[]
  opening_line text,
  status text not null default 'draft' check (status in ('draft','scheduled','running','paused','completed','cancelled')),
  pause_reason text check (pause_reason in ('user','no_credits','agent_offline','failure_rate','admin')),
  schedule jsonb not null default '{}'::jsonb,
  consent_attested_at timestamptz,
  consent_attested_by uuid references auth.users(id),
  source_summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  launched_at timestamptz,
  last_dial_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
create index on public.campaigns (workspace_id, created_at desc);
create trigger trg_campaigns_updated before update on public.campaigns for each row execute function public.touch_updated_at();

create table public.campaign_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  phone_e164 text not null,
  name text,
  local_tz text,
  variables jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','notified','calling','answered','no_answer','busy','failed','skipped_dnc','skipped_invalid','opted_out','completed','cancelled')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_call_id text,
  outcome text check (outcome in ('booked','ordered','interested','not_interested','callback_requested','wrong_number','do_not_call','unknown')),
  outcome_summary text,
  callback_at timestamptz,
  pre_call_sent_at timestamptz,
  last_attempt_at timestamptz,
  final_message_sent boolean not null default false,
  locked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (campaign_id, phone_e164)
);
alter table public.campaign_targets enable row level security;
create index on public.campaign_targets (campaign_id, status, next_attempt_at);
create trigger trg_targets_updated before update on public.campaign_targets for each row execute function public.touch_updated_at();

create view public.campaign_stats with (security_invoker = true) as
select c.id as campaign_id,
  count(t.*) as total,
  count(t.*) filter (where t.attempts > 0) as called,
  count(t.*) filter (where t.status in ('answered','completed')) as answered,
  count(t.*) filter (where t.outcome in ('booked','ordered','interested')) as converted,
  count(t.*) filter (where t.status in ('queued','notified') ) as remaining,
  count(t.*) filter (where t.status = 'calling') as calling,
  count(t.*) filter (where t.status in ('no_answer','busy')) as unanswered,
  count(t.*) filter (where t.status in ('opted_out','skipped_dnc') or t.outcome = 'do_not_call') as opted_out,
  count(t.*) filter (where t.status in ('failed','skipped_invalid')) as failed
from public.campaigns c left join public.campaign_targets t on t.campaign_id = c.id
group by c.id;

-- ── RLS ──
create policy "members read" on public.campaigns for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members read" on public.campaign_targets for select using (exists (select 1 from public.campaigns c where c.id = campaign_id and (public.is_member(c.workspace_id) or public.is_platform_admin())));
grant select on public.campaign_stats to authenticated;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.campaigns, public.campaign_targets'; exception when others then null; end;
end $$;

-- ── Background jobs (pg_cron + pg_net). URL and secret live in Vault (set once per environment, never in git). ──
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_edge(fn text, body jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare base text; secret text;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'edge_base_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret';
  if base is null or secret is null then return; end if;   -- not configured in this environment
  perform net.http_post(url := base || '/functions/v1/' || fn, body := body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret), timeout_milliseconds := 55000);
end $$;
revoke execute on function public.invoke_edge from public, anon, authenticated;

select cron.schedule('bs-campaign-dispatcher', '* * * * *', $$select public.invoke_edge('campaign-dispatcher')$$);
select cron.schedule('bs-messaging-worker', '* * * * *', $$select public.invoke_edge('messaging-worker')$$);
select cron.schedule('bs-compile-sweep', '*/5 * * * *', $$select public.invoke_edge('agent-compile', '{"sweep": true}'::jsonb)$$);
select cron.schedule('bs-credit-cycles', '7 * * * *', $$select public.run_free_plan_cycles(); select public.expire_lots();$$);

insert into public.prompt_templates (key, version, active, body) values
('calling.outbound', 1, true, $T$[CALL PURPOSE]
You are calling {{contact_name_or_customer}} on behalf of {{business_name}}.
Purpose: {{purpose}}
{{#key_points}}Key points (mention naturally, one at a time, only if relevant):
{{key_points}}{{/key_points}}
{{#offer}}Offer: {{offer}}{{#offer_validity}} (valid {{offer_validity}}){{/offer_validity}}. Do not change or extend it.{{/offer}}
{{#questions}}Questions to ask: {{questions}}{{/questions}}
Success means: {{success_definition}}.{{#collect}} Collect: {{collect}}.{{/collect}}
{{#contact_vars}}What we know about this customer: {{contact_vars}}{{/contact_vars}}

OUTBOUND ETIQUETTE
1. After your opening line, ask if it's a good time. If not, ask when to call back, call record_campaign_outcome (outcome "callback_requested", callback_at_iso), thank them and end the call.
2. Keep it short and respectful. If they're not interested, thank them, record "not_interested", end.
3. If it's a wrong number, apologise, record "wrong_number", end.
4. If they ask not to be called again, apologise, call mark_do_not_contact, record "do_not_call", end.
5. If they ask for a person, use handoff_to_human as usual.
6. Before ending any call, call record_campaign_outcome exactly once with the best outcome:
   booked | ordered | interested | not_interested | callback_requested | wrong_number | do_not_call | unknown.
[END CALL PURPOSE]$T$),
('campaign.script_writer', 1, true, $T$You help a {{industry}} business called {{business_name}} write a short outbound phone campaign.
The owner's request: "{{brief}}"
Campaign goal type: {{goal_type}}. The calls are made by an AI assistant in {{language_name}}.
Return ONLY JSON:
{ "name": "short campaign name (max 40 chars)",
  "purpose": "one sentence",
  "key_points": ["max 4 short points"],
  "offer": "only if the owner stated an offer, else null",
  "offer_validity": "only if stated, else null",
  "questions_to_ask": ["max 3"],
  "success_definition": "what counts as success",
  "collect_fields": ["details to collect"],
  "opening_line": "max 25 words in {{language_name}}; may use {{first_name}}; mention {{business_name}}; say you are its AI assistant; end by asking if it's a good time" }
Never invent discounts, prices, dates or deadlines that the owner did not state.$T$);
