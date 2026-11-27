// WhatsApp session lifecycle for an agent (engine owns the session; we only proxy, scoped to the caller's agent).
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess } from "../_shared/supabase.ts";
import { engine } from "../_shared/engine.ts";
import { compileAgent } from "../_shared/compile-agent.ts";
import { notify } from "../_shared/runtime-tools.ts";

const Body = z.object({ agent_id: z.string().uuid(), action: z.enum(["start", "status", "regenerate", "disconnect", "remove"]) });

serveHandler("wa-connect", async (req) => {
  const { agent_id, action } = Body.parse(await readJson(req));
  const { db, agent, workspace, user } = await requireAgentAccess(req, agent_id);

  if (action === "start") {
    if (!user.email_confirmed_at) throw new HttpError(403, "email_unverified", "Verify your email before connecting WhatsApp.");
    // Register the agent config with the engine BEFORE creating the session (first call is never silent).
    const res = await compileAgent(db, agent_id, { pushEngine: true });
    if (res.engineError) throw new HttpError(502, "engine_sync", "Couldn't reach the voice engine. Please try again in a moment.");
    const s = await engine.createSession(agent_id);
    await db.from("agents").update({ engine_session_id: s.id, wa_status: "qr" }).eq("id", agent_id);
    return json(req, await currentStatus(db, { ...agent, engine_session_id: s.id }, workspace.id));
  }
  if (action === "status") return json(req, await currentStatus(db, agent, workspace.id));
  if (!agent.engine_session_id) throw new HttpError(409, "no_session", "WhatsApp isn't connected yet.");
  if (action === "regenerate") {
    try { await engine.pair(agent.engine_session_id); } catch { /* already pairing */ }
    return json(req, await currentStatus(db, agent, workspace.id));
  }
  if (action === "disconnect") {
    await engine.logout(agent.engine_session_id);
    await db.from("agents").update({ wa_status: "not_connected", wa_jid: null, status: agent.status === "live" ? "paused" : agent.status, pause_reason: agent.status === "live" ? "user" : agent.pause_reason }).eq("id", agent_id);
    return json(req, { state: "not_connected" });
  }
  // remove
  try { await engine.deleteSession(agent.engine_session_id); } catch { /* already gone */ }
  await db.from("agents").update({ engine_session_id: null, wa_status: "not_connected", wa_jid: null, wa_phone: null }).eq("id", agent_id);
  return json(req, { state: "not_connected" });
});

async function currentStatus(db: any, agent: Record<string, any>, workspaceId: string) {
  if (!agent.engine_session_id) return { state: "not_connected" };
  const { sessions } = await engine.listSessions(agent.id);
  let s: { id: string; state: string; paired: boolean; jid: string; qr?: string } | undefined = sessions.find((x) => x.id === agent.engine_session_id) ?? sessions[0];
  if (!s) {
    // Engine restarted while unpaired → it drops unpaired sessions. Recreate transparently.
    const created = await engine.createSession(agent.id);
    await db.from("agents").update({ engine_session_id: created.id, wa_status: "qr" }).eq("id", agent.id);
    s = (await engine.listSessions(agent.id)).sessions.find((x) => x.id === created.id);
    if (!s) return { state: "connecting" };
  }
  if (s.state === "open" || s.paired) {
    const phone = s.jid ? `+${s.jid.split(/[:@]/)[0]}` : null;
    if (agent.wa_status !== "connected") {
      await db.from("agents").update({ wa_status: "connected", wa_jid: s.jid, wa_phone: phone, wa_connected_at: new Date().toISOString(), engine_session_id: s.id }).eq("id", agent.id);
      await notify(db, workspaceId, "whatsapp", "WhatsApp connected", `${agent.name} is linked to ${phone}.`, `/app/agents/${agent.id}/test`);
    }
    return { state: "connected", phone };
  }
  if (s.state === "qr" && s.qr) return { state: "qr", qr: s.qr };
  if (s.state === "logged_out") return { state: "expired" };
  return { state: "connecting" };
}
