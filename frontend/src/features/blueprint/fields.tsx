import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, FileText, Lock, Pencil, Sparkles, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { FieldMeta } from "@/features/knowledge/useAgentKnowledge";

export function SourceBadge({ source, locked }: { source?: "ai" | "user" | "document"; locked?: boolean }) {
  if (locked || source === "user") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"><Lock className="h-2.5 w-2.5" />You</span>
        </TooltipTrigger>
        <TooltipContent>You edited this — the Orchestrator won't change it.</TooltipContent>
      </Tooltip>
    );
  }
  if (source === "document") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info"><FileText className="h-2.5 w-2.5" />Doc</span>;
  }
  if (source === "ai") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground"><Sparkles className="h-2.5 w-2.5" />AI</span>;
  }
  return null;
}

/** Plays the green "fill" glow when `stamp` changes recently. */
export function useFlash(stamp?: number) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!stamp || Date.now() - stamp > 3000) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1300);
    return () => clearTimeout(t);
  }, [stamp]);
  return flash;
}

export function Section({ title, action, children, flashStamp }: { title: string; action?: ReactNode; children: ReactNode; flashStamp?: number }) {
  const flash = useFlash(flashStamp);
  return (
    <section className={cn("rounded-xl border bg-card p-4 transition-colors", flash && "animate-fill-glow")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

type InlineFieldProps = {
  agentId: string;
  path: string;
  label: string;
  value?: string | null;
  meta: FieldMeta;
  multiline?: boolean;
  placeholder?: string;
  flashStamp?: number;
  format?: (v: string) => string;
};

/** Click-to-edit blueprint field. Saving locks it so the Orchestrator won't overwrite it. */
export function InlineField({ agentId, path, label, value, meta, multiline, placeholder = "Add later", flashStamp }: InlineFieldProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const flash = useFlash(flashStamp);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const m = meta[path];

  useEffect(() => { if (!editing) setDraft(value ?? ""); }, [value, editing]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = async () => {
    if (draft === (value ?? "")) { setEditing(false); return; }
    setSaving(true);
    const { error } = await supabase.rpc("update_blueprint_field", { p_agent: agentId, p_path: path, p_value: draft.trim() ? JSON.stringify(draft.trim()) : null });
    setSaving(false);
    if (error) { toast.error("Couldn't save. Please try again."); return; }
    setEditing(false);
    toast.success("Saved", { description: "Your agents will use this from the next conversation." });
    qc.invalidateQueries({ queryKey: ["knowledge", agentId] });
  };

  return (
    <div className={cn("group -mx-2 rounded-lg px-2 py-1.5 transition-colors", flash && "animate-fill-glow")}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {value ? <SourceBadge source={m?.source} locked={m?.locked} /> : null}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          {multiline ? (
            <Textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
              onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }} />
          ) : (
            <Input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter") save(); }} />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}><Check className="mr-1 h-3.5 w-3.5" />Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="mr-1 h-3.5 w-3.5" />Cancel</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-0.5 flex w-full items-start justify-between gap-2 text-left">
          <span className={cn("text-sm", !value && "italic text-muted-foreground")}>{value || placeholder}</span>
          <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}

export function ReadinessRing({ score, size = 44 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Readiness ${score}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} className="fill-none stroke-muted" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={5} strokeLinecap="round" className="fill-none stroke-brand-500 transition-[stroke-dashoffset] duration-700"
          strokeDasharray={c} strokeDashoffset={c - (c * Math.min(100, score)) / 100} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular">{score}%</span>
    </div>
  );
}

export function formatPrice(minor: number | null, currency: string | null, from = false) {
  if (minor == null) return null;
  try {
    return `${from ? "from " : ""}${new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "USD", maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100)}`;
  } catch {
    return `${from ? "from " : ""}${(minor / 100).toFixed(2)} ${currency ?? ""}`;
  }
}
