// Superadmin: platform settings (feature flags, campaign safety, models, support) and prompt templates.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { adminApi, Card } from "./shared";
import { F, useConfig } from "./AdminCatalog";

const FLAG_HELP: Record<string, string> = {
  campaigns_live: "Allow customers to launch outbound campaigns (and the dispatcher to dial).",
  voice_tools_enabled: "Let the Calling Agent use tools (bookings, orders, handoff) during calls.",
};

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const [draft, setDraft] = useState<Record<string, Record<string, unknown>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (cfg) setDraft(structuredClone(cfg.settings)); }, [cfg]);
  if (!cfg) return <Skeleton className="h-96 rounded-xl" />;
  const save = async (key: string, value: Record<string, unknown>) => {
    setBusy(key);
    try { await adminApi({ action: "set_setting", key, value }); toast.success("Saved"); qc.invalidateQueries({ queryKey: ["admin", "config"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const flags = (draft.feature_flags ?? {}) as Record<string, boolean>;
  const safety = (draft.campaign_safety ?? {}) as Record<string, string | number>;
  const models = (draft.models ?? {}) as Record<string, string>;
  const support = (draft.support ?? {}) as Record<string, string>;
  const set = (key: string, k: string, v: unknown) => setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? {}), [k]: v } }));
  const SaveBtn = ({ k }: { k: string }) => <Button size="sm" onClick={() => save(k, draft[k] ?? {})} disabled={busy === k}>{busy === k && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Feature flags">
        <div className="space-y-3">{Object.entries(flags).map(([k, v]) => (
          <label key={k} className="flex items-start gap-3 text-sm"><Switch checked={v} onCheckedChange={(on) => save("feature_flags", { [k]: on })} /><span><span className="block font-medium">{k}</span>{FLAG_HELP[k] && <span className="block text-xs text-muted-foreground">{FLAG_HELP[k]}</span>}</span></label>))}</div>
      </Card>
      <Card title="Campaign safety" actions={<SaveBtn k="campaign_safety" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Quiet hours start (local)"><Input type="time" value={String(safety.quiet_start ?? "")} onChange={(e) => set("campaign_safety", "quiet_start", e.target.value)} /></F>
          <F label="Quiet hours end (local)"><Input type="time" value={String(safety.quiet_end ?? "")} onChange={(e) => set("campaign_safety", "quiet_end", e.target.value)} /></F>
          <F label="Default daily cap"><Input type="number" value={Number(safety.default_daily_cap ?? 0)} onChange={(e) => set("campaign_safety", "default_daily_cap", Number(e.target.value))} /></F>
          <F label="Max daily cap"><Input type="number" value={Number(safety.max_daily_cap ?? 0)} onChange={(e) => set("campaign_safety", "max_daily_cap", Number(e.target.value))} /></F>
          <F label="Pause when failure ratio ≥"><Input type="number" step="0.05" min={0.05} max={1} value={Number(safety.failure_pause_ratio ?? 0)} onChange={(e) => set("campaign_safety", "failure_pause_ratio", Number(e.target.value))} /></F>
          <F label="…over the last N calls"><Input type="number" value={Number(safety.failure_window ?? 0)} onChange={(e) => set("campaign_safety", "failure_window", Number(e.target.value))} /></F>
        </div>
      </Card>
      <Card title="AI models" actions={<SaveBtn k="models" />}>
        <p className="mb-3 text-xs text-muted-foreground">Calling Agent voice model is configured in the Go engine. Orchestrator should stay on a mid-tier model.</p>
        <div className="grid gap-3">{Object.entries(models).map(([k, v]) => <F key={k} label={k}><Input value={v} onChange={(e) => set("models", k, e.target.value)} className="font-mono text-xs" /></F>)}</div>
      </Card>
      <Card title="Support contacts (shown to customers by plan)" actions={<SaveBtn k="support" />}>
        <div className="grid gap-3">
          <F label="Support email"><Input value={support.email ?? ""} onChange={(e) => set("support", "email", e.target.value)} placeholder="support@buildstart.io" /></F>
          <F label="Priority WhatsApp (Enterprise)"><Input value={support.priority_whatsapp ?? ""} onChange={(e) => set("support", "priority_whatsapp", e.target.value)} placeholder="+94…" /></F>
          <F label="Onboarding call booking link"><Input value={support.onboarding_url ?? ""} onChange={(e) => set("support", "onboarding_url", e.target.value)} placeholder="https://…" /></F>
        </div>
      </Card>
    </div>
  );
}

export function PromptsPage() {
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const keys = useMemo(() => [...new Set((cfg?.templates ?? []).map((t) => t.key))].sort(), [cfg]);
  const [key, setKey] = useState<string>();
  const versions = (cfg?.templates ?? []).filter((t) => t.key === key);
  const active = versions.find((v) => v.active) ?? versions[0];
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!key && keys[0]) setKey(keys[0]); }, [keys, key]);
  useEffect(() => { setBody(active?.body ?? ""); setNotes(""); }, [key, active?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg) return <Skeleton className="h-96 rounded-xl" />;
  const save = async () => {
    setBusy(true);
    try { const r = await adminApi<{ version?: number; unchanged?: boolean }>({ action: "save_template", key, body, notes: notes || undefined }); toast.success(r.unchanged ? "No changes" : `Saved as v${r.version} and activated. Agents recompile within 5 minutes.`); qc.invalidateQueries({ queryKey: ["admin", "config"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const activate = async (version: number) => {
    try { await adminApi({ action: "activate_template", key, version }); toast.success(`v${version} active`); qc.invalidateQueries({ queryKey: ["admin", "config"] }); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <nav className="rounded-xl border bg-card p-2">{keys.map((k) => <button key={k} onClick={() => setKey(k)} className={cn("block w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-xs", k === key ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{k}</button>)}</nav>
      <div className="space-y-3">
        <Card title={<span className="font-mono">{key}</span>} actions={<span className="text-xs text-muted-foreground">active v{active?.version}</span>}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={22} className="font-mono text-xs leading-relaxed" spellCheck={false} />
          <p className="mt-2 text-xs text-muted-foreground">Mustache variables like {"{{business_name}}"}; sections {"{{#x}}…{{/x}}"}. Fixed refusal/handoff messages are code constants and not editable here.</p>
          <div className="mt-3 flex flex-wrap gap-2"><Input placeholder="What changed? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className="max-w-sm" /><Button onClick={save} disabled={busy || body === active?.body}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save new version</Button></div>
        </Card>
        <Card title="Versions">{versions.map((v) => (
          <div key={v.version} className="flex items-center justify-between border-b py-1.5 text-sm last:border-0"><span>v{v.version} <span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span></span>
            {v.active ? <span className="text-xs text-success">active</span> : <Button variant="ghost" size="sm" onClick={() => activate(v.version)}>Roll back to this</Button>}</div>))}</Card>
      </div>
    </div>
  );
}
