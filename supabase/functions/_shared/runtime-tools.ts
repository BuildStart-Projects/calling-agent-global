// Runtime tools used by the Messaging Agent (JSON actions) and the Calling Agent (Gemini Live tool.invoke).
// Business rules are enforced here, server-side; tools are always scoped to the agent.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { engine } from "./engine.ts";
import { FIXED, fill } from "./fixed-messages.ts";
import { BOOKING_TOOLS, ORDER_TOOLS, COMMERCE_TOOL_NAMES, runCommerceTool } from "./commerce-tools.ts";

export type RuntimeCtx = {
  db: SupabaseClient;
  agent: Record<string, any>;
  workspaceId: string;
  contact: { id: string; phone_e164: string | null; name: string | null; wa_jid: string | null } | null;
  conversationId?: string | null;
  channel: "call" | "whatsapp" | "playground";
  sandbox?: boolean;
  clientRef?: string | null; // campaign_target id on campaign calls
};

type ToolDecl = { name: string; description: string; parameters: Record<string, unknown> };

const BASE_TOOLS: ToolDecl[] = [
  {
    name: "search_knowledge",
    description: "Search the business's services, products, FAQs and notes for something not in your instructions.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "capture_lead",
    description: "Record what the customer wants so the team can follow up (questions you can't answer, booking or order requests, quote requests).",
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string", description: "e.g. booking_request, order_request, quote, callback, question" },
        summary: { type: "string", description: "One or two sentences" },
        details: { type: "object", description: "Key details such as preferred time, items, address" },
        urgency: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["intent", "summary"],
    },
  },
  {
    name: "handoff_to_human",
    description: "Alert the business owner that this customer wants to talk to a person.",
    parameters: { type: "object", properties: { reason: { type: "string" }, summary: { type: "string" }, urgency: { type: "string", enum: ["normal", "high"] } }, required: ["reason"] },
  },
  {
    name: "mark_do_not_contact",
    description: "The customer asked not to be contacted or called again.",
    parameters: { type: "object", properties: { reason: { type: "string" } } },
  },
];

/** Gemini Live functionDeclarations sent to the engine (agent config `tools`). end_call is engine built-in. */
export function toolsForType(type: string): ToolDecl[] {
  return [...BASE_TOOLS, ...(type === "booking" ? BOOKING_TOOLS : type === "order" ? ORDER_TOOLS : [])];
}

export function CALLING_TOOL_DECLARATIONS(type: string): ToolDecl[] {
  return [
    ...toolsForType(type),
    {
      name: "record_campaign_outcome",
      description: "Only on outbound campaign calls: record the result of the call once, just before ending it.",
      parameters: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["booked", "ordered", "interested", "not_interested", "callback_requested", "wrong_number", "do_not_call", "unknown"] },
          summary: { type: "string", description: "One sentence" },
          callback_at_iso: { type: "string", description: "When the customer asked to be called back, ISO 8601 with offset" },
        },
        required: ["outcome"],
      },
    },
    { name: "end_call", description: "End the call after saying goodbye.", parameters: { type: "object", properties: {} } },
  ];
}

export const MESSAGING_TOOLS = BASE_TOOLS;

export async function runRuntimeTool(name: string, args: Record<string, any>, ctx: RuntimeCtx): Promise<Record<string, unknown>> {
  if (COMMERCE_TOOL_NAMES.has(name)) {
    const allowed = toolsForType(ctx.agent.type).some((t) => t.name === name);
    return allowed ? runCommerceTool(name, args, ctx) : { ok: false, error: "tool not available for this agent" };
  }
  switch (name) {
    case "search_knowledge": return searchKnowledge(String(args.query ?? ""), ctx);
    case "capture_lead": return captureLead(args, ctx);
    case "handoff_to_human": return handoff(args, ctx);
    case "mark_do_not_contact": return markDnc(args, ctx);
    case "record_campaign_outcome": return recordOutcome(args, ctx);
    default: return { ok: false, error: "unknown tool" };
  }
}

async function searchKnowledge(q: string, ctx: RuntimeCtx) {
  const term = q.trim().slice(0, 80);
  if (!term) return { ok: true, results: [] };
  const like = `%${term.replace(/[%_]/g, "")}%`;
  const [items, faqs] = await Promise.all([
    ctx.db.from("catalog_items").select("ref,name,description,price_minor,price_from,currency,duration_minutes").eq("agent_id", ctx.agent.id).eq("active", true).or(`name.ilike.${like},description.ilike.${like}`).limit(5),
    ctx.db.from("faqs").select("question,answer").eq("agent_id", ctx.agent.id).eq("active", true).or(`question.ilike.${like},answer.ilike.${like}`).limit(5),
  ]);
  return {
    ok: true,
    results: [
      ...(items.data ?? []).map((i) => ({ type: "item", ref: i.ref, name: i.name, price: i.price_minor != null ? `${i.price_from ? "from " : ""}${(i.price_minor / 100).toFixed(i.price_minor % 100 ? 2 : 0)} ${i.currency}` : null, duration_minutes: i.duration_minutes, description: i.description })),
      ...(faqs.data ?? []).map((f) => ({ type: "faq", question: f.question, answer: f.answer })),
    ],
  };
}

async function captureLead(args: Record<string, any>, ctx: RuntimeCtx) {
  const row = {
    agent_id: ctx.agent.id, workspace_id: ctx.workspaceId, contact_id: ctx.contact?.id ?? null,
    intent: String(args.intent ?? "question").slice(0, 60), summary: String(args.summary ?? "").slice(0, 1000),
    details: typeof args.details === "object" && args.details ? args.details : {},
    urgency: ["low", "normal", "high"].includes(args.urgency) ? args.urgency : "normal",
    source: ctx.channel === "call" ? "call" : ctx.channel === "playground" ? "playground" : "whatsapp",
    is_test: Boolean(ctx.sandbox),
  };
  // One open lead per contact + intent: update instead of duplicating.
  const { data: existing } = ctx.contact
    ? await ctx.db.from("leads").select("id").eq("agent_id", ctx.agent.id).eq("contact_id", ctx.contact.id).eq("intent", row.intent).in("status", ["new", "contacted"]).maybeSingle()
    : { data: null };
  if (existing) await ctx.db.from("leads").update({ summary: row.summary, details: row.details, urgency: row.urgency }).eq("id", existing.id);
  else await ctx.db.from("leads").insert(row);
  if (!ctx.sandbox) await notify(ctx.db, ctx.workspaceId, "lead", `New ${row.intent.replace(/_/g, " ")}`, `${ctx.contact?.name ?? ctx.contact?.phone_e164 ?? "A customer"}: ${row.summary}`, "/app/leads");
  return { ok: true, recorded: true };
}

const OUTCOMES = ["booked", "ordered", "interested", "not_interested", "callback_requested", "wrong_number", "do_not_call", "unknown"];
async function recordOutcome(args: Record<string, any>, ctx: RuntimeCtx) {
  if (!ctx.clientRef || ctx.sandbox) return { ok: true, note: "not a campaign call" };
  const outcome = OUTCOMES.includes(args.outcome) ? args.outcome : "unknown";
  const cb = args.callback_at_iso ? new Date(String(args.callback_at_iso)) : null;
  const callback = cb && !isNaN(+cb) && +cb > Date.now() && +cb < Date.now() + 60 * 86_400_000 ? cb.toISOString() : null;
  await ctx.db.from("campaign_targets").update({ outcome, outcome_summary: args.summary ? String(args.summary).slice(0, 500) : null, callback_at: callback }).eq("id", ctx.clientRef);
  if (outcome === "do_not_call") await markDnc({ reason: "requested_on_campaign_call" }, ctx);
  return { ok: true };
}

async function markDnc(args: Record<string, any>, ctx: RuntimeCtx) {
  if (!ctx.contact || ctx.sandbox) return { ok: true };
  await ctx.db.from("contacts").update({ do_not_contact: true, dnc_reason: String(args.reason ?? "requested"), dnc_at: new Date().toISOString() }).eq("id", ctx.contact.id);
  if (ctx.contact.phone_e164) {
    await ctx.db.from("dnc_list").upsert({ workspace_id: ctx.workspaceId, phone_e164: ctx.contact.phone_e164, reason: ctx.channel === "call" ? "requested_on_call" : "replied_stop" });
  }
  return { ok: true };
}

/** Human handoff: WhatsApp alert from the agent's connected number to the owner's handoff number (§15.3). */
export async function handoff(args: Record<string, any>, ctx: RuntimeCtx) {
  const reason = String(args.reason ?? "Wants to talk to a person").slice(0, 300);
  if (ctx.sandbox) return { ok: true, test: true };

  // Merge duplicate alerts for the same contact within 10 minutes.
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: recent } = ctx.contact
    ? await ctx.db.from("handoff_alerts").select("id").eq("agent_id", ctx.agent.id).eq("contact_id", ctx.contact.id).gte("created_at", since).limit(1)
    : { data: [] };
  if (ctx.conversationId) {
    await ctx.db.from("conversations").update({ needs_attention: true, ...(ctx.channel === "whatsapp" ? { ai_paused: true, paused_by: "handoff", paused_until: new Date(Date.now() + 24 * 3600_000).toISOString() } : {}) }).eq("id", ctx.conversationId);
  }
  if (recent?.length) return { ok: true, merged: true };

  let delivered = false;
  const to = ctx.agent.handoff_phone_e164 as string | null;
  if (to && ctx.agent.engine_session_id && ctx.agent.wa_status === "connected") {
    const digits = (ctx.contact?.phone_e164 ?? "").replace(/\D/g, "");
    const text = fill(FIXED.handoff_owner_alert, {
      customer_name_or_number: ctx.contact?.name ?? ctx.contact?.phone_e164 ?? "Unknown",
      customer_number: ctx.contact?.phone_e164 ?? "unknown",
      channel: ctx.channel === "call" ? "Phone call" : "WhatsApp chat",
      agent_name: ctx.agent.name,
      reason,
      summary_line: args.summary ? `Summary: ${String(args.summary).slice(0, 400)}\n` : "",
      customer_digits: digits,
    });
    try { await engine.sendText(ctx.agent.engine_session_id, to, text); delivered = true; } catch (e) { console.error(JSON.stringify({ where: "handoff", error: String(e) })); }
  }
  await ctx.db.from("handoff_alerts").insert({ agent_id: ctx.agent.id, contact_id: ctx.contact?.id ?? null, channel: ctx.channel, reason, delivered });
  await notify(ctx.db, ctx.workspaceId, "handoff", "🙋 A customer wants a person", `${ctx.contact?.name ?? ctx.contact?.phone_e164 ?? "A customer"}: ${reason}`, "/app/inbox?filter=attention");
  return { ok: true, delivered };
}

export async function notify(db: SupabaseClient, workspaceId: string, type: string, title: string, body: string, link?: string) {
  await db.from("notifications").insert({ workspace_id: workspaceId, type, title, body: body.slice(0, 500), link: link ?? null });
}
