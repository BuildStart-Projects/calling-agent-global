// Pauses a workspace's live agents when credits run out and resumes them when credits come back.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { compileAgent } from "./compile-agent.ts";
import { notify } from "./runtime-tools.ts";

const RESUME_MIN = 0.5; // same as agent-control's go-live check

export async function syncCreditPause(db: SupabaseClient, workspaceId: string): Promise<"paused" | "resumed" | null> {
  const { data: w } = await db.from("wallet_balance").select("total").eq("workspace_id", workspaceId).maybeSingle();
  const total = Number(w?.total ?? 0);
  if (total <= 0) {
    const { data: live } = await db.from("agents").update({ status: "paused", pause_reason: "no_credits" }).eq("workspace_id", workspaceId).eq("status", "live").select("id");
    if (!live?.length) return null;
    for (const a of live) await compileAgent(db, a.id, { pushEngine: true }).catch((e) => console.error(JSON.stringify({ where: "credit-pause", agent: a.id, error: String(e) })));
    await notify(db, workspaceId, "billing", "🔴 Agents paused: out of credits", "Calls and messages aren't being answered. Top up or upgrade and your agents go back live automatically.", "/app/billing");
    return "paused";
  }
  if (total >= RESUME_MIN) {
    const { data: ws } = await db.from("workspaces").select("status").eq("id", workspaceId).single();
    if (ws?.status !== "active") return null;
    const { data: back } = await db.from("agents").update({ status: "live", pause_reason: null }).eq("workspace_id", workspaceId).eq("status", "paused").eq("pause_reason", "no_credits").eq("wa_status", "connected").select("id");
    if (!back?.length) return null;
    for (const a of back) await compileAgent(db, a.id, { pushEngine: true }).catch((e) => console.error(JSON.stringify({ where: "credit-pause", agent: a.id, error: String(e) })));
    await notify(db, workspaceId, "billing", "✅ Your agents are live again", "Thanks for topping up. Your agents are answering calls and messages again.", "/app/agents");
    return "resumed";
  }
  return null;
}
