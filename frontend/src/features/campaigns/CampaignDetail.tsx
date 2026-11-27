import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Loader2, Pause, Pencil, Phone, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { manage, OUTCOME_LABEL, PAUSE_REASON, STATUS_STYLE, TARGET_LABEL, useCampaign, type Target } from "./api";

const FILTERS: Array<[string, string, (t: Target) => boolean]> = [
  ["all", "All", () => true],
  ["converted", "Converted", (t) => ["booked", "ordered", "interested"].includes(t.outcome ?? "")],
  ["callback", "Call back", (t) => t.outcome === "callback_requested"],
  ["unanswered", "No answer", (t) => ["no_answer", "busy"].includes(t.status)],
  ["waiting", "Waiting", (t) => ["queued", "notified", "calling"].includes(t.status)],
  ["other", "Other", (t) => ["failed", "skipped_dnc", "opted_out", "cancelled", "skipped_invalid"].includes(t.status) || ["not_interested", "wrong_number", "do_not_call"].includes(t.outcome ?? "")],
];

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { data, isLoading } = useCampaign(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [filter, setFilter] = useState("all");
  if (isLoading || !data) return <div className="p-8"><Skeleton className="h-96 rounded-2xl" /></div>;
  const { campaign: c, stats: s, targets } = data;
  const act = async (action: "pause" | "resume" | "cancel") => {
    setBusy(action);
    try { await manage({ action, campaign_id: c.id }); toast.success(action === "pause" ? "Paused" : action === "resume" ? "Resumed" : "Campaign stopped"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); setConfirmStop(false); }
  };
  const done = s ? s.total - s.remaining - s.calling : 0;
  const rows = targets.filter(FILTERS.find(([k]) => k === filter)![2]);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <Link to="/app/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Campaigns</Link>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h1 className="truncate text-2xl font-semibold">{c.name}</h1><span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", STATUS_STYLE[c.status])}>{c.status}</span></div>
          {c.status === "paused" && c.pause_reason && <p className="text-sm text-warning">{PAUSE_REASON[c.pause_reason] ?? "Paused"}</p>}
          {c.status === "scheduled" && c.schedule.start_at && <p className="text-sm text-muted-foreground">Starts {new Date(c.schedule.start_at).toLocaleString()}</p>}
        </div>
        <div className="flex gap-2">
          {["running", "scheduled"].includes(c.status) && <Button variant="outline" onClick={() => act("pause")} disabled={Boolean(busy)}>{busy === "pause" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pause className="mr-1 h-4 w-4" />}Pause</Button>}
          {c.status === "paused" && <><Button variant="outline" onClick={() => nav(`/app/campaigns/${c.id}/edit`)}><Pencil className="mr-1 h-4 w-4" />Edit</Button><Button onClick={() => act("resume")} disabled={Boolean(busy)}>{busy === "resume" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}Resume</Button></>}
          {["running", "scheduled", "paused"].includes(c.status) && <Button variant="ghost" className="text-destructive" onClick={() => setConfirmStop(true)}><Square className="mr-1 h-4 w-4" />Stop</Button>}
        </div>
      </div>

      {s && (
        <>
          <div className="mt-6 surface p-5">
            <div className="flex items-center justify-between text-sm"><span className="font-medium">{done} of {s.total} called</span>{s.calling > 0 && <span className="flex items-center gap-1.5 text-success"><span className="h-2 w-2 animate-pulse rounded-full bg-success" />{s.calling} on a call now</span>}</div>
            <Progress value={s.total ? (done / s.total) * 100 : 0} className="mt-3 h-2" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Answered" value={s.answered} of={s.called} />
            <Kpi label="Converted" value={s.converted} of={s.answered} accent />
            <Kpi label="No answer" value={s.unanswered} />
            <Kpi label="Opted out" value={s.opted_out} />
          </div>
        </>
      )}

      <div className="mt-8 flex gap-1.5 overflow-x-auto">{FILTERS.map(([k, l, f]) => <button key={k} onClick={() => setFilter(k)} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l} <span className="opacity-70">{targets.filter(f).length}</span></button>)}</div>
      <div className="mt-3 overflow-hidden rounded-xl border bg-card">
        {rows.length ? rows.map((t) => (
          <div key={t.id} className="flex flex-col gap-1 border-b px-4 py-3 text-sm last:border-0 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {t.status === "calling" ? <Phone className="h-4 w-4 animate-pulse text-success" /> : <span className="h-4 w-4" />}
              <div className="min-w-0"><p className="truncate font-medium">{t.name ?? t.phone_e164}</p>{t.name && <p className="tabular text-xs text-muted-foreground">{t.phone_e164}</p>}</div>
            </div>
            <div className="sm:w-64">{t.outcome_summary && t.outcome && <p className="line-clamp-2 text-xs text-muted-foreground">{t.outcome_summary}</p>}{t.callback_at && <p className="text-xs text-brand-700 dark:text-brand-300">Call back {new Date(t.callback_at).toLocaleString()}</p>}</div>
            <div className="flex items-center gap-3 sm:w-56 sm:justify-end">
              <span className={cn("rounded-full px-2 py-0.5 text-xs", t.outcome && ["booked", "ordered", "interested"].includes(t.outcome) ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{t.outcome && ["completed", "opted_out", "queued"].includes(t.status) ? OUTCOME_LABEL[t.outcome] : TARGET_LABEL[t.status] ?? t.status}</span>
              <span className="text-xs text-muted-foreground">{t.last_attempt_at ? formatDistanceToNow(new Date(t.last_attempt_at), { addSuffix: true }) : ""}</span>
            </div>
          </div>
        )) : <p className="p-8 text-center text-sm text-muted-foreground">No one here.</p>}
      </div>
      {c.status !== "draft" && <p className="mt-3 text-xs text-muted-foreground">Recordings and transcripts for each call are in <Link to="/app/calls" className="underline">Calls</Link>.</p>}

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Stop this campaign?</AlertDialogTitle><AlertDialogDescription>People who haven't been called yet won't be called. Calls in progress finish normally. This can't be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep running</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => act("cancel")}>Stop campaign</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kpi({ label, value, of, accent }: { label: string; value: number; of?: number; accent?: boolean }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-2xl font-semibold tabular", accent && "text-success")}>{value}{of ? <span className="ml-1 text-sm font-normal text-muted-foreground">{Math.round((value / of) * 100)}%</span> : null}</p>
    </div>
  );
}
