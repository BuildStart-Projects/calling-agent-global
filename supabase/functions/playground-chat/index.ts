// Test playground: the real Messaging Agent in sandbox mode (no WhatsApp send, test records, playground meter).
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess } from "../_shared/supabase.ts";
import { runMessagingTurn } from "../_shared/messaging-agent.ts";
import { compileAgent } from "../_shared/compile-agent.ts";
import { chargeUsage, hasCredits } from "../_shared/credits.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";

const Body = z.object({ agent_id: z.string().uuid(), message: z.string().trim().max(2000).optional(), reset: z.boolean().optional() });

serveHandler("playground-chat", async (req) => {
  const body = Body.parse(await readJson(req));
  const { db, agent, workspace, user } = await requireAgentAccess(req, body.agent_id);
  await enforceRateLimit(db, `playground:${user.id}`, 30, 60, "Slow down a little — try again in a moment.");

  // One sandbox contact + conversation per user and agent.
  const jid = `playground:${user.id}`;
  let { data: contact } = await db.from("contacts").select("*").eq("workspace_id", workspace.id).eq("wa_jid", jid).maybeSingle();
  if (!contact) contact = (await db.from("contacts").insert({ workspace_id: workspace.id, wa_jid: jid, name: "You (test)", source: "playground" }).select("*").single()).data;
  let { data: convo } = await db.from("conversations").select("*").eq("agent_id", agent.id).eq("contact_id", contact.id).maybeSingle();
  if (!convo) convo = (await db.from("conversations").insert({ agent_id: agent.id, contact_id: contact.id, is_test: true }).select("*").single()).data;

  if (body.reset) {
    await db.from("messages").delete().eq("conversation_id", convo.id);
    await db.from("conversations").update({ welcomed: false, summary: null }).eq("id", convo.id);
    await db.from("leads").delete().eq("agent_id", agent.id).eq("is_test", true);
    return json(req, { reset: true });
  }
  if (!body.message) throw new HttpError(400, "invalid", "Type a message to test.");
  if (!(await hasCredits(db, workspace.id, 0.05))) throw new HttpError(402, "out_of_credits", "You're out of credits. Top up to keep testing.");

  const { data: bp } = await db.from("agent_blueprints").select("pending_compile").eq("agent_id", agent.id).single();
  const { data: cfg } = await db.from("channel_configs").select("compiled_prompt").eq("agent_id", agent.id).eq("channel", "messaging").single();
  if (bp?.pending_compile || !cfg?.compiled_prompt) await compileAgent(db, agent.id);

  await db.from("messages").insert({ conversation_id: convo.id, direction: "in", sender: "customer", text: body.message, status: "received" });
  const { data: history } = await db.from("messages").select("direction,sender,text,tool_events").eq("conversation_id", convo.id).order("created_at", { ascending: false }).limit(20);
  const result = await runMessagingTurn({
    db, agent, workspace, contact: { id: contact.id, phone_e164: null, name: null, wa_jid: jid }, conversationId: convo.id,
    history: (history ?? []).reverse(), summary: convo.summary, isFirstContact: !convo.welcomed, sandbox: true, channel: "playground",
  });
  await db.from("messages").insert({ conversation_id: convo.id, direction: "out", sender: "ai", text: result.reply, status: "sent", refusal: result.refused, validation_flags: result.flags, tool_events: result.events });
  await db.from("conversations").update({ welcomed: true }).eq("id", convo.id);
  await chargeUsage(db, { workspaceId: workspace.id, agentId: agent.id, agentKind: "messaging", meter: "playground_tokens", usage: result.usage, refType: "playground", refId: convo.id });
  return json(req, { reply: result.reply, refused: result.refused, actions: result.events.map((e) => e.tool), flags: result.flags });
});
