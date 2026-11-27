-- Phase 9: superadmin read APIs. All gated on platform admin + MFA (aal2). Writes go through the admin-api Edge Function (audited).

create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then raise exception 'mfa_required' using errcode = '42501'; end if;
end $$;

-- Provider cost estimates (USD) used only for margin reporting. Keys: <meter> (per minute / unit) or <meter>:in / <meter>:out (per 1M tokens).
insert into public.provider_costs (meter, cost_per_unit_usd, unit) values
  ('call_minutes', 0.0300, 'per_minute'),
  ('campaign_call_minutes', 0.0300, 'per_minute'),
  ('messaging_tokens:in', 0.50, 'per_1m_input_tokens'), ('messaging_tokens:out', 3.00, 'per_1m_output_tokens'),
  ('playground_tokens:in', 0.50, 'per_1m_input_tokens'), ('playground_tokens:out', 3.00, 'per_1m_output_tokens'),
  ('orchestrator_tokens:in', 0.50, 'per_1m_input_tokens'), ('orchestrator_tokens:out', 3.00, 'per_1m_output_tokens'),
  ('call_analysis_tokens:in', 0.50, 'per_1m_input_tokens'), ('call_analysis_tokens:out', 3.00, 'per_1m_output_tokens'),
  ('doc_extraction_tokens:in', 0.10, 'per_1m_input_tokens'), ('doc_extraction_tokens:out', 0.40, 'per_1m_output_tokens')
on conflict (meter) do nothing;

create or replace function public.usage_cost_usd(e public.usage_events)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select cost_per_unit_usd from public.provider_costs where meter = e.meter || ':in'), 0) * e.input_tokens / 1e6
       + coalesce((select cost_per_unit_usd from public.provider_costs where meter = e.meter || ':out'), 0) * e.output_tokens / 1e6
       + coalesce((select cost_per_unit_usd from public.provider_costs where meter = e.meter and unit = 'per_minute'), 0) * e.seconds / 60
       + coalesce((select cost_per_unit_usd from public.provider_costs where meter = e.meter and unit = 'per_unit'), 0) * e.units;
$$;
revoke execute on function public.usage_cost_usd from public, anon, authenticated;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - interval '30 days'; out jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'signups_30d', (select count(*) from public.profiles where created_at >= since),
    'workspaces', (select count(*) from public.workspaces),
    'paying', (select count(*) from public.workspaces w join public.plans p on p.id = w.plan_id where p.price_minor > 0 and w.status = 'active'),
    'mrr_minor', (select coalesce(sum(p.price_minor), 0) from public.workspaces w join public.plans p on p.id = w.plan_id where p.price_minor > 0 and w.status = 'active'),
    'revenue_30d_minor', (select coalesce(sum(amount_minor), 0) from public.payments where status in ('paid','partially_refunded') and created_at >= since),
    'topups_30d_minor', (select coalesce(sum(amount_minor), 0) from public.payments where kind = 'topup' and status in ('paid','partially_refunded') and created_at >= since),
    'credits_used_30d', (select coalesce(sum(credits), 0) from public.usage_events where created_at >= since),
    'cost_30d_usd', (select coalesce(sum(public.usage_cost_usd(u)), 0) from public.usage_events u where created_at >= since),
    'agents', (select count(*) from public.agents),
    'live_agents', (select count(*) from public.agents where status = 'live'),
    'connected_agents', (select count(*) from public.agents where wa_status = 'connected'),
    'calls_30d', (select count(*) from public.calls where created_at >= since),
    'call_minutes_30d', (select coalesce(round(sum(duration_seconds) / 60.0), 0) from public.calls where created_at >= since),
    'messages_30d', (select count(*) from public.messages where created_at >= since and sender = 'ai'),
    'campaigns_running', (select count(*) from public.campaigns where status = 'running'),
    'plans', (select coalesce(jsonb_agg(x order by x.sort), '[]'::jsonb) from (
        select p.key, p.name, p.sort, count(w.id) as workspaces from public.plans p left join public.workspaces w on w.plan_id = p.id group by p.id) x)
  ) into out;
  return out;
end $$;

create or replace function public.admin_daily(p_days int default 30)
returns table (day date, signups bigint, credits_used numeric, cost_usd numeric, revenue_minor bigint, calls bigint, ai_messages bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  with d as (select generate_series((now() at time zone 'UTC')::date - (least(p_days, 365) - 1), (now() at time zone 'UTC')::date, interval '1 day')::date as day)
  select d.day,
    (select count(*) from public.profiles p where (p.created_at at time zone 'UTC')::date = d.day),
    (select coalesce(sum(u.credits), 0) from public.usage_events u where (u.created_at at time zone 'UTC')::date = d.day),
    (select coalesce(round(sum(public.usage_cost_usd(u)), 4), 0) from public.usage_events u where (u.created_at at time zone 'UTC')::date = d.day),
    (select coalesce(sum(pm.amount_minor), 0)::bigint from public.payments pm where pm.status in ('paid','partially_refunded') and (pm.created_at at time zone 'UTC')::date = d.day),
    (select count(*) from public.calls c where (c.created_at at time zone 'UTC')::date = d.day),
    (select count(*) from public.messages m where m.sender = 'ai' and (m.created_at at time zone 'UTC')::date = d.day)
  from d order by d.day;
end $$;

create or replace function public.admin_usage_by_meter(p_days int default 30)
returns table (meter text, agent_kind text, events bigint, credits numeric, input_tokens numeric, output_tokens numeric, minutes numeric, cost_usd numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select u.meter, u.agent_kind, count(*), coalesce(sum(u.credits), 0), sum(u.input_tokens)::numeric, sum(u.output_tokens)::numeric, round(sum(u.seconds) / 60, 1), round(sum(public.usage_cost_usd(u)), 4)
  from public.usage_events u where u.created_at >= now() - make_interval(days => least(p_days, 365))
  group by u.meter, u.agent_kind order by 4 desc;
end $$;

create or replace function public.admin_workspaces(p_q text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, name text, owner_email text, plan_key text, status text, country text, balance numeric, agents bigint, credits_30d numeric, paid_total_minor bigint, created_at timestamptz, last_active timestamptz, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  with base as (
    select w.*, u.email::text as email, p.key as pkey from public.workspaces w
    join auth.users u on u.id = w.owner_id left join public.plans p on p.id = w.plan_id
    where p_q is null or p_q = '' or w.name ilike '%' || p_q || '%' or u.email ilike '%' || p_q || '%' or w.id::text = p_q
  )
  select b.id, b.name, b.email, b.pkey, b.status, b.country,
    (select coalesce(sum(l.remaining), 0) from public.credit_lots l where l.workspace_id = b.id and (l.expires_at is null or l.expires_at > now())),
    (select count(*) from public.agents a where a.workspace_id = b.id),
    (select coalesce(sum(e.credits), 0) from public.usage_events e where e.workspace_id = b.id and e.created_at >= now() - interval '30 days'),
    (select coalesce(sum(pm.amount_minor), 0)::bigint from public.payments pm where pm.workspace_id = b.id and pm.status in ('paid','partially_refunded')),
    b.created_at,
    (select max(e.created_at) from public.usage_events e where e.workspace_id = b.id),
    count(*) over ()
  from base b order by b.created_at desc limit least(p_limit, 200) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_workspace_detail(ws uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object(
    'workspace', to_jsonb(w) - 'stripe_customer_id' || jsonb_build_object('has_stripe', w.stripe_customer_id is not null),
    'plan', (select to_jsonb(p) from public.plans p where p.id = w.plan_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'email', u.email, 'name', pr.full_name, 'last_sign_in_at', u.last_sign_in_at)), '[]') from public.workspace_members m join auth.users u on u.id = m.user_id left join public.profiles pr on pr.id = m.user_id where m.workspace_id = ws),
    'agents', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'status', a.status, 'wa_status', a.wa_status, 'wa_phone', a.wa_phone, 'created_at', a.created_at) order by a.created_at), '[]') from public.agents a where a.workspace_id = ws),
    'lots', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]') from (select * from public.credit_lots where workspace_id = ws order by created_at desc limit 30) l),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]') from (select id, delta, reason, agent_kind, balance_after, note, created_at from public.credit_ledger where workspace_id = ws order by created_at desc limit 50) x),
    'usage_by_kind_30d', (select coalesce(jsonb_object_agg(k, c), '{}') from (select agent_kind k, round(sum(credits), 2) c from public.usage_events where workspace_id = ws and created_at >= now() - interval '30 days' group by 1) z),
    'payments', (select coalesce(jsonb_agg(to_jsonb(pm) order by pm.created_at desc), '[]') from (select id, kind, amount_minor, currency, status, credits_granted, created_at from public.payments where workspace_id = ws order by created_at desc limit 30) pm)
  ) into out from public.workspaces w where w.id = ws;
  return out;
end $$;

create or replace function public.admin_agents(p_q text default null, p_limit int default 100)
returns table (id uuid, name text, type text, status text, wa_status text, wa_phone text, workspace_id uuid, workspace_name text, calls_30d bigint, ai_messages_30d bigint, credits_30d numeric, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select a.id, a.name, a.type, a.status, a.wa_status, a.wa_phone, a.workspace_id, w.name,
    (select count(*) from public.calls c where c.agent_id = a.id and c.created_at >= now() - interval '30 days'),
    (select count(*) from public.messages m join public.conversations cv on cv.id = m.conversation_id where cv.agent_id = a.id and m.sender = 'ai' and m.created_at >= now() - interval '30 days'),
    (select coalesce(sum(e.credits), 0) from public.usage_events e where e.agent_id = a.id and e.created_at >= now() - interval '30 days'),
    a.created_at
  from public.agents a join public.workspaces w on w.id = a.workspace_id
  where p_q is null or p_q = '' or a.name ilike '%' || p_q || '%' or w.name ilike '%' || p_q || '%' or a.wa_phone ilike '%' || p_q || '%'
  order by a.created_at desc limit least(p_limit, 300);
end $$;

-- Admin reads of config tables (rules history, provider costs, settings, templates, audit).
create or replace function public.admin_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort), '[]') from public.plans p),
    'packs', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]') from public.topup_packs t),
    'rules', (select coalesce(jsonb_agg(to_jsonb(r) order by r.meter, r.unit, r.effective_from desc), '[]') from public.credit_rules r),
    'costs', (select coalesce(jsonb_agg(to_jsonb(c) order by c.meter), '[]') from public.provider_costs c),
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}') from public.platform_settings),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('key', t.key, 'version', t.version, 'active', t.active, 'body', t.body, 'created_at', t.created_at) order by t.key, t.version desc), '[]') from public.prompt_templates t)
  );
end $$;

create or replace function public.admin_audit(p_limit int default 100)
returns table (id uuid, admin_email text, action text, target_type text, target_id text, before jsonb, after jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query select a.id, u.email::text, a.action, a.target_type, a.target_id, a.before, a.after, a.created_at
    from public.admin_audit_log a left join auth.users u on u.id = a.admin_id order by a.created_at desc limit least(p_limit, 500);
end $$;

do $$ declare f text; begin
  foreach f in array array['require_admin()','admin_overview()','admin_daily(int)','admin_usage_by_meter(int)','admin_workspaces(text,int,int)','admin_workspace_detail(uuid)','admin_agents(text,int)','admin_config()','admin_audit(int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Admin debit: removes credits from live lots, soonest expiry first; never creates debt.
create or replace function public.admin_debit(ws uuid, p_amount numeric, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare l record; left_amt numeric := p_amount; take numeric; taken numeric := 0;
begin
  if p_amount <= 0 then raise exception 'debit amount must be positive'; end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || ws::text));
  for l in select id, remaining from public.credit_lots where workspace_id = ws and remaining > 0 and (expires_at is null or expires_at > now())
           order by expires_at nulls last, created_at for update loop
    exit when left_amt <= 0;
    take := least(left_amt, l.remaining);
    update public.credit_lots set remaining = remaining - take where id = l.id;
    left_amt := left_amt - take; taken := taken + take;
  end loop;
  if taken > 0 then
    insert into public.credit_ledger (workspace_id, delta, reason, balance_after, note) values (ws, -taken, 'admin_adjust', public.wallet_total(ws), p_note);
  end if;
  return taken;
end $$;
revoke execute on function public.admin_debit from public, anon, authenticated;
