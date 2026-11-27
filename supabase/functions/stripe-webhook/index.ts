// Stripe webhook: the only place credits are granted for payments. Signature-verified, deduped, idempotent.
import { serveHandler, HttpError, json, log } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { stripe, verifyStripeSignature } from "../_shared/stripe.ts";
import { notify } from "../_shared/runtime-tools.ts";

type Db = ReturnType<typeof serviceClient>;
const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

serveHandler("stripe-webhook", async (req, { requestId }) => {
  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature"), Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? ""))) throw new HttpError(400, "bad_signature", "Invalid signature.");
  const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, any> } };
  const db = serviceClient();

  const { data: seen } = await db.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (seen?.processed_at) return json(req, { received: true, duplicate: true });
  if (!seen) await db.from("stripe_events").insert({ id: event.id, type: event.type });

  try {
    const o = event.data.object;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (o.mode === "payment" && o.metadata?.kind === "topup" && o.payment_status === "paid") await onTopup(db, o);
        if (o.mode === "subscription" && o.subscription) await syncSubscription(db, await stripe("GET", `/subscriptions/${o.subscription}`), o.metadata?.workspace_id);
        break;
      case "invoice.paid":
        if (o.subscription) await onInvoicePaid(db, o);
        break;
      case "invoice.payment_failed":
        if (o.subscription) {
          const ws = await workspaceFor(db, o.customer, o.subscription_details?.metadata?.workspace_id);
          if (ws) await notify(db, ws, "billing", "⚠️ Payment failed", "We couldn't charge your card for your plan. Update your payment method to keep your monthly credits.", "/app/billing");
        }
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(db, o, o.metadata?.workspace_id);
        break;
      case "charge.refunded":
        if (o.payment_intent) {
          const taken = await rpc(db, "apply_refund", { p_payment_intent: o.payment_intent, p_refunded: o.amount_refunded });
          log("stripe-webhook", requestId, { refund: o.payment_intent, clawback: taken });
        }
        break;
      case "charge.dispute.created":
        if (o.payment_intent) await db.from("payments").update({ status: "disputed" }).eq("stripe_payment_intent_id", o.payment_intent);
        break;
    }
    await db.from("stripe_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    log("stripe-webhook", requestId, { event: event.type, id: event.id });
    return json(req, { received: true });
  } catch (e) {
    await db.from("stripe_events").update({ error: String(e).slice(0, 500) }).eq("id", event.id);
    throw e; // 500 → Stripe retries
  }
});

async function rpc(db: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function workspaceFor(db: Db, customer?: string, hint?: string): Promise<string | null> {
  if (customer) {
    const { data } = await db.from("workspaces").select("id").eq("stripe_customer_id", customer).maybeSingle();
    if (data) return data.id;
  }
  if (hint) {
    // Only trust metadata for a workspace with no customer yet (first checkout), then bind the customer.
    const { data } = await db.from("workspaces").select("id,stripe_customer_id").eq("id", hint).maybeSingle();
    if (data && !data.stripe_customer_id && customer) { await db.from("workspaces").update({ stripe_customer_id: customer }).eq("id", hint); return hint; }
    if (data && (!customer || data.stripe_customer_id === customer)) return hint;
  }
  return null;
}

async function planForPrice(db: Db, priceId?: string) {
  if (!priceId) return null;
  const { data } = await db.from("plans").select("id,name,key").or(`stripe_price_id.eq.${priceId},archived_price_ids.cs.{${priceId}}`).limit(1).maybeSingle();
  return data;
}

async function onTopup(db: Db, s: Record<string, any>) {
  const ws = await workspaceFor(db, s.customer, s.metadata?.workspace_id);
  if (!ws) throw new Error(`no workspace for checkout ${s.id}`);
  const applied = await rpc(db, "apply_topup", { ws, p_pack: s.metadata.pack_id, p_session: s.id, p_payment_intent: s.payment_intent ?? null, p_amount: s.amount_total, p_currency: s.currency });
  if (applied) {
    const { data: pack } = await db.from("topup_packs").select("credits,validity_days").eq("id", s.metadata.pack_id).single();
    await notify(db, ws, "billing", `💚 ${pack?.credits ?? ""} credits added`, `Thanks! Your top-up is ready to use and valid for ${Math.round((pack?.validity_days ?? 365) / 30)} months.`, "/app/billing");
  }
}

async function onInvoicePaid(db: Db, inv: Record<string, any>) {
  if (!(inv.amount_paid > 0) && inv.billing_reason !== "subscription_create") return; // proration-only credit notes etc.
  const ws = await workspaceFor(db, inv.customer, inv.subscription_details?.metadata?.workspace_id);
  if (!ws) throw new Error(`no workspace for invoice ${inv.id}`);
  // The subscription line (not proration lines) carries the plan price and the new period.
  const lines = (inv.lines?.data ?? []) as Array<Record<string, any>>;
  const line = lines.find((l) => !l.proration && l.price?.recurring) ?? lines.find((l) => l.price?.recurring);
  const plan = await planForPrice(db, line?.price?.id);
  if (!plan || !line) throw new Error(`unknown plan price on invoice ${inv.id}`);
  const applied = await rpc(db, "apply_subscription_invoice", {
    ws, p_plan: plan.id, p_start: iso(line.period?.start) ?? new Date().toISOString(), p_end: iso(line.period?.end),
    p_invoice: inv.id, p_payment_intent: inv.payment_intent ?? null, p_amount: inv.amount_paid, p_currency: inv.currency,
  });
  if (applied) {
    await db.from("subscriptions").update({ plan_id: plan.id, pending_plan_id: null }).eq("stripe_subscription_id", inv.subscription);
    await notify(db, ws, "billing", `✅ ${plan.name} plan active`, "Your monthly credits have been added.", "/app/billing");
  }
}

async function syncSubscription(db: Db, s: Record<string, any>, hint?: string) {
  const ws = await workspaceFor(db, s.customer, hint ?? s.metadata?.workspace_id);
  if (!ws) throw new Error(`no workspace for subscription ${s.id}`);
  const item = s.items?.data?.[0];
  const plan = await planForPrice(db, item?.price?.id);
  const periodStart = iso(item?.current_period_start ?? s.current_period_start);
  const periodEnd = iso(item?.current_period_end ?? s.current_period_end);
  const { data: free } = await db.from("plans").select("id").eq("key", "free").single();
  await db.from("subscriptions").upsert({
    workspace_id: ws, plan_id: plan?.id ?? free!.id, stripe_subscription_id: s.id, status: s.status,
    current_period_start: periodStart, current_period_end: periodEnd, cancel_at_period_end: Boolean(s.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  }, { onConflict: "stripe_subscription_id" });

  if (s.status === "canceled" || s.status === "incomplete_expired") {
    // Back to Free from now; any remaining paid plan credits end with the period (no rollover).
    const { data: w } = await db.from("workspaces").select("plan_id").eq("id", ws).single();
    if (w?.plan_id !== free!.id) {
      const start = new Date(); const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      await rpc(db, "start_plan_period", { ws, p_plan: free!.id, p_start: start.toISOString(), p_end: end.toISOString(), p_source_ref: `downgrade:${s.id}` });
      await db.from("subscriptions").update({ pending_plan_id: null }).eq("stripe_subscription_id", s.id);
      await notify(db, ws, "billing", "Your plan changed to Free", "Your paid subscription ended. Upgrade any time from Billing.", "/app/billing");
    }
  }
}
