import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Usage } from "./llm.ts";

export type AgentKind = "orchestrator" | "calling" | "messaging";

export async function chargeUsage(db: SupabaseClient, p: {
  workspaceId: string; agentId?: string | null; agentKind: AgentKind; meter: string;
  usage?: Usage; seconds?: number; units?: number; model?: string; refType?: string; refId?: string;
  campaignId?: string | null; free?: boolean;
}) {
  const { data, error } = await db.rpc("consume_credits", {
    ws: p.workspaceId, p_agent: p.agentId ?? null, p_agent_kind: p.agentKind, p_meter: p.meter,
    p_input_tokens: p.usage?.input_tokens ?? 0, p_output_tokens: p.usage?.output_tokens ?? 0,
    p_seconds: p.seconds ?? 0, p_units: p.units ?? 0, p_model: p.model ?? null,
    p_ref_type: p.refType ?? null, p_ref_id: p.refId ?? null, p_campaign: p.campaignId ?? null,
    p_free: p.free ?? false, p_estimated: p.usage?.estimated ?? false,
  });
  if (error) console.error(JSON.stringify({ level: "error", where: "chargeUsage", error: error.message }));
  return data as { credits: number; balance_after: number } | null;
}

export async function hasCredits(db: SupabaseClient, workspaceId: string, min = 0.01): Promise<boolean> {
  const { data } = await db.rpc("has_credits", { ws: workspaceId, min_credits: min });
  return Boolean(data);
}
