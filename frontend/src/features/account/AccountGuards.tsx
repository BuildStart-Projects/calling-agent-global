// App-wide account states: blocked workspace (suspended / pending deletion), credit banners, out-of-credits modal.
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, LogOut, Mail, ShieldAlert, Zap } from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgents } from "@/features/agents/useAgents";
import { usePublicPricing } from "@/features/billing/usePublicPricing";
import { supabase } from "@/lib/supabase";
import { formatCredits } from "@/lib/format";

export type SupportContacts = { email: string; priority_whatsapp: string | null; onboarding_url: string | null };

export function useSupportContacts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["support-contacts", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 10 * 60_000,
    queryFn: async () => ((await supabase.rpc("support_contacts")).data ?? { email: "hello@buildstart.io", priority_whatsapp: null, onboarding_url: null }) as SupportContacts,
  });
}

/** Full-screen notice when the workspace can't be used. Returns null when it's active. */
export function WorkspaceBlocked() {
  const { workspace, signOut } = useAuth();
  const { data: support } = useSupportContacts();
  if (!workspace || workspace.status === "active") return null;
  const deleting = workspace.status === "pending_deletion";
  const email = support?.email ?? "hello@buildstart.io";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <Logo className="mx-auto h-7" />
        <div className="mx-auto mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          {deleting ? <Clock className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
        </div>
        <h1 className="mt-4 text-xl font-semibold">{deleting ? "This workspace is being deleted" : "This workspace is suspended"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {deleting
            ? <>Your agents are offline and WhatsApp is disconnected. All data will be permanently erased on <strong className="text-foreground">{workspace.deletion_scheduled_for ? format(new Date(workspace.deletion_scheduled_for), "MMMM d, yyyy") : "the scheduled date"}</strong>. Changed your mind? Contact us before then and we'll restore it.</>
            : <>Your agents and campaigns are paused. Please contact support and we'll help you sort it out.</>}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button asChild><a href={`mailto:${email}?subject=${encodeURIComponent(deleting ? `Restore workspace: ${workspace.name}` : `Suspended workspace: ${workspace.name}`)}`}><Mail className="mr-2 h-4 w-4" />Email {email}</a></Button>
          <Button variant="ghost" onClick={signOut}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/** Thin banner above page content: out of credits, low balance, or top-up credits expiring within 14 days. */
export function CreditBanner() {
  const { wallet, workspace } = useAuth();
  const { data: pricing } = usePublicPricing();
  const { data: agents } = useAgents();
  const { pathname } = useLocation();
  const [hidden, setHidden] = useState(() => sessionStorage.getItem("bs.creditBanner") ?? "");
  if (!wallet || !workspace || pathname.startsWith("/app/billing")) return null;
  const hasAgent = (agents ?? []).some((a) => a.status !== "draft");
  const plan = pricing?.plans.find((p) => p.id === workspace.plan_id);
  const threshold = Math.max(5, (plan?.monthly_credits ?? 15) * 0.2);
  const total = Number(wallet.total);
  const expDays = wallet.next_topup_expiry ? differenceInCalendarDays(new Date(wallet.next_topup_expiry), new Date()) : null;

  let key = ""; let tone: "danger" | "warn" = "warn"; let text: React.ReactNode = null;
  if (hasAgent && total <= 0) { key = "out"; tone = "danger"; text = <>You're out of credits. Your agents have paused. Top up or upgrade to keep answering customers.</>; }
  else if (hasAgent && total < threshold) { key = `low-${workspace.plan_period_end ?? ""}`; text = <>Only <strong>{formatCredits(total)}</strong> credits left{wallet.plan_expires_at ? <> · monthly credits refresh {format(new Date(wallet.plan_expires_at), "MMM d")}</> : null}.</>; }
  else if (expDays !== null && expDays <= 14 && Number(wallet.next_topup_expiry_amount ?? 0) >= 1) { key = `exp-${wallet.next_topup_expiry}`; text = <><strong>{formatCredits(Number(wallet.next_topup_expiry_amount))}</strong> top-up credits expire {expDays <= 0 ? "today" : `in ${expDays} day${expDays === 1 ? "" : "s"}`}. Use them before {format(new Date(wallet.next_topup_expiry!), "MMM d")}.</>; }
  if (!key || (key === hidden && tone !== "danger")) return null;

  return (
    <div role="status" className={tone === "danger" ? "border-b border-destructive/30 bg-destructive/10 text-destructive" : "border-b border-warning/30 bg-warning/10 text-warning-foreground dark:text-warning"}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        {tone === "danger" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Zap className="h-4 w-4 shrink-0" />}
        <span className="flex-1 text-foreground">{text}</span>
        <Button size="sm" variant={tone === "danger" ? "default" : "outline"} asChild className="h-7"><Link to="/app/billing">{key.startsWith("exp") ? "View credits" : "Top up"}</Link></Button>
        {tone !== "danger" && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { sessionStorage.setItem("bs.creditBanner", key); setHidden(key); }}>Dismiss</button>}
      </div>
    </div>
  );
}

/** Shown once per session when credits hit zero and an agent was paused for it. */
export function OutOfCreditsModal() {
  const { wallet } = useAuth();
  const { workspace } = useAuth();
  const { data: paused } = useQuery({
    queryKey: ["agents-no-credits", workspace?.id, Number(wallet?.total ?? 1) <= 0],
    enabled: Boolean(workspace?.id) && Number(wallet?.total ?? 1) <= 0,
    queryFn: async () => (await supabase.from("agents").select("id", { count: "exact", head: true }).eq("workspace_id", workspace!.id).eq("pause_reason", "no_credits")).count ?? 0,
  });
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("bs.oocModal") === "1");
  const open = !dismissed && Number(wallet?.total ?? 1) <= 0 && (paused ?? 0) > 0;
  const close = () => { sessionStorage.setItem("bs.oocModal", "1"); setDismissed(true); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"><Zap className="h-6 w-6" /></div>
          <DialogTitle className="text-center">Agents paused: out of credits</DialogTitle>
          <DialogDescription className="text-center">Calls and messages aren't being answered right now. Add credits and your agents go back to work straight away.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button asChild onClick={close}><Link to="/app/billing#topups">Buy credits</Link></Button>
          <Button variant="outline" asChild onClick={close}><Link to="/app/billing">See plans</Link></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
