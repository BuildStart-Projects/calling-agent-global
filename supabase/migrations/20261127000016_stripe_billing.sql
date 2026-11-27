-- Phase 8: Stripe billing. Credit grants are idempotent on the Stripe object id (webhook replays are safe).

drop function if exists public.admin_debit(uuid, numeric, text);
create or replace function public.admin_debit(ws uuid, p_amount numeric, p_note text, p_reason text default 'admin_adjust', p_kind text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare l record; left_amt numeric := p_amount; take numeric; taken numeric := 0;
begin
  if p_amount <= 0 then raise exception 'debit amount must be positive'; end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || ws::text));
  for l in select id, remaining from public.credit_lots where workspace_id = ws and remaining > 0 and (expires_at is null or expires_at > now())
             and (p_kind is null or kind = p_kind)
           order by expires_at nulls last, created_at for update loop
    exit when left_amt <= 0;
    take := least(left_amt, l.remaining);
    update public.credit_lots set remaining = remaining - take where id = l.id;
    left_amt := left_amt - take; taken := taken + take;
  end loop;
  if taken > 0 then
    insert into public.credit_ledger (workspace_id, delta, reason, balance_after, note) values (ws, -taken, p_reason, public.wallet_total(ws), p_note);
  end if;
  return taken;
end $$;
revoke execute on function public.admin_debit from public, anon, authenticated;

-- Paid subscription invoice → new plan period with that plan's monthly credits (no rollover).
create or replace function public.apply_subscription_invoice(
  ws uuid, p_plan uuid, p_start timestamptz, p_end timestamptz, p_invoice text, p_payment_intent text, p_amount bigint, p_currency text
) returns boolean language plpgsql security definer set search_path = public as $$
declare pl public.plans; pid uuid;
begin
  select * into pl from public.plans where id = p_plan;
  if pl.id is null then raise exception 'unknown plan'; end if;
  insert into public.payments (workspace_id, kind, plan_id, stripe_invoice_id, stripe_payment_intent_id, amount_minor, currency, status, credits_granted)
  values (ws, 'subscription', p_plan, p_invoice, p_payment_intent, p_amount, lower(p_currency), 'paid', pl.monthly_credits)
  on conflict (stripe_invoice_id) do nothing returning id into pid;
  if pid is null then return false; end if;      -- already applied
  perform public.start_plan_period(ws, p_plan, p_start, p_end, p_invoice);
  return true;
end $$;

-- One-time top-up → credits valid for the pack's validity period (default 1 year).
create or replace function public.apply_topup(
  ws uuid, p_pack uuid, p_session text, p_payment_intent text, p_amount bigint, p_currency text
) returns boolean language plpgsql security definer set search_path = public as $$
declare pk public.topup_packs; pid uuid;
begin
  select * into pk from public.topup_packs where id = p_pack;
  if pk.id is null then raise exception 'unknown pack'; end if;
  insert into public.payments (workspace_id, kind, topup_pack_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_minor, currency, status, credits_granted)
  values (ws, 'topup', p_pack, p_session, p_payment_intent, p_amount, lower(p_currency), 'paid', pk.credits)
  on conflict (stripe_checkout_session_id) do nothing returning id into pid;
  if pid is null then return false; end if;
  perform public.grant_credits(ws, 'topup', pk.credits, now() + make_interval(days => pk.validity_days), 'topup', p_session, pk.name || ' top-up');
  return true;
end $$;

-- Refund: mark the payment and claw back unused credits of that kind (never below zero).
create or replace function public.apply_refund(p_payment_intent text, p_refunded bigint)
returns numeric language plpgsql security definer set search_path = public as $$
declare p public.payments; share numeric; taken numeric := 0;
begin
  select * into p from public.payments where stripe_payment_intent_id = p_payment_intent for update;
  if p.id is null or p.status = 'refunded' then return 0; end if;
  share := least(1, p_refunded::numeric / greatest(p.amount_minor, 1));
  update public.payments set status = case when share >= 1 then 'refunded' else 'partially_refunded' end where id = p.id;
  if p.credits_granted > 0 then
    taken := public.admin_debit(p.workspace_id, round(p.credits_granted * share, 4), 'Refund ' || p_payment_intent, 'refund_clawback', case p.kind when 'topup' then 'topup' else 'plan' end);
  end if;
  return taken;
end $$;

revoke execute on function public.apply_subscription_invoice, public.apply_topup, public.apply_refund from public, anon, authenticated;

-- (members already read their own payments/subscriptions via policies in migration 002)
