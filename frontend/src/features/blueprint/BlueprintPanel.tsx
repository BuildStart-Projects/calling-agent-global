import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Link2Off, Loader2, MessageCircle, Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabase";
import type { Knowledge } from "@/features/knowledge/useAgentKnowledge";
import { ReadinessRing } from "./fields";
import { AvailabilitySection, BusinessSection, CatalogSection, FaqPolicySection, ToneSelect } from "./sections";

type Props = {
  k: Knowledge | undefined;
  patchedPaths: Record<string, number>;
  readiness?: { score: number; missing: string[] } | null;
  onOpenVoice?: () => void;
};

const TAB_FOR_PATH: Record<string, string> = {
  business: "business", handoff_phone: "business", collect_fields: "business", goal: "business", tone: "business", notes: "business",
  catalog: "catalog", availability: "availability", hours: "business", faqs: "faqs", policies: "faqs",
};

export function BlueprintPanel({ k, patchedPaths, readiness, onOpenVoice }: Props) {
  const [tab, setTab] = useState("business");
  const [userTouched, setUserTouched] = useState(0);
  const [updatedLabel, setUpdatedLabel] = useState<string[]>([]);

  // Auto-switch to the tab the Orchestrator just updated (unless the user switched tabs in the last 8s).
  useEffect(() => {
    const entries = Object.entries(patchedPaths).sort((a, b) => b[1] - a[1]);
    const latest = entries[0];
    if (!latest || Date.now() - latest[1] > 2000) return;
    const t = TAB_FOR_PATH[latest[0].split(".")[0]!];
    if (t && Date.now() - userTouched > 8000) setTab(t);
    const recent = [...new Set(entries.filter(([, ts]) => Date.now() - ts < 4000).map(([p]) => TAB_FOR_PATH[p.split(".")[0]!]).filter(Boolean))] as string[];
    setUpdatedLabel(recent);
    const timer = setTimeout(() => setUpdatedLabel([]), 4000);
    return () => clearTimeout(timer);
  }, [patchedPaths, userTouched]);

  const flash = useMemo(() => {
    const f: Record<string, number> = {};
    for (const [p, ts] of Object.entries(patchedPaths)) {
      f[p] = ts;
      const root = p.split(".")[0]!;
      f[root] = Math.max(f[root] ?? 0, ts);
      if (root === "availability") f.availability = ts;
    }
    return f;
  }, [patchedPaths]);

  if (!k) return <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-40" /><Skeleton className="h-28" /></div>;

  const score = readiness?.score ?? k.readiness;
  const missing = readiness?.missing ?? [];
  const isBooking = k.agent.type === "booking";
  const catalogLabel = k.agent.type === "order" ? "Products" : "Services";
  const tabNames: Record<string, string> = { business: "Business", catalog: catalogLabel, availability: "Availability", faqs: "FAQs & Policies" };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <ReadinessRing score={score} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{k.blueprint.business?.name || "Your agent"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {score >= 100 ? "Everything your agent needs is in place" : missing.length ? `Still needed: ${missing.slice(0, 2).join(", ")}${missing.length > 2 ? "…" : ""}` : "Filling in as you chat"}
          </p>
        </div>
        <AnimatePresence>
          {updatedLabel.length > 0 && (
            <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="hidden items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground sm:inline-flex">
              <Sparkles className="h-3 w-3" />Updated: {updatedLabel.map((t) => tabNames[t] ?? t).join(", ")}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setUserTouched(Date.now()); }} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-3">
          <TabsList className="h-11 w-full justify-start gap-1 overflow-x-auto bg-transparent p-0">
            {["business", "catalog", ...(isBooking ? ["availability"] : []), "faqs", "calling", "messaging"].map((t) => (
              <TabsTrigger key={t} value={t} className="relative h-11 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-brand-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                {tabNames[t] ?? (t === "calling" ? "Calling Agent" : "Messaging Agent")}
                {updatedLabel.includes(t) && <span className="absolute right-1 top-2 h-1.5 w-1.5 rounded-full bg-brand-500" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4 sm:p-5">
            <TabsContent value="business" className="mt-0"><BusinessSection k={k} flash={flash} /></TabsContent>
            <TabsContent value="catalog" className="mt-0"><CatalogSection k={k} flash={flash} /></TabsContent>
            {isBooking && <TabsContent value="availability" className="mt-0"><AvailabilitySection k={k} flash={flash} /></TabsContent>}
            <TabsContent value="faqs" className="mt-0"><FaqPolicySection k={k} flash={flash} /></TabsContent>
            <TabsContent value="calling" className="mt-0"><CallingTab k={k} onOpenVoice={onOpenVoice} /></TabsContent>
            <TabsContent value="messaging" className="mt-0"><MessagingTab k={k} /></TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function CallingTab({ k, onOpenVoice }: { k: Knowledge; onOpenVoice?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Mic className="h-5 w-5" /></div>
          <div className="flex-1">
            <p className="font-semibold">Calling Agent</p>
            <p className="mt-1 text-sm text-muted-foreground">Answers WhatsApp calls using everything in this blueprint. Choose its voice and language in the next step.</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Tone</span>
          <ToneSelect k={k} />
        </div>
        {onOpenVoice && <Button className="mt-4 w-full" variant="outline" onClick={onOpenVoice}>Choose voice & language</Button>}
      </div>
    </div>
  );
}

function MessagingTab({ k }: { k: Knowledge }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.from("channel_configs").select("synced_from_calling").eq("agent_id", k.agent.id).eq("channel", "messaging").maybeSingle()
      .then(({ data }) => setSynced(Boolean(data?.synced_from_calling)));
  }, [k.agent.id]);

  const useSame = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("use_same_info_for_messaging", { p_agent: k.agent.id });
    setBusy(false);
    if (error) { toast.error("Couldn't copy the information. Please try again."); return; }
    setSynced(true);
    qc.invalidateQueries({ queryKey: ["knowledge", k.agent.id] });
    toast.success("Messaging Agent is set up", { description: "It now uses the same information as your Calling Agent." });
  };
  const unlink = async () => {
    const { error } = await supabase.from("channel_configs").update({ synced_from_calling: false }).eq("agent_id", k.agent.id).eq("channel", "messaging");
    if (!error) setSynced(false);
  };

  if (synced === null) return <Skeleton className="h-40" />;
  return synced ? (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"><Copy className="h-3 w-3" />Synced with Calling Agent</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={unlink}><Link2Off className="mr-1 h-3.5 w-3.5" />Unlink</Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Your Messaging Agent replies on WhatsApp with the same business information, services, FAQs and policies. Changes you make apply to both.</p>
    </div>
  ) : (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow"><MessageCircle className="h-6 w-6" /></div>
      <p className="mt-4 font-semibold">Set up your Messaging Agent</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">Reply to WhatsApp messages with everything you've told your Calling Agent — in one click.</p>
      <Button className="mt-5" onClick={useSame} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Use the same information for the Messaging Agent</Button>
    </div>
  );
}
