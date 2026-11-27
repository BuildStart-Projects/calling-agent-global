import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronLeft, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";
import { OrchestratorWorkspace } from "@/features/orchestrator/OrchestratorWorkspace";
import { cn } from "@/lib/utils";

export const SETUP_STEPS = [
  { key: "build", label: "Build" },
  { key: "voice", label: "Voice" },
  { key: "messaging", label: "Messaging" },
  { key: "handoff", label: "Handoff" },
  { key: "test", label: "Test" },
  { key: "connect", label: "Connect" },
] as const;

export function SetupStepper({ agentId, current }: { agentId: string; current: (typeof SETUP_STEPS)[number]["key"] }) {
  const idx = SETUP_STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="hidden items-center gap-1 md:flex" aria-label="Setup progress">
      {SETUP_STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1">
          <Link
            to={`/app/agents/${agentId}/${s.key}`}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              i === idx ? "bg-primary text-primary-foreground" : i < idx ? "text-brand-700 hover:bg-accent dark:text-brand-300" : "text-muted-foreground hover:bg-muted",
            )}
            aria-current={i === idx ? "step" : undefined}
          >
            {i < idx ? <Check className="h-3.5 w-3.5" /> : <span className="tabular">{i + 1}</span>}
            {s.label}
          </Link>
          {i < SETUP_STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

export default function BuilderPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: k } = useAgentKnowledge(id);

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col sm:h-[calc(100dvh-4rem)]">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <Button variant="ghost" size="icon" asChild aria-label="Back to dashboard"><Link to="/app"><ChevronLeft className="h-5 w-5" /></Link></Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{k?.blueprint.business?.name || k?.agent.name || "New agent"}</p>
          <p className="text-xs capitalize text-muted-foreground">{k?.agent.type} agent · {k?.agent.status === "draft" ? "Draft" : "Ready"}</p>
        </div>
        <div className="ml-auto"><SetupStepper agentId={id} current="build" /></div>
      </div>
      <div className="min-h-0 flex-1 pb-16 sm:pb-0">
        <OrchestratorWorkspace
          agentId={id}
          mode="onboarding"
          onOpenVoice={() => navigate(`/app/agents/${id}/voice`)}
          renderDone={(done) => (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl border border-brand-500/40 bg-card p-5 shadow-glow">
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-gradient opacity-20 blur-2xl" />
              <div className="flex items-center gap-2 text-brand-700 dark:text-brand-300"><PartyPopper className="h-5 w-5" /><p className="font-semibold">Your agent is ready to configure</p></div>
              {done.summary && <p className="mt-2 text-sm text-muted-foreground">{done.summary}</p>}
              {done.defaults_applied.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Defaults I set for you</p>
                  <ul className="mt-1.5 space-y-1 text-sm">{done.defaults_applied.map((d) => <li key={d} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />{d}</li>)}</ul>
                  <p className="mt-2 text-xs text-muted-foreground">You can change any of these in the panel on the right.</p>
                </div>
              )}
              <Button className="mt-4" onClick={() => navigate(`/app/agents/${id}/voice`)}>Choose a voice <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </motion.div>
          )}
        />
      </div>
    </div>
  );
}
