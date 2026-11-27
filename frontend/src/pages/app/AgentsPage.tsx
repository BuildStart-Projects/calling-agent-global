import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useAgents, type AgentSummary } from "@/features/agents/useAgents";
import { callFunction } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const WA: Record<string, string> = { connected: "WhatsApp connected", qr: "Waiting for QR scan", logged_out: "⚠ WhatsApp disconnected", not_connected: "WhatsApp not connected" };

export default function AgentsPage() {
  const { data: agents } = useAgents();
  const qc = useQueryClient();
  const [confirmPause, setConfirmPause] = useState<AgentSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const control = async (a: AgentSummary, action: "pause" | "resume") => {
    setBusy(a.id);
    try { await callFunction("agent-control", { agent_id: a.id, action }); toast.success(action === "pause" ? "Agent paused" : "Agent is live again"); qc.invalidateQueries({ queryKey: ["agents"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHeader title="Agents" description="Your AI agents and their WhatsApp numbers." actions={<Button asChild><Link to="/app/new"><Plus className="mr-1 h-4 w-4" />New agent</Link></Button>} />
      <PageBody>
        {!agents?.length ? <EmptyState icon={Bot} title="No agents yet" action={<Button asChild><Link to="/app/new">Create an agent</Link></Button>} /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {agents.map((a) => (
              <div key={a.id} className="surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Bot className="h-5 w-5" /></span>
                    <div><p className="font-semibold">{a.name}</p><p className="text-sm capitalize text-muted-foreground">{a.type} agent</p></div>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", a.status === "live" ? "bg-success/10 text-success" : a.status === "paused" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>{a.status === "live" ? "● Live" : a.status}</span>
                </div>
                <p className={cn("mt-4 text-sm", a.wa_status === "logged_out" ? "text-destructive" : "text-muted-foreground")}>{WA[a.wa_status]}{a.wa_phone ? ` · ${a.wa_phone}` : ""}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {a.status === "draft" || a.status === "ready" ? <Button size="sm" asChild><Link to={`/app/agents/${a.id}/${a.status === "draft" ? "build" : "voice"}`}>Continue setup</Link></Button> : null}
                  {a.status === "live" && <Button size="sm" variant="outline" onClick={() => setConfirmPause(a)} disabled={busy === a.id}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button>}
                  {a.status === "paused" && <Button size="sm" onClick={() => control(a, "resume")} disabled={busy === a.id}>{busy === a.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}Resume</Button>}
                  {(a.wa_status === "logged_out" || a.wa_status === "not_connected") && a.status !== "draft" && <Button size="sm" variant="outline" asChild><Link to={`/app/agents/${a.id}/connect`}>Connect WhatsApp</Link></Button>}
                  <Button size="sm" variant="ghost" asChild><Link to={`/app/agents/${a.id}/voice`}>Voice & settings</Link></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
      <AlertDialog open={Boolean(confirmPause)} onOpenChange={(o) => !o && setConfirmPause(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {confirmPause?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Calls will ring your phone normally and messages won't get AI replies until you resume.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep live</AlertDialogCancel><AlertDialogAction onClick={() => confirmPause && control(confirmPause, "pause")}>Pause agent</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
