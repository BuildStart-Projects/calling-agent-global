import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PageBody } from "@/components/common/PageHeader";
import { useAgents } from "@/features/agents/useAgents";
import { OrchestratorWorkspace } from "@/features/orchestrator/OrchestratorWorkspace";

const STARTERS = ["Add a new service", "Update my prices", "Holiday hours", "Add an FAQ", "Upload a price list"];

export default function KnowledgePage() {
  const { data: agents, isLoading } = useAgents();
  const [agentId, setAgentId] = useState<string | undefined>();
  useEffect(() => { if (!agentId && agents?.length) setAgentId(agents[0]!.id); }, [agents, agentId]);

  if (isLoading) return <PageBody className="pt-8"><Skeleton className="h-96 rounded-2xl" /></PageBody>;
  if (!agents?.length) {
    return (
      <PageBody className="pt-8">
        <EmptyState icon={BookOpen} title="No agents yet" description="Create an agent first — then teach it about your business here." action={<Button asChild><Link to="/app/new">Create an agent</Link></Button>} />
      </PageBody>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <BookOpen className="h-5 w-5 text-brand-600 dark:text-brand-300" />
        <h1 className="text-base font-semibold">Knowledge</h1>
        {agents.length > 1 && (
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"><CheckCircle2 className="h-4 w-4 text-brand-500" />Changes apply to both agents</span>
      </div>
      <div className="min-h-0 flex-1 pb-16 sm:pb-0">
        {agentId && (
          <OrchestratorWorkspace key={agentId} agentId={agentId} mode="knowledge" placeholder="Tell me what to add or change…" starterChips={STARTERS} />
        )}
      </div>
    </div>
  );
}
