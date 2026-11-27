// Applies a campaign call result to its target: completes it, or schedules a retry / final no-answer message.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { engine } from "./engine.ts";
import { agentProfile, fillVars, firstName, type Schedule } from "./campaigns.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onCampaignCall(db: SupabaseClient, agent: Record<string, any>, targetId: string, result: "answered" | "no_answer" | "busy" | "failed", callId: string) {
  if (!UUID.test(targetId)) return;
  const { data: t } = await db.from("campaign_targets").select("*, campaign:campaigns(id,agent_id,schedule,status)").eq("id", targetId).maybeSingle();
  if (!t || t.campaign?.agent_id !== agent.id) return; // client_ref must belong to this agent
  const s = (t.campaign.schedule ?? {}) as Schedule;
  if (result === "answered") {
    const callbackRetry = t.outcome === "callback_requested" && t.callback_at;
    await db.from("campaign_targets").update({
      status: callbackRetry ? "queued" : t.outcome === "do_not_call" ? "opted_out" : "completed",
      next_attempt_at: callbackRetry ? t.callback_at : t.next_attempt_at, last_call_id: callId, locked_at: null,
      outcome: t.outcome ?? "unknown",
    }).eq("id", t.id);
    return;
  }
  const maxAttempts = 1 + Math.min(3, Math.max(0, s.retries?.max ?? 1));
  const spacing = Math.max(30, s.retries?.spacing_minutes ?? 120) * 60_000;
  if (result !== "failed" && t.attempts < maxAttempts && t.campaign.status !== "cancelled") {
    await db.from("campaign_targets").update({ status: "queued", next_attempt_at: new Date(Date.now() + spacing).toISOString(), last_call_id: callId, locked_at: null }).eq("id", t.id);
    return;
  }
  await db.from("campaign_targets").update({ status: result === "failed" ? "failed" : result, last_call_id: callId, locked_at: null }).eq("id", t.id);
  const msg = s.no_answer_message;
  if (result !== "failed" && msg?.enabled && msg.text && !t.final_message_sent && agent.engine_session_id && agent.wa_status === "connected") {
    try {
      await engine.sendText(agent.engine_session_id, t.phone_e164, fillVars(msg.text, { first_name: firstName(t.name), business_name: (await agentProfile(db, agent)).name, ...(t.variables ?? {}) }));
      await db.from("campaign_targets").update({ final_message_sent: true }).eq("id", t.id);
    } catch (e) { console.error(JSON.stringify({ where: "campaign_no_answer_msg", error: String(e) })); }
  }
}
