// Streams a private call recording from the engine to an authorised member (fallback until engine N2 presigns publicly).
import { serveHandler, HttpError, corsHeaders, json } from "../_shared/http.ts";
import { requireAgentAccess, serviceClient } from "../_shared/supabase.ts";
import { engine } from "../_shared/engine.ts";

serveHandler("recording-proxy", async (req) => {
  const callId = new URL(req.url).searchParams.get("call_id");
  if (!callId) throw new HttpError(400, "invalid", "call_id is required.");
  const { data: call } = await serviceClient().from("calls").select("agent_id,engine_call_id,recording_expired_at").eq("id", callId).maybeSingle();
  if (!call) throw new HttpError(404, "not_found", "Recording not found.");
  const { agent } = await requireAgentAccess(req, call.agent_id);
  if (call.recording_expired_at) throw new HttpError(410, "recording_expired", "This recording was deleted after your plan's retention period.");
  if (!agent.engine_session_id) throw new HttpError(404, "not_found", "Recording not available.");
  // Preferred: short-lived public presigned URL from the engine (supports seeking, no proxy bandwidth).
  if (new URL(req.url).searchParams.get("mode") !== "stream") {
    try {
      const p = await engine.presignRecording(agent.engine_session_id, call.engine_call_id);
      if (p.url?.startsWith("https://")) return json(req, { url: p.url, expires_in_seconds: p.expires_in_seconds ?? 900 });
    } catch { /* fall back to streaming */ }
  }
  const upstream = await fetch(engine.recordingUrl(agent.engine_session_id, call.engine_call_id), {
    headers: { "X-Api-Key": Deno.env.get("GO_API_KEY_GLOBAL") ?? "", ...(req.headers.get("range") ? { Range: req.headers.get("range")! } : {}) },
  });
  if (!upstream.ok && upstream.status !== 206) throw new HttpError(404, "not_found", "Recording not ready yet.");
  const headers = new Headers(corsHeaders(req));
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  if (!headers.get("content-type")) headers.set("content-type", "audio/wav");
  return new Response(upstream.body, { status: upstream.status, headers });
});
