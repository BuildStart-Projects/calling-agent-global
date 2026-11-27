import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgents } from "@/features/agents/useAgents";
import { manage, QUICK, STATUS_STYLE, useCampaigns, type Campaign, type QuickType } from "./api";

export default function CampaignsPage() {
  const { workspace } = useAuth();
  const nav = useNavigate();
  const { data: agents } = useAgents();
  const callers = agents ?? [];
  const [agentId, setAgentId] = useState<string>();
  useEffect(() => { if (!agentId && callers[0]) setAgentId(callers[0].id); }, [callers, agentId]);
  const agent = callers.find((a) => a.id === agentId);
  const { data: list, isLoading } = useCampaigns(workspace?.id);
  const { data: counts } = useQuery({
    queryKey: ["quick-counts", agentId],
    enabled: Boolean(agentId),
    staleTime: 60_000,
    queryFn: () => manage<{ counts: Record<QuickType, number> }>({ action: "quick_counts", agent_id: agentId }).then((r) => r.counts),
  });
  const [busy, setBusy] = useState<string | null>(null);

  const create = async (quick?: QuickType) => {
    if (!agentId) return;
    setBusy(quick ?? "new");
    try {
      const r = await manage<{ campaign: Campaign; added?: { added: number } }>({ action: "draft", agent_id: agentId, ...(quick ? { quick } : {}) });
      if (quick) toast.success(`${r.added?.added ?? 0} people added. Review and launch.`);
      nav(`/app/campaigns/${r.campaign.id}/edit`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  if (agents && !callers.length) return <PageBody className="pt-8"><EmptyState icon={Megaphone} title="Campaigns need a calling agent" description="Create an agent that makes calls, then reach your customers in bulk." action={<Button asChild><Link to="/app/new">Create an agent</Link></Button>} /></PageBody>;

  return (
    <>
      <PageHeader title="Campaigns" description="Your AI calls a list of customers for you — follow-ups, reminders, offers."
        actions={<>
          {callers.length > 1 && <Select value={agentId} onValueChange={setAgentId}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent>{callers.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>}
          <Button onClick={() => create()} disabled={!agentId || Boolean(busy)}>{busy === "new" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}New campaign</Button>
        </>} />
      <PageBody className="space-y-8 pb-10">
        {agent && agent.wa_status !== "connected" && <p className="rounded-xl bg-warning/10 p-3 text-sm">Connect WhatsApp for <b>{agent.name}</b> before launching. <Link className="font-medium underline" to={`/app/agents/${agent.id}/connect`}>Connect now</Link></p>}

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Quick campaigns</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {QUICK.filter((q) => !q.needs || agent?.type === q.needs).map((q) => {
              const n = counts?.[q.type];
              return (
                <button key={q.type} disabled={!n || Boolean(busy)} onClick={() => create(q.type)}
                  className={cn("surface group flex items-start gap-3 p-4 text-left transition-colors", n ? "hover:border-brand-500/60" : "opacity-60")}>
                  <span className="text-xl">{q.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{q.title}</span>
                    <span className="block text-xs text-muted-foreground">{q.hint}</span>
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", n ? "bg-brand-500/10 text-brand-700 dark:text-brand-300" : "bg-muted text-muted-foreground")}>
                    {busy === q.type ? <Loader2 className="h-3 w-3 animate-spin" /> : n === undefined ? "…" : n}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">All campaigns</h2>
          {isLoading ? <Skeleton className="h-40 rounded-xl" /> : !list?.length ? (
            <EmptyState icon={Megaphone} title="No campaigns yet" description="Start with a quick campaign above, or upload a list of numbers." />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {list.map((c) => {
                const s = c.stats; const done = s ? s.total - s.remaining - s.calling : 0;
                return (
                  <Link key={c.id} to={c.status === "draft" ? `/app/campaigns/${c.id}/edit` : `/app/campaigns/${c.id}`} className="flex flex-col gap-2 border-b p-4 last:border-0 hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="truncate font-medium">{c.name}</span><span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", STATUS_STYLE[c.status])}>{c.status}</span></div>
                      <p className="text-xs text-muted-foreground">{c.launched_at ? `Launched ${formatDistanceToNow(new Date(c.launched_at), { addSuffix: true })}` : `Created ${formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}`}</p>
                    </div>
                    {s && s.total > 0 && (
                      <div className="flex items-center gap-4 text-sm sm:w-80">
                        <Progress value={(done / s.total) * 100} className="h-1.5 flex-1" />
                        <span className="tabular text-muted-foreground">{done}/{s.total}</span>
                        <span className="tabular font-medium text-success">{s.converted} ✓</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </PageBody>
    </>
  );
}
