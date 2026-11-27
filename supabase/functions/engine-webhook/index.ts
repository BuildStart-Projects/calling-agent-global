// Receives signed events from the Go engine (platform = global). See IMPLEMENTATION_PLAN.md §3.2.
import { onCampaignCall } from "../_shared/campaign-results.ts";
import { serveHandler, HttpError, json, log } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { verifyEngine } from "../_shared/hmac.ts";
import { engine } from "../_shared/engine.ts";
import { chargeUsage } from "../_shared/credits.ts";
import { aiGenerate, parseJsonObject, MODELS } from "../_shared/llm.ts";
import { render, template } from "../_shared/templating.ts";
import { handoff, notify } from "../_shared/runtime-tools.ts";
import { loadCompileContext, knowledgeBlocks } from "../_shared/compiler.ts";

type Env = { event_id: string; event: string; occurred_at: string; session_id: string; business_id: string; data: Record<string, any> };
type Db = ReturnType<typeof serviceClient>;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const background = (p: Promise<unknown>) => (typeof EdgeRuntime !== "undefined" ? EdgeRuntime.waitUntil(p.catch((e) => console.error(String(e)))) : p.catch((e) => console.error(String(e))));

serveHandler("engine-webhook", async (req, { requestId }) => {
  const raw = await req.text();
  if (!(await verifyEngine(Deno.env.get("ENGINE_WEBHOOK_SECRET") ?? "", req.headers.get("x-engine-signature"), raw))) {
    throw new HttpError(401, "bad_signature", "Invalid signature.");
  }
  const env = JSON.parse(raw) as Env;
  const db = serviceClient();

  const { error: dup } = await db.from("engine_events").insert({ event_id: env.event_id, event: env.event });
  if (dup) return json(req, { ok: true, duplicate: true });

  const { data: agent } = await db.from("agents").select("*").eq("id", env.business_id).maybeSingle();
  if (!agent) { log("engine-webhook", requestId, { event: env.event, skipped: "unknown agent" }); return json(req, { ok: true, skipped: true }); }

  try {
    switch (env.event) {
      case "session.status": await onSession(db, agent, env); break;
      case "message.received": await onMessage(db, agent, env); break;
      case "message.owner_sent": await onOwnerSent(db, agent, env); break;
      case "call.completed": await onCallCompleted(db, agent, env); break;
      case "call.missed": await onCallMissed(db, agent, env); break;
      case "call.ended": await onCallEnded(db, agent, env); break;
      case "recording.ready":
        await db.from("calls").update({ recording_key: env.data.recording_key ?? env.data.recording_url ?? null }).eq("engine_call_id", env.data.call_id);
        break;
    }
    await db.from("engine_events").update({ processed_at: new Date().toISOString() }).eq("event_id", env.event_id);
  } catch (e) {
    await db.from("engine_events").update({ error: String(e).slice(0, 500) }).eq("event_id", env.event_id);
    // Let the engine retry: delete the dedupe row so the retry is processed.
    await db.from("engine_events").delete().eq("event_id", env.event_id);
    throw e;
  }
  log("engine-webhook", requestId, { event: env.event, agent: agent.id });
  return json(req, { ok: true });
});

// ───────────────────────── helpers ─────────────────────────
function phoneFromJid(jid?: string | null): string | null {
  if (!jid || !jid.includes("@s.whatsapp.net")) return null;
  const d = jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "");
  return d.length >= 7 ? `+${d}` : null;
}
function normalizeNumber(n?: string | null): string | null {
  if (!n || n.startsWith("LID")) return null;
  const d = n.replace(/\D/g, "");
  return d.length >= 7 ? `+${d}` : null;
}

async function upsertContact(db: Db, agent: Record<string, any>, phone: string | null, jid: string | null, name?: string | null) {
  const ws = agent.workspace_id;
  const q = phone ? db.from("contacts").select("*").eq("workspace_id", ws).eq("phone_e164", phone) : db.from("contacts").select("*").eq("workspace_id", ws).eq("wa_jid", jid);
  const { data: found } = await q.maybeSingle();
  const now = new Date().toISOString();
  if (found) {
    await db.from("contacts").update({ last_seen_at: now, push_name: name ?? found.push_name, name: found.name ?? name ?? null, wa_jid: found.wa_jid ?? jid }).eq("id", found.id);
    return { ...found, name: found.name ?? name ?? null };
  }
  const { data: created, error } = await db.from("contacts").insert({ workspace_id: ws, phone_e164: phone, wa_jid: jid, name: name ?? null, push_name: name ?? null, source: "inbound" }).select("*").single();
  if (error) { // race: someone inserted first
    const { data } = await q.maybeSingle();
    return data;
  }
  return created;
}

async function upsertConversation(db: Db, agentId: string, contactId: string) {
  const { data } = await db.from("conversations").upsert({ agent_id: agentId, contact_id: contactId }, { onConflict: "agent_id,contact_id", ignoreDuplicates: false }).select("*").single();
  return data!;
}

// ───────────────────────── events ─────────────────────────
async function onSession(db: Db, agent: Record<string, any>, env: Env) {
  const state = env.data.state;
  if (state === "open") {
    await db.from("agents").update({ wa_status: "connected", wa_jid: env.data.jid, wa_phone: phoneFromJid(env.data.jid) ?? agent.wa_phone, engine_session_id: env.session_id, wa_connected_at: new Date().toISOString() }).eq("id", agent.id);
  } else if (state === "logged_out") {
    await db.from("agents").update({ wa_status: "logged_out" }).eq("id", agent.id);
    await notify(db, agent.workspace_id, "whatsapp", "⚠️ WhatsApp disconnected", `${agent.name} was logged out of WhatsApp. Reconnect to keep answering customers.`, `/app/agents/${agent.id}/connect`);
  } else if (state === "deleted") {
    await db.from("agents").update({ wa_status: "not_connected", engine_session_id: null }).eq("id", agent.id);
  } else if (state === "qr" && agent.wa_status === "not_connected") {
    await db.from("agents").update({ wa_status: "qr", engine_session_id: env.session_id }).eq("id", agent.id);
  }
}

async function onMessage(db: Db, agent: Record<string, any>, env: Env) {
  const d = env.data;
  if (d.is_group || String(d.chat_jid ?? "").endsWith("@newsletter") || String(d.chat_jid ?? "").includes("broadcast")) return;
  const phone = phoneFromJid(d.sender_jid) ?? phoneFromJid(d.chat_jid);
  const contact = await upsertContact(db, agent, phone, d.chat_jid ?? d.sender_jid, d.sender_name || null);
  if (!contact) return;
  const convo = await upsertConversation(db, agent.id, contact.id);

  let mediaPath: string | null = null;
  if (d.has_media && agent.engine_session_id) {
    try { // the engine caches media descriptors for 30 minutes only — download now
      const media = await engine.downloadMedia(agent.engine_session_id, d.message_id);
      mediaPath = `${agent.workspace_id}/${agent.id}/${d.message_id}`;
      await db.storage.from("inbound-media").upload(mediaPath, media.bytes, { contentType: media.mime, upsert: true });
    } catch (e) { console.error(JSON.stringify({ where: "media", error: String(e) })); }
  }
  const text = d.text || d.caption || null;
  const { data: msg, error } = await db.from("messages").insert({
    conversation_id: convo.id, direction: "in", sender: "customer", type: d.media_type || "text", text,
    media_path: mediaPath, media_mime: d.mime_type || null, wa_message_id: d.message_id, status: "received",
    created_at: d.timestamp ? new Date(d.timestamp).toISOString() : undefined,
  }).select("id").single();
  if (error || !msg) return; // duplicate message id
  await db.from("conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: (text ?? `[${d.media_type || "file"}]`).slice(0, 140),
    unread_count: (convo.unread_count ?? 0) + 1,
  }).eq("id", convo.id);
  await db.from("contacts").update({ last_inbound_at: new Date().toISOString() }).eq("id", contact.id);

  // Backlog after a reconnect: store, but don't auto-reply to stale messages.
  const ageMs = Date.now() - Number(d.timestamp ?? Date.now());
  const stale = ageMs > 15 * 60_000 || (d.is_offline && ageMs > 2 * 60_000);
  await db.from("inbound_queue").insert({
    agent_id: agent.id, conversation_id: convo.id, message_id: msg.id,
    status: stale ? "skipped" : "pending", available_at: new Date(Date.now() + 2500).toISOString(),
  });
  if (!stale) kickWorker();
}

function kickWorker() {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/messaging-worker`;
  background((async () => {
    await new Promise((r) => setTimeout(r, 2700)); // after the debounce window
    await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" }, body: "{}" });
  })());
}

async function onOwnerSent(db: Db, agent: Record<string, any>, env: Env) {
  const d = env.data;
  if (d.is_group) return;
  const phone = phoneFromJid(d.chat_jid ?? d.peer_jid);
  const contact = await upsertContact(db, agent, phone, d.chat_jid ?? d.peer_jid, null);
  if (!contact) return;
  const convo = await upsertConversation(db, agent.id, contact.id);
  await db.from("messages").insert({ conversation_id: convo.id, direction: "out", sender: "owner_phone", type: d.media_type || "text", text: d.text || d.caption || null, wa_message_id: d.message_id, status: "sent" });
  await db.from("conversations").update({
    ai_paused: true, paused_by: "owner_phone", paused_until: new Date(Date.now() + 12 * 3600_000).toISOString(),
    last_message_at: new Date().toISOString(), last_message_preview: (d.text ?? "").slice(0, 140),
  }).eq("id", convo.id);
}

async function onCallMissed(db: Db, agent: Record<string, any>, env: Env) {
  const d = env.data;
  const phone = normalizeNumber(d.caller_number) ?? phoneFromJid(d.peer_jid);
  const contact = await upsertContact(db, agent, phone, d.peer_jid ?? null, null);
  await db.from("calls").upsert({
    agent_id: agent.id, workspace_id: agent.workspace_id, engine_call_id: d.call_id, contact_id: contact?.id ?? null,
    direction: "inbound", caller_number: phone ?? d.caller_number, started_at: new Date(env.occurred_at).toISOString(),
    outcome: d.reason === "agent_disabled" ? "agent_disabled" : "missed",
    summary: d.auto_callback_scheduled ? "Missed call — your AI called them back." : d.reason === "agent_disabled" ? "Call rang through to your phone (agent paused)." : "Missed call.",
  }, { onConflict: "engine_call_id" });
}

async function onCallEnded(db: Db, agent: Record<string, any>, env: Env) {
  const d = env.data;
  const phone = normalizeNumber(d.caller_number) ?? phoneFromJid(d.peer_jid);
  const contact = await upsertContact(db, agent, phone, d.peer_jid ?? null, null);
  await db.from("calls").upsert({
    agent_id: agent.id, workspace_id: agent.workspace_id, engine_call_id: d.call_id, contact_id: contact?.id ?? null,
    direction: d.direction === "auto-callback" ? "auto-callback" : "outbound", caller_number: phone ?? d.caller_number,
    started_at: d.started_at ? new Date(d.started_at).toISOString() : null, ended_at: d.ended_at ? new Date(d.ended_at).toISOString() : null,
    outcome: "unanswered", summary: `No answer (${d.end_reason ?? "unanswered"}).`,
    campaign_target_id: d.client_ref ?? null,
  }, { onConflict: "engine_call_id" });
  if (d.client_ref) await onCampaignCall(db, agent, d.client_ref, /busy|reject|declin/i.test(String(d.end_reason ?? "")) ? "busy" : /fail|error|invalid|not_on_whatsapp/i.test(String(d.end_reason ?? "")) ? "failed" : "no_answer", d.call_id);
}

async function onCallCompleted(db: Db, agent: Record<string, any>, env: Env) {
  const d = env.data;
  const phone = normalizeNumber(d.caller_number) ?? phoneFromJid(d.peer_jid);
  const contact = await upsertContact(db, agent, phone, d.peer_jid ?? null, null);
  const iso = (ms?: number | null) => (ms ? new Date(ms).toISOString() : null);
  const direction = ["inbound", "outbound", "auto-callback"].includes(d.direction) ? d.direction : "inbound";
  const tools = (d.tool_invocations ?? []) as Array<{ name: string; result?: any }>;
  const handoffByTool = tools.some((t) => t.name === "handoff_to_human");
  const { data: call } = await db.from("calls").upsert({
    agent_id: agent.id, workspace_id: agent.workspace_id, engine_call_id: d.call_id, contact_id: contact?.id ?? null,
    direction, caller_number: phone ?? d.caller_number, started_at: iso(d.started_at), connected_at: iso(d.connected_at), ended_at: iso(d.ended_at),
    duration_seconds: Number(d.duration_seconds ?? 0), transcript: d.transcripts ?? [], tool_invocations: tools,
    outcome: handoffByTool ? "handoff" : tools.some((t) => t.name === "capture_lead") ? "lead" : "answered",
    campaign_target_id: d.client_ref ?? null,
  }, { onConflict: "engine_call_id" }).select("id").single();

  if (d.client_ref) await onCampaignCall(db, agent, d.client_ref, Number(d.duration_seconds ?? 0) > 0 ? "answered" : "no_answer", d.call_id);
  await chargeUsage(db, { workspaceId: agent.workspace_id, agentId: agent.id, agentKind: "calling", meter: d.client_ref ? "campaign_call_minutes" : "call_minutes", seconds: Number(d.duration_seconds ?? 0), refType: "call", refId: d.call_id });
  await notify(db, agent.workspace_id, "call", `📞 Call ${direction === "inbound" ? "from" : "to"} ${contact?.name ?? phone ?? "a customer"}`, `${Math.max(1, Math.round(Number(d.duration_seconds ?? 0) / 60))} min · summary on the way`, "/app/calls");

  // Summary, claims audit and handoff fallback run after we ack the engine.
  background(summarizeCall(db, agent, contact, call?.id ?? null, d, handoffByTool));
}

async function summarizeCall(db: Db, agent: Record<string, any>, contact: any, callRowId: string | null, d: Record<string, any>, handoffByTool: boolean) {
  const transcript = (d.transcripts ?? []) as Array<{ role: string; text: string }>;
  if (transcript.length < 2 || !callRowId) return;
  const ctx = await loadCompileContext(db, agent.id);
  const kb = knowledgeBlocks(ctx, "calling", 12_000);
  const t = await template(db, "summarize.call");
  const system = render(t.body, {
    owner_language: "English",
    knowledge_compact: [kb.catalog_block, kb.hours_block, kb.policies_block].filter(Boolean).join("\n").slice(0, 6000),
    tool_results_compact: JSON.stringify((d.tool_invocations ?? []).map((x: any) => ({ name: x.name, result: x.result }))).slice(0, 2000),
  });
  const text = transcript.map((x) => `${x.role === "assistant" ? "AI" : "Caller"}: ${x.text}`).join("\n").slice(0, 20_000);
  const res = await aiGenerate({ model: MODELS.summarizer, messages: [{ role: "system", content: system }, { role: "user", content: text }], maxTokens: 800, temperature: 0.2 });
  await chargeUsage(db, { workspaceId: agent.workspace_id, agentId: agent.id, agentKind: "calling", meter: "call_analysis_tokens", usage: res.usage, refType: "call", refId: d.call_id });
  const s = parseJsonObject<any>(res.text);
  if (!s) return;
  const flags = Array.isArray(s.unsupported_claims) ? s.unsupported_claims.slice(0, 10) : [];
  await db.from("calls").update({
    summary: String(s.summary ?? "").slice(0, 1200), flags,
    outcome: handoffByTool || s.handoff_requested ? "handoff" : ["booked", "ordered", "lead", "answered", "handoff"].includes(s.outcome) ? s.outcome : "answered",
  }).eq("id", callRowId);
  if (s.customer_name && contact && !contact.name) await db.from("contacts").update({ name: String(s.customer_name).slice(0, 80) }).eq("id", contact.id);

  const rctx = { db, agent, workspaceId: agent.workspace_id, contact, channel: "call" as const };
  if (s.handoff_requested && !handoffByTool) await handoff({ reason: s.handoff_reason ?? "Asked for a person on the call", summary: s.summary }, rctx);
  if (s.do_not_contact && contact?.phone_e164) {
    await db.from("contacts").update({ do_not_contact: true, dnc_reason: "requested_on_call", dnc_at: new Date().toISOString() }).eq("id", contact.id);
    await db.from("dnc_list").upsert({ workspace_id: agent.workspace_id, phone_e164: contact.phone_e164, reason: "requested_on_call" });
  }
  if (s.lead && !(d.tool_invocations ?? []).some((x: any) => x.name === "capture_lead")) {
    await db.from("leads").insert({ agent_id: agent.id, workspace_id: agent.workspace_id, contact_id: contact?.id ?? null, intent: String(s.lead.intent ?? "call_request").slice(0, 60), summary: String(s.lead.details ?? s.summary ?? "").slice(0, 1000), urgency: ["low", "normal", "high"].includes(s.lead.urgency) ? s.lead.urgency : "normal", source: "call" });
  }
}
