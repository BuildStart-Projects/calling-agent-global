import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FileUp, Loader2, Plus, Sparkles, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { manage, QUICK, TARGET_LABEL, useCampaign, type AddResult, type Campaign, type Schedule, type Script } from "./api";
import { extractNumbers, fromText, IMPORT_ACCEPT, type ImportResult } from "./numbers";

const STEPS = [["message", "Message"], ["audience", "Who to call"], ["schedule", "When"], ["review", "Review & launch"]] as const;
type Step = (typeof STEPS)[number][0];
const DAYS: Array<[string, string]> = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];

export default function CampaignEditor() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useCampaign(id);
  const [step, setStep] = useState<Step>("message");
  const nav = useNavigate();
  useEffect(() => { if (data && !["draft", "paused", "scheduled"].includes(data.campaign.status)) nav(`/app/campaigns/${id}`, { replace: true }); }, [data, id, nav]);
  if (isLoading || !data) return <div className="p-8"><Skeleton className="h-96 rounded-2xl" /></div>;
  const idx = STEPS.findIndex(([k]) => k === step);
  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <Link to="/app/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Campaigns</Link>
      <NameField c={data.campaign} />
      <ol className="mt-5 flex gap-1 overflow-x-auto">
        {STEPS.map(([k, label], i) => (
          <li key={k}><button onClick={() => setStep(k)} className={cn("flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-sm", k === step ? "bg-primary text-primary-foreground" : i < idx ? "bg-brand-500/10 text-brand-700 dark:text-brand-300" : "bg-muted text-muted-foreground")}>
            <span className="tabular">{i < idx ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>{label}</button></li>
        ))}
      </ol>
      <div className="mt-6">
        {step === "message" && <MessageStep c={data.campaign} />}
        {step === "audience" && <AudienceStep c={data.campaign} targets={data.targets} />}
        {step === "schedule" && <ScheduleStep c={data.campaign} />}
        {step === "review" && <ReviewStep c={data.campaign} total={data.stats?.total ?? 0} />}
      </div>
      <div className="fixed inset-x-0 bottom-16 z-20 border-t bg-background/90 backdrop-blur sm:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-4xl justify-between px-4 py-3 sm:px-6">
          <Button variant="ghost" disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1]![0])}>Back</Button>
          {idx < STEPS.length - 1 && <Button onClick={() => setStep(STEPS[idx + 1]![0])}>Next: {STEPS[idx + 1]![1]}</Button>}
        </div>
      </div>
    </div>
  );
}

function useSave(c: Campaign) {
  const qc = useQueryClient();
  return async (patch: Record<string, unknown>, quiet = true) => {
    try { await manage({ action: "update", campaign_id: c.id, patch }); qc.invalidateQueries({ queryKey: ["campaign", c.id] }); if (!quiet) toast.success("Saved"); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
  };
}

function NameField({ c }: { c: Campaign }) {
  const save = useSave(c);
  const [name, setName] = useState(c.name);
  useEffect(() => setName(c.name), [c.name]);
  return <input aria-label="Campaign name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && save({ name: name.trim() })}
    className="mt-3 w-full bg-transparent text-2xl font-semibold outline-none focus:underline decoration-brand-500/40 underline-offset-4 sm:text-[28px]" />;
}

// ───────── Step 1: message ─────────
function MessageStep({ c }: { c: Campaign }) {
  const qc = useQueryClient();
  const save = useSave(c);
  const [brief, setBrief] = useState(c.script.brief ?? "");
  const [writing, setWriting] = useState(false);
  const [s, setS] = useState<Script>(c.script);
  const [opening, setOpening] = useState(c.opening_line ?? "");
  useEffect(() => { setS(c.script); setOpening(c.opening_line ?? ""); }, [c.script, c.opening_line]);
  const write = async () => {
    setWriting(true);
    try { await manage({ action: "generate_script", campaign_id: c.id, brief }); qc.invalidateQueries({ queryKey: ["campaign", c.id] }); toast.success("Script ready. Edit anything you like."); }
    catch (e) { toast.error((e as Error).message); } finally { setWriting(false); }
  };
  const list = (v?: string[]) => (v ?? []).join("\n");
  const toList = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  const hasScript = Boolean(c.script.purpose);
  return (
    <div className="space-y-6">
      <div className="surface p-5">
        <Label htmlFor="brief" className="text-base font-semibold">What should your AI say on these calls?</Label>
        <p className="mt-1 text-sm text-muted-foreground">Describe it in your own words. Include any offer and its end date — the AI never invents one.</p>
        <Textarea id="brief" rows={3} className="mt-3" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Tell past customers we now do keratin treatments, 20% off until 15 December, and offer to book them in." />
        <Button className="mt-3" onClick={write} disabled={writing || brief.trim().length < 5}>{writing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{hasScript ? "Rewrite script" : "Write my script"}</Button>
      </div>
      {hasScript && (
        <div className="surface space-y-4 p-5">
          <div className="space-y-1.5"><Label htmlFor="opening">Opening line <span className="font-normal text-muted-foreground">— the first thing your AI says. Use {"{{first_name}}"} to personalise.</span></Label>
            <Textarea id="opening" rows={2} value={opening} onChange={(e) => setOpening(e.target.value)} onBlur={() => opening !== c.opening_line && save({ opening_line: opening })} />
            <p className={cn("text-xs", opening.split(/\s+/).filter(Boolean).length > 30 ? "text-destructive" : "text-muted-foreground")}>{opening.split(/\s+/).filter(Boolean).length}/30 words</p>
          </div>
          <div className="space-y-1.5"><Label htmlFor="purpose">Purpose</Label><Input id="purpose" value={s.purpose ?? ""} onChange={(e) => setS({ ...s, purpose: e.target.value })} onBlur={() => save({ script: { purpose: s.purpose } })} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="points">Key points (one per line)</Label><Textarea id="points" rows={4} value={list(s.key_points)} onChange={(e) => setS({ ...s, key_points: e.target.value.split("\n") })} onBlur={() => save({ script: { key_points: toList(list(s.key_points)) } })} /></div>
            <div className="space-y-1.5"><Label htmlFor="questions">Questions to ask (one per line)</Label><Textarea id="questions" rows={4} value={list(s.questions_to_ask)} onChange={(e) => setS({ ...s, questions_to_ask: e.target.value.split("\n") })} onBlur={() => save({ script: { questions_to_ask: toList(list(s.questions_to_ask)) } })} /></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="offer">Offer (optional)</Label><Input id="offer" value={s.offer ?? ""} onChange={(e) => setS({ ...s, offer: e.target.value })} onBlur={() => save({ script: { offer: s.offer || null } })} placeholder="No offer" /></div>
            <div className="space-y-1.5"><Label htmlFor="validity">Offer valid</Label><Input id="validity" value={s.offer_validity ?? ""} onChange={(e) => setS({ ...s, offer_validity: e.target.value })} onBlur={() => save({ script: { offer_validity: s.offer_validity || null } })} placeholder="e.g. until 15 December" /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="success">A call is a success when…</Label><Input id="success" value={s.success_definition ?? ""} onChange={(e) => setS({ ...s, success_definition: e.target.value })} onBlur={() => save({ script: { success_definition: s.success_definition } })} /></div>
        </div>
      )}
    </div>
  );
}

// ───────── Step 2: audience ─────────
function AudienceStep({ c, targets }: { c: Campaign; targets: Array<{ id: string; phone_e164: string; name: string | null; status: string }> }) {
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState<string | null>(null);
  const [pending, setPending] = useState<(ImportResult & { source: string }) | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["campaign", c.id] });
  const report = (r: AddResult) => toast.success(`${r.added} added${r.duplicates ? ` · ${r.duplicates} duplicates` : ""}${r.invalid ? ` · ${r.invalid} invalid` : ""}${r.dnc ? ` · ${r.dnc} on do-not-call` : ""}`);

  const onFile = async (f: File) => {
    setParsing("Reading file…");
    try { const r = await extractNumbers(f, workspace?.country ?? null, (l) => setParsing(l)); if (!r.rows.length) toast.error("No mobile numbers found in that file."); else setPending({ ...r, source: f.name.slice(0, 80) }); }
    catch { toast.error("Couldn't read that file."); } finally { setParsing(null); }
  };
  const commit = async (rows: ImportResult["rows"], source: string) => {
    setBusy(true);
    try { for (let i = 0; i < rows.length; i += 2000) report((await manage<{ added: AddResult }>({ action: "add_rows", campaign_id: c.id, rows: rows.slice(i, i + 2000), source })).added); setPending(null); setPaste(""); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const addQuick = async (quick: string) => {
    setBusy(true);
    try { report((await manage<{ added: AddResult }>({ action: "add_quick", campaign_id: c.id, quick })).added); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (ids: string[]) => { await manage({ action: "remove_targets", campaign_id: c.id, target_ids: ids }); refresh(); };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <button onClick={() => fileRef.current?.click()} className="surface flex flex-col items-start gap-1 p-4 text-left hover:border-brand-500/60">
          <FileUp className="h-5 w-5 text-brand-600" /><span className="font-medium">Upload a file</span><span className="text-xs text-muted-foreground">Excel, CSV, contacts (.vcf), PDF, Word or a photo of a list</span>
        </button>
        <button onClick={() => setContactsOpen(true)} className="surface flex flex-col items-start gap-1 p-4 text-left hover:border-brand-500/60">
          <Users className="h-5 w-5 text-brand-600" /><span className="font-medium">From your contacts</span><span className="text-xs text-muted-foreground">People who've chatted or called before</span>
        </button>
        <div className="surface p-4">
          <Label htmlFor="paste" className="font-medium">Paste numbers</Label>
          <Textarea id="paste" rows={2} className="mt-2 text-sm" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="+94 77 123 4567, Nimali" />
          <Button size="sm" className="mt-2" disabled={!paste.trim() || busy} onClick={() => { const r = fromText(paste, workspace?.country ?? null); r.rows.length ? commit(r.rows, "pasted") : toast.error("No mobile numbers found."); }}>Add</Button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      {parsing && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{parsing}</p>}

      {pending && (
        <div className="surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div><p className="font-medium">Found {pending.rows.length} mobile numbers in {pending.source}</p>
              {pending.columns && <p className="text-xs text-muted-foreground">Phone column “{pending.columns.phone}”{pending.columns.name ? ` · name column “${pending.columns.name}”` : ""}{pending.columns.extra.length ? ` · also using ${pending.columns.extra.join(", ")}` : ""}</p>}
              {pending.scanned > pending.rows.length && <p className="text-xs text-muted-foreground">{pending.scanned - pending.rows.length} rows skipped (landlines or invalid).</p>}
            </div>
            <Button variant="ghost" size="icon" onClick={() => setPending(null)} aria-label="Discard"><X className="h-4 w-4" /></Button>
          </div>
          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-sm">{pending.rows.slice(0, 8).map((r) => <li key={r.phone} className="flex gap-3"><span className="tabular w-40">{r.phone}</span><span className="text-muted-foreground">{r.name ?? "—"}</span></li>)}{pending.rows.length > 8 && <li className="text-xs text-muted-foreground">…and {pending.rows.length - 8} more</li>}</ul>
          <Button className="mt-3" disabled={busy} onClick={() => commit(pending.rows, pending.source)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add {pending.rows.length} to campaign</Button>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-muted-foreground">Or add a ready-made group</p>
        <div className="flex flex-wrap gap-2">{QUICK.map((q) => <Button key={q.type} variant="outline" size="sm" disabled={busy} onClick={() => addQuick(q.type)}>{q.emoji} {q.title}</Button>)}</div>
      </div>

      <div className="surface">
        <div className="flex items-center justify-between border-b px-4 py-3"><p className="font-medium">{targets.length} people to call</p>
          {targets.some((t) => t.status === "queued") && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(targets.filter((t) => t.status === "queued").map((t) => t.id))}><Trash2 className="mr-1 h-4 w-4" />Clear all</Button>}
        </div>
        {targets.length ? <ul className="max-h-80 overflow-y-auto">{targets.map((t) => (
          <li key={t.id} className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-0"><span className="tabular w-40">{t.phone_e164}</span><span className="flex-1 truncate">{t.name ?? <span className="text-muted-foreground">No name</span>}</span><span className="text-xs text-muted-foreground">{TARGET_LABEL[t.status] ?? t.status}</span>
            {t.status === "queued" && <button aria-label="Remove" onClick={() => remove([t.id])} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>}</li>))}</ul>
          : <p className="p-6 text-center text-sm text-muted-foreground">No one added yet.</p>}
      </div>
      {contactsOpen && <ContactsPicker campaignId={c.id} onClose={() => setContactsOpen(false)} onAdded={(r) => { report(r); refresh(); }} />}
    </div>
  );
}

function ContactsPicker({ campaignId, onClose, onAdded }: { campaignId: string; onClose: () => void; onAdded: (r: AddResult) => void }) {
  const { workspace } = useAuth();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["contacts-pick", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => (await supabase.from("contacts").select("id,name,push_name,phone_e164,last_seen_at").eq("workspace_id", workspace!.id).eq("do_not_contact", false).not("phone_e164", "is", null).order("last_seen_at", { ascending: false }).limit(2000)).data ?? [],
  });
  const rows = (data ?? []).filter((c) => !q || `${c.name ?? ""} ${c.push_name ?? ""} ${c.phone_e164}`.toLowerCase().includes(q.toLowerCase()));
  const add = async () => {
    setBusy(true);
    try { onAdded((await manage<{ added: AddResult }>({ action: "add_contacts", campaign_id: campaignId, contact_ids: [...sel] })).added); onClose(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="flex max-h-[80dvh] w-full max-w-lg flex-col rounded-t-2xl bg-background sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-4"><p className="font-semibold">Choose contacts</p><Input className="mt-3" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="mt-2 text-xs text-brand-700 hover:underline dark:text-brand-300" onClick={() => setSel(new Set(rows.map((r) => r.id)))}>Select all {rows.length}</button></div>
        <ul className="flex-1 overflow-y-auto">{rows.map((r) => (
          <li key={r.id}><label className="flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 text-sm">
            <Checkbox checked={sel.has(r.id)} onCheckedChange={(v) => { const n = new Set(sel); v ? n.add(r.id) : n.delete(r.id); setSel(n); }} />
            <span className="flex-1 truncate">{r.name ?? r.push_name ?? "—"}</span><span className="tabular text-muted-foreground">{r.phone_e164}</span></label></li>))}
          {!rows.length && <li className="p-6 text-center text-sm text-muted-foreground">No contacts yet.</li>}</ul>
        <div className="flex justify-end gap-2 border-t p-3"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!sel.size || busy} onClick={add}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add {sel.size}</Button></div>
      </div>
    </div>
  );
}

// ───────── Step 3: schedule ─────────
function ScheduleStep({ c }: { c: Campaign }) {
  const save = useSave(c);
  const [s, setS] = useState<Schedule>(c.schedule);
  useEffect(() => setS(c.schedule), [c.schedule]);
  const commit = (next: Schedule) => { setS(next); save({ schedule: next }); };
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
  return (
    <div className="space-y-5">
      <div className="surface grid gap-4 p-5 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="start">Start</Label><Input id="start" type="datetime-local" value={toLocal(s.start_at)} onChange={(e) => commit({ ...s, start_at: fromLocal(e.target.value) })} /><p className="text-xs text-muted-foreground">Leave empty to start as soon as you launch.</p></div>
        <div className="space-y-1.5"><Label htmlFor="end">Stop by (optional)</Label><Input id="end" type="datetime-local" value={toLocal(s.end_at)} onChange={(e) => commit({ ...s, end_at: fromLocal(e.target.value) })} /></div>
      </div>
      <div className="surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Calling hours</p>
          <Select value={s.window_tz} onValueChange={(v) => commit({ ...s, window_tz: v as Schedule["window_tz"] })}><SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contact">In each customer's local time</SelectItem><SelectItem value="business">In my business time zone</SelectItem></SelectContent></Select></div>
        <div className="mt-4 space-y-2">{DAYS.map(([d, label]) => {
          const w = s.windows[d]?.[0];
          return (
            <div key={d} className="flex items-center gap-3 text-sm">
              <Switch checked={Boolean(w)} onCheckedChange={(on) => { const windows = { ...s.windows }; if (on) windows[d] = [["10:00", "18:00"]]; else delete windows[d]; commit({ ...s, windows }); }} aria-label={label} />
              <span className="w-10">{label}</span>
              {w ? <><Input type="time" className="h-9 w-28" value={w[0]} onChange={(e) => commit({ ...s, windows: { ...s.windows, [d]: [[e.target.value, w[1]]] } })} /><span>–</span><Input type="time" className="h-9 w-28" value={w[1]} onChange={(e) => commit({ ...s, windows: { ...s.windows, [d]: [[w[0], e.target.value]] } })} /></> : <span className="text-muted-foreground">No calls</span>}
            </div>
          );
        })}</div>
        <p className="mt-3 text-xs text-muted-foreground">We never call between 9 pm and 8 am local time, whatever you set here.</p>
      </div>
      <div className="surface grid gap-4 p-5 sm:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="cap">Max calls per day</Label><Input id="cap" type="number" min={1} value={s.daily_cap} onChange={(e) => setS({ ...s, daily_cap: +e.target.value })} onBlur={() => commit(s)} /></div>
        <div className="space-y-1.5"><Label htmlFor="retries">Retry if no answer</Label>
          <Select value={String(s.retries.max)} onValueChange={(v) => commit({ ...s, retries: { ...s.retries, max: +v } })}><SelectTrigger id="retries"><SelectValue /></SelectTrigger><SelectContent>{[0, 1, 2, 3].map((n) => <SelectItem key={n} value={String(n)}>{n === 0 ? "Don't retry" : `${n} more time${n > 1 ? "s" : ""}`}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="spacing">Wait before retry</Label>
          <Select value={String(s.retries.spacing_minutes)} onValueChange={(v) => commit({ ...s, retries: { ...s.retries, spacing_minutes: +v } })}><SelectTrigger id="spacing"><SelectValue /></SelectTrigger><SelectContent>{[[30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [1440, "Next day"]].map(([v, l]) => <SelectItem key={v} value={String(v)}>{l}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="surface space-y-4 p-5">
        <MsgToggle title="Send a WhatsApp heads-up before calling" hint="Customers answer more often when they expect the call." on={s.pre_call_message.enabled} text={s.pre_call_message.text}
          onToggle={(on) => commit({ ...s, pre_call_message: { ...s.pre_call_message, enabled: on } })} onText={(t) => commit({ ...s, pre_call_message: { ...s.pre_call_message, text: t } })} />
        <MsgToggle title="Send a WhatsApp message if they never answer" hint="Sent once, after the last attempt." on={s.no_answer_message.enabled} text={s.no_answer_message.text}
          onToggle={(on) => commit({ ...s, no_answer_message: { ...s.no_answer_message, enabled: on } })} onText={(t) => commit({ ...s, no_answer_message: { ...s.no_answer_message, text: t } })} />
      </div>
    </div>
  );
}

function MsgToggle({ title, hint, on, text, onToggle, onText }: { title: string; hint: string; on: boolean; text: string; onToggle: (v: boolean) => void; onText: (t: string) => void }) {
  const [t, setT] = useState(text);
  useEffect(() => setT(text), [text]);
  return (
    <div>
      <label className="flex items-start gap-3"><Switch checked={on} onCheckedChange={onToggle} /><span><span className="block font-medium">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span></label>
      {on && <Textarea rows={2} className="mt-2 text-sm" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t !== text && onText(t)} />}
    </div>
  );
}

// ───────── Step 4: review ─────────
function ReviewStep({ c, total }: { c: Campaign; total: number }) {
  const nav = useNavigate();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: preview, isLoading } = useQuery({
    queryKey: ["campaign-preview", c.id, c.opening_line, c.script, total],
    queryFn: () => manage<{ opening_line: string; context: string; estimate: { targets: number; credits: number; max_credits: number } }>({ action: "preview", campaign_id: c.id }),
  });
  const problems = [!c.script.purpose && "Write the message first.", !c.opening_line?.trim() && "Add an opening line.", !total && "Add at least one person to call."].filter(Boolean) as string[];
  const launch = async () => {
    setBusy(true);
    try { await manage({ action: c.status === "paused" ? "resume" : "launch", campaign_id: c.id, consent: true }); toast.success("Campaign launched 🚀"); nav(`/app/campaigns/${c.id}`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <div className="surface p-5">
        <p className="text-sm font-semibold text-muted-foreground">Your AI will open with</p>
        {isLoading ? <Skeleton className="mt-2 h-6" /> : <p className="mt-2 text-lg">“{preview?.opening_line || "—"}”</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="People to call" value={preview?.estimate.targets ?? total} />
        <Stat label="Estimated credits" value={preview ? `~${preview.estimate.credits}` : "…"} hint={preview ? `Up to ${preview.estimate.max_credits} if every call runs to the limit` : undefined} />
        <Stat label="Calling hours" value={Object.keys(c.schedule.windows ?? {}).length ? `${Object.keys(c.schedule.windows).length} days/week` : "None set"} />
      </div>
      {problems.length > 0 ? <ul className="space-y-1 rounded-xl bg-warning/10 p-4 text-sm">{problems.map((p) => <li key={p}>• {p}</li>)}</ul> : (
        <div className="surface p-5">
          <label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} className="mt-0.5" />
            <span>I confirm these people are my customers or asked to hear from me, and that calling them is allowed where they live. People who say “don't call me” are removed automatically.</span></label>
          <Button size="lg" className="mt-4 w-full sm:w-auto" disabled={!consent || busy} onClick={launch}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{c.status === "paused" ? "Resume campaign" : c.schedule.start_at && new Date(c.schedule.start_at) > new Date() ? "Schedule campaign" : "Launch campaign"}</Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="surface p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>;
}
