// Synchronous tool execution for live calls (engine `tool.invoke`, 8 s budget). No LLM calls in here.
import { serveHandler, HttpError, json, log } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { verifyEngine } from "../_shared/hmac.ts";
import { runRuntimeTool } from "../_shared/runtime-tools.ts";

serveHandler("engine-tools", async (req, { requestId }) => {
  const raw = await req.text();
  if (!(await verifyEngine(Deno.env.get("ENGINE_WEBHOOK_SECRET") ?? "", req.headers.get("x-engine-signature"), raw))) throw new HttpError(401, "bad_signature", "Invalid signature.");
  const env = JSON.parse(raw) as { event: string; business_id: string; data: { name: string; args?: Record<string, unknown>; caller_number?: string; peer_jid?: string; call_id: string; client_ref?: string } };
  if (env.event !== "tool.invoke") return json(req, { error: "unsupported event" });
  const db = serviceClient();
  const { data: agent } = await db.from("agents").select("*").eq("id", env.business_id).maybeSingle();
  if (!agent) return json(req, { error: "unknown agent" });

  const digits = (env.data.caller_number ?? "").replace(/\D/g, "") || (env.data.peer_jid ?? "").split("@")[0]!.replace(/\D/g, "");
  const phone = digits.length >= 7 ? `+${digits}` : null;
  let contact = null;
  if (phone) {
    const { data } = await db.from("contacts").select("id,phone_e164,name,wa_jid").eq("workspace_id", agent.workspace_id).eq("phone_e164", phone).maybeSingle();
    contact = data ?? (await db.from("contacts").insert({ workspace_id: agent.workspace_id, phone_e164: phone, source: "inbound" }).select("id,phone_e164,name,wa_jid").single()).data;
  }
  const started = performance.now();
  const result = await runRuntimeTool(env.data.name, env.data.args ?? {}, { db, agent, workspaceId: agent.workspace_id, contact, channel: "call", clientRef: env.data.client_ref ?? null });
  log("engine-tools", requestId, { tool: env.data.name, ms: Math.round(performance.now() - started) });
  return json(req, { result });
});
