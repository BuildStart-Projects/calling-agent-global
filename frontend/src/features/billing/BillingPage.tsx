import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { CreditCard, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { callFunction, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { PricingCards } from "./PricingCards";
import { usePublicPricing, type Plan } from "./usePublicPricing";

type Sub = { status: string; current_period_end: string | null; cancel_at_period_end: boolean; pending_plan_id: string | null };
const KIND_LABEL: Record<string, string> = { calling: "Calling Agent", messaging: "Messaging Agent", orchestrator: "Orchestrator (setup)" };
const REASON_LABEL: Record<string, string> = { plan_grant: "Monthly credits", plan_expiry: "Unused monthly credits expired", topup: "Top-up", topup_expiry: "Top-up expired", bonus: "Bonus", usage: "Usage", admin_adjust: "Adjustment by BuildStart", refund_clawback: "Refund", debt_settled: "Balance settled" };
const money = (minor: number, cur = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency: cur.toUpperCase(), maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
const cr = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Number(n ?? 0));

export default function BillingPage() {
  const { workspace, wallet, refresh } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { data: pricing } = usePublicPricing();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Plan | null>(null);

  const { data: sub } = useQuery({
    queryKey: ["subscription", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => (await supabase.from("subscriptions").select("status,current_period_end,cancel_at_period_end,pending_plan_id").eq("workspace_id", workspace!.id).in("status", ["active", "trialing", "past_due"]).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as Sub | null,
  });
  const { data: usage } = useQuery({
    queryKey: ["usage-30d", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data } = await supabase.from("my_usage_daily").select("agent_kind,credits").eq("workspace_id", workspace!.id).gte("day", since);
      const by: Record<string, number> = {};
      for (const r of data ?? []) by[r.agent_kind] = (by[r.agent_kind] ?? 0) + Number(r.credits);
      return by;
    },
  });
  const { data: history } = useQuery({
    queryKey: ["credit-history", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => {
      const [l, p] = await Promise.all([
        supabase.from("my_credit_history").select("id,created_at,reason,delta,agent_kind").eq("workspace_id", workspace!.id).neq("reason", "usage").order("created_at", { ascending: false }).limit(30),
        supabase.from("payments").select("id,kind,amount_minor,currency,status,credits_granted,created_at").eq("workspace_id", workspace!.id).order("created_at", { ascending: false }).limit(30),
      ]);
      return { ledger: l.data ?? [], payments: p.data ?? [] };
    },
  });

  useEffect(() => {
    if (window.location.hash !== "#topups") return;
    const t = setTimeout(() => document.getElementById("topups")?.scrollIntoView({ behavior: "smooth" }), 400);
    return () => clearTimeout(t);
  }, []);

  // Returning from Stripe Checkout: the webhook grants credits a moment later — poll briefly.
  useEffect(() => {
    const c = params.get("checkout");
    if (!c) return;
    if (c === "success") {
      toast.success("Payment received — adding your credits…");
      let n = 0;
      const t = setInterval(() => { refresh(); qc.invalidateQueries({ queryKey: ["subscription"] }); qc.invalidateQueries({ queryKey: ["credit-history"] }); if (++n >= 6) clearInterval(t); }, 2500);
      setParams({}, { replace: true });
      return () => clearInterval(t);
    }
    toast("Checkout cancelled — nothing was charged.");
    setParams({}, { replace: true });
  }, [params, setParams, refresh, qc]);

  const plans = pricing?.plans ?? [];
  const current = plans.find((p) => p.id === workspace?.plan_id);
  const pending = plans.find((p) => p.id === sub?.pending_plan_id);

  const go = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const r = await callFunction<{ status: string; url?: string; effective_at?: string }>("billing", body);
      if (r.url) { window.location.href = r.url; return; }
      if (r.status === "upgraded") toast.success("Upgraded! Your new credits arrive in a moment.");
      else if (r.status === "scheduled") toast.success(`Change scheduled for ${r.effective_at ? format(new Date(r.effective_at), "PP") : "the end of this period"}.`);
      else if (r.status === "resumed") toast.success("Your plan will continue.");
      refresh(); qc.invalidateQueries({ queryKey: ["subscription"] });
      setTimeout(() => { refresh(); qc.invalidateQueries({ queryKey: ["credit-history"] }); }, 3000);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); setConfirm(null); }
  };
  const choose = (p: Plan) => (current && p.price_minor < current.price_minor ? setConfirm(p) : go({ action: "change_plan", plan_id: p.id }, p.id));
  const usedTotal = Object.values(usage ?? {}).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Billing & credits" description="Credits power your agents. Monthly credits renew each period; top-ups last a year."
        actions={workspace?.stripe_customer_id ? <Button variant="outline" onClick={() => go({ action: "portal" }, "portal")} disabled={busy === "portal"}>{busy === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}Payment methods & invoices</Button> : undefined} />
      <PageBody className="space-y-8 pb-12">
        {!wallet || !current ? <Skeleton className="h-40 rounded-2xl" /> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="surface p-5 lg:col-span-1">
              <p className="text-sm text-muted-foreground">Current plan</p>
              <p className="mt-1 text-2xl font-semibold">{current.name}</p>
              {current.price_minor > 0 && <p className="text-sm text-muted-foreground">{money(current.price_minor, current.currency)} / month</p>}
              {sub?.status === "past_due" && <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">Last payment failed. Update your card to keep your plan.</p>}
              {sub?.cancel_at_period_end || pending ? (
                <div className="mt-3 rounded-lg bg-warning/10 p-3 text-sm">
                  Changes to <b>{pending?.name ?? "Free"}</b> on {sub?.current_period_end ? format(new Date(sub.current_period_end), "PP") : "renewal"}.
                  <Button size="sm" variant="link" className="h-auto px-1" onClick={() => go({ action: "resume" }, "resume")} disabled={Boolean(busy)}>Keep {current.name}</Button>
                </div>
              ) : workspace?.plan_period_end && <p className="mt-3 text-sm text-muted-foreground">{current.price_minor > 0 ? "Renews" : "Free credits refresh"} {format(new Date(workspace.plan_period_end), "PP")}</p>}
            </div>
            <div className="surface p-5 lg:col-span-2">
              <div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">Credits available</p><p className="font-display text-4xl font-semibold tabular">{cr(wallet.total)}</p></div>
                {wallet.total < 5 && <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning"><Sparkles className="h-3.5 w-3.5" />Running low</span>}</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Monthly credits</p><p className="text-lg font-semibold tabular">{cr(wallet.plan_remaining)}</p><p className="text-xs text-muted-foreground">{wallet.plan_expires_at ? `Unused credits expire ${format(new Date(wallet.plan_expires_at), "PP")} (no rollover)` : "—"}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Top-up credits</p><p className="text-lg font-semibold tabular">{cr(wallet.topup_remaining)}</p><p className="text-xs text-muted-foreground">{wallet.next_topup_expiry ? `${cr(wallet.next_topup_expiry_amount ?? 0)} expire ${format(new Date(wallet.next_topup_expiry), "PP")}` : "Used after monthly credits run out"}</p></div>
              </div>
              {usage && usedTotal > 0 && (
                <div className="mt-4"><p className="mb-2 text-xs text-muted-foreground">Used in the last 30 days · {cr(usedTotal)} credits</p>
                  <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">{Object.entries(usage).sort((a, b) => b[1] - a[1]).map(([k, v], i) => <div key={k} title={`${KIND_LABEL[k] ?? k}: ${cr(v)}`} className={cn(["bg-brand-600", "bg-brand-400", "bg-lime-400"][i] ?? "bg-muted-foreground")} style={{ width: `${(v / usedTotal) * 100}%` }} />)}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">{Object.entries(usage).sort((a, b) => b[1] - a[1]).map(([k, v], i) => <span key={k} className="flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-full", ["bg-brand-600", "bg-brand-400", "bg-lime-400"][i] ?? "bg-muted-foreground")} />{KIND_LABEL[k] ?? k} <span className="tabular text-muted-foreground">{cr(v)}</span></span>)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-4 text-lg font-semibold">Plans</h2>
          <PricingCards currentPlanKey={current?.key} onSelectPlan={choose} showTopups={false} />
          {busy && plans.some((p) => p.id === busy) && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Opening secure checkout…</p>}
        </section>

        <section id="topups" className="scroll-mt-20">
          <h2 className="text-lg font-semibold">Top up credits</h2>
          <p className="mb-4 text-sm text-muted-foreground">One-time purchase. Valid for 12 months, used after your monthly credits.</p>
          <div className="grid gap-3 sm:grid-cols-3">{(pricing?.packs ?? []).map((p) => (
            <div key={p.id} className="surface flex flex-col p-5">
              <div className="flex items-center gap-2"><p className="font-display text-3xl font-semibold tabular">{cr(p.credits)}</p><span className="text-sm text-muted-foreground">credits</span>{p.badge && <span className="ml-auto rounded-full bg-brand-500/10 px-2 py-0.5 text-xs text-brand-700 dark:text-brand-300">{p.badge}</span>}</div>
              <p className="mt-1 text-sm text-muted-foreground">{money(p.price_minor, p.currency)} · valid {Math.round(p.validity_days / 30)} months</p>
              <Button className="mt-4" variant="outline" onClick={() => go({ action: "topup", pack_id: p.id }, p.id)} disabled={Boolean(busy)}>{busy === p.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Buy</Button>
            </div>))}</div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="surface">
            <p className="border-b px-4 py-3 text-sm font-semibold">Payments</p>
            {history?.payments.length ? history.payments.map((p) => (
              <div key={p.id} className="flex justify-between border-b px-4 py-2.5 text-sm last:border-0"><span>{p.kind === "topup" ? "Top-up" : "Plan"} <span className="text-muted-foreground">· {format(new Date(p.created_at), "PP")}</span>{p.status !== "paid" && <span className="ml-2 text-xs capitalize text-warning">{p.status.replace("_", " ")}</span>}</span><span className="tabular">{money(p.amount_minor, p.currency)} · +{cr(p.credits_granted)}</span></div>
            )) : <p className="p-6 text-center text-sm text-muted-foreground">No payments yet.</p>}
          </div>
          <div className="surface">
            <p className="border-b px-4 py-3 text-sm font-semibold">Credit activity</p>
            {history?.ledger.length ? history.ledger.map((l) => (
              <div key={l.id} className="flex justify-between border-b px-4 py-2.5 text-sm last:border-0"><span>{REASON_LABEL[l.reason] ?? l.reason} <span className="text-muted-foreground">· {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</span></span><span className={cn("tabular", Number(l.delta) > 0 && "text-success")}>{Number(l.delta) > 0 ? "+" : ""}{cr(l.delta)}</span></div>
            )) : <p className="p-6 text-center text-sm text-muted-foreground">No activity yet.</p>}
          </div>
        </section>
      </PageBody>

      <AlertDialog open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Switch to {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>You keep {current?.name} and its credits until {sub?.current_period_end ? format(new Date(sub.current_period_end), "PP") : "the end of this period"}. From then you'll get {cr(confirm?.monthly_credits ?? 0)} credits a month{confirm && confirm.price_minor > 0 ? ` for ${money(confirm.price_minor, confirm.currency)}` : ""}.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep {current?.name}</AlertDialogCancel><AlertDialogAction onClick={() => confirm && go({ action: "change_plan", plan_id: confirm.id }, confirm.id)}>Switch at renewal</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
