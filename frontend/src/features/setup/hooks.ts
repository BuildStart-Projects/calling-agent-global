import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type ChannelConfig = {
  agent_id: string; channel: "calling" | "messaging"; language: string; adapt_language: boolean; voice_name: string | null;
  persona_style: "friendly" | "professional" | "energetic" | "reassuring"; greeting: string | null; missed_call_message: string | null;
  callback_greeting: string | null; welcome_message: string | null; emoji_level: "none" | "light" | "expressive";
  off_topic_reply: string | null; custom_instructions: string | null; synced_from_calling: boolean; compiled_at: string | null;
};
export type Voice = { name: string; display_name: string; descriptor: string; tags: string[] };
export type Language = { code: string; label: string; native_label: string };

export function useChannelConfigs(agentId: string | undefined) {
  return useQuery({
    queryKey: ["channel-configs", agentId],
    enabled: Boolean(agentId),
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_configs")
        .select("agent_id,channel,language,adapt_language,voice_name,persona_style,greeting,missed_call_message,callback_greeting,welcome_message,emoji_level,off_topic_reply,custom_instructions,synced_from_calling,compiled_at")
        .eq("agent_id", agentId!);
      if (error) throw error;
      const rows = (data ?? []) as ChannelConfig[];
      return { calling: rows.find((r) => r.channel === "calling")!, messaging: rows.find((r) => r.channel === "messaging")! };
    },
  });
}

export function useSaveChannel(agentId: string | undefined) {
  const qc = useQueryClient();
  return async (channel: "calling" | "messaging", patch: Partial<ChannelConfig>) => {
    const { error } = await supabase.from("channel_configs").update(patch).eq("agent_id", agentId!).eq("channel", channel);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["channel-configs", agentId] });
  };
}

export function useCatalogs() {
  return useQuery({
    queryKey: ["voice-catalogs"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [v, l] = await Promise.all([
        supabase.from("voices").select("name,display_name,descriptor,tags").eq("active", true).order("sort"),
        supabase.from("languages").select("code,label,native_label").eq("active", true).order("sort"),
      ]);
      return { voices: (v.data ?? []) as Voice[], languages: (l.data ?? []) as Language[] };
    },
  });
}
