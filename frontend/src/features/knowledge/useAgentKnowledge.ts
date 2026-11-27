import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type CatalogItem = {
  id: string; ref: string; kind: "service" | "product"; name: string; description: string | null;
  price_minor: number | null; price_from: boolean; currency: string | null; duration_minutes: number | null;
  source: "ai" | "user" | "document"; locked: boolean; active: boolean; in_calling: boolean; in_messaging: boolean; sort: number;
};
export type Faq = { id: string; question: string; answer: string; source: "ai" | "user" | "document"; locked: boolean; in_calling: boolean; in_messaging: boolean };
export type AvailabilityRule = { id: string; weekday: number; start_time: string; end_time: string };
export type BookingSettings = {
  timezone: string; slot_interval_minutes: number; buffer_minutes: number; capacity: number;
  min_notice_minutes: number; max_days_ahead: number; auto_confirm: boolean; default_duration_minutes: number;
};
export type FieldMeta = Record<string, { source?: "ai" | "user" | "document"; locked?: boolean; updated_at?: string }>;
export type BlueprintData = {
  business?: { name?: string; industry?: string; description?: string; address?: string; service_area?: string; website?: string; timezone?: string; currency?: string };
  hours?: Record<string, [string, string][]>;
  policies?: {
    cancellation?: string; deposit?: string; returns?: string; payment_methods?: string[]; payment_instructions?: string; other?: string;
    delivery?: { enabled?: boolean; areas?: string; fee?: number; free_over?: number; eta?: string };
    pickup?: { enabled?: boolean; address?: string };
  };
  collect_fields?: string[]; goal?: string; tone?: string; notes?: string; response_time?: string;
};
export type AgentDetail = {
  id: string; workspace_id: string; name: string; type: "booking" | "inquiry" | "order"; status: "draft" | "ready" | "live" | "paused";
  handoff_phone_e164: string | null; handoff_verified_at: string | null; wa_phone: string | null; wa_status: string; industry_key: string | null;
};
export type DocumentRow = { id: string; filename: string; status: "uploaded" | "extracting" | "ready" | "failed"; digest_summary: string | null; created_at: string; error: string | null };

export function useAgentKnowledge(agentId: string | undefined) {
  return useQuery({
    queryKey: ["knowledge", agentId],
    enabled: Boolean(agentId),
    queryFn: async () => {
      const id = agentId!;
      const [agent, bp, catalog, faqs, rules, settings, docs] = await Promise.all([
        supabase.from("agents").select("id,workspace_id,name,type,status,handoff_phone_e164,handoff_verified_at,wa_phone,wa_status,industry_key").eq("id", id).single(),
        supabase.from("agent_blueprints").select("data,field_meta,readiness,version").eq("agent_id", id).single(),
        supabase.from("catalog_items").select("*").eq("agent_id", id).order("sort").order("created_at"),
        supabase.from("faqs").select("id,question,answer,source,locked,in_calling,in_messaging").eq("agent_id", id).order("sort").order("created_at"),
        supabase.from("availability_rules").select("id,weekday,start_time,end_time").eq("agent_id", id).order("weekday").order("start_time"),
        supabase.from("booking_settings").select("*").eq("agent_id", id).maybeSingle(),
        supabase.from("documents").select("id,filename,status,digest_summary,created_at,error").eq("agent_id", id).order("created_at", { ascending: false }),
      ]);
      if (agent.error) throw agent.error;
      return {
        agent: agent.data as AgentDetail,
        blueprint: (bp.data?.data ?? {}) as BlueprintData,
        fieldMeta: (bp.data?.field_meta ?? {}) as FieldMeta,
        readiness: (bp.data?.readiness ?? 0) as number,
        version: (bp.data?.version ?? 0) as number,
        catalog: (catalog.data ?? []) as CatalogItem[],
        faqs: (faqs.data ?? []) as Faq[],
        rules: (rules.data ?? []) as AvailabilityRule[],
        bookingSettings: (settings.data ?? null) as BookingSettings | null,
        documents: (docs.data ?? []) as DocumentRow[],
      };
    },
  });
}

export type Knowledge = NonNullable<ReturnType<typeof useAgentKnowledge>["data"]>;
