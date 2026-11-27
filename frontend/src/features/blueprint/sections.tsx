import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, Loader2, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CatalogItem, Faq, Knowledge } from "@/features/knowledge/useAgentKnowledge";
import { InlineField, Section, SourceBadge, formatPrice, useFlash } from "./fields";

type Flash = Record<string, number>;

// ─────────────────────────── Business ───────────────────────────
export function BusinessSection({ k, flash }: { k: Knowledge; flash: Flash }) {
  const b = k.blueprint.business ?? {};
  const id = k.agent.id;
  return (
    <div className="space-y-4">
      <Section title="Business" flashStamp={flash.business}>
        <div className="grid gap-1 sm:grid-cols-2">
          <InlineField agentId={id} meta={k.fieldMeta} path="business.name" label="Name" value={b.name} flashStamp={flash["business.name"]} />
          <InlineField agentId={id} meta={k.fieldMeta} path="business.industry" label="Industry" value={b.industry} flashStamp={flash["business.industry"]} />
        </div>
        <InlineField agentId={id} meta={k.fieldMeta} path="business.description" label="What you do" value={b.description} multiline flashStamp={flash["business.description"]} />
        <div className="grid gap-1 sm:grid-cols-2">
          <InlineField agentId={id} meta={k.fieldMeta} path="business.address" label="Address" value={b.address} flashStamp={flash["business.address"]} />
          <InlineField agentId={id} meta={k.fieldMeta} path="business.service_area" label="Service area" value={b.service_area} flashStamp={flash["business.service_area"]} />
          <InlineField agentId={id} meta={k.fieldMeta} path="business.website" label="Website" value={b.website} flashStamp={flash["business.website"]} />
        </div>
      </Section>
      <HandoffCard k={k} flashStamp={flash.handoff_phone} />
      <Section title="How your agents work" flashStamp={flash.collect_fields ?? flash.goal ?? flash.tone}>
        <InlineField agentId={id} meta={k.fieldMeta} path="notes" label="Anything else your agents should know" value={k.blueprint.notes} multiline />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground">Collects:</span>
          {(k.blueprint.collect_fields ?? []).length ? (k.blueprint.collect_fields ?? []).map((f) => (
            <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-xs">{f.replace(/_/g, " ")}</span>
          )) : <span className="text-xs italic text-muted-foreground">name & phone (default)</span>}
          {k.blueprint.tone && <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs capitalize text-accent-foreground">{k.blueprint.tone} tone</span>}
        </div>
      </Section>
    </div>
  );
}

function HandoffCard({ k, flashStamp }: { k: Knowledge; flashStamp?: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(k.agent.handoff_phone_e164 ?? "");
  const [saving, setSaving] = useState(false);
  const flash = useFlash(flashStamp);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("set_handoff_phone", { p_agent: k.agent.id, p_phone: value });
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("same_as_agent_number") ? "Use a different number than your business WhatsApp." : error.message.includes("invalid_phone") ? "Enter the full number with country code." : "Couldn't save the number.");
      return;
    }
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["knowledge", k.agent.id] });
    toast.success("Handoff number saved");
  };
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center", flash && "animate-fill-glow", !k.agent.handoff_phone_e164 && "border-dashed")}>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Phone className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Human handoff alerts</p>
        <p className="text-xs text-muted-foreground">When a customer asks for a person, we WhatsApp this number.</p>
      </div>
      {editing ? (
        <div className="flex gap-2">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="+1 415 555 0123" className="h-9 w-44" autoFocus onKeyDown={(e) => e.key === "Enter" && save()} />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </div>
      ) : (
        <Button size="sm" variant={k.agent.handoff_phone_e164 ? "ghost" : "outline"} onClick={() => setEditing(true)}>
          {k.agent.handoff_phone_e164 ?? "Add number"}
        </Button>
      )}
    </div>
  );
}

// ─────────────────────────── Catalog ───────────────────────────
export function CatalogSection({ k, flash }: { k: Knowledge; flash: Flash }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<CatalogItem> | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  const kind: "service" | "product" = k.agent.type === "order" ? "product" : "service";
  const label = kind === "service" ? "Services" : "Products";

  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("catalog_items").delete().eq("id", deleting.id);
    setDeleting(null);
    if (error) toast.error("Couldn't remove it."); else { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["knowledge", k.agent.id] }); }
  };

  return (
    <Section title={`${label} (${k.catalog.length})`} flashStamp={flash.catalog} action={<Button size="sm" variant="ghost" onClick={() => setEditing({ kind })}><Plus className="mr-1 h-4 w-4" />Add</Button>}>
      {k.catalog.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No {label.toLowerCase()} yet — tell the Orchestrator or upload a price list.</p>
      ) : (
        <ul className="divide-y">
          {k.catalog.map((c) => <CatalogRow key={c.id} item={c} flashStamp={flash[`catalog.${c.ref}`]} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />)}
        </ul>
      )}
      {editing && <CatalogDialog agentId={k.agent.id} item={editing} defaultCurrency={k.blueprint.business?.currency ?? "USD"} onClose={() => setEditing(null)} />}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Your agents will stop offering it from the next conversation.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function CatalogRow({ item, flashStamp, onEdit, onDelete }: { item: CatalogItem; flashStamp?: number; onEdit: () => void; onDelete: () => void }) {
  const flash = useFlash(flashStamp);
  return (
    <li className={cn("group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5", flash && "animate-fill-glow")}>
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.name}</span>
          <SourceBadge source={item.source} locked={item.locked} />
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {item.duration_minutes && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{item.duration_minutes} min</span>}
          {item.description && <span className="truncate">{item.description}</span>}
        </div>
      </button>
      <span className="shrink-0 text-sm font-medium tabular">{formatPrice(item.price_minor, item.currency, item.price_from) ?? <span className="text-xs italic text-muted-foreground">no price</span>}</span>
      <button onClick={onDelete} aria-label={`Remove ${item.name}`} className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-4 w-4" /></button>
    </li>
  );
}

function CatalogDialog({ agentId, item, defaultCurrency, onClose }: { agentId: string; item: Partial<CatalogItem>; defaultCurrency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(item.name ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [price, setPrice] = useState(item.price_minor != null ? String(item.price_minor / 100) : "");
  const [from, setFrom] = useState(item.price_from ?? false);
  const [duration, setDuration] = useState(item.duration_minutes ? String(item.duration_minutes) : "");
  const [saving, setSaving] = useState(false);
  const isService = (item.kind ?? "service") === "service";

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const row = {
      agent_id: agentId, kind: item.kind ?? "service", name: name.trim(), description: description.trim() || null,
      price_minor: price.trim() ? Math.round(Number(price) * 100) : null, price_from: from,
      currency: item.currency ?? defaultCurrency, duration_minutes: isService && duration ? Number(duration) : null,
    };
    const { error } = item.id
      ? await supabase.from("catalog_items").update(row).eq("id", item.id)
      : await supabase.from("catalog_items").insert({ ...row, ref: "" });
    setSaving(false);
    if (error) { toast.error("Couldn't save. Check the values and try again."); return; }
    qc.invalidateQueries({ queryKey: ["knowledge", agentId] });
    toast.success(item.id ? "Updated" : "Added");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item.id ? "Edit" : "Add"} {isService ? "service" : "product"}</DialogTitle>
          <DialogDescription>Your agents will only quote what you enter here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="c-name">Name</Label><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="c-price">Price</Label><Input id="c-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Optional" /></div>
            {isService && <div className="space-y-1.5"><Label htmlFor="c-dur">Duration (min)</Label><Input id="c-dur" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 45" /></div>}
          </div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={from} onCheckedChange={setFrom} />Price is a starting price (“from”)</label>
          <div className="space-y-1.5"><Label htmlFor="c-desc">Description</Label><Textarea id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Availability ───────────────────────────
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function AvailabilitySection({ k, flash }: { k: Knowledge; flash: Flash }) {
  const [open, setOpen] = useState(false);
  const s = k.bookingSettings;
  return (
    <div className="space-y-4">
      <Section title="When customers can book" flashStamp={flash.availability} action={<Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Edit</Button>}>
        <div className="grid grid-cols-7 gap-1.5">
          {ORDER.map((d) => {
            const ranges = k.rules.filter((r) => r.weekday === d);
            return (
              <div key={d} className="text-center">
                <p className="mb-1 text-[11px] text-muted-foreground">{DAYS[d]}</p>
                <div className={cn("flex h-16 flex-col justify-center rounded-lg px-0.5 text-[10px] leading-tight", ranges.length ? "bg-brand-50 font-medium text-brand-700 dark:text-brand-300" : "hatched text-muted-foreground")}>
                  {ranges.length ? ranges.map((r) => <span key={r.id}>{r.start_time.slice(0, 5)}<br />{r.end_time.slice(0, 5)}</span>) : "Closed"}
                </div>
              </div>
            );
          })}
        </div>
        {s && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Chip>{s.slot_interval_minutes}-min slots</Chip>
            <Chip>{s.capacity} at a time</Chip>
            <Chip>{s.min_notice_minutes >= 60 ? `${Math.round(s.min_notice_minutes / 60)}h` : `${s.min_notice_minutes}m`} notice</Chip>
            <Chip>up to {s.max_days_ahead} days ahead</Chip>
            <Chip>{s.auto_confirm ? "Auto-confirm" : "You approve each booking"}</Chip>
          </div>
        )}
      </Section>
      {open && <WeeklyHoursDialog k={k} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2.5 py-1">{children}</span>;
}

export function WeeklyHoursDialog({ k, onClose }: { k: Knowledge; onClose: () => void }) {
  const qc = useQueryClient();
  const initial: Record<number, Array<[string, string]>> = {};
  for (const d of ORDER) initial[d] = k.rules.filter((r) => r.weekday === d).map((r) => [r.start_time.slice(0, 5), r.end_time.slice(0, 5)]);
  const [week, setWeek] = useState(initial);
  const [saving, setSaving] = useState(false);

  const setRange = (d: number, i: number, idx: 0 | 1, v: string) => setWeek((w) => ({ ...w, [d]: w[d]!.map((r, j) => (j === i ? (idx === 0 ? [v, r[1]] : [r[0], v]) : r)) }));
  const invalid = Object.values(week).flat().some(([a, b]) => !a || !b || a >= b);

  const save = async () => {
    setSaving(true);
    await supabase.from("availability_rules").delete().eq("agent_id", k.agent.id);
    const rows = Object.entries(week).flatMap(([d, rs]) => rs.map(([s, e]) => ({ agent_id: k.agent.id, weekday: Number(d), start_time: s, end_time: e, source: "user" })));
    const { error } = rows.length ? await supabase.from("availability_rules").insert(rows) : { error: null };
    setSaving(false);
    if (error) { toast.error("Couldn't save hours."); return; }
    qc.invalidateQueries({ queryKey: ["knowledge", k.agent.id] });
    toast.success("Availability updated");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-brand-600" />Weekly availability</DialogTitle>
          <DialogDescription>Times are in {k.bookingSettings?.timezone ?? "your timezone"}. Add a second range for split shifts.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {ORDER.map((d) => {
            const open = week[d]!.length > 0;
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5">
                <label className="flex w-24 items-center gap-2 text-sm font-medium">
                  <Switch checked={open} onCheckedChange={(v) => setWeek((w) => ({ ...w, [d]: v ? [["09:00", "17:00"]] : [] }))} />{DAYS[d]}
                </label>
                {open ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    {week[d]!.map(([s, e], i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input type="time" value={s} onChange={(ev) => setRange(d, i, 0, ev.target.value)} className="h-8 w-[104px]" />
                        <span className="text-muted-foreground">–</span>
                        <Input type="time" value={e} onChange={(ev) => setRange(d, i, 1, ev.target.value)} className="h-8 w-[104px]" />
                        {week[d]!.length > 1 && <button onClick={() => setWeek((w) => ({ ...w, [d]: w[d]!.filter((_, j) => j !== i) }))} className="text-muted-foreground hover:text-destructive" aria-label="Remove range"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    ))}
                    {week[d]!.length < 3 && <button onClick={() => setWeek((w) => ({ ...w, [d]: [...w[d]!, ["13:00", "17:00"]] }))} className="text-xs text-brand-700 hover:underline dark:text-brand-300">+ split shift</button>}
                  </div>
                ) : <span className="text-sm text-muted-foreground">Closed</span>}
              </div>
            );
          })}
        </div>
        <button onClick={() => setWeek((w) => ({ ...w, 2: w[1]!.slice(), 3: w[1]!.slice(), 4: w[1]!.slice(), 5: w[1]!.slice() }))} className="text-left text-xs text-brand-700 hover:underline dark:text-brand-300">Copy Monday to Tue–Fri</button>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || invalid}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save hours</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── FAQs & policies ───────────────────────────
export function FaqPolicySection({ k, flash }: { k: Knowledge; flash: Flash }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Faq> | null>(null);
  const p = k.blueprint.policies ?? {};
  const id = k.agent.id;
  return (
    <div className="space-y-4">
      <Section title={`Common questions (${k.faqs.length})`} flashStamp={flash.faqs} action={<Button size="sm" variant="ghost" onClick={() => setEditing({})}><Plus className="mr-1 h-4 w-4" />Add</Button>}>
        {k.faqs.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No FAQs yet.</p> : (
          <ul className="divide-y">
            {k.faqs.map((f) => (
              <li key={f.id} className="group -mx-2 flex items-start gap-2 rounded-lg px-2 py-2.5">
                <button onClick={() => setEditing(f)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2"><p className="text-sm font-medium">{f.question}</p><SourceBadge source={f.source} locked={f.locked} /></div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.answer}</p>
                </button>
                <button onClick={async () => { await supabase.from("faqs").delete().eq("id", f.id); qc.invalidateQueries({ queryKey: ["knowledge", id] }); }} aria-label="Remove FAQ" className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Policies & payments" flashStamp={flash.policies}>
        <InlineField agentId={id} meta={k.fieldMeta} path="policies.cancellation" label="Cancellation" value={p.cancellation} multiline flashStamp={flash["policies.cancellation"]} />
        <InlineField agentId={id} meta={k.fieldMeta} path="policies.payment_instructions" label="Payment instructions (shared exactly as written)" value={p.payment_instructions} multiline flashStamp={flash["policies.payment_instructions"]} />
        {k.agent.type === "order" && (
          <>
            <InlineField agentId={id} meta={k.fieldMeta} path="policies.delivery.areas" label="Delivery areas" value={p.delivery?.areas} flashStamp={flash["policies.delivery"]} />
            <InlineField agentId={id} meta={k.fieldMeta} path="policies.pickup.address" label="Pickup address" value={p.pickup?.address} flashStamp={flash["policies.pickup"]} />
            <InlineField agentId={id} meta={k.fieldMeta} path="policies.returns" label="Returns" value={p.returns} multiline />
          </>
        )}
        <InlineField agentId={id} meta={k.fieldMeta} path="policies.other" label="Other policies" value={p.other} multiline />
      </Section>
      {editing && <FaqDialog agentId={id} faq={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FaqDialog({ agentId, faq, onClose }: { agentId: string; faq: Partial<Faq>; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState(faq.question ?? "");
  const [a, setA] = useState(faq.answer ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const row = { agent_id: agentId, question: q.trim(), answer: a.trim() };
    const { error } = faq.id ? await supabase.from("faqs").update(row).eq("id", faq.id) : await supabase.from("faqs").insert(row);
    setSaving(false);
    if (error) { toast.error("Couldn't save."); return; }
    qc.invalidateQueries({ queryKey: ["knowledge", agentId] });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{faq.id ? "Edit" : "Add"} question</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="f-q">Question</Label><Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
          <div className="space-y-1.5"><Label htmlFor="f-a">Answer</Label><Textarea id="f-a" value={a} onChange={(e) => setA(e.target.value)} rows={4} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !q.trim() || !a.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ToneSelect({ k }: { k: Knowledge }) {
  const qc = useQueryClient();
  return (
    <Select value={k.blueprint.tone ?? "friendly"} onValueChange={async (v) => {
      await supabase.rpc("update_blueprint_field", { p_agent: k.agent.id, p_path: "tone", p_value: JSON.stringify(v) });
      qc.invalidateQueries({ queryKey: ["knowledge", k.agent.id] });
    }}>
      <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        {["friendly", "professional", "energetic", "reassuring"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
