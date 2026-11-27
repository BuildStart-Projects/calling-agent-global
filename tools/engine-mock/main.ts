// BuildStart engine mock — implements the Go engine contract used by Global (IMPLEMENTATION_PLAN.md §3, incl. N1).
// Run:  deno run -A tools/engine-mock/main.ts
// Env:  PORT (8787), GO_API_KEY_GLOBAL, PLATFORM_GLOBAL_WEBHOOK_URL, PLATFORM_GLOBAL_WEBHOOK_SECRET, PLATFORM_GLOBAL_TOOLS_URL
//
// Dev helpers (no auth):
//   POST /__mock/sessions/{sid}/scan            → pairs the session (state "open")
//   POST /__mock/sessions/{sid}/inbound-message {from, text}
//   POST /__mock/sessions/{sid}/inbound-call    {from, answered?: bool, seconds?: number, transcript?: [...]}
//   POST /__mock/calls/{callId}/outcome         {outcome: "answered"|"no_answer"|"busy", seconds?, transcript?}

import { signEngine } from "../../supabase/functions/_shared/hmac.ts";

type Session = { id: string; business_id: string; platform: string; jid: string; state: "qr" | "open" | "logged_out"; paired: boolean; qr?: string };
type Config = Record<string, unknown> & { platform: string; updated_at: string };

const PORT = Number(Deno.env.get("PORT") ?? 8787);
const KEY = Deno.env.get("GO_API_KEY_GLOBAL") ?? "dev-global-key";
const WEBHOOK = Deno.env.get("PLATFORM_GLOBAL_WEBHOOK_URL") ?? "";
const TOOLS = Deno.env.get("PLATFORM_GLOBAL_TOOLS_URL") ?? WEBHOOK;
const SECRET = Deno.env.get("PLATFORM_GLOBAL_WEBHOOK_SECRET") ?? "dev-webhook-secret";

const sessions = new Map<string, Session>();
const configs = new Map<string, Config>();
const calls = new Map<string, { sid: string; phone: string; client_ref?: string; direction: string; started_at: number }>();

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function emit(session: Session, event: string, data: unknown) {
  if (!WEBHOOK) return console.log(`[mock] (no webhook) ${event}`, data);
  const body = JSON.stringify({ event_id: `evt_${hex(16)}`, event, occurred_at: new Date().toISOString(), platform: "global", session_id: session.id, business_id: session.business_id, data });
  const res = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json", "X-Engine-Signature": await signEngine(SECRET, body) }, body }).catch((e) => e);
  console.log(`[mock] → ${event} ${res instanceof Response ? res.status : String(res)}`);
}

export async function invokeTool(session: Session, callId: string, phone: string, name: string, args: unknown) {
  const body = JSON.stringify({ event_id: `evt_${hex(16)}`, event: "tool.invoke", occurred_at: new Date().toISOString(), platform: "global", session_id: session.id, business_id: session.business_id, data: { invocation_id: hex(8), call_id: callId, caller_number: phone, peer_jid: `${phone.replace(/\D/g, "")}@s.whatsapp.net`, name, args } });
  const res = await fetch(TOOLS, { method: "POST", headers: { "Content-Type": "application/json", "X-Engine-Signature": await signEngine(SECRET, body) }, body, signal: AbortSignal.timeout(8000) });
  return res.json();
}

function rotateQr(s: Session) {
  s.qr = `2@mock-${hex(24)},${hex(16)},${hex(16)}`;
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/api(\/v1)?/, "");
  const m = (re: RegExp) => p.match(re);

  // ── dev helpers ──
  if (url.pathname.startsWith("/__mock/")) {
    const body = await req.json().catch(() => ({}));
    let r;
    if ((r = url.pathname.match(/^\/__mock\/sessions\/([^/]+)\/scan$/))) {
      const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
      s.state = "open"; s.paired = true; s.jid = `${body.phone ?? "14155550123"}:12@s.whatsapp.net`; s.qr = undefined;
      await emit(s, "session.status", { state: "open", jid: s.jid });
      return json({ ok: true });
    }
    if ((r = url.pathname.match(/^\/__mock\/sessions\/([^/]+)\/inbound-message$/))) {
      const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
      const from = String(body.from ?? "+447700900123").replace(/\D/g, "");
      await emit(s, "message.received", { message_id: hex(10).toUpperCase(), chat_jid: `${from}@s.whatsapp.net`, sender_jid: `${from}@s.whatsapp.net`, sender_name: body.name ?? "Test Customer", is_group: false, is_offline: false, text: body.text ?? "Hi!", media_type: "", mime_type: "", filename: "", file_size: 0, caption: "", has_media: false, quoted_message_id: "", timestamp: Date.now() });
      return json({ ok: true });
    }
    if ((r = url.pathname.match(/^\/__mock\/sessions\/([^/]+)\/owner-message$/))) {
      const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
      const to = String(body.to ?? "+447700900123").replace(/\D/g, "");
      await emit(s, "message.owner_sent", { message_id: hex(10).toUpperCase(), chat_jid: `${to}@s.whatsapp.net`, peer_jid: `${to}@s.whatsapp.net`, text: body.text ?? "Hi, this is the owner.", media_type: "", caption: "", is_group: false, is_offline: false, timestamp: Date.now() });
      return json({ ok: true });
    }
    if ((r = url.pathname.match(/^\/__mock\/sessions\/([^/]+)\/inbound-call$/))) {
      const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
      const from = String(body.from ?? "+447700900123").replace(/\D/g, "");
      const callId = hex(16).toUpperCase();
      const now = Date.now();
      if (body.answered === false) {
        await emit(s, "call.missed", { call_id: callId, peer_jid: `${from}@s.whatsapp.net`, caller_number: `+${from}`, reason: configs.get(s.business_id)?.voice_enabled === false ? "agent_disabled" : "caller_unanswered", auto_callback_scheduled: false });
      } else {
        const secs = Number(body.seconds ?? 64);
        await emit(s, "call.completed", { call_id: callId, peer_jid: `${from}@s.whatsapp.net`, caller_number: `+${from}`, direction: "inbound", started_at: now - secs * 1000 - 3000, connected_at: now - secs * 1000, ended_at: now, duration_seconds: secs, end_reason: "user_ended", transcripts: body.transcript ?? [{ timestamp: now - 60000, role: "assistant", text: "Hi! Thanks for calling. How can I help?" }, { timestamp: now - 55000, role: "user", text: "Do you have time tomorrow?" }], tool_invocations: [] });
        await emit(s, "recording.ready", { call_id: callId, recording_key: `${s.business_id}/${callId}.wav` });
      }
      return json({ ok: true, call_id: callId });
    }
    if ((r = url.pathname.match(/^\/__mock\/calls\/([^/]+)\/outcome$/))) {
      const c = calls.get(r[1]!); if (!c) return json({ error: "no such call" }, 404);
      const s = sessions.get(c.sid)!;
      const digits = c.phone.replace(/\D/g, "");
      const base = { call_id: r[1], peer_jid: `${digits}@s.whatsapp.net`, caller_number: `+${digits}`, direction: c.direction, client_ref: c.client_ref };
      if (body.outcome === "answered") {
        const secs = Number(body.seconds ?? 45);
        await emit(s, "call.completed", { ...base, started_at: c.started_at, connected_at: c.started_at + 4000, ended_at: Date.now(), duration_seconds: secs, end_reason: "user_ended", transcripts: body.transcript ?? [], tool_invocations: [] });
      } else {
        await emit(s, "call.ended", { ...base, outcome: "unanswered", duration_seconds: 0, end_reason: body.outcome === "busy" ? "busy" : "timeout", started_at: c.started_at, ended_at: Date.now() });
      }
      calls.delete(r[1]!);
      return json({ ok: true });
    }
    return json({ error: "unknown mock route" }, 404);
  }

  if (p === "/health") return json({ status: "online", timestamp: Math.floor(Date.now() / 1000) });
  if (req.headers.get("x-api-key") !== KEY && req.headers.get("authorization") !== `Bearer ${KEY}`) return json({ error: "unauthorized" }, 401);

  let r;
  if ((r = m(/^\/agent-configs\/([^/]+)$/))) {
    const id = r[1]!;
    if (!UUID.test(id)) return json({ error: "invalid business_id uuid" }, 400);
    if (req.method === "PUT") {
      const body = await req.json();
      const cfg = { ...body, platform: "global", updated_at: new Date().toISOString() };
      configs.set(id, cfg);
      return json({ business_id: id, updated_at: cfg.updated_at });
    }
    if (req.method === "GET") return configs.has(id) ? json({ business_id: id, ...configs.get(id) }) : json({ error: "not found" }, 404);
    if (req.method === "DELETE") { configs.delete(id); return new Response(null, { status: 204 }); }
  }

  if (p === "/sessions" && req.method === "GET") {
    const bid = url.searchParams.get("business_id");
    return json({ sessions: [...sessions.values()].filter((s) => !bid || s.business_id === bid) });
  }
  if (p === "/sessions" && req.method === "POST") {
    const { business_id } = await req.json();
    if (!UUID.test(business_id ?? "")) return json({ error: "invalid business_id uuid" }, 400);
    const existing = [...sessions.values()].find((s) => s.business_id === business_id);
    if (existing) return json({ id: existing.id, session_id: existing.id, business_id, platform: "global", reused: true });
    const s: Session = { id: hex(16), business_id, platform: "global", jid: "", state: "qr", paired: false };
    rotateQr(s);
    sessions.set(s.id, s);
    const timer = setInterval(() => (s.state === "qr" ? rotateQr(s) : clearInterval(timer)), 20_000);
    await emit(s, "session.status", { state: "qr", jid: "" });
    return json({ id: s.id, session_id: s.id, business_id, platform: "global", reused: false });
  }
  if ((r = m(/^\/sessions\/([^/]+)$/)) && req.method === "DELETE") {
    const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
    sessions.delete(s.id); await emit(s, "session.status", { state: "deleted", jid: s.jid });
    return new Response(null, { status: 204 });
  }
  if ((r = m(/^\/sessions\/([^/]+)\/(pair|logout)$/)) && req.method === "POST") {
    const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
    if (r[2] === "pair") { if (s.paired) return json({ error: "session already paired" }, 400); s.state = "qr"; rotateQr(s); }
    else { s.state = "logged_out"; s.paired = false; s.jid = ""; s.qr = undefined; await emit(s, "session.status", { state: "logged_out", jid: "" }); }
    return new Response(null, { status: 204 });
  }
  if ((r = m(/^\/sessions\/([^/]+)\/messages\/send$/)) && req.method === "POST") {
    const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
    if (!s.paired) return json({ error: "session not paired" }, 503);
    const body = await req.json();
    console.log(`[mock] send → ${body.to}: ${body.text ?? body.caption ?? body.media_url}`);
    return json({ success: true, message_id: hex(10).toUpperCase(), to: `${String(body.to).replace(/\D/g, "")}@s.whatsapp.net` });
  }
  if ((r = m(/^\/sessions\/([^/]+)\/(presence|messages\/[^/]+\/read)$/)) && req.method === "POST") return json({ ok: true });
  if ((r = m(/^\/sessions\/([^/]+)\/messages\/([^/]+)\/media$/))) return new Response(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), { headers: { "Content-Type": "audio/ogg" } });
  if ((r = m(/^\/sessions\/([^/]+)\/calls$/)) && req.method === "POST") {
    const s = sessions.get(r[1]!); if (!s) return json({ error: "no such session" }, 404);
    if (!s.paired) return json({ error: "not paired" }, 503);
    const body = await req.json();
    const callId = hex(16).toUpperCase();
    calls.set(callId, { sid: s.id, phone: body.phone, client_ref: body.client_ref, direction: "outbound", started_at: Date.now() });
    console.log(`[mock] dial ${body.phone} ref=${body.client_ref ?? "-"} greeting="${body.greeting ?? ""}"`);
    return json({ call_id: callId, callId, id: callId, status: "ringing" });
  }
  if ((r = m(/^\/sessions\/([^/]+)\/calls\/([^/]+)\/recording$/))) return json({ url: `http://localhost:${PORT}/__recordings/${r[2]}.wav`, expires_in_seconds: 900 });

  return json({ error: "not found" }, 404);
});

console.log(`[mock] BuildStart engine mock on :${PORT}`);
