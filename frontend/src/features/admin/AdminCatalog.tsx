// Superadmin: plans & top-up packs, credit rules (versioned), provider costs, pricing simulator.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminApi, adminRpc, Card, num, usd } from "./shared";

type Feature = { label: string; included: boolean; highlight?: boolean };
export type Plan = { id?: string; key: string; name: string; tagline: string | null; price_minor: number; currency: string; monthly_credits: number; limits: Record<string, number>; features: Feature[]; badge: string | null; cta_label: string | null; active: boolean; sort: number; stripe_price_id?: string | null };
type Pack = { id?: string; name: string; credits: number; price_minor: number; currency: string; validity_days: number; badge: string | null; active: boolean; sort: number; stripe_price_id?: string | null };
type Rule = { id: string; meter: string; unit: string; credits: number; rounding: string; effective_from: string };
type Cost = { meter: string; unit: string; cost_per_unit_usd: number };
export type Config = { plans: Plan[]; packs: Pack[]; rules: Rule[]; costs: Cost[]; settings: Record<string, Record<string, unknown>>; templates: Array<{ key: string; version: number; active: boolean; body: string; created_at: string }> };

export const useConfig = () => useQuery({ queryKey: ["admin", "config"], queryFn: () => adminRpc<Config>("admin_config") });

const LIMIT_KEYS: Array<[string, string]> = [["max_agents", "Agents"], ["max_active_campaigns", "Active campaigns"], ["max_campaign_targets_per_month", "Campaign contacts / month"], ["max_concurrent_campaign_calls", "Concurrent campaign calls"], ["max_call_seconds", "Max call length (s)"], ["voice_preview_daily", "Voice previews / day"], ["recording_retention_days", "Recording retention (days)"]];

export function PlansPage() {
  const { data: cfg } = useConfig();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pack, setPack] = useState<Pack | null>(null);
  if (!cfg) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Changes show on the pricing page immediately. Monthly credits don't roll over; top-ups last for their validity period. Price changes create a new Stripe price at the next checkout.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        {cfg.plans.map((p) => (
          <button key={p.id} onClick={() => setPlan(p)} className="rounded-xl border bg-card p-5 text-left hover:border-brand-500/60">
            <div className="flex items-center gap-2"><p className="text-lg font-semibold">{p.name}</p>{p.badge && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs text-brand-300">{p.badge}</span>}{!p.active && <span className="rounded bg-muted px-1.5 text-xs">hidden</span>}</div>
            <p className="mt-1 font-display text-3xl font-semibold tabular">{usd(p.price_minor, p.currency)}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            <p className="text-sm text-brand-300">{num(p.monthly_credits)} credits / month</p>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{p.features.map((f, i) => <li key={i} className={f.included ? "" : "line-through opacity-60"}>• {f.label}</li>)}</ul>
          </button>
        ))}
        <button onClick={() => setPlan({ key: "", name: "", tagline: null, price_minor: 0, currency: "USD", monthly_credits: 0, limits: {}, features: [], badge: null, cta_label: null, active: false, sort: cfg.plans.length + 1 })} className="flex min-h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground hover:text-foreground"><Plus className="mr-1 h-4 w-4" />New plan</button>
      </div>
      <Card title="Top-up packs" actions={<Button size="sm" variant="outline" onClick={() => setPack({ name: "", credits: 50, price_minor: 1000, currency: "USD", validity_days: 365, badge: null, active: false, sort: cfg.packs.length + 1 })}><Plus className="mr-1 h-4 w-4" />Pack</Button>}>
        <div className="grid gap-3 sm:grid-cols-3">{cfg.packs.map((p) => (
          <button key={p.id} onClick={() => setPack(p)} className="rounded-lg border p-3 text-left hover:border-brand-500/60">
            <p className="font-medium">{p.name} {!p.active && <span className="ml-1 rounded bg-muted px-1.5 text-xs">hidden</span>}</p>
            <p className="text-sm tabular">{num(p.credits)} credits · {usd(p.price_minor, p.currency)}</p>
            <p className="text-xs text-muted-foreground">{usd(Math.round(p.price_minor / p.credits), p.currency)}/credit · valid {p.validity_days} days</p>
          </button>))}</div>
      </Card>
      {plan && <PlanDialog plan={plan} onClose={() => setPlan(null)} />}
      {pack && <PackDialog pack={pack} onClose={() => setPack(null)} />}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const qc = useQueryClient();
  const [p, setP] = useState<Plan>(structuredClone(plan));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const { stripe_price_id: _s, ...rest } = p as Plan & { created_at?: string; updated_at?: string; stripe_product_id?: string; archived_price_ids?: string[] };
      const body = Object.fromEntries(Object.entries(rest).filter(([k]) => !["created_at", "updated_at", "stripe_product_id", "archived_price_ids", "interval"].includes(k)));
      await adminApi({ action: "upsert_plan", plan: { ...body, features: p.features.filter((f) => f.label.trim()) } });
      toast.success("Plan saved"); qc.invalidateQueries({ queryKey: ["admin", "config"] }); qc.invalidateQueries({ queryKey: ["public-pricing"] }); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{plan.id ? `Edit ${plan.name}` : "New plan"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Key (permanent)"><Input value={p.key} disabled={Boolean(plan.id)} onChange={(e) => setP({ ...p, key: e.target.value.toLowerCase() })} /></F>
          <F label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></F>
          <F label="Price / month (USD)"><Input type="number" min={0} step="0.01" value={p.price_minor / 100} onChange={(e) => setP({ ...p, price_minor: Math.round(Number(e.target.value) * 100) })} /></F>
          <F label="Credits / month"><Input type="number" min={0} value={p.monthly_credits} onChange={(e) => setP({ ...p, monthly_credits: Number(e.target.value) })} /></F>
          <F label="Tagline"><Input value={p.tagline ?? ""} onChange={(e) => setP({ ...p, tagline: e.target.value || null })} /></F>
          <F label="Badge"><Input value={p.badge ?? ""} placeholder="e.g. Most popular" onChange={(e) => setP({ ...p, badge: e.target.value || null })} /></F>
          <F label="Button label"><Input value={p.cta_label ?? ""} onChange={(e) => setP({ ...p, cta_label: e.target.value || null })} /></F>
          <F label="Sort order"><Input type="number" value={p.sort} onChange={(e) => setP({ ...p, sort: Number(e.target.value) })} /></F>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={p.active} onCheckedChange={(v) => setP({ ...p, active: v })} />Shown on pricing page and purchasable</label>
        <div><p className="mb-2 text-sm font-medium">Limits</p><div className="grid gap-2 sm:grid-cols-2">{LIMIT_KEYS.map(([k, l]) => <F key={k} label={l}><Input type="number" min={0} value={p.limits[k] ?? ""} onChange={(e) => setP({ ...p, limits: { ...p.limits, [k]: Number(e.target.value) } })} /></F>)}</div></div>
        <div>
          <p className="mb-2 text-sm font-medium">Features shown on the pricing card (support level, onboarding…)</p>
          <div className="space-y-2">{p.features.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={f.label} onChange={(e) => { const fs = [...p.features]; fs[i] = { ...f, label: e.target.value }; setP({ ...p, features: fs }); }} />
              <label className="flex items-center gap-1 text-xs"><Switch checked={f.included} onCheckedChange={(v) => { const fs = [...p.features]; fs[i] = { ...f, included: v }; setP({ ...p, features: fs }); }} />Included</label>
              <label className="flex items-center gap-1 text-xs"><Switch checked={Boolean(f.highlight)} onCheckedChange={(v) => { const fs = [...p.features]; fs[i] = { ...f, highlight: v }; setP({ ...p, features: fs }); }} />Highlight</label>
              <Button variant="ghost" size="icon" aria-label="Remove feature" onClick={() => setP({ ...p, features: p.features.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>))}
            <Button variant="outline" size="sm" onClick={() => setP({ ...p, features: [...p.features, { label: "", included: true }] })}><Plus className="mr-1 h-4 w-4" />Feature</Button>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !p.key || !p.name}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save plan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PackDialog({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const qc = useQueryClient();
  const [p, setP] = useState<Pack>({ ...pack });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(p).filter(([k]) => !["created_at", "updated_at", "stripe_product_id", "stripe_price_id"].includes(k)));
      await adminApi({ action: "upsert_pack", pack: body }); toast.success("Pack saved"); qc.invalidateQueries({ queryKey: ["admin", "config"] }); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{pack.id ? `Edit ${pack.name}` : "New top-up pack"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Name"><Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></F>
          <F label="Credits"><Input type="number" min={1} value={p.credits} onChange={(e) => setP({ ...p, credits: Number(e.target.value) })} /></F>
          <F label="Price (USD)"><Input type="number" min={0.5} step="0.01" value={p.price_minor / 100} onChange={(e) => setP({ ...p, price_minor: Math.round(Number(e.target.value) * 100) })} /></F>
          <F label="Valid for (days)"><Input type="number" min={1} value={p.validity_days} onChange={(e) => setP({ ...p, validity_days: Number(e.target.value) })} /></F>
          <F label="Badge"><Input value={p.badge ?? ""} onChange={(e) => setP({ ...p, badge: e.target.value || null })} /></F>
          <F label="Sort"><Input type="number" value={p.sort} onChange={(e) => setP({ ...p, sort: Number(e.target.value) })} /></F>
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={p.active} onCheckedChange={(v) => setP({ ...p, active: v })} />Available to buy</label>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !p.name}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save pack</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const UNIT_LABEL: Record<string, string> = { per_1m_input_tokens: "per 1M input tokens", per_1m_output_tokens: "per 1M output tokens", per_minute: "per minute", per_unit: "per unit" };

export function CreditsPage() {
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [costEdit, setCostEdit] = useState<Record<string, string>>({});
  const current = useMemo(() => {
    const m = new Map<string, Rule & { history: Rule[] }>();
    for (const r of cfg?.rules ?? []) {
      const k = `${r.meter}|${r.unit}`;
      if (new Date(r.effective_from) > new Date()) continue;
      if (!m.has(k)) m.set(k, { ...r, history: [] }); else m.get(k)!.history.push(r);
    }
    return [...m.values()];
  }, [cfg]);
  if (!cfg) return <Skeleton className="h-96 rounded-xl" />;
  const saveRule = async (r: Rule) => {
    const v = Number(edit[r.id]);
    if (!(v >= 0)) return;
    try { await adminApi({ action: "add_rule", meter: r.meter, unit: r.unit, credits: v, rounding: r.rounding }); toast.success(`${r.meter} rate updated — applies to new usage now`); setEdit((e) => ({ ...e, [r.id]: "" })); qc.invalidateQueries({ queryKey: ["admin", "config"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  const saveCost = async (c: Cost) => {
    const v = Number(costEdit[c.meter]);
    if (!(v >= 0)) return;
    try { await adminApi({ action: "set_cost", meter: c.meter, unit: c.unit, cost_per_unit_usd: v }); toast.success("Cost updated"); setCostEdit((e) => ({ ...e, [c.meter]: "" })); qc.invalidateQueries({ queryKey: ["admin", "config"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="space-y-6">
      <Card title="Credit rates (hidden from customers)">
        <p className="mb-3 text-xs text-muted-foreground">Each change is a new version effective immediately; past usage keeps the rate it was charged at.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Meter</th><th>Unit</th><th className="text-right">Credits</th><th>Rounding</th><th className="w-48" /></tr></thead>
          <tbody>{current.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2">{r.meter}{r.history.length > 0 && <span className="ml-1 text-xs text-muted-foreground">({r.history.length} older)</span>}</td>
              <td className="text-xs text-muted-foreground">{UNIT_LABEL[r.unit]}</td>
              <td className="text-right tabular">{num(r.credits, 4)}</td>
              <td className="text-xs text-muted-foreground">{r.rounding}</td>
              <td><div className="flex justify-end gap-1"><Input className="h-8 w-24" type="number" min={0} step="any" placeholder="new" value={edit[r.id] ?? ""} onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} aria-label={`New rate for ${r.meter}`} /><Button size="sm" variant="outline" disabled={edit[r.id] === undefined || edit[r.id] === ""} onClick={() => saveRule(r)}>Set</Button></div></td>
            </tr>))}</tbody></table></div>
      </Card>
      <Simulator cfg={cfg} rules={current} />
      <Card title="Provider costs (USD, estimates for margin reporting)">
        <div className="grid gap-2 sm:grid-cols-2">{cfg.costs.map((c) => (
          <div key={c.meter} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{c.meter} <span className="text-xs text-muted-foreground">{UNIT_LABEL[c.unit]}</span></span><span className="tabular text-muted-foreground">${num(c.cost_per_unit_usd, 4)}</span>
            <Input className="h-8 w-24" type="number" step="any" min={0} placeholder="new" value={costEdit[c.meter] ?? ""} onChange={(e) => setCostEdit({ ...costEdit, [c.meter]: e.target.value })} aria-label={`New cost for ${c.meter}`} /><Button size="sm" variant="outline" disabled={!costEdit[c.meter]} onClick={() => saveCost(c)}>Set</Button></div>))}</div>
      </Card>
    </div>
  );
}

function Simulator({ cfg, rules }: { cfg: Config; rules: Array<Rule> }) {
  const [callMin, setCallMin] = useState(60);
  const [replies, setReplies] = useState(300);
  const [tokIn, setTokIn] = useState(3000);
  const [tokOut, setTokOut] = useState(120);
  const rate = (meter: string, unit: string) => Number(rules.find((r) => r.meter === meter && r.unit === unit)?.credits ?? 0);
  const cost = (meter: string) => Number(cfg.costs.find((c) => c.meter === meter)?.cost_per_unit_usd ?? 0);
  const callCredits = callMin * rate("call_minutes", "per_minute"); // post-call analysis adds a little more
  const chatCredits = replies * ((tokIn / 1e6) * rate("messaging_tokens", "per_1m_input_tokens") + (tokOut / 1e6) * rate("messaging_tokens", "per_1m_output_tokens"));
  const credits = callCredits + chatCredits;
  const usdCost = callMin * cost("call_minutes") + replies * ((tokIn / 1e6) * cost("messaging_tokens:in") + (tokOut / 1e6) * cost("messaging_tokens:out"));
  return (
    <Card title="Simulator — what a month of usage costs">
      <div className="grid gap-3 sm:grid-cols-4">
        <F label="Call minutes"><Input type="number" min={0} value={callMin} onChange={(e) => setCallMin(Number(e.target.value))} /></F>
        <F label="WhatsApp AI replies"><Input type="number" min={0} value={replies} onChange={(e) => setReplies(Number(e.target.value))} /></F>
        <F label="Avg input tokens / reply"><Input type="number" min={0} value={tokIn} onChange={(e) => setTokIn(Number(e.target.value))} /></F>
        <F label="Avg output tokens / reply"><Input type="number" min={0} value={tokOut} onChange={(e) => setTokOut(Number(e.target.value))} /></F>
      </div>
      <p className="mt-4 text-sm">≈ <b className="tabular">{num(credits, 1)} credits</b> ({num(callCredits, 1)} calls + {num(chatCredits, 1)} chat) · provider cost ≈ <b className="tabular">${num(usdCost, 2)}</b></p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Plan</th><th className="text-right">Credits</th><th className="text-right">Covers?</th><th className="text-right">Revenue / credit</th><th className="text-right">Cost of this usage</th><th className="text-right">Margin at full use</th></tr></thead>
        <tbody>{cfg.plans.filter((p) => p.active).map((p) => {
          const perCredit = p.monthly_credits ? p.price_minor / 100 / p.monthly_credits : 0;
          const fullCostPerCredit = credits ? usdCost / credits : 0;
          return <tr key={p.id} className="border-t"><td className="py-1.5">{p.name}</td><td className="text-right tabular">{num(p.monthly_credits)}</td>
            <td className="text-right">{credits <= p.monthly_credits ? <span className="text-success">Yes</span> : <span className="text-warning">Needs {num(credits - p.monthly_credits)} more</span>}</td>
            <td className="text-right tabular">${num(perCredit, 3)}</td><td className="text-right tabular">${num(usdCost, 2)}</td>
            <td className="text-right tabular">{p.price_minor ? `$${num(p.price_minor / 100 - p.monthly_credits * fullCostPerCredit, 2)}` : "—"}</td></tr>;
        })}
          {cfg.packs.filter((p) => p.active).map((p) => <tr key={p.id} className="border-t text-muted-foreground"><td className="py-1.5">Top-up {p.name}</td><td className="text-right tabular">{num(p.credits)}</td><td /><td className="text-right tabular">${num(p.price_minor / 100 / p.credits, 3)}</td><td /><td className="text-right tabular">${num(p.price_minor / 100 - p.credits * (credits ? usdCost / credits : 0), 2)}</td></tr>)}
        </tbody></table></div>
    </Card>
  );
}

export function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
