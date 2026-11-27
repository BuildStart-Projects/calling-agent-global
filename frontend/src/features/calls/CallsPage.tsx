import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { AlertTriangle, Bot, Loader2, Pause, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, User } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

type Call = {
  id: string; direction: "inbound" | "outbound" | "auto-callback"; caller_number: string | null; started_at: string | null; duration_seconds: number;
  outcome: string; summary: string | null; transcript: Array<{ role: string; text: string }>; flags: Array<{ claim: string; reason: string }>;
  recording_key: string | null; contact: { name: string | null } | null; created_at: string;
};
const OUTCOME: Record<string, { label: string; cls: string }> = {
  answered: { label: "Answered", cls: "bg-success/10 text-success" }, lead: { label: "Lead", cls: "bg-info/10 text-info" },
  booked: { label: "Booked", cls: "bg-success/10 text-success" }, ordered: { label: "Ordered", cls: "bg-success/10 text-success" },
  handoff: { label: "Wants a person", cls: "bg-warning/10 text-warning" }, missed: { label: "Missed", cls: "bg-destructive/10 text-destructive" },
  unanswered: { label: "No answer", cls: "bg-muted text-muted-foreground" }, agent_disabled: { label: "Rang your phone", cls: "bg-muted text-muted-foreground" },
};
const FILTERS = [["all", "All"], ["inbound", "Inbound"], ["outbound", "Outbound"], ["auto-callback", "Callbacks"]] as const;

export default function CallsPage() {
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [open, setOpen] = useState<Call | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["calls", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => {
      const { data, error } = await supabase.from("calls").select("*, contact:contacts(name)").eq("workspace_id", workspace!.id).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data as Call[];
    },
  });
  useEffect(() => {
    if (!workspace?.id) return;
    const ch = supabase.channel("calls-live").on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `workspace_id=eq.${workspace.id}` }, () => qc.invalidateQueries({ queryKey: ["calls"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspace?.id, qc]);
  const rows = useMemo(() => (data ?? []).filter((c) => filter === "all" || c.direction === filter), [data, filter]);

  return (
    <>
      <PageHeader title="Calls" description="Every call your agent handled — summary, recording and transcript." />
      <PageBody className="space-y-4">
        <div className="flex gap-1.5">
          {FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full px-3 py-1.5 text-sm", filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{l}</button>)}
        </div>
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !rows.length ? (
          <EmptyState icon={Phone} title="No calls yet" description="When customers call your WhatsApp number, your agent answers and the call appears here with a summary." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {rows.map((c) => {
              const Icon = c.outcome === "missed" ? PhoneMissed : c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
              const o = OUTCOME[c.outcome] ?? OUTCOME.answered!;
              return (
                <button key={c.id} onClick={() => setOpen(c)} className="flex w-full items-center gap-4 border-b px-4 py-3.5 text-left last:border-0 hover:bg-muted/50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.contact?.name ?? c.caller_number ?? "Unknown"}</span>
                      {c.flags?.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-label="Needs review" />}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">{c.summary ?? (c.duration_seconds ? "Summary on the way…" : "")}</span>
                  </span>
                  <span className={cn("hidden rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline", o.cls)}>{o.label}</span>
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {c.duration_seconds ? `${Math.floor(c.duration_seconds / 60)}:${String(c.duration_seconds % 60).padStart(2, "0")}` : "—"}<br />
                    {formatDistanceToNow(new Date(c.started_at ?? c.created_at), { addSuffix: true })}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </PageBody>
      <Sheet open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && <CallDetail call={open} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function CallDetail({ call }: { call: Call }) {
  const merged = useMemo(() => {
    const out: Array<{ role: string; text: string }> = [];
    for (const t of call.transcript ?? []) {
      const role = t.role === "assistant" || t.role === "agent" ? "ai" : "caller";
      const last = out.at(-1);
      if (last && last.role === role) last.text += ` ${t.text}`; else out.push({ role, text: t.text });
    }
    return out;
  }, [call]);
  return (
    <>
      <SheetHeader>
        <SheetTitle>{call.contact?.name ?? call.caller_number ?? "Call"}</SheetTitle>
        <p className="text-sm text-muted-foreground">{call.started_at ? format(new Date(call.started_at), "PPp") : ""} · {call.direction}</p>
      </SheetHeader>
      <div className="mt-6 space-y-5">
        {call.summary && <div className="rounded-xl border bg-accent/50 p-4 text-sm"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>{call.summary}</div>}
        {call.flags?.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-warning"><AlertTriangle className="h-4 w-4" />Please review</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">{call.flags.map((f, i) => <li key={i}>“{f.claim}” — {f.reason}</li>)}</ul>
            <p className="mt-2 text-xs">Add the correct information in Knowledge so your agent gets it right next time.</p>
          </div>
        )}
        {call.recording_key && <RecordingPlayer callId={call.id} />}
        {merged.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transcript</p>
            {merged.map((t, i) => (
              <div key={i} className={cn("flex gap-2", t.role === "ai" ? "" : "flex-row-reverse")}>
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">{t.role === "ai" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}</span>
                <p className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", t.role === "ai" ? "bg-muted" : "bg-primary text-primary-foreground")}>{t.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RecordingPlayer({ callId }: { callId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audio] = useState(() => new Audio());
  useEffect(() => () => { audio.pause(); if (url?.startsWith("blob:")) URL.revokeObjectURL(url); }, [audio, url]);
  const toggle = async () => {
    if (playing) { audio.pause(); setPlaying(false); return; }
    if (!url) {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recording-proxy?call_id=${callId}`;
      const headers = { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY };
      let src: string | null = null;
      const res = await fetch(base, { headers });
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) src = (await res.json()).url ?? null;
      else if (res.ok) src = URL.createObjectURL(await res.blob());
      setLoading(false);
      if (!src) return;
      setUrl(src);
      audio.src = src;
    }
    audio.onended = () => setPlaying(false);
    await audio.play();
    setPlaying(true);
  };
  return (
    <button onClick={toggle} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left hover:bg-muted/50">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</span>
      <span className="text-sm font-medium">Call recording</span>
    </button>
  );
}
