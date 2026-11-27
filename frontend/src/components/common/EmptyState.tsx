import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      <div className="relative mb-5">
        <div className="absolute inset-0 -z-10 rounded-2xl bg-brand-gradient opacity-20 blur-xl" />
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-card shadow-soft">
          <Icon className="h-6 w-6 text-brand-600 dark:text-brand-300" />
        </div>
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
