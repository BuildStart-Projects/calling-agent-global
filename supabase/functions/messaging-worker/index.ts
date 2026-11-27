// Inbound WhatsApp queue worker: per-conversation lock, debounce-merged turns, retries. Service role only.
import { isServiceOrCron } from "../_shared/cron.ts";
import { serveHandler, HttpError, json, log } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { engine } from "../_shared/engine.ts";
import { runMessagingTurn } from "../_shared/messaging-agent.ts";
import { chargeUsage, hasCredits } from "../_shared/credits.ts";
import { aiGenerate, MODELS } from "../_shared/llm.ts";
import { template } from "../_shared/templating.ts";
import { notify } from "../_shared/runtime-tools.ts";

type Db = ReturnType<typeof serviceClient>;

serveHandler("messaging-worker", async (req, { requestId }) => {
  if (!isServiceOrCron(req)) throw new HttpError(401, "unauthorized", "Service only.");
  const db = serviceClient();
  let processed = 0;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const { data: batch, error } = await db.rpc("claim_inbound", { p_limit: 3 });
    if (error) throw error;
    if (!batch?.length) break;
    await Promise.all(batch.map((b: { conversation_id: string; agent_id: string; queue_ids: string[] }) => handleConversation(db, b).catch(async (e) => {
      console.error(JSON.stringify({ fn: "messaging-worker", requestId, error: String(e) }));
      await fail(db, b.queue_ids, String(e));
    })));
    processed += batch.length;
  }
  log("messaging-worker", requestId, { processed });
  return json(req, { processed });
});

async function finish(db: Db, ids: string[], status: "done" | "skipped", error?: string) {
  await db.from("inbound_queue").update({ status, locked_at: null, error: error ?? null }).in("id", ids);
}

async function fail(db: Db, ids: string[], error: string) {
  const { data: rows } = await db.from("inbound_queue").select("id,attempts,agent_id").in("id", ids);
  for (const r of rows ?? []) {
    if (r.attempts >= 3) {
      await db.from("inbound_queue").update({ status: "dead", error: error.slice(0, 500), locked_at: null }).eq("id", r.id);
    } else {
      const backoff = [10, 60, 300][r.attempts - 1] ?? 300;
      await db.from("inbound_queue").update({ status: "pending", error: error.slice(0, 500), locked_at: null, available_at: new Date(Date.now() + backoff * 1000).toISOString() }).eq("id", r.id);
    }
  }
}

async function handleConversation(db: Db, b: { conversation_id: string; agent_id: string; queue_ids: string[] }) {
  const [{ data: convo }, { data: agent }] = await Promise.all([
    db.from("conversations").select("*, contact:contacts(*)").eq("id", b.conversation_id).single(),
    db.from("agents").select("*").eq("id", b.agent_id).single(),
  ]);
  const { data: ws } = await db.from("workspaces").select("*").eq("id", agent.workspace_id).single();
  const contact = convo.contact;

  const pausedUntil = convo.paused_until ? new Date(convo.paused_until).getTime() : 0;
  const paused = convo.ai_paused && (!pausedUntil || pausedUntil > Date.now());
  if (convo.ai_paused && pausedUntil && pausedUntil <= Date.now()) await db.from("conversations").update({ ai_paused: false, paused_by: null, paused_until: null }).eq("id", convo.id);
  const skipReason =
    ws.status !== "active" ? "workspace_suspended" :
    agent.status !== "live" ? "agent_not_live" :
    !agent.messaging_enabled ? "messaging_disabled" :
    agent.wa_status !== "connected" || !agent.engine_session_id ? "whatsapp_disconnected" :
    paused ? "ai_paused" : null;
  if (skipReason) return finish(db, b.queue_ids, "skipped", skipReason);
  if (!(await hasCredits(db, ws.id, 0.05))) {
    await notifyOnce(db, ws.id, "credits", "⚡ Out of credits", "Your Messaging Agent stopped replying because you're out of credits.");
    return finish(db, b.queue_ids, "skipped", "out_of_credits");
  }

  const { data: history } = await db.from("messages").select("direction,sender,text,type,wa_message_id,tool_events").eq("conversation_id", convo.id).order("created_at", { ascending: false }).limit(20);
  const ordered = (history ?? []).reverse();
  const to = contact.phone_e164 ?? contact.wa_jid;
  try { await engine.presence(agent.engine_session_id, to, "composing"); } catch { /* best effort */ }

  const result = await runMessagingTurn({
    db, agent, workspace: ws, contact: { id: contact.id, phone_e164: contact.phone_e164, name: contact.name ?? contact.push_name, wa_jid: contact.wa_jid },
    conversationId: convo.id, history: ordered.map((m) => ({ direction: m.direction, sender: m.sender, tool_events: m.tool_events, text: m.type !== "text" && !m.text ? `[customer sent a ${m.type}]` : m.text })),
    summary: convo.summary, isFirstContact: !convo.welcomed, channel: "whatsapp",
  });

  const sent = await sendLong(agent.engine_session_id, to, result.reply);
  await db.from("messages").insert({
    conversation_id: convo.id, direction: "out", sender: "ai", type: "text", text: result.reply, wa_message_id: sent[0] ?? null,
    status: sent.length ? "sent" : "failed", refusal: result.refused, validation_flags: result.flags, tool_events: result.events,
  });
  await db.from("conversations").update({ welcomed: true, last_message_at: new Date().toISOString(), last_message_preview: result.reply.slice(0, 140) }).eq("id", convo.id);
  const lastIn = ordered.filter((m) => m.direction === "in" && m.wa_message_id).at(-1);
  if (lastIn) { try { await engine.markRead(agent.engine_session_id, lastIn.wa_message_id!, to); } catch { /* best effort */ } }
  await chargeUsage(db, { workspaceId: ws.id, agentId: agent.id, agentKind: "messaging", meter: "messaging_tokens", usage: result.usage, refType: "conversation", refId: convo.id });
  await finish(db, b.queue_ids, "done");
  await maybeSummarize(db, convo, ws.id, agent.id);
}

/** WhatsApp messages over ~1,000 chars are split at paragraph boundaries. */
async function sendLong(sid: string, to: string, text: string): Promise<string[]> {
  const parts: string[] = [];
  let cur = "";
  for (const para of text.split(/\n{2,}/)) {
    if ((cur + "\n\n" + para).length > 1000 && cur) { parts.push(cur); cur = para; } else cur = cur ? `${cur}\n\n${para}` : para;
  }
  if (cur) parts.push(cur);
  const ids: string[] = [];
  for (const p of parts) ids.push((await engine.sendText(sid, to, p)).message_id);
  return ids;
}

async function maybeSummarize(db: Db, convo: Record<string, any>, workspaceId: string, agentId: string) {
  const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", convo.id);
  if (!count || count - (convo.summary_message_count ?? 0) < 20) return;
  const { data: msgs } = await db.from("messages").select("direction,text").eq("conversation_id", convo.id).order("created_at", { ascending: false }).limit(30);
  const t = await template(db, "summarize.conversation");
  const res = await aiGenerate({ model: MODELS.light, maxTokens: 300, messages: [
    { role: "system", content: t.body },
    { role: "user", content: `Previous summary: ${convo.summary ?? "(none)"}\nNew messages:\n${(msgs ?? []).reverse().map((m) => `${m.direction === "in" ? "Customer" : "Agent"}: ${m.text ?? "[file]"}`).join("\n")}` },
  ] });
  await db.from("conversations").update({ summary: res.text.slice(0, 1200), summary_message_count: count }).eq("id", convo.id);
  await chargeUsage(db, { workspaceId, agentId, agentKind: "messaging", meter: "messaging_tokens", usage: res.usage, refType: "conversation_summary", refId: convo.id });
}

async function notifyOnce(db: Db, ws: string, type: string, title: string, body: string) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("type", type).gte("created_at", since);
  if (!count) await notify(db, ws, type, title, body, "/app/billing");
}
