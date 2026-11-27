// Superadmin: overview, workspaces (users), agents (bots), audit.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { adminApi, adminRpc, Card, DailyBars, num, Tile, usd } from "./shared";

type Overview = Record<string, number> & { plans: Array<{ key: string; name: string; workspaces: number }> };
type Daily = { day: string; signups: number; credits_used: number; cost_usd: number; revenue_minor: number; calls: number; ai_messages: number };

export function OverviewPage() {
  const { data: o } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => adminRpc<Overview>("admin_overview") });
  const { data: daily } = useQuery({ queryKey: ["admin", "daily"], queryFn: () => adminRpc<Daily[]>("admin_daily", { p_days: 30 }) });
  const { data: meters } = useQuery({ queryKey: ["admin", "meters"], queryFn: () => adminRpc<Array<{ meter: string; agent_kind: string; events: number; credits: number; input_tokens: number; output_tokens: number; minutes: number; cost_usd: number }>>("admin_usage_by_meter", { p_days: 30 }) });
  if (!o) return <Skeleton className="h-96 rounded-xl" />;
  const margin = o.revenue_30d_minor / 100 - o.cost_30d_usd;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="MRR" value={usd(o.mrr_minor)} hint={`${o.paying} paying workspaces`} />
        <Tile label="Revenue · 30 days" value={usd(o.revenue_30d_minor)} hint={`${usd(o.topups_30d_minor)} from top-ups`} />
        <Tile label="Est. provider cost · 30 days" value={`$${num(o.cost_30d_usd, 2)}`} hint="AI + voice, from Costs" />
        <Tile label="Est. gross margin · 30 days" value={<span className={margin < 0 ? "text-destructive" : ""}>${num(margin, 2)}</span>} hint={o.revenue_30d_minor ? `${Math.round((margin / (o.revenue_30d_minor / 100)) * 100)}%` : "No revenue yet"} />
        <Tile label="Users" value={num(o.users)} hint={`+${o.signups_30d} in 30 days`} />
        <Tile label="Agents" value={num(o.agents)} hint={`${o.live_agents} live · ${o.connected_agents} WhatsApp connected`} />
        <Tile label="Calls · 30 days" value={num(o.calls_30d)} hint={`${num(o.call_minutes_30d)} minutes`} />
        <Tile label="AI messages · 30 days" value={num(o.messages_30d)} hint={`${o.campaigns_running} campaigns running`} />
      </div>
      {daily && (
        <div className="grid gap-4 lg:grid-cols-2">
          <DailyBars title="Credits used per day" rows={daily} value="credits_used" format={(n) => num(n, 1)} />
          <DailyBars title="Revenue per day" rows={daily.map((d) => ({ ...d, revenue: d.revenue_minor / 100 }))} value="revenue" format={(n) => `$${num(n, 2)}`} />
          <DailyBars title="Sign-ups per day" rows={daily} value="signups" format={(n) => num(n)} />
          <DailyBars title="Est. provider cost per day" rows={daily} value="cost_usd" format={(n) => `$${num(n, 2)}`} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Workspaces by plan">{o.plans.map((p) => <div key={p.key} className="flex justify-between border-b py-1.5 text-sm last:border-0"><span>{p.name}</span><span className="tabular">{p.workspaces}</span></div>)}</Card>
        <Card title="Usage by meter · 30 days" className="lg:col-span-2">
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Meter</th><th>Agent</th><th className="text-right">Events</th><th className="text-right">Tokens in/out</th><th className="text-right">Minutes</th><th className="text-right">Credits</th><th className="text-right">Cost</th></tr></thead>
            <tbody>{(meters ?? []).map((m) => <tr key={m.meter + m.agent_kind} className="border-t"><td className="py-1.5">{m.meter}</td><td className="capitalize text-muted-foreground">{m.agent_kind}</td><td className="text-right tabular">{num(m.events)}</td><td className="text-right tabular">{m.input_tokens ? `${num(m.input_tokens / 1000)}k / ${num(m.output_tokens / 1000)}k` : "—"}</td><td className="text-right tabular">{m.minutes ? num(m.minutes, 1) : "—"}</td><td className="text-right tabular">{num(m.credits, 2)}</td><td className="text-right tabular">${num(m.cost_usd, 3)}</td></tr>)}</tbody></table></div>
        </Card>
      </div>
    </div>
  );
}

type WsRow = { id: string; name: string; owner_email: string; plan_key: string; status: string; country: string | null; balance: number; agents: number; credits_30d: number; paid_total_minor: number; created_at: string; last_active: string | null; total_count: number };

export function WorkspacesPage() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["admin", "workspaces", term, page], queryFn: () => adminRpc<WsRow[]>("admin_workspaces", { p_q: term || null, p_limit: 50, p_offset: page * 50 }) });
  const total = data?.[0]?.total_count ?? 0;
  return (
    <div className="space-y-4">
      <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setTerm(q.trim()); }}><Input placeholder="Search name, email or id" value={q} onChange={(e) => setQ(e.target.value)} /><Button variant="outline"><Search className="h-4 w-4" /></Button></form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Workspace</th><th>Plan</th><th className="text-right">Balance</th><th className="text-right">Used 30d</th><th className="text-right">Paid</th><th className="text-right">Agents</th><th className="px-4 text-right">Last active</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={7} className="p-4"><Skeleton className="h-24" /></td></tr> : (data ?? []).map((w) => (
              <tr key={w.id} onClick={() => setOpen(w.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted/40">
                <td className="px-4 py-2.5"><p className="font-medium">{w.name} {w.status !== "active" && <span className="ml-1 rounded bg-destructive/15 px-1.5 text-[10px] text-destructive">{w.status === "pending_deletion" ? "deleting" : w.status}</span>}</p><p className="text-xs text-muted-foreground">{w.owner_email}{w.country ? ` · ${w.country}` : ""}</p></td>
                <td className="capitalize">{w.plan_key}</td>
                <td className={cn("text-right tabular", w.balance < 0 && "text-destructive")}>{num(w.balance, 1)}</td>
                <td className="text-right tabular">{num(w.credits_30d, 1)}</td>
                <td className="text-right tabular">{usd(w.paid_total_minor)}</td>
                <td className="text-right tabular">{w.agents}</td>
                <td className="px-4 text-right text-xs text-muted-foreground">{w.last_active ? formatDistanceToNow(new Date(w.last_active), { addSuffix: true }) : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{total} workspaces</span>
        <div className="flex gap-2"><Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      <Sheet open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-xl">{open && <WorkspaceDetail id={open} />}</SheetContent></Sheet>
    </div>
  );
}

type Detail = {
  workspace: { id: string; name: string; status: string; country: string | null; timezone: string; currency: string; plan_period_end: string | null; created_at: string; has_stripe: boolean; deletion_scheduled_for?: string | null; deletion_reason?: string | null };
  plan: { id: string; name: string; key: string } | null;
  members: Array<{ user_id: string; role: string; email: string; name: string | null; last_sign_in_at: string | null }>;
  agents: Array<{ id: string; name: string; type: string; status: string; wa_status: string; wa_phone: string | null }>;
  lots: Array<{ id: string; kind: string; granted: number; remaining: number; expires_at: string | null; created_at: string }>;
  ledger: Array<{ id: string; delta: number; reason: string; agent_kind: string | null; balance_after: number; note: string | null; created_at: string }>;
  usage_by_kind_30d: Record<string, number>;
  payments: Array<{ id: string; kind: string; amount_minor: number; currency: string; status: string; credits_granted: number; created_at: string }>;
};

function WorkspaceDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { data: d } = useQuery({ queryKey: ["admin", "ws", id], queryFn: () => adminRpc<Detail>("admin_workspace_detail", { ws: id }) });
  const { data: cfg } = useQuery({ queryKey: ["admin", "config"], queryFn: () => adminRpc<{ plans: Array<{ id: string; name: string }> }>("admin_config") });
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState("365");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "ws", id] }); qc.invalidateQueries({ queryKey: ["admin", "workspaces"] }); };
  const run = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try { await adminApi(body); toast.success(ok); refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  if (!d) return <Skeleton className="h-96" />;
  const balance = d.lots.filter((l) => !l.expires_at || new Date(l.expires_at) > new Date()).reduce((a, l) => a + Number(l.remaining), 0);
  return (
    <>
      <SheetHeader><SheetTitle>{d.workspace.name}</SheetTitle><p className="text-xs text-muted-foreground">{d.workspace.id} · {d.workspace.country ?? "—"} · {d.workspace.timezone} · {d.workspace.currency}</p></SheetHeader>
      <div className="mt-5 space-y-5 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Balance" value={num(balance, 1)} />
          <Tile label="Plan" value={<span className="text-lg">{d.plan?.name ?? "—"}</span>} hint={d.workspace.plan_period_end ? `renews ${new Date(d.workspace.plan_period_end).toLocaleDateString()}` : undefined} />
          <Tile label="Used 30d" value={num(Object.values(d.usage_by_kind_30d).reduce((a, b) => a + Number(b), 0), 1)} hint={Object.entries(d.usage_by_kind_30d).map(([k, v]) => `${k} ${num(v, 1)}`).join(" · ")} />
        </div>

        <Card title="Adjust credits">
          <div className="grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[110px_1fr_120px]">
            <Input type="number" placeholder="+50 / -10" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
            <Input placeholder="Reason (required, shown in audit)" value={note} onChange={(e) => setNote(e.target.value)} className="col-span-2 sm:col-span-1" aria-label="Reason" />
            <Select value={expiry} onValueChange={setExpiry}><SelectTrigger aria-label="Expiry"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">Expires 30d</SelectItem><SelectItem value="365">Expires 1y</SelectItem><SelectItem value="none">Never</SelectItem></SelectContent></Select>
          </div>
          <Button size="sm" className="mt-2" disabled={!Number(amount) || note.trim().length < 3 || Boolean(busy)} onClick={() => run("credits", { action: "adjust_credits", workspace_id: id, amount: Number(amount), note: note.trim(), expires_days: expiry === "none" ? null : Number(expiry) }, "Credits adjusted").then(() => { setAmount(""); setNote(""); })}>{busy === "credits" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply</Button>
        </Card>

        <Card title="Plan & status">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1"><Label className="text-xs">Change plan (starts a new period now)</Label>
              <Select onValueChange={(v) => run("plan", { action: "set_plan", workspace_id: id, plan_id: v }, "Plan changed")}><SelectTrigger className="w-44"><SelectValue placeholder={d.plan?.name ?? "Choose"} /></SelectTrigger><SelectContent>{cfg?.plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
            {d.workspace.status === "active"
              ? <Button variant="outline" className="text-destructive" disabled={Boolean(busy)} onClick={() => confirm("Suspend this workspace? Its agents and campaigns pause immediately.") && run("status", { action: "set_workspace_status", workspace_id: id, status: "suspended" }, "Suspended")}>Suspend</Button>
              : <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("status", { action: "set_workspace_status", workspace_id: id, status: "active" }, d.workspace.status === "pending_deletion" ? "Restored" : "Reactivated")}>{d.workspace.status === "pending_deletion" ? "Restore (cancel deletion)" : "Reactivate"}</Button>}
            {d.workspace.status === "pending_deletion" && <p className="w-full text-xs text-destructive">Owner requested deletion. Data is erased on {d.workspace.deletion_scheduled_for ? new Date(d.workspace.deletion_scheduled_for).toLocaleDateString() : "—"}{d.workspace.deletion_reason ? ` · “${d.workspace.deletion_reason}”` : ""}. Restoring keeps the data; the owner must re-link WhatsApp.</p>}
          </div>
        </Card>

        <Card title="Members">{d.members.map((m) => <div key={m.user_id} className="flex justify-between border-b py-1.5 last:border-0"><span>{m.name ?? m.email} <span className="text-muted-foreground">· {m.email}</span></span><span className="text-xs capitalize text-muted-foreground">{m.role}</span></div>)}</Card>
        <Card title="Agents">{d.agents.length ? d.agents.map((a) => <div key={a.id} className="flex items-center justify-between border-b py-1.5 last:border-0"><span>{a.name} <span className="text-xs capitalize text-muted-foreground">· {a.type}</span></span><span className="text-xs text-muted-foreground">{a.status} · WA {a.wa_status}{a.wa_phone ? ` ${a.wa_phone}` : ""}</span></div>) : <p className="text-muted-foreground">None</p>}</Card>
        <Card title="Credit lots">{d.lots.map((l) => <div key={l.id} className="flex justify-between border-b py-1.5 text-xs last:border-0"><span className="capitalize">{l.kind} · granted {num(l.granted, 2)}</span><span className="tabular">{num(l.remaining, 2)} left · {l.expires_at ? `exp ${new Date(l.expires_at).toLocaleDateString()}` : "no expiry"}</span></div>)}</Card>
        <Card title="Recent ledger">{d.ledger.map((l) => <div key={l.id} className="flex justify-between border-b py-1.5 text-xs last:border-0"><span>{l.reason.replace(/_/g, " ")}{l.agent_kind ? ` · ${l.agent_kind}` : ""}{l.note ? ` · ${l.note}` : ""}</span><span className="tabular"><span className={Number(l.delta) < 0 ? "" : "text-success"}>{Number(l.delta) > 0 ? "+" : ""}{num(l.delta, 3)}</span> → {num(l.balance_after, 2)} · {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</span></div>)}</Card>
        <Card title="Payments">{d.payments.length ? d.payments.map((p) => <div key={p.id} className="flex justify-between border-b py-1.5 text-xs last:border-0"><span className="capitalize">{p.kind} · {p.status}</span><span className="tabular">{usd(p.amount_minor, p.currency)} · +{num(p.credits_granted)} cr · {new Date(p.created_at).toLocaleDateString()}</span></div>) : <p className="text-muted-foreground">No payments yet</p>}</Card>
      </div>
    </>
  );
}

type AgentRow = { id: string; name: string; type: string; status: string; wa_status: string; wa_phone: string | null; workspace_id: string; workspace_name: string; calls_30d: number; ai_messages_30d: number; credits_30d: number; created_at: string };

export function AgentsAdminPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "agents", term], queryFn: () => adminRpc<AgentRow[]>("admin_agents", { p_q: term || null, p_limit: 200 }) });
  const toggle = async (a: AgentRow) => {
    try { await adminApi({ action: "set_agent_status", agent_id: a.id, status: a.status === "live" ? "paused" : "live" }); toast.success(a.status === "live" ? "Paused" : "Live"); qc.invalidateQueries({ queryKey: ["admin", "agents"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <form className="flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}><Input placeholder="Search agent, workspace or number" value={q} onChange={(e) => setQ(e.target.value)} /><Button variant="outline"><Search className="h-4 w-4" /></Button></form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr className="border-b"><th className="px-4 py-2">Agent</th><th>Status</th><th>WhatsApp</th><th className="text-right">Calls 30d</th><th className="text-right">AI msgs 30d</th><th className="text-right">Credits 30d</th><th className="px-4" /></tr></thead>
          <tbody>{isLoading ? <tr><td colSpan={7} className="p-4"><Skeleton className="h-24" /></td></tr> : (data ?? []).map((a) => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="px-4 py-2.5"><p className="font-medium">{a.name} <span className="text-xs capitalize text-muted-foreground">· {a.type}</span></p><p className="text-xs text-muted-foreground">{a.workspace_name}</p></td>
              <td className="capitalize">{a.status}</td>
              <td className="text-xs">{a.wa_status}{a.wa_phone ? ` · ${a.wa_phone}` : ""}</td>
              <td className="text-right tabular">{a.calls_30d}</td><td className="text-right tabular">{a.ai_messages_30d}</td><td className="text-right tabular">{num(a.credits_30d, 1)}</td>
              <td className="px-4 text-right">{["live", "paused"].includes(a.status) && <Button variant="ghost" size="sm" onClick={() => toggle(a)}>{a.status === "live" ? "Pause" : "Resume"}</Button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

export function AuditPage() {
  const { data } = useQuery({ queryKey: ["admin", "audit"], queryFn: () => adminRpc<Array<{ id: string; admin_email: string; action: string; target_type: string; target_id: string; before: unknown; after: unknown; created_at: string }>>("admin_audit", { p_limit: 300 }) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {(data ?? []).map((a) => (
        <div key={a.id} className="border-b last:border-0">
          <button onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-muted/40">
            <span className="font-medium">{a.action}</span><span className="text-xs text-muted-foreground">{a.target_type} {a.target_id}</span><span className="ml-auto text-xs text-muted-foreground">{a.admin_email} · {new Date(a.created_at).toLocaleString()}</span>
          </button>
          {open === a.id && <div className="grid gap-2 bg-muted/30 px-4 py-3 text-xs sm:grid-cols-2"><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(a.before, null, 2)}</pre><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(a.after, null, 2)}</pre></div>}
        </div>
      ))}
      {data && !data.length && <p className="p-8 text-center text-sm text-muted-foreground">No admin actions yet.</p>}
    </div>
  );
}
