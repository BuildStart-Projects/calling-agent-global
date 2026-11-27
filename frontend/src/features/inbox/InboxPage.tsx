import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, isToday } from "date-fns";
import { AlertTriangle, ArrowLeft, ArrowUp, Bot, Hand, Inbox as InboxIcon, Loader2, Pause, Play, Search, ShieldAlert, Smartphone, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { callFunction, supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgents } from "@/features/agents/useAgents";
import { cn } from "@/lib/utils";

type Convo = {
  id: string; agent_id: string; ai_paused: boolean; paused_by: string | null; paused_until: string | null; needs_attention: boolean;
  last_message_at: string; last_message_preview: string | null; unread_count: number; is_test: boolean;
  contact: { id: string; name: string | null; push_name: string | null; phone_e164: string | null; do_not_contact: boolean };
};
type Msg = { id: string; direction: "in" | "out"; sender: string; text: string | null; type: string; created_at: string; refusal: boolean; validation_flags: unknown[]; tool_events: Array<{ tool: string }> };
const FILTERS = [["all", "All"], ["attention", "Needs attention"], ["paused", "AI paused"], ["unread", "Unread"]] as const;

export default function InboxPage() {
  const { data: agents } = useAgents();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>((params.get("filter") as never) ?? "all");
  const [q, setQ] = useState("");
  const selected = params.get("c");
  const agentIds = (agents ?? []).map((a) => a.id);

  const { data: convos, isLoading } = useQuery({
    queryKey: ["conversations", agentIds.join(",")],
    enabled: agentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("conversations").select("*, contact:contacts(id,name,push_name,phone_e164,do_not_contact)").in("agent_id", agentIds).eq("is_test", false).order("last_message_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data as Convo[];
    },
  });
  useEffect(() => {
    if (!agentIds.length) return;
    const ch = supabase.channel("inbox-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => qc.invalidateQueries({ queryKey: ["conversations"] }))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => qc.invalidateQueries({ queryKey: ["messages", (p.new as { conversation_id: string }).conversation_id] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [agentIds.join(","), qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => (convos ?? []).filter((c) => {
    const name = `${c.contact.name ?? ""} ${c.contact.push_name ?? ""} ${c.contact.phone_e164 ?? ""} ${c.last_message_preview ?? ""}`.toLowerCase();
    if (q && !name.includes(q.toLowerCase())) return false;
    if (filter === "attention") return c.needs_attention;
    if (filter === "paused") return c.ai_paused;
    if (filter === "unread") return c.unread_count > 0;
    return true;
  }), [convos, filter, q]);
  const current = convos?.find((c) => c.id === selected) ?? null;
  const select = (id: string | null) => { const p = new URLSearchParams(params); if (id) p.set("c", id); else p.delete("c"); setParams(p, { replace: true }); };

  if (agents && !agents.length) return <div className="p-8"><EmptyState icon={InboxIcon} title="No conversations yet" description="Create and connect an agent — WhatsApp conversations will appear here." /></div>;

  return (
    <div className="flex h-[calc(100dvh-4rem)] pb-16 sm:pb-0">
      <aside className={cn("flex w-full flex-col border-r md:w-[340px]", current && "hidden md:flex")}>
        <div className="space-y-3 border-b p-4">
          <h1 className="text-lg font-semibold">Inbox</h1>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 pl-9" /></div>
          <div className="flex gap-1 overflow-x-auto">{FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs", filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l}</button>)}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> : !list.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No conversations here.</p>
          ) : list.map((c) => (
            <button key={c.id} onClick={() => select(c.id)} className={cn("flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted/50", c.id === selected && "bg-accent/60")}>
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 dark:text-brand-300">
                {(c.contact.name ?? c.contact.push_name ?? "?")[0]?.toUpperCase()}
                {c.needs_attention && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-warning text-[9px] text-white">!</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.contact.name ?? c.contact.push_name ?? c.contact.phone_e164}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{isToday(new Date(c.last_message_at)) ? format(new Date(c.last_message_at), "HH:mm") : formatDistanceToNowStrict(new Date(c.last_message_at))}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  {c.ai_paused && <Pause className="h-3 w-3 shrink-0 text-warning" />}
                  <span className="truncate text-xs text-muted-foreground">{c.last_message_preview}</span>
                  {c.unread_count > 0 && <span className="ml-auto rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-white">{c.unread_count}</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className={cn("flex min-w-0 flex-1 flex-col", !current && "hidden md:flex")}>
        {current ? <Thread convo={current} onBack={() => select(null)} /> : <div className="m-auto max-w-sm text-center text-sm text-muted-foreground"><InboxIcon className="mx-auto mb-3 h-8 w-8" />Select a conversation</div>}
      </section>
    </div>
  );
}

function Thread({ convo, onBack }: { convo: Convo; onBack: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const { data: msgs } = useQuery({
    queryKey: ["messages", convo.id],
    queryFn: async () => (await supabase.from("messages").select("*").eq("conversation_id", convo.id).order("created_at").limit(500)).data as Msg[],
  });
  useEffect(() => { end.current?.scrollIntoView(); }, [msgs]);
  useEffect(() => {
    if (convo.unread_count > 0) supabase.from("conversations").update({ unread_count: 0 }).eq("id", convo.id).then(() => qc.invalidateQueries({ queryKey: ["conversations"] }));
  }, [convo.id, convo.unread_count, qc]);

  const setPaused = async (paused: boolean) => {
    const { error } = await supabase.from("conversations").update({ ai_paused: paused, paused_by: paused ? "inbox" : null, paused_until: null, needs_attention: paused ? convo.needs_attention : false }).eq("id", convo.id);
    if (error) toast.error("Couldn't update."); else { toast.success(paused ? "AI paused for this chat" : "AI resumed"); qc.invalidateQueries({ queryKey: ["conversations"] }); }
  };
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try { await callFunction("inbox-send", { conversation_id: convo.id, text }); setText(""); qc.invalidateQueries({ queryKey: ["messages", convo.id] }); qc.invalidateQueries({ queryKey: ["conversations"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setSending(false); }
  };

  return (
    <>
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{convo.contact.name ?? convo.contact.push_name ?? convo.contact.phone_e164}</p>
          <p className="text-xs text-muted-foreground">{convo.contact.phone_e164}{convo.contact.do_not_contact && " · Do not contact"}</p>
        </div>
        {convo.ai_paused ? (
          <Button size="sm" variant="outline" onClick={() => setPaused(false)}><Play className="mr-1 h-3.5 w-3.5" />Resume AI</Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setPaused(true)}><Pause className="mr-1 h-3.5 w-3.5" />Pause AI</Button>
        )}
      </header>
      {convo.ai_paused && (
        <div className="flex items-center gap-2 border-b bg-warning/10 px-4 py-2 text-xs">
          {convo.paused_by === "owner_phone" ? <Smartphone className="h-3.5 w-3.5" /> : convo.paused_by === "handoff" ? <Hand className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {convo.paused_by === "owner_phone" ? "Paused — you replied from your phone." : convo.paused_by === "handoff" ? "Paused — the customer asked for a person." : "AI paused for this chat."}
          {convo.paused_until && ` Resumes ${formatDistanceToNowStrict(new Date(convo.paused_until), { addSuffix: true })}.`}
        </div>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/30 px-4 py-4">
        {(msgs ?? []).map((m) => (
          <div key={m.id} className={cn("flex flex-col", m.direction === "out" ? "items-end" : "items-start")}>
            <div className={cn("max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-sm",
              m.direction === "in" ? "rounded-tl-md bg-card" : m.sender === "ai" ? (m.refusal ? "rounded-tr-md bg-muted" : "rounded-tr-md bg-[#d9fdd3] text-neutral-900 dark:bg-[#005c4b] dark:text-white") : "rounded-tr-md bg-primary text-primary-foreground")}>
              {m.text ?? <span className="italic opacity-70">[{m.type}]</span>}
            </div>
            <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              {m.direction === "out" && (m.sender === "ai" ? <><Bot className="h-3 w-3" />AI</> : m.sender === "owner_phone" ? <><Smartphone className="h-3 w-3" />Your phone</> : <><UserRound className="h-3 w-3" />You</>)}
              {m.tool_events?.some((t) => t.tool === "handoff_to_human") && <span className="text-warning">· 🙋 handoff</span>}
              {m.tool_events?.some((t) => t.tool === "capture_lead") && <span>· saved lead</span>}
              {m.validation_flags?.length > 0 && <span title="A value was corrected before sending"><ShieldAlert className="inline h-3 w-3 text-warning" /></span>}
              · {format(new Date(m.created_at), "HH:mm")}
            </span>
          </div>
        ))}
        <div ref={end} />
      </div>
      {convo.needs_attention && <div className="flex items-center gap-2 border-t bg-warning/10 px-4 py-2 text-xs"><AlertTriangle className="h-3.5 w-3.5 text-warning" />This customer wants to talk to a person.</div>}
      <div className="flex items-end gap-2 border-t p-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Reply as yourself — the AI pauses for this chat" className="max-h-32 min-h-[44px] resize-none"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button size="icon" className="h-11 w-11 shrink-0 rounded-full" onClick={send} disabled={sending || !text.trim()} aria-label="Send">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button>
      </div>
    </>
  );
}
