import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatCredits } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CreditsPill({ className }: { className?: string }) {
  const { wallet } = useAuth();
  const total = wallet?.total ?? 0;
  const low = total < 5;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium tabular transition-colors hover:bg-accent",
            low && "border-warning/40 text-warning",
            className,
          )}
          aria-label={`${formatCredits(total)} credits`}
        >
          <Zap className={cn("h-4 w-4", low ? "text-warning" : "text-brand-500")} fill="currentColor" />
          {formatCredits(total)}
          <span className="hidden text-muted-foreground sm:inline">credits</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Available credits</p>
            <p className="font-display text-3xl font-semibold tabular">{formatCredits(total)}</p>
          </div>
          <div className="space-y-1.5 text-sm">
            <Row
              label="Monthly"
              value={formatCredits(wallet?.plan_remaining)}
              hint={wallet?.plan_expires_at ? `resets ${format(new Date(wallet.plan_expires_at), "MMM d")}` : undefined}
            />
            <Row
              label="Top-up"
              value={formatCredits(wallet?.topup_remaining)}
              hint={wallet?.next_topup_expiry ? `earliest expiry ${format(new Date(wallet.next_topup_expiry), "MMM yyyy")}` : undefined}
            />
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" className="flex-1"><Link to="/app/billing?tab=topup">Buy credits</Link></Button>
            <Button asChild size="sm" variant="outline" className="flex-1"><Link to="/app/billing">Upgrade</Link></Button>
          </div>
          <Link to="/app/usage" className="block text-center text-xs text-muted-foreground hover:text-foreground">View usage →</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular">
        <span className="font-medium">{value}</span>
        {hint && <span className="ml-1.5 text-xs text-muted-foreground">({hint})</span>}
      </span>
    </div>
  );
}
