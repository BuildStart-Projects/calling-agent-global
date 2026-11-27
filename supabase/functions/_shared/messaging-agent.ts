// Messaging Agent turn: JSON action protocol over the ai-generate transport, server-side tools, reply validator.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aiGenerate, addUsage, parseJsonObject, MODELS, type ChatMessage, type Usage } from "./llm.ts";
import { toolsForType, runRuntimeTool, type RuntimeCtx } from "./runtime-tools.ts";
import { validateReply, type ValidationIssue } from "./validator.ts";
import { FIXED } from "./fixed-messages.ts";
import { compileMessaging, loadCompileContext, knowledgeBlocks } from "./compiler.ts";

type Envelope = { reply?: string; actions?: Array<{ tool: string; args?: Record<string, unknown> }>; off_topic?: boolean };

const PROTOCOL = (tools: ReturnType<typeof toolsForType>) => `
OUTPUT FORMAT (MANDATORY)
Reply with ONE JSON object and nothing else:
{"reply": string, "actions": [{"tool": string, "args": object}], "off_topic": boolean}
- "reply": the WhatsApp message to send the customer (plain text, WhatsApp formatting only).
- "actions": actions to run BEFORE your reply is sent (may be empty). If you need an action's result
  to answer (e.g. search_knowledge), return the action with an empty reply; you'll get the result and
  can then write the reply. Available actions:
${tools.map((t) => `- ${t.name}: ${t.description}\n  args: ${JSON.stringify(compactSchema(t.parameters))}`).join("\n")}
- "off_topic": true when the customer asks for something unrelated to the business (then reply is ignored).`;

export type MessagingTurnResult = {
  reply: string;
  refused: boolean;
  events: Array<{ tool: string; args: unknown; result: unknown }>;
  flags: ValidationIssue[];
  usage: Usage;
  handoff: boolean;
  dnc: boolean;
};

export async function runMessagingTurn(p: {
  db: SupabaseClient;
  agent: Record<string, any>;
  workspace: Record<string, any>;
  contact: RuntimeCtx["contact"];
  conversationId: string | null;
  history: Array<{ direction: "in" | "out"; sender: string; text: string | null; tool_events?: Array<{ tool: string; result?: unknown }> | null }>;
  summary?: string | null;
  isFirstContact: boolean;
  sandbox?: boolean;
  channel: "whatsapp" | "playground";
}): Promise<MessagingTurnResult> {
  const { db, agent } = p;
  const { data: cfg } = await db.from("channel_configs").select("compiled_prompt,off_topic_reply,handoff_caller_line,welcome_message").eq("agent_id", agent.id).eq("channel", "messaging").single();
  const ctx = await loadCompileContext(db, agent.id);
  const prompt = cfg?.compiled_prompt ?? (await compileMessaging(db, ctx)).prompt;
  const kb = knowledgeBlocks(ctx, "messaging", 40_000);
  const tz = ctx.bookingSettings?.timezone ?? ctx.workspace.timezone ?? "UTC";
  const now = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date());

  const contactCard = [
    `Current local date and time: ${now} (${tz}).`,
    p.contact?.name ? `Customer name: ${p.contact.name}.` : "Customer name: unknown.",
    p.isFirstContact ? "This is the customer's first conversation with us." : "Returning customer.",
    p.summary ? `Conversation so far (summary): ${p.summary}` : "",
  ].filter(Boolean).join("\n");

  const convo: ChatMessage[] = p.history.slice(-12).map((m) => ({
    role: m.direction === "in" ? "user" : "assistant",
    content: m.text ?? (m.direction === "in" ? "[customer sent a file]" : ""),
  }));
  while (convo.length && convo[0]!.role !== "user") convo.shift();
  if (!convo.length) convo.push({ role: "user", content: "Hi" });

  const tools = toolsForType(agent.type);
  // Results of earlier actions (exact slot times, quote ids, booking refs) so follow-up turns use real values.
  const recentResults = p.history.slice(-8).flatMap((m) => m.tool_events ?? []).filter((e) => e.result).slice(-4);
  const resultsNote = recentResults.length ? `\nRESULTS OF YOUR PREVIOUS ACTIONS (use these exact values, e.g. start_iso / quote_id):\n${JSON.stringify(recentResults).slice(0, 4000)}` : "";
  const system = `${prompt}\n\n${contactCard}${resultsNote}\n${PROTOCOL(tools)}`;
  const customerText = p.history.filter((m) => m.direction === "in").map((m) => m.text ?? "").join("\n");
  let allowed = [JSON.stringify(recentResultsFor(p.history)), kb.business_info_block, kb.hours_block, kb.catalog_block, kb.faq_block, kb.policies_block, kb.payment_block, customerText, agent.handoff_phone_e164 ?? "", ctx.blueprint.business?.website ?? ""].join("\n");

  const rctx: RuntimeCtx = { db, agent, workspaceId: p.workspace.id, contact: p.contact, conversationId: p.conversationId, channel: p.channel, sandbox: p.sandbox };
  const events: MessagingTurnResult["events"] = [];
  let usage: Usage = { input_tokens: 0, output_tokens: 0, estimated: false };
  let reply = "";
  let handoff = false, dnc = false;
  let flags: ValidationIssue[] = [];

  for (let round = 0; round < 4; round++) {
    const res = await aiGenerate({ model: (await modelFor(db)) ?? MODELS.messaging, messages: [{ role: "system", content: system }, ...convo], maxTokens: 900, temperature: 0.3 });
    usage = addUsage(usage, res.usage);
    const env = parseJsonObject<Envelope>(res.text);
    if (!env) {
      convo.push({ role: "assistant", content: res.text.slice(0, 1500) }, { role: "user", content: "[SYSTEM] Invalid format. Reply again with ONLY the JSON object." });
      continue;
    }
    if (env.off_topic) {
      return { reply: cfg?.off_topic_reply ?? FIXED.agent_off_topic.replace("{{business_name}}", ctx.blueprint.business?.name ?? "this business"), refused: true, events, flags, usage, handoff, dnc };
    }
    const acts = (env.actions ?? []).filter((a) => tools.some((t) => t.name === a.tool)).slice(0, 4);
    const results: Array<{ tool: string; result: unknown }> = [];
    for (const a of acts) {
      const result = await runRuntimeTool(a.tool, (a.args ?? {}) as Record<string, any>, rctx);
      events.push({ tool: a.tool, args: a.args, result });
      results.push({ tool: a.tool, result });
      if (a.tool === "handoff_to_human") handoff = true;
      if (a.tool === "mark_do_not_contact") dnc = true;
    }
    if (dnc) return { reply: FIXED.dnc_confirmation, refused: false, events, flags, usage, handoff, dnc };
    if (results.length) allowed += `\n${JSON.stringify(results)}`;

    const draft = String(env.reply ?? "").trim();
    const needsFollowUp = results.length > 0 && acts.some((a) => !["capture_lead", "handoff_to_human", "mark_do_not_contact"].includes(a.tool));
    if (!draft || needsFollowUp) {
      convo.push({ role: "assistant", content: JSON.stringify(env) }, { role: "user", content: `[SYSTEM] ACTION RESULTS: ${JSON.stringify(results)}\nNow write your reply to the customer based ONLY on these results (if ok is false, say so and offer the alternatives). JSON format; only include new actions if the customer already confirmed them.` });
      continue;
    }

    const issues = validateReply(draft, allowed);
    if (issues.length && round < 3) {
      flags = issues;
      convo.push({ role: "assistant", content: JSON.stringify(env) }, { role: "user", content: `[SYSTEM] Your reply mentions ${issues.map((i) => `"${i.value}"`).join(", ")}, which is not in the business information or action results. Remove it or say you'll check with the team. Reply again in JSON.` });
      continue;
    }
    reply = issues.length ? FIXED.validation_fallback : draft;
    flags = issues;
    break;
  }
  if (!reply) reply = FIXED.validation_fallback;
  // Handoff confirmation is a fixed message (never model-written), so it's always accurate.
  if (handoff) reply = cfg?.handoff_caller_line ?? FIXED.handoff_chat_line;
  return { reply, refused: false, events, flags, usage, handoff, dnc };
}

function recentResultsFor(history: Array<{ tool_events?: Array<{ result?: unknown }> | null }>) {
  return history.slice(-8).flatMap((m) => m.tool_events ?? []).map((e) => e.result).filter(Boolean);
}

/** Nested, compact arg shapes so the model sees exactly what goes inside arrays/objects. */
function compactSchema(v: any): unknown {
  if (!v || typeof v !== "object") return v;
  if (v.type === "object") return v.properties ? Object.fromEntries(Object.entries(v.properties).map(([k, x]) => [(v.required ?? []).includes(k) ? k : `${k}?`, compactSchema(x)])) : "object";
  if (v.type === "array") return [compactSchema(v.items)];
  if (v.enum) return v.enum.join("|");
  return v.description ? `${v.type}: ${v.description}` : v.type;
}

let cachedModel: { v: string | null; at: number } | null = null;
async function modelFor(db: SupabaseClient): Promise<string | null> {
  if (cachedModel && Date.now() - cachedModel.at < 60_000) return cachedModel.v;
  const { data } = await db.from("platform_settings").select("value").eq("key", "models").maybeSingle();
  cachedModel = { v: (data?.value?.messaging as string) ?? null, at: Date.now() };
  return cachedModel.v;
}
