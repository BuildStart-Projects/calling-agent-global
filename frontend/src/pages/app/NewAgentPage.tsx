import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CalendarCheck, Loader2, MessageCircleQuestion, ShoppingBag } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { AgentType } from "@/app/nav";

const TYPES: Array<{ type: AgentType; title: string; promise: string; examples: string[]; icon: typeof CalendarCheck; badge?: string }> = [
  { type: "booking", title: "Booking Agent", promise: "Books appointments into your real availability.", examples: ["Salons & spas", "Clinics & dental", "Home-service visits"], icon: CalendarCheck, badge: "Most popular" },
  { type: "inquiry", title: "Inquiry Agent", promise: "Answers questions and turns interest into leads.", examples: ["Electricians & plumbers", "Agencies", "Real estate"], icon: MessageCircleQuestion },
  { type: "order", title: "Order Agent", promise: "Takes complete, correctly priced orders.", examples: ["Restaurants & bakeries", "Florists", "Shops"], icon: ShoppingBag },
];

export default function NewAgentPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<AgentType | null>(null);

  const choose = async (type: AgentType) => {
    setBusy(type);
    const { data, error } = await supabase.rpc("create_agent", { p_type: type });
    setBusy(null);
    if (error) {
      toast.error(error.message.includes("agent_limit") ? "You've reached the agent limit on your plan. Upgrade to add more agents." : error.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ["agents"] });
    navigate(`/app/agents/${data as string}/build`);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">Step 1 of 7</p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">What should your agent do?</h1>
        <p className="mt-3 text-muted-foreground">Pick the main job. Every agent answers calls and WhatsApp messages — you can fine-tune everything later.</p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {TYPES.map((t, i) => (
          <motion.button
            key={t.type}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            whileHover={{ y: -4 }}
            onClick={() => choose(t.type)}
            disabled={busy !== null}
            className={cn(
              "group relative flex flex-col rounded-2xl border bg-card p-6 text-left shadow-soft transition-colors hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              t.badge && "border-brand-500/40",
            )}
          >
            {t.badge && <span className="absolute -top-3 left-6 rounded-full bg-brand-gradient px-3 py-1 text-xs font-semibold text-white">{t.badge}</span>}
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors group-hover:bg-brand-gradient group-hover:text-white">
              <t.icon className="h-6 w-6" />
            </div>
            <h2 className="mt-5 text-xl font-semibold">{t.title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t.promise}</p>
            <ul className="mt-5 flex-1 space-y-1.5 text-sm">
              {t.examples.map((e) => <li key={e} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-brand-500" />{e}</li>)}
            </ul>
            <span className="mt-6 inline-flex items-center text-sm font-medium text-brand-700 dark:text-brand-300">
              {busy === t.type ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</> : <>Choose <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" /></>}
            </span>
          </motion.button>
        ))}
      </div>
      <div className="mt-8 text-center">
        <Button variant="ghost" onClick={() => navigate("/app")}>I'll do this later</Button>
      </div>
    </div>
  );
}
