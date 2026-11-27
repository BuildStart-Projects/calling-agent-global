// Orchestrator tools: declarations (Gemini functionDeclarations) + validated executors.
import { z } from "npm:zod@3.25.76";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { mergePatch } from "./blueprint.ts";
import { Provenance } from "./provenance.ts";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const str = (description: string) => ({ type: "string", description });
const hoursSchema = {
  type: "object",
  description: "Weekly hours. Keys mon..sun; each value is a list of [\"HH:MM\",\"HH:MM\"] ranges (24h). Omit closed days or use [].",
  properties: Object.fromEntries(DAYS.map((d) => [d, { type: "array", items: { type: "array", items: { type: "string" } } }])),
};

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export const ORCHESTRATOR_TOOLS: Record<string, ToolSpec> = {
  update_blueprint: {
    name: "update_blueprint",
    description: "Save business facts the owner stated. Only include fields you are changing.",
    parameters: {
      type: "object",
      properties: {
        business: {
          type: "object",
          properties: {
            name: str("Business name"), industry: str("Short industry, e.g. 'hair salon'"), description: str("One or two sentences about the business"),
            address: str("Street address if given"), service_area: str("Areas served"), website: str("Website URL if given"),
            timezone: str("IANA timezone if the location clearly implies one"), currency: str("ISO 4217 code if stated"),
          },
        },
        hours: hoursSchema,
        policies: {
          type: "object",
          properties: {
            cancellation: str("Cancellation policy"), deposit: str("Deposit policy"), returns: str("Returns policy"),
            payment_methods: { type: "array", items: { type: "string", enum: ["cash", "card", "bank_transfer", "online_link", "mobile_wallet", "cash_on_delivery"] } },
            payment_instructions: str("Exact payment instructions to share (bank details, link)"),
            delivery: { type: "object", properties: { enabled: { type: "boolean" }, areas: str("Delivery areas"), fee: { type: "number" }, free_over: { type: "number" }, eta: str("Typical delivery time") } },
            pickup: { type: "object", properties: { enabled: { type: "boolean" }, address: str("Pickup address") } },
            other: str("Any other policy"),
          },
        },
        collect_fields: { type: "array", items: { type: "string" }, description: "Details to collect from customers besides name and phone, e.g. address, problem_description, preferred_staff" },
        goal: { type: "string", enum: ["appointment", "book_visit", "quote", "callback", "order"] },
        tone: { type: "string", enum: ["friendly", "professional", "energetic", "reassuring"] },
        notes: str("Other things the owner wants the agents to know"),
        response_time: str("How fast the team usually replies, e.g. 'within 2 hours'"),
      },
    },
  },
  upsert_catalog_items: {
    name: "upsert_catalog_items",
    description: "Add, update or remove services/products. Use match_ref to update/remove an existing item.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              match_ref: str("Existing item ref like s3, to update or remove it"),
              name: str("Item name"),
              kind: { type: "string", enum: ["service", "product"] },
              description: str("Short description"),
              price: { type: "number", description: "Price in major units, exactly as stated" },
              price_from: { type: "boolean", description: "True if the owner said 'from'/'starting at'" },
              currency: str("ISO currency if different from the workspace currency"),
              duration_minutes: { type: "integer", description: "Duration for services" },
              remove: { type: "boolean" },
            },
            required: ["name", "kind"],
          },
        },
      },
      required: ["items"],
    },
  },
  upsert_faqs: {
    name: "upsert_faqs",
    description: "Add, update or remove FAQs. Answers must use only the owner's information.",
    parameters: {
      type: "object",
      properties: {
        faqs: { type: "array", items: { type: "object", properties: { match_question: str("Existing question to update/remove"), question: str("Question"), answer: str("Answer"), remove: { type: "boolean" } }, required: ["question", "answer"] } },
      },
      required: ["faqs"],
    },
  },
  set_availability: {
    name: "set_availability",
    description: "Set when customers can book (booking agents only).",
    parameters: {
      type: "object",
      properties: {
        weekly: hoursSchema,
        slot_interval_minutes: { type: "integer", enum: [15, 30, 60] },
        buffer_minutes: { type: "integer" },
        capacity: { type: "integer", description: "How many customers can be served at the same time" },
        min_notice_minutes: { type: "integer" },
        max_days_ahead: { type: "integer" },
        auto_confirm: { type: "boolean" },
        exceptions: { type: "array", items: { type: "object", properties: { date: str("YYYY-MM-DD"), closed: { type: "boolean" }, start: str("HH:MM"), end: str("HH:MM"), note: str("Reason") }, required: ["date", "closed"] } },
      },
    },
  },
  set_handoff_phone: {
    name: "set_handoff_phone",
    description: "Save the phone number that should get a WhatsApp alert when a customer asks for a human.",
    parameters: { type: "object", properties: { phone: str("Phone number in international format") }, required: ["phone"] },
  },
  ask_question: {
    name: "ask_question",
    description: "Ask the owner ONE question. This is the only way to ask questions.",
    parameters: {
      type: "object",
      properties: { question: str("The question, short and friendly"), suggestions: { type: "array", items: { type: "string" }, description: "2–4 short tap-to-reply suggestions" }, topic: str("What this question is about") },
      required: ["question", "suggestions", "topic"],
    },
  },
  finish_onboarding: {
    name: "finish_onboarding",
    description: "Finish setup when required info is complete or no questions remain.",
    parameters: {
      type: "object",
      properties: { summary: str("One-paragraph summary of the agent"), defaults_applied: { type: "array", items: { type: "string" } }, recommended_next: { type: "array", items: { type: "string" } } },
      required: ["summary", "defaults_applied"],
    },
  },
  decline_off_topic: {
    name: "decline_off_topic",
    description: "Use when the owner asks for something unrelated to setting up their agent.",
    parameters: { type: "object", properties: { topic: str("What they asked about") } },
  },
};

// ─────────────────────────── Validation schemas ───────────────────────────
const range = z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)]).refine(([a, b]) => a < b, "start must be before end");
const weekly = z.object(Object.fromEntries(DAYS.map((d) => [d, z.array(range).max(4).optional()]))).partial();

const catalogItem = z.object({
  match_ref: z.string().max(10).optional(),
  name: z.string().min(1).max(200),
  kind: z.enum(["service", "product"]),
  description: z.string().max(1000).optional(),
  price: z.number().min(0).max(10_000_000).optional(),
  price_from: z.boolean().optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  remove: z.boolean().optional(),
});

export type ToolEvent = { type: "blueprint_patch"; path: string; value?: unknown; source: "ai" | "document" } | { type: "skipped_locked"; path: string };

export type ToolContext = {
  db: SupabaseClient;
  agent: { id: string; type: "booking" | "inquiry" | "order"; wa_phone: string | null };
  workspace: { currency: string; timezone: string };
  provenance: Provenance;
  source: "ai" | "document";
  emit: (e: ToolEvent) => void;
};

type Result = Record<string, unknown>;

export async function runOrchestratorTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  switch (name) {
    case "update_blueprint": return updateBlueprint(args, ctx);
    case "upsert_catalog_items": return upsertCatalog(args, ctx);
    case "upsert_faqs": return upsertFaqs(args, ctx);
    case "set_availability": return setAvailability(args, ctx);
    case "set_handoff_phone": return setHandoff(args, ctx);
    default: return { ok: false, error: `unknown tool ${name}` };
  }
}

async function loadBlueprint(ctx: ToolContext) {
  const { data } = await ctx.db.from("agent_blueprints").select("data,field_meta,version").eq("agent_id", ctx.agent.id).single();
  return data as { data: Record<string, unknown>; field_meta: Record<string, { locked?: boolean }>; version: number };
}

async function updateBlueprint(args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  const bp = await loadBlueprint(ctx);
  const locked = new Set(Object.entries(bp.field_meta ?? {}).filter(([, m]) => m.locked).map(([k]) => k));
  const patch = structuredClone(args);
  const rejected: string[] = [];

  // provenance on numeric facts
  const hours = patch.hours as Record<string, [string, string][]> | undefined;
  if (hours) {
    const parsed = weekly.safeParse(hours);
    if (!parsed.success) { delete patch.hours; rejected.push("hours (invalid format)"); }
    else if (Object.values(hours).flat().some(([a, b]) => !ctx.provenance.time(a) || !ctx.provenance.time(b))) { delete patch.hours; rejected.push("hours (not stated by the owner)"); }
  }
  const pol = patch.policies as Record<string, unknown> | undefined;
  const delivery = pol?.delivery as { fee?: number; free_over?: number } | undefined;
  if (delivery) {
    if (delivery.fee != null && !ctx.provenance.price(delivery.fee)) { delete delivery.fee; rejected.push("delivery fee"); }
    if (delivery.free_over != null && !ctx.provenance.price(delivery.free_over)) { delete delivery.free_over; rejected.push("free delivery minimum"); }
  }
  for (const k of ["payment_instructions"]) {
    if (pol && typeof pol[k] === "string" && !ctx.provenance.text(pol[k] as string)) { delete pol[k]; rejected.push(k); }
  }

  const data = structuredClone(bp.data ?? {});
  const { applied, skipped } = mergePatch(data, patch, locked);
  const meta = { ...(bp.field_meta ?? {}) };
  const now = new Date().toISOString();
  for (const p of applied) meta[p] = { ...(meta[p] ?? {}), source: ctx.source, locked: false, updated_at: now } as never;
  await ctx.db.from("agent_blueprints").update({ data, field_meta: meta, pending_compile: true }).eq("agent_id", ctx.agent.id);

  for (const p of applied) ctx.emit({ type: "blueprint_patch", path: p, value: p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], data), source: ctx.source });
  for (const p of skipped) ctx.emit({ type: "skipped_locked", path: p });
  return { ok: true, saved: applied, skipped_locked: skipped, rejected_not_from_owner: rejected };
}

async function upsertCatalog(args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  const parsed = z.object({ items: z.array(catalogItem).max(200) }).safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid items", details: parsed.error.issues.slice(0, 3) };
  const saved: string[] = [], removed: string[] = [], skipped: string[] = [], rejected: string[] = [];
  const { data: existing } = await ctx.db.from("catalog_items").select("id,ref,name,locked").eq("agent_id", ctx.agent.id);
  const byRef = new Map((existing ?? []).map((e) => [e.ref, e]));
  const byName = new Map((existing ?? []).map((e) => [e.name.toLowerCase(), e]));

  for (const it of parsed.data.items) {
    const match = (it.match_ref && byRef.get(it.match_ref)) || byName.get(it.name.toLowerCase());
    if (match?.locked) { skipped.push(it.name); ctx.emit({ type: "skipped_locked", path: `catalog.${match.ref}` }); continue; }
    if (it.remove) {
      if (match) { await ctx.db.from("catalog_items").delete().eq("id", match.id); removed.push(it.name); ctx.emit({ type: "blueprint_patch", path: `catalog.${match.ref}`, source: ctx.source }); }
      continue;
    }
    const priceOk = ctx.provenance.price(it.price);
    const durOk = ctx.provenance.duration(it.duration_minutes);
    if (!priceOk) rejected.push(`${it.name}: price`);
    if (!durOk) rejected.push(`${it.name}: duration`);
    const row = {
      agent_id: ctx.agent.id, kind: it.kind, name: it.name, description: it.description ?? null,
      price_minor: priceOk && it.price != null ? Math.round(it.price * 100) : null,
      price_from: it.price_from ?? false, currency: (it.currency ?? ctx.workspace.currency).toUpperCase(),
      duration_minutes: durOk ? it.duration_minutes ?? null : null, source: ctx.source,
    };
    const res = match
      ? await ctx.db.from("catalog_items").update(row).eq("id", match.id).select("ref").single()
      : await ctx.db.from("catalog_items").insert(row).select("ref").single();
    if (res.data) { saved.push(`${it.name} [${res.data.ref}]`); ctx.emit({ type: "blueprint_patch", path: `catalog.${res.data.ref}`, value: row, source: ctx.source }); }
  }
  return { ok: true, saved, removed, skipped_locked: skipped, rejected_not_from_owner: rejected };
}

async function upsertFaqs(args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  const parsed = z.object({ faqs: z.array(z.object({ match_question: z.string().optional(), question: z.string().min(1).max(500), answer: z.string().min(1).max(3000), remove: z.boolean().optional() })).max(50) }).safeParse(args);
  if (!parsed.success) return { ok: false, error: "invalid faqs" };
  const { data: existing } = await ctx.db.from("faqs").select("id,question,locked").eq("agent_id", ctx.agent.id);
  const find = (q: string) => (existing ?? []).find((e) => e.question.toLowerCase().trim() === q.toLowerCase().trim());
  const saved: string[] = [], rejected: string[] = [], skipped: string[] = [];
  for (const f of parsed.data.faqs) {
    const match = find(f.match_question ?? f.question);
    if (match?.locked) { skipped.push(f.question); continue; }
    if (f.remove) { if (match) await ctx.db.from("faqs").delete().eq("id", match.id); ctx.emit({ type: "blueprint_patch", path: "faqs", source: ctx.source }); continue; }
    if (!ctx.provenance.text(f.answer)) { rejected.push(f.question); continue; }
    const row = { agent_id: ctx.agent.id, question: f.question, answer: f.answer, source: ctx.source };
    if (match) await ctx.db.from("faqs").update(row).eq("id", match.id); else await ctx.db.from("faqs").insert(row);
    saved.push(f.question);
    ctx.emit({ type: "blueprint_patch", path: "faqs", value: row, source: ctx.source });
  }
  return { ok: true, saved, skipped_locked: skipped, rejected_not_from_owner: rejected };
}

async function setAvailability(args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  if (ctx.agent.type !== "booking") return { ok: false, error: "availability is only for booking agents" };
  const schema = z.object({
    weekly: weekly.optional(),
    slot_interval_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
    buffer_minutes: z.number().int().min(0).max(240).optional(),
    capacity: z.number().int().min(1).max(100).optional(),
    min_notice_minutes: z.number().int().min(0).max(10080).optional(),
    max_days_ahead: z.number().int().min(1).max(365).optional(),
    auto_confirm: z.boolean().optional(),
    exceptions: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), closed: z.boolean(), start: z.string().regex(HHMM).optional(), end: z.string().regex(HHMM).optional(), note: z.string().max(200).optional() })).max(60).optional(),
  });
  const p = schema.safeParse(args);
  if (!p.success) return { ok: false, error: "invalid availability", details: p.error.issues.slice(0, 3) };
  const a = p.data;
  const rejected: string[] = [];
  if (a.weekly) {
    const ranges = Object.values(a.weekly).flat() as [string, string][];
    if (ranges.some(([s, e]) => !ctx.provenance.time(s) || !ctx.provenance.time(e))) {
      rejected.push("weekly hours (not stated by the owner)");
    } else {
      await ctx.db.from("availability_rules").delete().eq("agent_id", ctx.agent.id);
      const rows = Object.entries(a.weekly).flatMap(([day, rs]) => (rs ?? []).map(([s, e]) => ({ agent_id: ctx.agent.id, weekday: DAYS.indexOf(day as typeof DAYS[number]), start_time: s, end_time: e, source: ctx.source })));
      if (rows.length) await ctx.db.from("availability_rules").insert(rows);
      ctx.emit({ type: "blueprint_patch", path: "availability.weekly", value: a.weekly, source: ctx.source });
    }
  }
  if (a.capacity != null && a.capacity > 1 && !ctx.provenance.hasNumber(a.capacity)) { rejected.push("capacity"); delete a.capacity; }
  const settings = Object.fromEntries(Object.entries({
    slot_interval_minutes: a.slot_interval_minutes, buffer_minutes: a.buffer_minutes, capacity: a.capacity,
    min_notice_minutes: a.min_notice_minutes, max_days_ahead: a.max_days_ahead, auto_confirm: a.auto_confirm,
  }).filter(([, v]) => v !== undefined));
  if (Object.keys(settings).length) {
    await ctx.db.from("booking_settings").update(settings).eq("agent_id", ctx.agent.id);
    ctx.emit({ type: "blueprint_patch", path: "availability.settings", value: settings, source: ctx.source });
  }
  if (a.exceptions?.length) {
    await ctx.db.from("availability_exceptions").upsert(a.exceptions.map((x) => ({ agent_id: ctx.agent.id, date: x.date, closed: x.closed, start_time: x.start ?? null, end_time: x.end ?? null, note: x.note ?? null })), { onConflict: "agent_id,date" });
    ctx.emit({ type: "blueprint_patch", path: "availability.exceptions", value: a.exceptions, source: ctx.source });
  }
  await ctx.db.from("agent_blueprints").update({ pending_compile: true }).eq("agent_id", ctx.agent.id);
  return { ok: true, rejected_not_from_owner: rejected };
}

async function setHandoff(args: Record<string, unknown>, ctx: ToolContext): Promise<Result> {
  const phone = String(args.phone ?? "");
  if (!ctx.provenance.phone(phone)) return { ok: false, error: "That number wasn't in the owner's message; ask them to type it." };
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return { ok: false, error: "invalid phone number; ask for the full international number" };
  if (ctx.agent.wa_phone && ctx.agent.wa_phone.replace(/\D/g, "") === digits) return { ok: false, error: "This is the business WhatsApp number itself. Ask for a different personal number." };
  await ctx.db.from("agents").update({ handoff_phone_e164: `+${digits}`, handoff_verified_at: null }).eq("id", ctx.agent.id);
  ctx.emit({ type: "blueprint_patch", path: "handoff_phone", value: `+${digits}`, source: ctx.source });
  return { ok: true, saved: `+${digits}` };
}

/** Compact schema text for the JSON action protocol (keeps prompt tokens low). */
export function actionSpecText(names: string[]): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.type === "object" && o.properties) return Object.fromEntries(Object.entries(o.properties as Record<string, unknown>).map(([k, x]) => [k, strip(x)]));
      if (o.type === "array") return [strip(o.items)];
      const t = String(o.type ?? "");
      return o.enum ? (o.enum as unknown[]).join("|") : o.description ? `${t}: ${o.description}` : t;
    }
    return v;
  };
  return names.map((n) => `- ${n}: ${ORCHESTRATOR_TOOLS[n]!.description}\n  args: ${JSON.stringify(strip(ORCHESTRATOR_TOOLS[n]!.parameters))}`).join("\n");
}
