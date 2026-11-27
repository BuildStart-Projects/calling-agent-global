import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
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
  const [deleting, setDeleting] = useState<AgentSummary | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const { role } = useAuth();
  const canDelete = role === "owner" || role === "admin";
  const remove = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    try { await callFunction("account", { action: "delete_agent", agent_id: deleting.id, confirm_name: confirmName }); toast.success(`${deleting.name} deleted`); setDeleting(null); setConfirmName(""); qc.invalidateQueries({ queryKey: ["agents"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
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
                  <div className="flex items-center gap-1"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", a.status === "live" ? "bg-success/10 text-success" : a.status === "paused" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>{a.status === "live" ? "● Live" : a.status === "paused" && a.pause_reason === "no_credits" ? "Paused · out of credits" : a.status === "paused" && a.pause_reason === "admin" ? "Paused by BuildStart" : a.status}</span>
                    {canDelete && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`More actions for ${a.name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setConfirmName(""); setDeleting(a); }}><Trash2 className="mr-2 h-4 w-4" />Delete agent</DropdownMenuItem></DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
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
      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>This disconnects its WhatsApp number, cancels its campaigns and permanently deletes its knowledge, conversations, calls and bookings. This can't be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5"><p className="text-sm">Type <strong>{deleting?.name}</strong> to confirm</p><Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" aria-label="Agent name" /></div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={confirmName.trim() !== deleting?.name.trim() || busy === deleting?.id} onClick={remove}>{busy === deleting?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete agent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
