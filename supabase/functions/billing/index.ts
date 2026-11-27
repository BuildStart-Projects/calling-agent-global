// Billing for workspace owners/admins: subscribe, change plan, cancel/resume, top up, open Stripe portal.
// Credits are never granted here — only by stripe-webhook after Stripe confirms payment.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { appUrl, ensureCustomer, ensurePrice, stripe } from "../_shared/stripe.ts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("change_plan"), plan_id: z.string().uuid() }),
  z.object({ action: z.literal("topup"), pack_id: z.string().uuid() }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("portal") }),
]);

serveHandler("billing", async (req) => {
  const body = Body.parse(await readJson(req));
  const user = await requireUser(req);
  const db = serviceClient();
  const { data: m } = await db.from("workspace_members").select("role, workspace:workspaces(*)").eq("user_id", user.id).in("role", ["owner", "admin"]).limit(1).maybeSingle();
  if (!m?.workspace) throw new HttpError(403, "forbidden", "Only the workspace owner or an admin can manage billing.");
  const ws = m.workspace as unknown as Record<string, any>;
  if (ws.status !== "active") throw new HttpError(403, ws.status === "pending_deletion" ? "workspace_deleting" : "workspace_suspended", ws.status === "pending_deletion" ? "This workspace is scheduled for deletion. Contact support to restore it." : "This workspace is suspended. Please contact support.");
  const { data: sub } = await db.from("subscriptions").select("*").eq("workspace_id", ws.id).in("status", ["active", "trialing", "past_due"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: current } = await db.from("plans").select("*").eq("id", ws.plan_id).maybeSingle();

  switch (body.action) {
    case "change_plan": {
      const { data: target } = await db.from("plans").select("*").eq("id", body.plan_id).eq("active", true).maybeSingle();
      if (!target) throw new HttpError(404, "not_found", "That plan isn't available.");
      if (target.id === ws.plan_id && !sub?.pending_plan_id && !sub?.cancel_at_period_end) return json(req, { status: "unchanged" });

      // → Free: cancel the paid subscription at period end (credits stay until then).
      if (target.price_minor === 0) {
        if (!sub?.stripe_subscription_id) return json(req, { status: "unchanged" });
        await stripe("POST", `/subscriptions/${sub.stripe_subscription_id}`, { cancel_at_period_end: true });
        await db.from("subscriptions").update({ cancel_at_period_end: true, pending_plan_id: target.id }).eq("id", sub.id);
        return json(req, { status: "scheduled", effective_at: sub.current_period_end });
      }

      const price = await ensurePrice(db, "plan", target);
      // No paid subscription yet → Stripe Checkout.
      if (!sub?.stripe_subscription_id) {
        const customer = await ensureCustomer(db, ws, user.email);
        const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
          mode: "subscription", customer, line_items: [{ price, quantity: 1 }], client_reference_id: ws.id,
          metadata: { workspace_id: ws.id, kind: "plan", plan_id: target.id }, subscription_data: { metadata: { workspace_id: ws.id, plan_id: target.id } },
          success_url: appUrl("/app/billing?checkout=success"), cancel_url: appUrl("/app/billing?checkout=cancelled"),
          allow_promotion_codes: true, billing_address_collection: "auto",
        });
        return json(req, { status: "redirect", url: session.url });
      }

      // Paid → paid. Upgrade now (prorated, new credits immediately); downgrade at renewal.
      const s = await stripe<{ items: { data: Array<{ id: string }> } }>("GET", `/subscriptions/${sub.stripe_subscription_id}`);
      const item = s.items.data[0]!.id;
      const upgrade = target.price_minor > (current?.price_minor ?? 0);
      if (upgrade) {
        await stripe("POST", `/subscriptions/${sub.stripe_subscription_id}`, {
          items: [{ id: item, price }], proration_behavior: "create_prorations", billing_cycle_anchor: "now",
          payment_behavior: "pending_if_incomplete", cancel_at_period_end: false, metadata: { workspace_id: ws.id, plan_id: target.id },
        }, `upgrade-${sub.stripe_subscription_id}-${target.id}-${Math.floor(Date.now() / 60_000)}`);
        await db.from("subscriptions").update({ pending_plan_id: null, cancel_at_period_end: false }).eq("id", sub.id);
        return json(req, { status: "upgraded" });
      }
      await stripe("POST", `/subscriptions/${sub.stripe_subscription_id}`, { items: [{ id: item, price }], proration_behavior: "none", cancel_at_period_end: false, metadata: { workspace_id: ws.id, plan_id: target.id } });
      await db.from("subscriptions").update({ pending_plan_id: target.id, cancel_at_period_end: false }).eq("id", sub.id);
      return json(req, { status: "scheduled", effective_at: sub.current_period_end });
    }
    case "cancel": {
      if (!sub?.stripe_subscription_id) throw new HttpError(409, "no_subscription", "You're on the Free plan.");
      const { data: free } = await db.from("plans").select("id").eq("key", "free").single();
      await stripe("POST", `/subscriptions/${sub.stripe_subscription_id}`, { cancel_at_period_end: true });
      await db.from("subscriptions").update({ cancel_at_period_end: true, pending_plan_id: free!.id }).eq("id", sub.id);
      return json(req, { status: "scheduled", effective_at: sub.current_period_end });
    }
    case "resume": {
      if (!sub?.stripe_subscription_id) throw new HttpError(409, "no_subscription", "No subscription to resume.");
      await stripe("POST", `/subscriptions/${sub.stripe_subscription_id}`, { cancel_at_period_end: false });
      await db.from("subscriptions").update({ cancel_at_period_end: false, pending_plan_id: null }).eq("id", sub.id);
      return json(req, { status: "resumed" });
    }
    case "topup": {
      const { data: pack } = await db.from("topup_packs").select("*").eq("id", body.pack_id).eq("active", true).maybeSingle();
      if (!pack) throw new HttpError(404, "not_found", "That pack isn't available.");
      const customer = await ensureCustomer(db, ws, user.email);
      const price = await ensurePrice(db, "pack", pack);
      const session = await stripe<{ url: string }>("POST", "/checkout/sessions", {
        mode: "payment", customer, line_items: [{ price, quantity: 1 }], client_reference_id: ws.id,
        metadata: { workspace_id: ws.id, kind: "topup", pack_id: pack.id }, payment_intent_data: { metadata: { workspace_id: ws.id, kind: "topup", pack_id: pack.id } },
        invoice_creation: { enabled: true },
        success_url: appUrl("/app/billing?checkout=success"), cancel_url: appUrl("/app/billing?checkout=cancelled"),
      });
      return json(req, { status: "redirect", url: session.url });
    }
    case "portal": {
      if (!ws.stripe_customer_id) throw new HttpError(409, "no_customer", "No billing history yet.");
      const p = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: ws.stripe_customer_id, return_url: appUrl("/app/billing") });
      return json(req, { status: "redirect", url: p.url });
    }
  }
});
