import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { callFunction, supabase } from "@/lib/supabase";

export type Schedule = {
  start_at: string | null; end_at: string | null; window_tz: "contact" | "business"; windows: Record<string, [string, string][]>;
  concurrency: number; gap_seconds: number; daily_cap: number; retries: { max: number; spacing_minutes: number };
  pre_call_message: { enabled: boolean; lead_minutes: number; text: string }; no_answer_message: { enabled: boolean; text: string }; max_call_seconds: number;
};
export type Script = { purpose?: string; key_points?: string[]; offer?: string | null; offer_validity?: string | null; questions_to_ask?: string[]; success_definition?: string; collect_fields?: string[]; brief?: string };
export type Campaign = {
  id: string; agent_id: string; name: string; goal_type: string; script: Script; opening_line: string | null; status: "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
  pause_reason: string | null; schedule: Schedule; source_summary: Record<string, number>; launched_at: string | null; completed_at: string | null; created_at: string;
};
export type Stats = { campaign_id: string; total: number; called: number; answered: number; converted: number; remaining: number; calling: number; unanswered: number; opted_out: number; failed: number };
export type Target = { id: string; phone_e164: string; name: string | null; status: string; attempts: number; outcome: string | null; outcome_summary: string | null; callback_at: string | null; last_attempt_at: string | null; last_call_id: string | null };
export type QuickType = "leads_24h" | "missed_callers" | "confirm_tomorrow" | "retry_no_answers" | "win_back" | "follow_up_inquiries" | "feedback";
export type AddResult = { added: number; invalid: number; duplicates: number; dnc: number };

export const manage = <T,>(body: Record<string, unknown>) => callFunction<T>("campaign-manage", body);

export function useCampaigns(workspaceId?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!workspaceId) return;
    const ch = supabase.channel("campaigns-list").on("postgres_changes", { event: "*", schema: "public", table: "campaigns", filter: `workspace_id=eq.${workspaceId}` }, () => qc.invalidateQueries({ queryKey: ["campaigns"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspaceId, qc]);
  return useQuery({
    queryKey: ["campaigns", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data } = await supabase.from("campaigns").select("*").eq("workspace_id", workspaceId!).order("created_at", { ascending: false });
      const ids = (data ?? []).map((c) => c.id);
      const { data: stats } = ids.length ? await supabase.from("campaign_stats").select("*").in("campaign_id", ids) : { data: [] };
      const byId = new Map((stats ?? []).map((s) => [s.campaign_id, s as Stats]));
      return (data ?? []).map((c) => ({ ...(c as Campaign), stats: byId.get(c.id) }));
    },
  });
}

export function useCampaign(id?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`campaign-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaigns", filter: `id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["campaign", id] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_targets", filter: `campaign_id=eq.${id}` }, () => qc.invalidateQueries({ queryKey: ["campaign", id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);
  return useQuery({
    queryKey: ["campaign", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const [c, s, t] = await Promise.all([
        supabase.from("campaigns").select("*").eq("id", id!).single(),
        supabase.from("campaign_stats").select("*").eq("campaign_id", id!).maybeSingle(),
        supabase.from("campaign_targets").select("id,phone_e164,name,status,attempts,outcome,outcome_summary,callback_at,last_attempt_at,last_call_id").eq("campaign_id", id!).order("updated_at", { ascending: false }).limit(1000),
      ]);
      if (c.error) throw c.error;
      return { campaign: c.data as Campaign, stats: s.data as Stats | null, targets: (t.data ?? []) as Target[] };
    },
  });
}

export const QUICK: Array<{ type: QuickType; title: string; hint: string; emoji: string; needs?: "booking" }> = [
  { type: "leads_24h", title: "Call last 24h leads", hint: "New enquiries from the last day", emoji: "⚡" },
  { type: "missed_callers", title: "Call back missed callers", hint: "Missed in the last 48 hours, not yet reached", emoji: "📞" },
  { type: "confirm_tomorrow", title: "Confirm tomorrow's bookings", hint: "Reduce no-shows", emoji: "📅", needs: "booking" },
  { type: "follow_up_inquiries", title: "Follow up enquiries", hint: "Enquired 3–14 days ago, undecided", emoji: "🔁" },
  { type: "retry_no_answers", title: "Retry no-answers", hint: "From your last campaign", emoji: "↻" },
  { type: "win_back", title: "Win back customers", hint: "No visit in 60+ days", emoji: "💚" },
  { type: "feedback", title: "Ask for feedback", hint: "Customers from the last 7 days", emoji: "⭐" },
];

export const STATUS_STYLE: Record<Campaign["status"], string> = {
  draft: "bg-muted text-muted-foreground", scheduled: "bg-accent text-accent-foreground", running: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning", completed: "bg-muted text-foreground", cancelled: "bg-muted text-muted-foreground",
};
export const PAUSE_REASON: Record<string, string> = {
  user: "Paused by you", no_credits: "Paused — out of credits", agent_offline: "Paused — WhatsApp disconnected", failure_rate: "Paused — too many failed calls", admin: "Paused by BuildStart support",
};
export const OUTCOME_LABEL: Record<string, string> = {
  booked: "Booked", ordered: "Ordered", interested: "Interested", not_interested: "Not interested", callback_requested: "Call back later",
  wrong_number: "Wrong number", do_not_call: "Do not call", unknown: "Answered",
};
export const TARGET_LABEL: Record<string, string> = {
  queued: "Waiting", notified: "Heads-up sent", calling: "Calling now", answered: "Answered", completed: "Done", no_answer: "No answer", busy: "Busy",
  failed: "Failed", skipped_dnc: "Skipped (do not call)", skipped_invalid: "Invalid", opted_out: "Opted out", cancelled: "Not called",
};
