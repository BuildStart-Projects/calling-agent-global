import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import type { AgentType } from "@/app/nav";

export type AgentSummary = {
  id: string;
  name: string;
  type: AgentType;
  status: "draft" | "ready" | "live" | "paused";
  wa_status: "not_connected" | "qr" | "connected" | "logged_out";
  wa_phone: string | null;
  pause_reason?: "user" | "no_credits" | "admin" | null;
  created_at: string;
};

export function useAgents() {
  const { workspace } = useAuth();
  return useQuery({
    queryKey: ["agents", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("id,name,type,status,pause_reason,wa_status,wa_phone,created_at")
        .eq("workspace_id", workspace!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AgentSummary[];
    },
  });
}
