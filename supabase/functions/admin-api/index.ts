// Superadmin writes. Platform admin + MFA (aal2) required; every change is written to admin_audit_log with before/after.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requirePlatformAdmin } from "../_shared/supabase.ts";
import { compileAgent } from "../_shared/compile-agent.ts";

const money = z.number().int().min(0).max(10_000_000);
const Feature = z.object({ label: z.string().min(1).max(120), included: z.boolean().default(true), highlight: z.boolean().optional() });
const Plan = z.object({
  id: z.string().uuid().optional(), key: z.string().regex(/^[a-z0-9_]{2,30}$/), name: z.string().min(1).max(40), tagline: z.string().max(140).nullable().optional(),
  price_minor: money, currency: z.string().length(3).default("USD"), monthly_credits: z.number().min(0).max(1_000_000),
  limits: z.record(z.number().int().min(0).max(1_000_000)), features: z.array(Feature).max(20), badge: z.string().max(30).nullable().optional(),
  cta_label: z.string().max(40).nullable().optional(), active: z.boolean(), sort: z.number().int().min(0).max(100),
});
const Pack = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1).max(40), credits: z.number().positive().max(1_000_000), price_minor: money.refine((v) => v > 0),
  currency: z.string().length(3).default("USD"), validity_days: z.number().int().min(1).max(1825), badge: z.string().max(30).nullable().optional(), active: z.boolean(), sort: z.number().int().min(0).max(100),
});
const SETTINGS = ["feature_flags", "campaign_safety", "models", "support", "orchestrator"] as const;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("adjust_credits"), workspace_id: z.string().uuid(), amount: z.number().refine((v) => v !== 0 && Math.abs(v) <= 100_000), note: z.string().min(3).max(300), expires_days: z.number().int().min(1).max(1825).nullable().optional() }),
  z.object({ action: z.literal("set_workspace_status"), workspace_id: z.string().uuid(), status: z.enum(["active", "suspended"]), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("set_plan"), workspace_id: z.string().uuid(), plan_id: z.string().uuid(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("upsert_plan"), plan: Plan }),
  z.object({ action: z.literal("upsert_pack"), pack: Pack }),
  z.object({ action: z.literal("add_rule"), meter: z.string().regex(/^[a-z0-9_]{2,40}$/), unit: z.enum(["per_1m_input_tokens", "per_1m_output_tokens", "per_minute", "per_unit"]), credits: z.number().min(0).max(100_000), rounding: z.enum(["exact", "ceil_second", "ceil_minute"]).default("exact"), effective_from: z.string().datetime().optional() }),
  z.object({ action: z.literal("set_cost"), meter: z.string().regex(/^[a-z0-9_:]{2,50}$/), unit: z.enum(["per_1m_input_tokens", "per_1m_output_tokens", "per_minute", "per_unit"]), cost_per_unit_usd: z.number().min(0).max(1000) }),
  z.object({ action: z.literal("set_setting"), key: z.enum(SETTINGS), value: z.record(z.unknown()) }),
  z.object({ action: z.literal("save_template"), key: z.string().regex(/^[a-z0-9_.]{2,60}$/), body: z.string().min(10).max(40_000), notes: z.string().max(300).optional() }),
  z.object({ action: z.literal("activate_template"), key: z.string(), version: z.number().int().min(1) }),
  z.object({ action: z.literal("set_agent_status"), agent_id: z.string().uuid(), status: z.enum(["paused", "live"]), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("set_campaign_status"), campaign_id: z.string().uuid(), status: z.enum(["paused", "cancelled"]) }),
]);

serveHandler("admin-api", async (req) => {
  const { user, db } = await requirePlatformAdmin(req);
  const body = Body.parse(await readJson(req));
  const audit = async (action: string, targetType: string, targetId: string | null, before: unknown, after: unknown) => {
    await db.from("admin_audit_log").insert({ admin_id: user.id, action, target_type: targetType, target_id: targetId, before: before ?? null, after: after ?? null, ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null });
  };
  const must = <T,>(r: { data: T | null; error: unknown }) => { if (r.error) throw r.error; return r.data as T; };

  switch (body.action) {
    case "adjust_credits": {
      const before = must(await db.from("wallet_balance").select("total").eq("workspace_id", body.workspace_id).single()) as { total: number };
      if (body.amount > 0) {
        must(await db.rpc("grant_credits", { ws: body.workspace_id, p_kind: "adjustment", p_amount: body.amount, p_expires_at: body.expires_days ? new Date(Date.now() + body.expires_days * 86_400_000).toISOString() : null, p_reason: "admin_adjust", p_source_ref: `admin:${user.id}`, p_note: body.note }));
      } else {
        must(await db.rpc("admin_debit", { ws: body.workspace_id, p_amount: -body.amount, p_note: body.note }));
      }
      const after = must(await db.from("wallet_balance").select("total").eq("workspace_id", body.workspace_id).single()) as { total: number };
      await audit("credits.adjust", "workspace", body.workspace_id, { balance: before.total }, { balance: after.total, amount: body.amount, note: body.note });
      return json(req, { balance: after.total });
    }
    case "set_workspace_status": {
      const before = must(await db.from("workspaces").select("status").eq("id", body.workspace_id).single());
      must(await db.from("workspaces").update({ status: body.status }).eq("id", body.workspace_id));
      if (body.status === "suspended") {
        const { data: agents } = await db.from("agents").select("id").eq("workspace_id", body.workspace_id).eq("status", "live");
        for (const a of agents ?? []) { await db.from("agents").update({ status: "paused", pause_reason: "admin" }).eq("id", a.id); await compileAgent(db, a.id, { pushEngine: true }).catch(() => null); }
        await db.from("campaigns").update({ status: "paused", pause_reason: "admin" }).eq("workspace_id", body.workspace_id).in("status", ["running", "scheduled"]);
      }
      await audit("workspace.status", "workspace", body.workspace_id, before, { status: body.status, note: body.note });
      return json(req, { ok: true });
    }
    case "set_plan": {
      const before = must(await db.from("workspaces").select("plan_id,plan_period_start,plan_period_end").eq("id", body.workspace_id).single());
      const start = new Date(); const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      must(await db.rpc("start_plan_period", { ws: body.workspace_id, p_plan: body.plan_id, p_start: start.toISOString(), p_end: end.toISOString(), p_source_ref: `admin:${user.id}` }));
      await audit("workspace.plan", "workspace", body.workspace_id, before, { plan_id: body.plan_id, note: body.note });
      return json(req, { ok: true });
    }
    case "upsert_plan": {
      const { id, ...p } = body.plan;
      const before = id ? must(await db.from("plans").select("*").eq("id", id).single()) : null;
      if (before && (before as any).key !== p.key) throw new HttpError(400, "key_locked", "A plan's key can't change.");
      if (before && (before as any).price_minor !== p.price_minor && (before as any).stripe_price_id) {
        // Price change: the Stripe price is immutable; Phase 8 billing sync creates a new price and archives the old one.
        (p as any).stripe_price_id = null; (p as any).archived_price_ids = [...((before as any).archived_price_ids ?? []), (before as any).stripe_price_id];
      }
      const saved = id ? must(await db.from("plans").update(p).eq("id", id).select("*").single()) : must(await db.from("plans").insert(p).select("*").single());
      await audit(id ? "plan.update" : "plan.create", "plan", (saved as any).id, before, saved);
      return json(req, { plan: saved });
    }
    case "upsert_pack": {
      const { id, ...p } = body.pack;
      const before = id ? must(await db.from("topup_packs").select("*").eq("id", id).single()) : null;
      if (before && (before as any).price_minor !== p.price_minor && (before as any).stripe_price_id) (p as any).stripe_price_id = null;
      const saved = id ? must(await db.from("topup_packs").update(p).eq("id", id).select("*").single()) : must(await db.from("topup_packs").insert(p).select("*").single());
      await audit(id ? "pack.update" : "pack.create", "topup_pack", (saved as any).id, before, saved);
      return json(req, { pack: saved });
    }
    case "add_rule": {
      const { data: before } = await db.from("credit_rules").select("*").eq("meter", body.meter).eq("unit", body.unit).lte("effective_from", new Date().toISOString()).order("effective_from", { ascending: false }).limit(1).maybeSingle();
      const saved = must(await db.from("credit_rules").insert({ meter: body.meter, unit: body.unit, credits: body.credits, rounding: body.rounding, effective_from: body.effective_from ?? new Date().toISOString(), created_by: user.id }).select("*").single());
      await audit("credit_rule.add", "credit_rule", (saved as any).id, before, saved);
      return json(req, { rule: saved });
    }
    case "set_cost": {
      const { data: before } = await db.from("provider_costs").select("*").eq("meter", body.meter).maybeSingle();
      const saved = must(await db.from("provider_costs").upsert({ meter: body.meter, unit: body.unit, cost_per_unit_usd: body.cost_per_unit_usd, updated_at: new Date().toISOString() }).select("*").single());
      await audit("provider_cost.set", "provider_cost", body.meter, before, saved);
      return json(req, { cost: saved });
    }
    case "set_setting": {
      const { data: before } = await db.from("platform_settings").select("value").eq("key", body.key).maybeSingle();
      const value = { ...(before?.value ?? {}), ...body.value };
      validateSetting(body.key, value);
      must(await db.from("platform_settings").upsert({ key: body.key, value, updated_by: user.id, updated_at: new Date().toISOString() }));
      await audit("setting.set", "setting", body.key, before?.value, value);
      return json(req, { value });
    }
    case "save_template": {
      const { data: cur } = await db.from("prompt_templates").select("version,body").eq("key", body.key).order("version", { ascending: false }).limit(1).maybeSingle();
      if (!cur) throw new HttpError(404, "unknown_template", "Unknown template key.");
      if (cur.body === body.body) return json(req, { unchanged: true });
      const version = cur.version + 1;
      must(await db.from("prompt_templates").insert({ key: body.key, version, body: body.body, active: false, notes: body.notes ?? null, created_by: user.id }));
      await activate(body.key, version);
      await audit("template.save", "prompt_template", `${body.key}@${version}`, { version: cur.version }, { version, notes: body.notes });
      return json(req, { version });
    }
    case "activate_template": {
      await activate(body.key, body.version);
      await audit("template.activate", "prompt_template", `${body.key}@${body.version}`, null, { version: body.version });
      return json(req, { ok: true });
    }
    case "set_agent_status": {
      const before = must(await db.from("agents").select("status,pause_reason").eq("id", body.agent_id).single());
      must(await db.from("agents").update(body.status === "paused" ? { status: "paused", pause_reason: "admin" } : { status: "live", pause_reason: null }).eq("id", body.agent_id));
      await compileAgent(db, body.agent_id, { pushEngine: true }).catch(() => null);
      await audit("agent.status", "agent", body.agent_id, before, { status: body.status, note: body.note });
      return json(req, { ok: true });
    }
    case "set_campaign_status": {
      const before = must(await db.from("campaigns").select("status,pause_reason").eq("id", body.campaign_id).single());
      if (body.status === "cancelled") await db.from("campaign_targets").update({ status: "cancelled" }).eq("campaign_id", body.campaign_id).in("status", ["queued", "notified"]);
      must(await db.from("campaigns").update(body.status === "paused" ? { status: "paused", pause_reason: "admin" } : { status: "cancelled", completed_at: new Date().toISOString() }).eq("id", body.campaign_id));
      await audit("campaign.status", "campaign", body.campaign_id, before, { status: body.status });
      return json(req, { ok: true });
    }
  }

  async function activate(key: string, version: number) {
    const { data: exists } = await db.from("prompt_templates").select("id").eq("key", key).eq("version", version).maybeSingle();
    if (!exists) throw new HttpError(404, "unknown_version", "That version doesn't exist.");
    must(await db.from("prompt_templates").update({ active: false }).eq("key", key).neq("version", version));
    must(await db.from("prompt_templates").update({ active: true }).eq("key", key).eq("version", version));
    // Agents compiled from this template pick it up on their next compile; mark all for the sweep.
    if (/^(calling|messaging)\./.test(key)) await db.from("agent_blueprints").update({ pending_compile: true }).neq("agent_id", "00000000-0000-0000-0000-000000000000");
  }
});

function validateSetting(key: string, v: Record<string, unknown>) {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (key === "campaign_safety") {
    if (!hhmm.test(String(v.quiet_start)) || !hhmm.test(String(v.quiet_end))) throw new HttpError(400, "invalid", "Quiet hours must be HH:MM.");
    for (const k of ["default_daily_cap", "max_daily_cap", "failure_window"]) if (!(Number(v[k]) >= 1)) throw new HttpError(400, "invalid", `${k} must be at least 1.`);
    if (!(Number(v.failure_pause_ratio) > 0 && Number(v.failure_pause_ratio) <= 1)) throw new HttpError(400, "invalid", "failure_pause_ratio must be between 0 and 1.");
  }
  if (key === "feature_flags") for (const [k, x] of Object.entries(v)) if (typeof x !== "boolean") throw new HttpError(400, "invalid", `${k} must be true or false.`);
  if (key === "models") for (const [k, x] of Object.entries(v)) if (typeof x !== "string" || !/^[a-z0-9./:-]{3,80}$/i.test(x)) throw new HttpError(400, "invalid", `Model id for ${k} looks wrong.`);
}
