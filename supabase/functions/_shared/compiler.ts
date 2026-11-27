// Deterministic prompt compiler for the Calling Agent and Messaging Agent (IMPLEMENTATION_PLAN.md §10.2).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { render, template } from "./templating.ts";
import { aiGenerate, parseJsonObject, MODELS, type Usage, addUsage } from "./llm.ts";
import { FIXED, fill } from "./fixed-messages.ts";
import type { AgentConfigPayload } from "./engine.ts";
import { CALLING_TOOL_DECLARATIONS } from "./runtime-tools.ts";

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const WEEKDAY_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const PERSONA: Record<string, string> = {
  friendly: "friendly and warm, with a natural smile in your voice",
  professional: "professional and calm, clear and composed",
  energetic: "upbeat and energetic, positive without being loud",
  reassuring: "gentle and reassuring, patient and kind",
};
export const EMOJI_RULE: Record<string, string> = {
  none: "Don't use emojis.",
  light: "Use at most one emoji per message, only where it helps (✅ confirmations, 📅 dates).",
  expressive: "Use a few friendly emojis to structure messages (max 3 per message).",
};
const GOAL_LABEL: Record<string, string> = { appointment: "an appointment", book_visit: "a visit", quote: "a quote", callback: "a callback from the team", order: "an order" };

export type CompileContext = Awaited<ReturnType<typeof loadCompileContext>>;

export async function loadCompileContext(db: SupabaseClient, agentId: string) {
  const [agent, bp, catalog, faqs, rules, settings, channels] = await Promise.all([
    db.from("agents").select("*").eq("id", agentId).single(),
    db.from("agent_blueprints").select("data").eq("agent_id", agentId).single(),
    db.from("catalog_items").select("*").eq("agent_id", agentId).eq("active", true).order("sort").order("created_at"),
    db.from("faqs").select("*").eq("agent_id", agentId).eq("active", true).order("sort").order("created_at"),
    db.from("availability_rules").select("weekday,start_time,end_time").eq("agent_id", agentId).order("weekday").order("start_time"),
    db.from("booking_settings").select("*").eq("agent_id", agentId).maybeSingle(),
    db.from("channel_configs").select("*").eq("agent_id", agentId),
  ]);
  const { data: ws } = await db.from("workspaces").select("*").eq("id", agent.data.workspace_id).single();
  const { data: plan } = await db.from("plans").select("limits").eq("id", ws.plan_id).maybeSingle();
  const { data: langs } = await db.from("languages").select("code,label");
  return {
    agent: agent.data, blueprint: (bp.data?.data ?? {}) as Record<string, any>, catalog: catalog.data ?? [], faqs: faqs.data ?? [],
    rules: rules.data ?? [], bookingSettings: settings.data, workspace: ws, planLimits: (plan?.limits ?? {}) as Record<string, any>,
    calling: (channels.data ?? []).find((c) => c.channel === "calling"), messaging: (channels.data ?? []).find((c) => c.channel === "messaging"),
    languages: new Map((langs ?? []).map((l) => [l.code, l.label])),
  };
}

function money(minor: number | null, currency: string | null, from: boolean) {
  if (minor == null) return "";
  const v = (minor / 100).toFixed(minor % 100 ? 2 : 0);
  return `${from ? "from " : ""}${v} ${currency ?? ""}`.trim();
}

/** Knowledge blocks shared by both agents; `channel` filters by in_calling / in_messaging. */
export function knowledgeBlocks(c: CompileContext, channel: "calling" | "messaging", budgetChars: number) {
  const b = c.blueprint.business ?? {};
  const info = [
    b.name && `Business: ${b.name}`, b.industry && `Type: ${b.industry}`, b.description && `About: ${b.description}`,
    b.address && `Address: ${b.address}`, b.service_area && `Service area: ${b.service_area}`, b.website && `Website: ${b.website}`,
  ].filter(Boolean).join("\n");

  // Hours: prefer booking availability for booking agents, else blueprint hours.
  let hours = "";
  if (c.rules.length) {
    const byDay = new Map<string, string[]>();
    for (const r of c.rules) byDay.set(WEEKDAY_KEY[r.weekday]!, [...(byDay.get(WEEKDAY_KEY[r.weekday]!) ?? []), `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`]);
    hours = DAY_ORDER.map((d) => `${DAY_LABEL[d]} ${byDay.get(d)?.join(", ") ?? "closed"}`).join("; ");
  } else if (c.blueprint.hours && Object.keys(c.blueprint.hours).length) {
    hours = DAY_ORDER.map((d) => {
      const r = c.blueprint.hours[d] as [string, string][] | undefined;
      return `${DAY_LABEL[d]} ${r?.length ? r.map(([s, e]) => `${s}–${e}`).join(", ") : "closed"}`;
    }).join("; ");
  }

  const flag = channel === "calling" ? "in_calling" : "in_messaging";
  const items = c.catalog.filter((i: any) => i[flag]);
  const faqs = c.faqs.filter((f: any) => f[flag]);
  let catalogLines = items.map((i: any) => `- [${i.ref}] ${i.name}${i.duration_minutes ? ` (${i.duration_minutes} min)` : ""}${i.price_minor != null ? `: ${money(i.price_minor, i.currency, i.price_from)}` : ""}${i.description ? `. ${i.description}` : ""}`);
  let faqLines = faqs.map((f: any) => `Q: ${f.question}\nA: ${f.answer}`);

  // Size budget: trim descriptions first, then drop FAQs beyond the top 20.
  const size = () => catalogLines.join("\n").length + faqLines.join("\n").length + info.length + hours.length;
  if (size() > budgetChars) catalogLines = items.map((i: any) => `- [${i.ref}] ${i.name}${i.duration_minutes ? ` (${i.duration_minutes} min)` : ""}${i.price_minor != null ? `: ${money(i.price_minor, i.currency, i.price_from)}` : ""}`);
  if (size() > budgetChars) faqLines = faqLines.slice(0, 20);

  const p = c.blueprint.policies ?? {};
  const policies = [
    p.cancellation && `Cancellation: ${p.cancellation}`, p.deposit && `Deposit: ${p.deposit}`, p.returns && `Returns: ${p.returns}`,
    p.delivery?.enabled && `Delivery: ${[p.delivery.areas && `areas ${p.delivery.areas}`, p.delivery.fee != null && `fee ${p.delivery.fee} ${b.currency ?? ""}`, p.delivery.free_over != null && `free over ${p.delivery.free_over} ${b.currency ?? ""}`, p.delivery.eta && `usually ${p.delivery.eta}`].filter(Boolean).join(", ")}`,
    p.pickup?.enabled && `Pickup: ${p.pickup.address ?? "available"}`, p.other,
    c.blueprint.notes && `Notes from the owner: ${c.blueprint.notes}`,
  ].filter(Boolean).join("\n");
  const payment = [p.payment_methods?.length && `Accepted: ${p.payment_methods.join(", ").replace(/_/g, " ")}`, p.payment_instructions].filter(Boolean).join("\n");

  return {
    business_info_block: info || "(no business details yet)",
    hours_block: hours,
    catalog_heading: c.agent.type === "order" ? "Products" : "Services",
    catalog_block: catalogLines.join("\n"),
    faq_block: faqLines.join("\n"),
    policies_block: policies,
    payment_block: payment,
  };
}

function splitType(body: string): { objective: string; flow: string } {
  const [objective, ...rest] = body.split(/\n---\n/);
  return { objective: (objective ?? "").trim(), flow: rest.join("\n").trim() };
}

function languageName(c: CompileContext, code: string) {
  return c.languages.get(code) ?? new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
}

function sharedVars(c: CompileContext, channelCfg: any) {
  const collect = (c.blueprint.collect_fields ?? []).filter((f: string) => f !== "name").map((f: string) => f.replace(/_/g, " "));
  const tone = channelCfg?.persona_style ?? c.blueprint.tone ?? "friendly";
  return {
    agent_name: "the assistant",
    business_name: c.blueprint.business?.name ?? c.agent.name,
    business_description: c.blueprint.business?.industry ?? "",
    persona_style_description: PERSONA[tone] ?? PERSONA.friendly,
    default_language_name: languageName(c, channelCfg?.language ?? c.workspace.locale ?? "en-US"),
    adapt_language: channelCfg?.adapt_language ?? true,
    timezone_label: c.bookingSettings?.timezone ?? c.blueprint.business?.timezone ?? c.workspace.timezone,
    emergency_rule: c.blueprint.emergency_rule ?? "",
    custom_instructions: channelCfg?.custom_instructions ?? "",
    collect_extra: collect.join(", "),
    collect_fields_label: ["name", ...collect].join(", "),
    goal_label: GOAL_LABEL[c.blueprint.goal ?? ""] ?? "the next step",
    response_time: c.blueprint.response_time ?? "",
    delivery_areas: c.blueprint.policies?.delivery?.enabled ? c.blueprint.policies.delivery.areas ?? "" : "",
    is_home_services: c.agent.industry_key === "home_services",
    has_booking_tools: c.agent.type === "booking",
    has_order_tools: c.agent.type === "order",
  };
}

/** Short texts in the agent's language (one cheap call, only when missing or language changed). */
export async function ensureShortTexts(db: SupabaseClient, c: CompileContext): Promise<{ usage: Usage; updated: boolean }> {
  const cfg = c.calling;
  const mcfg = c.messaging;
  const lang = cfg?.language ?? "en-US";
  const businessName = c.blueprint.business?.name ?? c.agent.name;
  const needs = !cfg?.greeting || !cfg?.missed_call_message || !cfg?.off_topic_reply || !cfg?.handoff_caller_line || !mcfg?.welcome_message || !mcfg?.off_topic_reply;
  if (!needs) return { usage: { input_tokens: 0, output_tokens: 0, estimated: false }, updated: false };

  const t = await template(db, "generate.greeting");
  const prompt = render(t.body, {
    business_name: businessName, industry: c.blueprint.business?.industry ?? "business", language_name: languageName(c, lang),
    persona_style: cfg?.persona_style ?? "friendly", emoji_rule: EMOJI_RULE[mcfg?.emoji_level ?? "light"],
    off_topic_source: fill(FIXED.agent_off_topic, { business_name: businessName }),
    handoff_caller_source: FIXED.handoff_caller_line, handoff_chat_source: FIXED.handoff_chat_line,
  });
  const res = await aiGenerate({ model: MODELS.light, messages: [{ role: "user", content: prompt }], maxTokens: 700, temperature: 0.4 });
  const j = parseJsonObject<Record<string, string>>(res.text) ?? {};
  const isEnglish = lang.startsWith("en");
  const offTopic = isEnglish ? fill(FIXED.agent_off_topic, { business_name: businessName }) : j.off_topic_reply;
  await db.from("channel_configs").update({
    greeting: cfg?.greeting || j.greeting || `Hi! Thanks for calling ${businessName}. How can I help?`,
    missed_call_message: cfg?.missed_call_message || j.missed_call_message || `Sorry we missed your call — we'll call you right back.`,
    callback_greeting: cfg?.callback_greeting || j.callback_greeting || `Hi, this is ${businessName} returning your call.`,
    off_topic_reply: cfg?.off_topic_reply || offTopic || fill(FIXED.agent_off_topic, { business_name: businessName }),
    handoff_caller_line: cfg?.handoff_caller_line || (isEnglish ? FIXED.handoff_caller_line : j.handoff_caller_line) || FIXED.handoff_caller_line,
  }).eq("agent_id", c.agent.id).eq("channel", "calling");
  await db.from("channel_configs").update({
    welcome_message: mcfg?.welcome_message || j.welcome_message || null,
    off_topic_reply: mcfg?.off_topic_reply || offTopic || fill(FIXED.agent_off_topic, { business_name: businessName }),
    handoff_caller_line: mcfg?.handoff_caller_line || (isEnglish ? FIXED.handoff_chat_line : j.handoff_chat_line) || FIXED.handoff_chat_line,
  }).eq("agent_id", c.agent.id).eq("channel", "messaging");
  return { usage: res.usage, updated: true };
}

export async function compileCalling(db: SupabaseClient, c: CompileContext) {
  const [base, type] = await Promise.all([template(db, "calling.base"), template(db, `calling.type.${c.agent.type}`)]);
  const vars = sharedVars(c, c.calling);
  const t = splitType(render(type.body, vars));
  const prompt = render(base.body, {
    ...vars, ...knowledgeBlocks(c, "calling", 24_000),
    type_objective: t.objective, type_flow: t.flow,
    off_topic_reply: c.calling?.off_topic_reply ?? fill(FIXED.agent_off_topic, { business_name: vars.business_name }),
    handoff_caller_line: c.calling?.handoff_caller_line ?? FIXED.handoff_caller_line,
  });
  return { prompt, version: base.version * 1000 + type.version };
}

export async function compileMessaging(db: SupabaseClient, c: CompileContext) {
  const [base, type] = await Promise.all([template(db, "messaging.base"), template(db, `messaging.type.${c.agent.type}`)]);
  const vars = sharedVars(c, c.messaging?.synced_from_calling ? { ...c.messaging, ...pick(c.calling, ["language", "adapt_language", "persona_style", "custom_instructions"]) } : c.messaging);
  const t = splitType(render(type.body, vars));
  const prompt = render(base.body, {
    ...vars, ...knowledgeBlocks(c, "messaging", 40_000),
    type_objective: t.objective, type_flow: t.flow,
    emoji_rule: EMOJI_RULE[c.messaging?.emoji_level ?? "light"],
    welcome_message: c.messaging?.welcome_message ?? "",
  });
  return { prompt, version: base.version * 1000 + type.version };
}

function pick(o: any, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o?.[k]]).filter(([, v]) => v !== undefined && v !== null));
}

export async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function engineConfig(c: CompileContext, callingPrompt: string): AgentConfigPayload {
  const paused = c.agent.status === "paused";
  const live = c.agent.status === "live" || c.agent.status === "ready";
  return {
    business_prompt: callingPrompt,
    greeting_message: c.calling?.greeting ?? "",
    callback_greeting: c.calling?.callback_greeting ?? "",
    fallback_message: c.calling?.missed_call_message ?? "",
    voice_model: c.calling?.voice_name ?? "Aoede",
    voice_enabled: live && !paused && c.agent.calling_enabled,
    auto_answer: true,
    auto_callback: live && !paused && c.agent.calling_enabled,
    callback_keywords: ["call me", "callback", "call back"],
    max_call_seconds: Number(c.planLimits.max_call_seconds ?? 900),
    timezone: c.bookingSettings?.timezone ?? c.blueprint.business?.timezone ?? c.workspace.timezone ?? "UTC",
    tools: CALLING_TOOL_DECLARATIONS(c.agent.type),
  };
}

export { addUsage };
