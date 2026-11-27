import { z } from "npm:zod@3.25.76";
import { isServiceOrCron } from "../_shared/cron.ts";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess, serviceClient } from "../_shared/supabase.ts";
import { compileAgent } from "../_shared/compile-agent.ts";
import { syncCreditPause } from "../_shared/credit-pause.ts";

const Body = z.object({ agent_id: z.string().uuid().optional(), sweep: z.boolean().optional() });

serveHandler("agent-compile", async (req) => {
  const body = Body.parse(await readJson(req));
  // Cron sweep (service role): compile every agent with pending changes.
  if (body.sweep) {
    if (!isServiceOrCron(req)) throw new HttpError(401, "unauthorized", "Service only.");
    const db = serviceClient();
    const { data } = await db.from("agent_blueprints").select("agent_id").eq("pending_compile", true).limit(25);
    const results = [];
    for (const r of data ?? []) results.push({ agent: r.agent_id, ...(await compileAgent(db, r.agent_id)) });
    // Resume agents paused for credits once the workspace has credits again (monthly Free grants, admin adjustments).
    const { data: waiting } = await db.from("agents").select("workspace_id").eq("status", "paused").eq("pause_reason", "no_credits").limit(200);
    const resumed = [];
    for (const ws of new Set((waiting ?? []).map((a) => a.workspace_id))) if ((await syncCreditPause(db, ws)) === "resumed") resumed.push(ws);
    return json(req, { compiled: results.length, results, resumed: resumed.length });
  }
  if (!body.agent_id) throw new HttpError(400, "invalid", "agent_id is required.");
  const { db } = await requireAgentAccess(req, body.agent_id);
  return json(req, await compileAgent(db, body.agent_id));
});
