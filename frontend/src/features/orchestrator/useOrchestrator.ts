import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type OrchestratorMode = "onboarding" | "knowledge" | "campaign_script";
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  questionIndex?: number | null;
  refused?: boolean;
  attachments?: Array<{ id: string; filename: string }>;
  pending?: boolean;
};
export type Readiness = { score: number; missing: string[]; questions_asked: number; max_questions: number; completed: boolean };
export type DoneInfo = { summary: string; defaults_applied: string[]; recommended_next: string[] };

type StreamState = { text: string; question: { text: string; suggestions: string[]; index: number | null; max: number | null } | null; refused: string | null };

export function useOrchestrator(agentId: string | undefined, mode: OrchestratorMode) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [stream, setStream] = useState<StreamState>({ text: "", question: null, refused: null });
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [done, setDone] = useState<DoneInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patchedPaths, setPatchedPaths] = useState<Record<string, number>>({});
  const sessionId = useRef<string | null>(null);
  const invalidateTimer = useRef<number>();
  const started = useRef(false);

  const invalidateKnowledge = useCallback(() => {
    window.clearTimeout(invalidateTimer.current);
    invalidateTimer.current = window.setTimeout(() => qc.invalidateQueries({ queryKey: ["knowledge", agentId] }), 250);
  }, [qc, agentId]);

  // Load the latest session + history for this mode.
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      const { data: session } = await supabase.from("orchestrator_sessions").select("id,status,questions_asked,max_questions")
        .eq("agent_id", agentId).eq("mode", mode).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (session) {
        sessionId.current = session.id;
        const { data: rows } = await supabase.from("orchestrator_messages").select("id,role,content,suggestions,question_index,refused,attachments")
          .eq("session_id", session.id).order("created_at", { ascending: true });
        if (cancelled) return;
        setMessages((rows ?? []).filter((r) => r.role !== "system_note").map((r) => ({
          id: r.id, role: r.role as "user" | "assistant", content: r.content, suggestions: r.suggestions as string[],
          questionIndex: r.question_index, refused: r.refused, attachments: r.attachments as ChatMessage["attachments"],
        })));
        setReadiness((prev) => prev ?? { score: 0, missing: [], questions_asked: session.questions_asked, max_questions: session.max_questions, completed: session.status === "completed" });
      }
      setLoadingHistory(false);
    })();
    return () => { cancelled = true; };
  }, [agentId, mode]);

  const send = useCallback(async (message: string | null, attachments: Array<{ id: string; filename: string }> = []) => {
    if (!agentId || streaming) return;
    setError(null);
    setDone(null);
    if (message || attachments.length) {
      setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: message ?? "", attachments }]);
    }
    setStreaming(true);
    setStream({ text: "", question: null, refused: null });
    const { data: { session } } = await supabase.auth.getSession();
    let acc: StreamState = { text: "", question: null, refused: null };
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/orchestrator-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ agent_id: agentId, session_id: sessionId.current ?? undefined, mode, message, attachment_ids: attachments.map((a) => a.id) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? "Couldn't reach the assistant. Please try again.");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buf += value;
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = /^event: (.+)$/m.exec(block)?.[1];
          const raw = /^data: (.*)$/m.exec(block)?.[1];
          if (!ev || raw == null) continue;
          const data = JSON.parse(raw);
          switch (ev) {
            case "token": acc = { ...acc, text: acc.text + data.text }; setStream(acc); break;
            case "question": acc = { ...acc, question: data }; setStream(acc); break;
            case "refused": acc = { ...acc, refused: data.text, text: "" }; setStream(acc); break;
            case "blueprint_patch":
              setPatchedPaths((p) => ({ ...p, [String(data.path).split(".").slice(0, 2).join(".")]: Date.now(), [String(data.path).split(".")[0]!]: Date.now() }));
              invalidateKnowledge();
              break;
            case "readiness": setReadiness(data); break;
            case "done": setDone(data); qc.invalidateQueries({ queryKey: ["agents"] }); break;
            case "error": setError(data.message); break;
          }
        }
      }
      const content = acc.refused ?? [acc.text.trim(), acc.question?.text].filter(Boolean).join("\n\n");
      if (content) {
        setMessages((m) => [...m, {
          id: `a-${Date.now()}`, role: "assistant", content, refused: Boolean(acc.refused),
          suggestions: acc.question?.suggestions ?? [], questionIndex: acc.question?.index ?? null,
        }]);
      }
      if (!sessionId.current) {
        const { data: s } = await supabase.from("orchestrator_sessions").select("id").eq("agent_id", agentId).eq("mode", mode).order("created_at", { ascending: false }).limit(1).maybeSingle();
        sessionId.current = s?.id ?? null;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStream({ text: "", question: null, refused: null });
      setStreaming(false);
      invalidateKnowledge();
    }
  }, [agentId, mode, streaming, invalidateKnowledge, qc]);

  // Auto-start an empty onboarding conversation.
  useEffect(() => {
    if (!loadingHistory && mode === "onboarding" && messages.length === 0 && !started.current && agentId) {
      started.current = true;
      void send(null);
    }
  }, [loadingHistory, messages.length, mode, agentId, send]);

  return { messages, loadingHistory, streaming, stream, readiness, done, error, patchedPaths, send, clearError: () => setError(null) };
}
