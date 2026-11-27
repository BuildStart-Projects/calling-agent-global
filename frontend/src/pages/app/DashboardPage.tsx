import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Bot, CalendarCheck, CheckCircle2, Circle, MessageCircle, Phone, Plus, QrCode, Smartphone, Sparkles, UserRoundCheck, Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgents, type AgentSummary } from "@/features/agents/useAgents";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { user, wallet, emailVerified } = useAuth();
  const { data: agents, isLoading } = useAgents();
  const first = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}${first ? `, ${first}` : ""}`}
        description="Here's what your AI agents are up to."
        actions={<Button asChild><Link to="/app/new"><Plus className="mr-1 h-4 w-4" />New agent</Link></Button>}
      />
      <PageBody className="space-y-6">
        {!emailVerified && (
          <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>Verify your email to connect WhatsApp and launch campaigns. Check your inbox for the link.</span>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-48 rounded-2xl" />
        ) : !agents?.length ? (
          <FirstAgentHero />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="space-y-6">
              <Kpis />
              <div className="grid gap-4 sm:grid-cols-2">
                {agents.map((a) => <AgentCard key={a.id} agent={a} />)}
              </div>
            </div>
            <div className="space-y-6">
              <CreditsWidget total={wallet?.total ?? 0} />
              <SetupChecklist agent={agents[0]!} emailVerified={emailVerified} />
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function FirstAgentHero() {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl border bg-card p-8 shadow-soft sm:p-10">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-gradient opacity-20 blur-3xl" />
      <div className="relative max-w-xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground"><Sparkles className="h-3.5 w-3.5" />Takes about 10 minutes</span>
        <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">Create your first AI agent</h2>
        <p className="mt-2 text-muted-foreground">Answer a few quick questions, pick a voice and scan a QR code. Your agent will answer calls and WhatsApp messages for you.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[[MessageCircle, "Chat with our AI"], [Smartphone, "Pick a voice"], [QrCode, "Scan a QR code"]].map(([Icon, t], i) => {
            const I = Icon as typeof MessageCircle;
            return (
              <div key={t as string} className="flex items-center gap-3 rounded-xl border bg-background/60 p-3 text-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient text-xs font-bold text-white">{i + 1}</span>
                <span className="flex items-center gap-1.5"><I className="h-4 w-4 text-muted-foreground" />{t as string}</span>
              </div>
            );
          })}
        </div>
        <Button asChild size="lg" className="mt-8"><Link to="/app/new">Get started <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      </div>
    </motion.div>
  );
}

function Kpis() {
  const { workspace } = useAuth();
  const { data } = useQuery({
    queryKey: ["kpis", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const ws = workspace!.id;
      const [convos, calls, leads, handoffs] = await Promise.all([
        supabase.from("conversations").select("id, agents!inner(workspace_id)", { count: "exact", head: true }).eq("agents.workspace_id", ws).eq("is_test", false).gte("last_message_at", since),
        supabase.from("calls").select("id", { count: "exact", head: true }).eq("workspace_id", ws).gt("duration_seconds", 0).gte("created_at", since),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("is_test", false).gte("created_at", since),
        supabase.from("handoff_alerts").select("id, agents!inner(workspace_id)", { count: "exact", head: true }).eq("agents.workspace_id", ws).gte("created_at", since),
      ]);
      return { convos: convos.count ?? 0, calls: calls.count ?? 0, leads: leads.count ?? 0, handoffs: handoffs.count ?? 0 };
    },
  });
  const items = [
    { label: "Conversations", value: data?.convos ?? 0, icon: MessageCircle },
    { label: "Calls answered", value: data?.calls ?? 0, icon: Phone },
    { label: "Leads & requests", value: data?.leads ?? 0, icon: CalendarCheck },
    { label: "Handoff requests", value: data?.handoffs ?? 0, icon: UserRoundCheck },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="surface p-4">
          <div className="flex items-center justify-between text-muted-foreground"><span className="text-xs">{k.label}</span><k.icon className="h-4 w-4" /></div>
          <p className="mt-2 font-display text-2xl font-semibold tabular">{k.value}</p>
          <p className="text-xs text-muted-foreground">Last 7 days</p>
        </div>
      ))}
    </div>
  );
}

const STATUS: Record<AgentSummary["status"], { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  ready: { label: "Ready", className: "bg-info/10 text-info" },
  live: { label: "Live", className: "bg-success/10 text-success" },
  paused: { label: "Paused", className: "bg-warning/10 text-warning" },
};

function AgentCard({ agent }: { agent: AgentSummary }) {
  const s = STATUS[agent.status];
  return (
    <Link to={agent.status === "draft" ? `/app/agents/${agent.id}/build` : `/app/agents/${agent.id}`} className="surface group block p-5 transition-colors hover:border-brand-500/50">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Bot className="h-5 w-5" /></div>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", s.className)}>{agent.status === "live" && "● "}{s.label}</span>
      </div>
      <p className="mt-4 font-semibold">{agent.name}</p>
      <p className="text-sm capitalize text-muted-foreground">{agent.type} agent · {agent.wa_phone ?? "WhatsApp not connected"}</p>
      <p className="mt-4 inline-flex items-center text-sm font-medium text-brand-700 dark:text-brand-300">
        {agent.status === "draft" ? "Continue setup" : "Open"} <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
      </p>
    </Link>
  );
}

function CreditsWidget({ total }: { total: number }) {
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Credits</p>
        <Zap className="h-4 w-4 text-brand-500" fill="currentColor" />
      </div>
      <p className="mt-1 font-display text-3xl font-semibold tabular">{formatCredits(total)}</p>
      <div className="mt-4 flex gap-2">
        <Button asChild size="sm" variant="outline" className="flex-1"><Link to="/app/usage">Usage</Link></Button>
        <Button asChild size="sm" className="flex-1"><Link to="/app/billing">Get more</Link></Button>
      </div>
    </div>
  );
}

function SetupChecklist({ agent, emailVerified }: { agent: AgentSummary; emailVerified: boolean }) {
  const steps = [
    { label: "Create your agent", done: true },
    { label: "Verify your email", done: emailVerified },
    { label: "Teach it about your business", done: agent.status !== "draft" },
    { label: "Connect WhatsApp", done: agent.wa_status === "connected" },
    { label: "Go live", done: agent.status === "live" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Finish setting up</p>
        <span className="text-xs text-muted-foreground tabular">{done}/{steps.length}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ul className="mt-4 space-y-2.5 text-sm">
        {steps.map((s) => (
          <li key={s.label} className={cn("flex items-center gap-2.5", s.done && "text-muted-foreground line-through")}>
            {s.done ? <CheckCircle2 className="h-4 w-4 text-brand-500" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
            {s.label}
          </li>
        ))}
      </ul>
      <Button asChild size="sm" className="mt-5 w-full"><Link to={`/app/agents/${agent.id}/build`}>Continue <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
    </div>
  );
}
