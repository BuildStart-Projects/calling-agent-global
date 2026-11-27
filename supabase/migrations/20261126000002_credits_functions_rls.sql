-- Credit engine (lots, soonest-expiry-first), plan periods, signup bootstrap, agent creation, views and RLS.

-- ───────────────────────────── Balance helpers ─────────────────────────────
create or replace function public.wallet_total(ws uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(remaining), 0)::numeric
  from public.credit_lots
  where workspace_id = ws and (expires_at is null or expires_at > now());
$$;

create or replace function public.has_credits(ws uuid, min_credits numeric default 0.01)
returns boolean language sql stable security definer set search_path = public as $$
  select public.wallet_total(ws) >= min_credits;
$$;

-- ───────────────────────────── Grants ─────────────────────────────
-- Inserts a lot, settles any outstanding debt from it, and writes a ledger row.
create or replace function public.grant_credits(
  ws uuid, p_kind text, p_amount numeric, p_expires_at timestamptz, p_reason text,
  p_source_ref text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  lot_id uuid;
  debt record;
  avail numeric;
  pay numeric;
begin
  if p_amount <= 0 then raise exception 'grant amount must be positive'; end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || ws::text));

  insert into public.credit_lots (workspace_id, kind, granted, remaining, expires_at, source_ref)
  values (ws, p_kind, p_amount, p_amount, p_expires_at, p_source_ref)
  returning id into lot_id;

  -- settle debt (negative 'debt' lots) from the new lot; total balance is unchanged by settlement
  avail := p_amount;
  for debt in select id, remaining from public.credit_lots where workspace_id = ws and kind = 'debt' and remaining < 0 order by created_at for update loop
    exit when avail <= 0;
    pay := least(avail, -debt.remaining);
    update public.credit_lots set remaining = remaining + pay where id = debt.id;
    update public.credit_lots set remaining = remaining - pay where id = lot_id;
    avail := avail - pay;
  end loop;

  insert into public.credit_ledger (workspace_id, lot_id, delta, reason, balance_after, note)
  values (ws, lot_id, p_amount, p_reason, public.wallet_total(ws), p_note);
  return lot_id;
end $$;

-- ───────────────────────────── Rates ─────────────────────────────
create or replace function public.current_rate(p_meter text, p_unit text)
returns public.credit_rules language sql stable security definer set search_path = public as $$
  select * from public.credit_rules
  where meter = p_meter and unit = p_unit and effective_from <= now()
  order by effective_from desc limit 1;
$$;

-- ───────────────────────────── Consumption ─────────────────────────────
-- Records a usage event and debits credits from lots in order of soonest expiry.
-- If balance is insufficient the shortfall becomes a 'debt' lot (settled by the next grant).
create or replace function public.consume_credits(
  ws uuid, p_agent uuid, p_agent_kind text, p_meter text,
  p_input_tokens bigint default 0, p_output_tokens bigint default 0,
  p_seconds numeric default 0, p_units numeric default 0,
  p_model text default null, p_ref_type text default null, p_ref_id text default null,
  p_campaign uuid default null, p_free boolean default false, p_estimated boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r_in public.credit_rules; r_out public.credit_rules; r_min public.credit_rules; r_unit public.credit_rules;
  cost numeric := 0;
  secs numeric;
  ev_id uuid;
  lot record;
  left_to_pay numeric;
  take numeric;
  debt_id uuid;
  bal numeric;
begin
  r_in := public.current_rate(p_meter, 'per_1m_input_tokens');
  r_out := public.current_rate(p_meter, 'per_1m_output_tokens');
  r_min := public.current_rate(p_meter, 'per_minute');
  r_unit := public.current_rate(p_meter, 'per_unit');

  if r_in.id is not null then cost := cost + (p_input_tokens::numeric / 1000000) * r_in.credits; end if;
  if r_out.id is not null then cost := cost + (p_output_tokens::numeric / 1000000) * r_out.credits; end if;
  if r_min.id is not null and p_seconds > 0 then
    secs := case r_min.rounding
      when 'ceil_second' then ceil(p_seconds)
      when 'ceil_minute' then ceil(p_seconds / 60) * 60
      else p_seconds end;
    cost := cost + (secs / 60) * r_min.credits;
  end if;
  if r_unit.id is not null then cost := cost + p_units * r_unit.credits; end if;
  if p_free then cost := 0; end if;
  cost := round(cost, 4);

  insert into public.usage_events (workspace_id, agent_id, agent_kind, meter, input_tokens, output_tokens, seconds, units,
                                   model, credits, rule_snapshot, estimated, ref_type, ref_id, campaign_id)
  values (ws, p_agent, p_agent_kind, p_meter, p_input_tokens, p_output_tokens, p_seconds, p_units, p_model, cost,
          jsonb_build_object('in', r_in.credits, 'out', r_out.credits, 'min', r_min.credits, 'min_rounding', r_min.rounding,
                             'unit', r_unit.credits, 'free', p_free),
          p_estimated, p_ref_type, p_ref_id, p_campaign)
  returning id into ev_id;

  if cost > 0 then
    perform pg_advisory_xact_lock(hashtext('credits:' || ws::text));
    left_to_pay := cost;
    for lot in
      select id, remaining from public.credit_lots
      where workspace_id = ws and remaining > 0 and kind <> 'debt' and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last, created_at asc
      for update
    loop
      exit when left_to_pay <= 0;
      take := least(lot.remaining, left_to_pay);
      update public.credit_lots set remaining = remaining - take where id = lot.id;
      left_to_pay := left_to_pay - take;
    end loop;
    if left_to_pay > 0 then
      select id into debt_id from public.credit_lots where workspace_id = ws and kind = 'debt' order by created_at desc limit 1 for update;
      if debt_id is null then
        insert into public.credit_lots (workspace_id, kind, granted, remaining, source_ref) values (ws, 'debt', 0, -left_to_pay, 'usage');
      else
        update public.credit_lots set remaining = remaining - left_to_pay where id = debt_id;
      end if;
    end if;
    bal := public.wallet_total(ws);
    insert into public.credit_ledger (workspace_id, delta, reason, usage_event_id, agent_kind, balance_after)
    values (ws, -cost, 'usage', ev_id, p_agent_kind, bal);
  else
    bal := public.wallet_total(ws);
  end if;

  return jsonb_build_object('usage_event_id', ev_id, 'credits', cost, 'balance_after', bal);
end $$;

-- ───────────────────────────── Expiry & plan periods ─────────────────────────────
create or replace function public.expire_lots()
returns int language plpgsql security definer set search_path = public as $$
declare l record; n int := 0;
begin
  for l in
    select id, workspace_id, kind, remaining from public.credit_lots
    where remaining > 0 and expires_at is not null and expires_at <= now() and kind <> 'debt'
    for update
  loop
    perform pg_advisory_xact_lock(hashtext('credits:' || l.workspace_id::text));
    update public.credit_lots set remaining = 0 where id = l.id;
    insert into public.credit_ledger (workspace_id, lot_id, delta, reason, balance_after)
    values (l.workspace_id, l.id, -l.remaining, case when l.kind = 'topup' then 'topup_expiry' else 'plan_expiry' end, public.wallet_total(l.workspace_id));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Starts a plan period: expires the previous plan lot (no rollover) and grants the plan's monthly credits.
create or replace function public.start_plan_period(
  ws uuid, p_plan uuid, p_start timestamptz, p_end timestamptz, p_source_ref text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare pl public.plans; old record; lot_id uuid;
begin
  select * into pl from public.plans where id = p_plan;
  if pl.id is null then raise exception 'unknown plan %', p_plan; end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || ws::text));
  for old in select id, remaining from public.credit_lots where workspace_id = ws and kind = 'plan' and remaining > 0 for update loop
    update public.credit_lots set remaining = 0, expires_at = least(coalesce(expires_at, now()), now()) where id = old.id;
    insert into public.credit_ledger (workspace_id, lot_id, delta, reason, balance_after, note)
    values (ws, old.id, -old.remaining, 'plan_expiry', public.wallet_total(ws), 'period ended (no rollover)');
  end loop;
  update public.workspaces set plan_id = pl.id, plan_period_start = p_start, plan_period_end = p_end where id = ws;
  if pl.monthly_credits > 0 then
    lot_id := public.grant_credits(ws, 'plan', pl.monthly_credits, p_end, 'plan_grant', p_source_ref, pl.name || ' monthly credits');
  end if;
  return lot_id;
end $$;

-- Free-plan anniversaries (paid plans are driven by Stripe invoice.paid).
create or replace function public.run_free_plan_cycles()
returns int language plpgsql security definer set search_path = public as $$
declare w record; free_id uuid; n int := 0; s timestamptz; e timestamptz;
begin
  select id into free_id from public.plans where key = 'free';
  for w in
    select id, plan_period_end from public.workspaces
    where plan_id = free_id and status = 'active' and (plan_period_end is null or plan_period_end <= now())
  loop
    s := coalesce(w.plan_period_end, now());
    e := s + interval '1 month';
    while e <= now() loop s := e; e := s + interval '1 month'; end loop;
    perform public.start_plan_period(w.id, free_id, s, e, 'free_cycle');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────────────────────── Signup bootstrap ─────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := nullif(trim(coalesce(meta->>'full_name', meta->>'name', '')), '');
  tz text := meta->>'timezone';
  ws uuid;
  free_id uuid;
begin
  if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then tz := 'UTC'; end if;

  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, full_name, coalesce(meta->>'avatar_url', meta->>'picture'));

  insert into public.workspaces (name, owner_id, country, timezone, currency, locale, notify_email)
  values (
    coalesce(split_part(full_name, ' ', 1) || '''s business', 'My business'),
    new.id,
    nullif(upper(meta->>'country'), ''),
    tz,
    coalesce(nullif(upper(meta->>'currency'), ''), 'USD'),
    coalesce(nullif(meta->>'locale', ''), 'en-US'),
    new.email
  ) returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');

  select id into free_id from public.plans where key = 'free';
  if free_id is not null then
    perform public.start_plan_period(ws, free_id, now(), now() + interval '1 month', 'signup');
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Google sign-ups carry no locale metadata; the callback page applies browser defaults once.
create or replace function public.apply_locale_defaults(p_locale jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare ws public.workspaces; tz text := p_locale->>'timezone';
begin
  select w.* into ws from public.workspaces w where w.owner_id = auth.uid() order by created_at limit 1;
  if ws.id is null or ws.created_at < now() - interval '1 hour' then return; end if;
  if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then tz := ws.timezone; end if;
  update public.workspaces set
    timezone = case when timezone = 'UTC' then tz else timezone end,
    country = coalesce(country, nullif(upper(p_locale->>'country'), '')),
    currency = case when currency = 'USD' and coalesce(p_locale->>'currency', '') ~ '^[A-Za-z]{3}$' then upper(p_locale->>'currency') else currency end,
    locale = coalesce(nullif(p_locale->>'locale', ''), locale)
  where id = ws.id;
end $$;

-- ───────────────────────────── Agent creation (plan-limited) ─────────────────────────────
create or replace function public.create_agent(p_type text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ws public.workspaces; lim int; cnt int; new_id uuid;
begin
  if p_type not in ('booking','inquiry','order') then raise exception 'invalid agent type'; end if;
  select w.* into ws from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where m.user_id = auth.uid() and m.role in ('owner','admin')
    order by w.created_at limit 1;
  if ws.id is null then raise exception 'no workspace'; end if;
  if ws.status <> 'active' then raise exception 'workspace_suspended'; end if;

  select coalesce((p.limits->>'max_agents')::int, 1) into lim from public.plans p where p.id = ws.plan_id;
  select count(*) into cnt from public.agents where workspace_id = ws.id;
  if cnt >= coalesce(lim, 1) then raise exception 'agent_limit_reached' using hint = 'Upgrade your plan to add more agents.'; end if;

  insert into public.agents (workspace_id, name, type)
  values (ws.id, coalesce(nullif(trim(p_name), ''), initcap(p_type) || ' agent'), p_type)
  returning id into new_id;
  return new_id;
end $$;

-- ───────────────────────────── Member-facing views ─────────────────────────────
create view public.wallet_balance with (security_invoker = true) as
select
  w.id as workspace_id,
  coalesce(sum(l.remaining) filter (where l.expires_at is null or l.expires_at > now()), 0) as total,
  coalesce(sum(l.remaining) filter (where l.kind = 'plan' and l.expires_at > now()), 0) as plan_remaining,
  max(l.expires_at) filter (where l.kind = 'plan' and l.remaining > 0 and l.expires_at > now()) as plan_expires_at,
  coalesce(sum(l.remaining) filter (where l.kind in ('topup','bonus','adjustment') and (l.expires_at is null or l.expires_at > now())), 0) as topup_remaining,
  min(l.expires_at) filter (where l.kind = 'topup' and l.remaining > 0 and l.expires_at > now()) as next_topup_expiry,
  (select sum(l2.remaining) from public.credit_lots l2
     where l2.workspace_id = w.id and l2.kind = 'topup' and l2.remaining > 0
       and l2.expires_at = (select min(l3.expires_at) from public.credit_lots l3 where l3.workspace_id = w.id and l3.kind = 'topup' and l3.remaining > 0 and l3.expires_at > now())
  ) as next_topup_expiry_amount
from public.workspaces w
left join public.credit_lots l on l.workspace_id = w.id
group by w.id;

-- usage_events is admin-only; this definer view exposes credits only, filtered to the caller's workspaces.
create view public.my_usage_daily as
select workspace_id, agent_id, agent_kind, campaign_id,
       (created_at at time zone 'UTC')::date as day,
       sum(credits) as credits
from public.usage_events
where public.is_member(workspace_id)
group by workspace_id, agent_id, agent_kind, campaign_id, (created_at at time zone 'UTC')::date;

create view public.my_credit_history with (security_invoker = true) as
select id, workspace_id, created_at, reason, delta, agent_kind, balance_after
from public.credit_ledger;

-- ───────────────────────────── RLS policies ─────────────────────────────
create policy "plans readable when active" on public.plans for select using (active or public.is_platform_admin());
create policy "packs readable when active" on public.topup_packs for select using (active or public.is_platform_admin());

create policy "own profile" on public.profiles for select using (id = auth.uid());
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "members read workspace" on public.workspaces for select using (public.is_member(id) or public.is_platform_admin());
create policy "owners update workspace" on public.workspaces for update using (public.is_owner_or_admin(id)) with check (public.is_owner_or_admin(id));

create policy "members read membership" on public.workspace_members for select using (public.is_member(workspace_id) or public.is_platform_admin());

create policy "members read lots" on public.credit_lots for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members read ledger" on public.credit_ledger for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members read subscriptions" on public.subscriptions for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members read payments" on public.payments for select using (public.is_member(workspace_id) or public.is_platform_admin());

create policy "admin only" on public.usage_events for select using (public.is_platform_admin());
create policy "admin only" on public.credit_rules for select using (public.is_platform_admin());
create policy "admin only" on public.stripe_events for select using (public.is_platform_admin());
create policy "admin only" on public.provider_costs for select using (public.is_platform_admin());
create policy "admin only" on public.admin_audit_log for select using (public.is_platform_admin());
create policy "admin only" on public.platform_admins for select using (public.is_platform_admin());
create policy "admin only" on public.platform_settings for select using (public.is_platform_admin());

create policy "members read agents" on public.agents for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members update agents" on public.agents for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "owners delete agents" on public.agents for delete using (public.is_owner_or_admin(workspace_id));

-- Column-level write protection: members may only edit safe columns.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant update (full_name, avatar_url, theme_pref, onboarding_state, marketing_opt_in) on public.profiles to authenticated;
grant update (name, country, timezone, currency, locale, notify_email) on public.workspaces to authenticated;
grant update (name, calling_enabled, messaging_enabled) on public.agents to authenticated;
grant delete on public.agents to authenticated;

-- Functions: only expose what the browser needs.
revoke execute on function public.grant_credits, public.consume_credits, public.expire_lots, public.start_plan_period,
  public.run_free_plan_cycles, public.handle_new_user, public.wallet_total, public.current_rate from public, anon, authenticated;
grant execute on function public.is_platform_admin, public.create_agent, public.apply_locale_defaults to authenticated;
grant select on public.wallet_balance, public.my_usage_daily, public.my_credit_history to authenticated;
revoke execute on function public.has_credits, public.setting from public, anon, authenticated;
-- agent_workspace() is used inside RLS policies evaluated as the caller, so authenticated must keep execute.
grant execute on function public.agent_workspace to authenticated;
