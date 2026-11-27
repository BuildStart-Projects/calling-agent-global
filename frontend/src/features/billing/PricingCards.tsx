import { Link } from "react-router-dom";
import { Check, Minus, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePublicPricing, type Plan } from "./usePublicPricing";

type Props = {
  /** Called when a plan CTA is pressed inside the app; on the landing page CTAs link to signup. */
  onSelectPlan?: (plan: Plan) => void;
  currentPlanKey?: string | null;
  showTopups?: boolean;
};

export function PricingCards({ onSelectPlan, currentPlanKey, showTopups = true }: Props) {
  const { data, isLoading, isError } = usePublicPricing();

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[460px] rounded-2xl" />)}
      </div>
    );
  }
  if (isError || !data) {
    return <p className="text-center text-sm text-muted-foreground">Pricing is temporarily unavailable. Please refresh in a moment.</p>;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid gap-6 md:grid-cols-3">
        {data.plans.map((plan, i) => {
          const featured = Boolean(plan.badge);
          const isCurrent = currentPlanKey === plan.key;
          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-6 shadow-soft sm:p-7",
                featured && "border-brand-500/60 shadow-glow",
              )}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand-gradient px-3 py-1 text-xs font-semibold text-white shadow">
                  {plan.badge}
                </span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              {plan.tagline && <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>}
              <div className="mt-5 flex items-baseline gap-1">
                <span className="font-display text-4xl font-semibold tabular">
                  {plan.price_minor === 0 ? "Free" : formatMoney(plan.price_minor, plan.currency)}
                </span>
                {plan.price_minor > 0 && <span className="text-sm text-muted-foreground">/ month</span>}
              </div>
              <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
                <Zap className="h-3.5 w-3.5" fill="currentColor" />
                {plan.monthly_credits.toLocaleString()} credits / month
              </div>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {(plan.features ?? []).map((f) => {
                  const row = (
                    <li key={f.label} className={cn("flex items-start gap-2.5", !f.included && "text-muted-foreground")}>
                      {f.included ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      ) : (
                        <Minus className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <span className={cn(f.highlight && "font-medium text-foreground")}>{f.label}</span>
                    </li>
                  );
                  return f.tooltip ? (
                    <Tooltip key={f.label}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent>{f.tooltip}</TooltipContent>
                    </Tooltip>
                  ) : row;
                })}
              </ul>
              <div className="mt-7">
                {onSelectPlan ? (
                  <Button className="w-full" variant={featured ? "default" : "outline"} disabled={isCurrent} onClick={() => onSelectPlan(plan)}>
                    {isCurrent ? "Current plan" : plan.cta_label ?? `Choose ${plan.name}`}
                  </Button>
                ) : (
                  <Button asChild className={cn("w-full", featured && "bg-brand-gradient text-white hover:opacity-95")} variant={featured ? "default" : "outline"}>
                    <Link to={`/signup?plan=${plan.key}`}>{plan.cta_label ?? (plan.price_minor === 0 ? "Start free" : `Get ${plan.name}`)}</Link>
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      {showTopups && data.packs.length > 0 && (
        <div className="mt-8 rounded-2xl border bg-muted/40 p-5 text-center text-sm sm:p-6">
          <p className="font-medium">Need more? Top up anytime.</p>
          <p className="mt-1 text-muted-foreground">
            {data.packs.map((p) => `${p.credits} credits for ${formatMoney(p.price_minor, p.currency)}`).join(" · ")}
            {" — "}top-up credits stay valid for {Math.round((data.packs[0]?.validity_days ?? 365) / 30)} months.
          </p>
        </div>
      )}
    </TooltipProvider>
  );
}
