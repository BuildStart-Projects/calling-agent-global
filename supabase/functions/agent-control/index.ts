// Go live / pause / resume an agent. Pushes engine flags (voice_enabled, auto_callback) via compile.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess } from "../_shared/supabase.ts";
import { compileAgent } from "../_shared/compile-agent.ts";
import { hasCredits } from "../_shared/credits.ts";

const Body = z.object({ agent_id: z.string().uuid(), action: z.enum(["go_live", "pause", "resume"]) });

serveHandler("agent-control", async (req) => {
  const { agent_id, action } = Body.parse(await readJson(req));
  const { db, agent, workspace, user } = await requireAgentAccess(req, agent_id);
  if (action === "go_live" || action === "resume") {
    if (!user.email_confirmed_at) throw new HttpError(403, "email_unverified", "Verify your email to go live.");
    if (agent.wa_status !== "connected") throw new HttpError(409, "not_connected", "Connect WhatsApp before going live.");
    if (!(await hasCredits(db, workspace.id, 0.5))) throw new HttpError(402, "out_of_credits", "You're out of credits. Top up or upgrade to go live.");
    await db.from("agents").update({ status: "live", pause_reason: null }).eq("id", agent_id);
  } else {
    await db.from("agents").update({ status: "paused", pause_reason: "user" }).eq("id", agent_id);
  }
  const result = await compileAgent(db, agent_id, { pushEngine: true });
  return json(req, { status: action === "pause" ? "paused" : "live", ...result });
});
