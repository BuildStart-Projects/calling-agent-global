import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess } from "../_shared/supabase.ts";
import { engine } from "../_shared/engine.ts";
import { FIXED, fill } from "../_shared/fixed-messages.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";

serveHandler("handoff-test", async (req) => {
  const { agent_id } = z.object({ agent_id: z.string().uuid() }).parse(await readJson(req));
  const { db, agent, user } = await requireAgentAccess(req, agent_id);
  await enforceRateLimit(db, `handoff-test:${user.id}`, 5, 3600, "Too many test alerts. Try again later.");
  if (!agent.handoff_phone_e164) throw new HttpError(400, "no_number", "Add a handoff number first.");
  if (agent.wa_status !== "connected" || !agent.engine_session_id) throw new HttpError(409, "not_connected", "Connect WhatsApp first — the alert is sent from your agent's number.");
  await engine.sendText(agent.engine_session_id, agent.handoff_phone_e164, fill(FIXED.handoff_test, { agent_name: agent.name }));
  await db.from("agents").update({ handoff_verified_at: new Date().toISOString() }).eq("id", agent_id);
  return json(req, { sent: true });
});
