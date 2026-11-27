// Client for the shared Go engine (buildstart-calling-agent), platform = "global".
// Contract: calling-agent-global/reports/IMPLEMENTATION_PLAN.md §3.

import { HttpError } from "./http.ts";

export type EngineSession = { id: string; business_id: string; jid: string; state: string; paired: boolean; qr?: string; platform?: string };
export type AgentConfigPayload = {
  business_prompt: string;
  greeting_message: string;
  fallback_message: string;
  voice_model: string;
  voice_enabled: boolean;
  auto_answer: boolean;
  auto_callback: boolean;
  callback_keywords?: string[] | null;
  max_call_seconds: number;
  timezone: string;
  tools?: unknown[] | null;
  callback_greeting?: string;
};

function base(): string {
  const url = Deno.env.get("ENGINE_BASE_URL");
  if (!url) throw new HttpError(503, "engine_unconfigured", "Voice engine is not configured.");
  return url.replace(/\/+$/, "");
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Api-Key": Deno.env.get("GO_API_KEY_GLOBAL") ?? "" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new HttpError(res.status === 404 ? 404 : 502, `engine_${res.status}`, `Voice engine error (${res.status}).`);
      (err as unknown as { detail: string }).detail = text.slice(0, 500);
      throw err;
    }
    return (text ? JSON.parse(text) : {}) as T;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "engine_unreachable", "Couldn't reach the voice engine. Please try again.");
  } finally {
    clearTimeout(t);
  }
}

export const engine = {
  putAgentConfig: (agentId: string, cfg: AgentConfigPayload) => call<{ business_id: string }>("PUT", `/api/v1/agent-configs/${agentId}`, cfg),
  deleteAgentConfig: (agentId: string) => call("DELETE", `/api/v1/agent-configs/${agentId}`),
  createSession: (agentId: string) => call<{ id: string; reused: boolean }>("POST", "/api/v1/sessions", { business_id: agentId }),
  listSessions: (agentId: string) => call<{ sessions: EngineSession[] }>("GET", `/api/v1/sessions?business_id=${agentId}`),
  pair: (sid: string) => call("POST", `/api/v1/sessions/${sid}/pair`),
  logout: (sid: string) => call("POST", `/api/v1/sessions/${sid}/logout`),
  deleteSession: (sid: string) => call("DELETE", `/api/v1/sessions/${sid}`),
  sendText: (sid: string, to: string, text: string) => call<{ success: boolean; message_id: string }>("POST", `/api/v1/sessions/${sid}/messages/send`, { to, text }),
  sendMedia: (sid: string, to: string, media: { media_url: string; media_type: "image" | "document" | "audio" | "video"; caption?: string; filename?: string }) =>
    call<{ success: boolean; message_id: string }>("POST", `/api/v1/sessions/${sid}/messages/send`, { to, ...media }, 30_000),
  presence: (sid: string, to: string, state: "composing" | "paused") => call("POST", `/api/v1/sessions/${sid}/presence`, { to, state }),
  markRead: (sid: string, messageId: string, from: string) => call("POST", `/api/v1/sessions/${sid}/messages/${messageId}/read`, { from }),
  /** N1: per-call outbound context (campaigns). */
  startCall: (sid: string, p: { phone: string; client_ref?: string; greeting?: string; context?: string; max_call_seconds?: number }) =>
    call<{ call_id: string }>("POST", `/api/v1/sessions/${sid}/calls`, p),
  async downloadMedia(sid: string, messageId: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const res = await fetch(`${base()}/api/v1/sessions/${sid}/messages/${messageId}/media`, { headers: { "X-Api-Key": Deno.env.get("GO_API_KEY_GLOBAL") ?? "" } });
    if (!res.ok) throw new HttpError(502, `engine_${res.status}`, "Couldn't download media.");
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
  },
  recordingUrl: (sid: string, callId: string) => `${base()}/api/v1/sessions/${sid}/calls/${callId}/recording`,
  presignRecording: (sid: string, callId: string) => call<{ url: string; expires_in_seconds?: number }>("GET", `/api/v1/sessions/${sid}/calls/${callId}/recording?presign=1`),
};
