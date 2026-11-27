// Usage: credits by agent kind per day, totals per agent and campaign, credit history. Never tokens, minutes or rates.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow, parseISO, subDays } from "date-fns";
import { Gauge, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgents } from "@/features/agents/useAgents";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = { day: string; agent_id: string | null; agent_kind: "orchestrator" | "calling" | "messaging"; campaign_id: string | null; credits: number };
type Kind = Row["agent_kind"];
// Validated categorical palette (light/dark steps): green, blue, amber. Order fixed, never cycled.
const SERIES: Array<{ kind: Kind; label: string; cls: string }> = [
  { kind: "calling", label: "Calling Agent", cls: "bg-[#1F9A33] dark:bg-[#16a34a]" },
  { kind: "messaging", label: "Messaging Agent", cls: "bg-[#2563eb] dark:bg-[#3b82f6]" },
  { kind: "orchestrator", label: "Orchestrator (setup)", cls: "bg-[#d97706] dark:bg-[#d97706]" },
];
const RANGES = [7, 30, 90] as const;
const REASON: Record<string, string> = { plan_grant: "Monthly credits added", plan_expiry: "Unused monthly credits expired", topup: "Top-up", topup_expiry: "Top-up credits expired", bonus: "Bonus", admin_adjust: "Adjustment by BuildStart", refund_clawback: "Refund", debt_settled: "Balance settled" };
const cr = (n: number) => formatCredits(Math.round(n * 100) / 100);

export default function UsagePage() {
  const { workspace, wallet } = useAuth();
  const { data: agents } = useAgents();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const since = format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  const { data: rows, isLoading } = useQuery({
    queryKey: ["usage", workspace?.id, days],
    enabled: Boolean(workspace?.id),
    queryFn: async () => ((await supabase.from("my_usage_daily").select("day,agent_id,agent_kind,campaign_id,credits").eq("workspace_id", workspace!.id).gte("day", since)).data ?? []) as Row[],
  });
  const campaignIds = useMemo(() => [...new Set((rows ?? []).map((r) => r.campaign_id).filter(Boolean))] as string[], [rows]);
  const { data: campaigns } = useQuery({
    queryKey: ["usage-campaigns", campaignIds.join(",")],
    enabled: campaignIds.length > 0,
    queryFn: async () => ((await supabase.from("campaigns").select("id,name").in("id", campaignIds)).data ?? []) as Array<{ id: string; name: string }>,
  });
  const { data: history } = useQuery({
    queryKey: ["credit-history", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => ((await supabase.from("my_credit_history").select("id,created_at,reason,delta").eq("workspace_id", workspace!.id).neq("reason", "usage").order("created_at", { ascending: false }).limit(50)).data ?? []) as Array<{ id: string; created_at: string; reason: string; delta: number }>,
  });

  const daily = useMemo(() => {
    const map = new Map<string, Record<Kind, number>>();
    for (let i = days - 1; i >= 0; i--) map.set(format(subDays(new Date(), i), "yyyy-MM-dd"), { calling: 0, messaging: 0, orchestrator: 0 });
    for (const r of rows ?? []) { const d = map.get(r.day); if (d) d[r.agent_kind] += Number(r.credits); }
    return [...map.entries()].map(([day, v]) => ({ day, ...v, total: v.calling + v.messaging + v.orchestrator }));
  }, [rows, days]);
  const byKind = SERIES.map((s) => ({ ...s, total: (rows ?? []).filter((r) => r.agent_kind === s.kind).reduce((a, r) => a + Number(r.credits), 0) }));
  const total = byKind.reduce((a, b) => a + b.total, 0);
  const byAgent = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.agent_id) m.set(r.agent_id, (m.get(r.agent_id) ?? 0) + Number(r.credits));
    return [...m.entries()].map(([id, v]) => ({ id, name: agents?.find((a) => a.id === id)?.name ?? "Deleted agent", v })).sort((a, b) => b.v - a.v);
  }, [rows, agents]);
  const byCampaign = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.campaign_id) m.set(r.campaign_id, (m.get(r.campaign_id) ?? 0) + Number(r.credits));
    return [...m.entries()].map(([id, v]) => ({ id, name: campaigns?.find((c) => c.id === id)?.name ?? "Campaign", v })).sort((a, b) => b.v - a.v);
  }, [rows, campaigns]);

  return (
    <>
      <PageHeader title="Usage" description="Credits used by each of your agents." actions={<Button asChild size="sm"><Link to="/app/billing"><Zap className="mr-1.5 h-4 w-4" />Buy credits</Link></Button>} />
      <PageBody className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Balance" value={cr(Number(wallet?.total ?? 0))} hint={wallet?.plan_expires_at ? `Monthly credits refresh ${format(new Date(wallet.plan_expires_at), "MMM d")}` : undefined} />
          <Stat label={`Used in the last ${days} days`} value={cr(total)} />
          <Stat label="Top-up credits" value={cr(Number(wallet?.topup_remaining ?? 0))} hint={wallet?.next_topup_expiry ? `Earliest expiry ${format(new Date(wallet.next_topup_expiry), "MMM d, yyyy")}` : "Valid for 12 months from purchase"} />
        </div>

        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Credits used per day</h2>
            <div className="flex gap-1">{RANGES.map((r) => <button key={r} onClick={() => setDays(r)} className={cn("rounded-full px-3 py-1 text-xs", days === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{r} days</button>)}</div>
          </div>
          {isLoading ? <Skeleton className="mt-4 h-48" /> : total === 0 ? (
            <EmptyState icon={Gauge} title="No usage yet" description="Credits appear here as your agents answer calls and messages." />
          ) : <StackedDaily rows={daily} />}
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">By agent</h2>
            <div className="mt-3 space-y-3">
              {byKind.map((k) => <Bar key={k.kind} label={k.label} value={k.total} max={total} swatch={k.cls} />)}
              {byAgent.length > 1 && <div className="border-t pt-3">{byAgent.map((a) => <Line key={a.id} label={a.name} value={a.v} />)}</div>}
            </div>
          </section>
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">By campaign</h2>
            {byCampaign.length ? <div className="mt-3">{byCampaign.map((c) => <Line key={c.id} label={<Link to={`/app/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>} value={c.v} />)}</div>
              : <p className="mt-3 text-sm text-muted-foreground">No campaign calls in this period. <Link to="/app/campaigns" className="text-brand-700 hover:underline dark:text-brand-300">Start a campaign</Link></p>}
          </section>
        </div>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Credit history</h2>
          <p className="text-xs text-muted-foreground">Credits added and expired. Daily usage is shown above.</p>
          <div className="mt-3">{history?.length ? history.map((h) => (
            <div key={h.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <span>{REASON[h.reason] ?? h.reason.replace(/_/g, " ")} <span className="text-xs text-muted-foreground">· {formatDistanceToNow(new Date(h.created_at), { addSuffix: true })}</span></span>
              <span className={cn("tabular font-medium", Number(h.delta) > 0 ? "text-success" : "text-muted-foreground")}>{Number(h.delta) > 0 ? "+" : ""}{cr(Number(h.delta))}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">Nothing yet.</p>}</div>
        </section>
      </PageBody>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular">{value}</p>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>;
}
function Bar({ label, value, max, swatch }: { label: string; value: number; max: number; swatch: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-sm", swatch)} />{label}</span><span className="tabular text-muted-foreground">{cr(value)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", swatch)} style={{ width: `${max ? (value / max) * 100 : 0}%` }} /></div>
    </div>
  );
}
function Line({ label, value }: { label: React.ReactNode; value: number }) {
  return <div className="flex justify-between border-b py-1.5 text-sm last:border-0"><span className="truncate pr-3">{label}</span><span className="tabular text-muted-foreground">{cr(value)}</span></div>;
}

function StackedDaily({ rows }: { rows: Array<{ day: string; total: number } & Record<Kind, number>> }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(0.01, ...rows.map((r) => r.total));
  const h = rows[hover ?? -1];
  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {SERIES.map((s) => <span key={s.kind} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", s.cls)} />{s.label}</span>)}
        <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-y-auto text-sm">
          <table className="w-full"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 font-medium">Day</th>{SERIES.map((s) => <th key={s.kind} className="py-1 text-right font-medium">{s.label}</th>)}<th className="py-1 text-right font-medium">Total</th></tr></thead>
            <tbody>{[...rows].reverse().map((r) => <tr key={r.day} className="border-t"><td className="py-1 text-muted-foreground">{format(parseISO(r.day), "MMM d")}</td>{SERIES.map((s) => <td key={s.kind} className="py-1 text-right tabular">{cr(r[s.kind])}</td>)}<td className="py-1 text-right font-medium tabular">{cr(r.total)}</td></tr>)}</tbody></table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex h-48 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => (
              <div key={r.day} className="flex h-full flex-1 cursor-default flex-col justify-end" onMouseEnter={() => setHover(i)} aria-label={`${r.day}: ${cr(r.total)} credits`}>
                <div className={cn("flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] transition-opacity", hover !== null && hover !== i && "opacity-50")} style={{ height: `${(r.total / max) * 100}%`, minHeight: r.total > 0 ? 2 : 0 }}>
                  {SERIES.map((s) => r[s.kind] > 0 && <div key={s.kind} className={s.cls} style={{ flexGrow: r[s.kind], flexBasis: 0, minHeight: 1 }} />)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{format(parseISO(rows[0]!.day), "MMM d")}</span><span>Today</span></div>
          {h && (
            <div className="pointer-events-none absolute -top-3 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md" style={{ left: `clamp(0px, calc(${((hover! + 0.5) / rows.length) * 100}% - 80px), calc(100% - 170px))` }}>
              <p className="font-medium">{format(parseISO(h.day), "EEE, MMM d")}</p>
              {SERIES.map((s) => <p key={s.kind} className="mt-0.5 flex justify-between gap-3"><span className="flex items-center gap-1.5 text-muted-foreground"><span className={cn("h-2 w-2 rounded-sm", s.cls)} />{s.label}</span><span className="tabular">{cr(h[s.kind])}</span></p>)}
              <p className="mt-1 flex justify-between border-t pt-1 font-medium"><span>Total</span><span className="tabular">{cr(h.total)}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
