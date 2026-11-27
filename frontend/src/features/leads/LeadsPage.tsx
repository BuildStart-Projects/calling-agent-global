import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle, Phone, Target } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

type Lead = { id: string; intent: string; summary: string | null; status: "new" | "contacted" | "qualified" | "won" | "lost"; urgency: "low" | "normal" | "high"; source: string; created_at: string; contact: { name: string | null; phone_e164: string | null } | null };
const STAGES: Lead["status"][] = ["new", "contacted", "qualified", "won", "lost"];
const URGENCY: Record<Lead["urgency"], string> = { high: "bg-destructive/10 text-destructive", normal: "bg-muted text-muted-foreground", low: "bg-muted text-muted-foreground" };

export default function LeadsPage() {
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const [stage, setStage] = useState<Lead["status"] | "all">("all");
  const { data, isLoading } = useQuery({
    queryKey: ["leads", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => (await supabase.from("leads").select("*, contact:contacts(name,phone_e164)").eq("workspace_id", workspace!.id).eq("is_test", false).order("created_at", { ascending: false }).limit(300)).data as Lead[],
  });
  useEffect(() => {
    if (!workspace?.id) return;
    const ch = supabase.channel("leads-live").on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `workspace_id=eq.${workspace.id}` }, () => qc.invalidateQueries({ queryKey: ["leads"] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspace?.id, qc]);
  const rows = (data ?? []).filter((l) => stage === "all" || l.status === stage);
  const update = async (l: Lead, status: Lead["status"]) => {
    const { error } = await supabase.from("leads").update({ status, ...(status === "contacted" ? { contacted_at: new Date().toISOString() } : {}) }).eq("id", l.id);
    if (error) toast.error("Couldn't update."); else qc.invalidateQueries({ queryKey: ["leads"] });
  };
  return (
    <>
      <PageHeader title="Leads" description="Customers your agent qualified for you to follow up." />
      <PageBody className="space-y-4">
        <div className="flex gap-1.5 overflow-x-auto">
          {(["all", ...STAGES] as const).map((s) => <button key={s} onClick={() => setStage(s)} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm capitalize", stage === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{s}{s !== "all" && <span className="ml-1.5 opacity-70">{(data ?? []).filter((l) => l.status === s).length}</span>}</button>)}
        </div>
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !rows.length ? <EmptyState icon={Target} title="No leads yet" description="When customers ask for quotes, visits or callbacks, your agent records them here." /> : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {rows.map((l) => (
              <div key={l.id} className="flex flex-col gap-3 border-b p-4 last:border-0 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.contact?.name ?? l.contact?.phone_e164 ?? "Customer"}</span>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-xs capitalize text-accent-foreground">{l.intent.replace(/_/g, " ")}</span>
                    {l.urgency !== "normal" && <span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", URGENCY[l.urgency])}>{l.urgency}</span>}
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{l.source === "call" ? <Phone className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</span>
                  </div>
                  {l.summary && <p className="mt-1 text-sm text-muted-foreground">{l.summary}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {l.contact?.phone_e164 && <a href={`https://wa.me/${l.contact.phone_e164.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">WhatsApp</a>}
                  <Select value={l.status} onValueChange={(v) => update(l, v as Lead["status"])}><SelectTrigger className="h-9 w-32 capitalize"><SelectValue /></SelectTrigger><SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
