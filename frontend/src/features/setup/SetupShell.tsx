import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupStepper, SETUP_STEPS } from "@/pages/app/BuilderPage";

type StepKey = (typeof SETUP_STEPS)[number]["key"];

export function SetupShell({ agentId, step, title, description, children, footer }: {
  agentId: string; step: StepKey; title: string; description?: string; children: ReactNode; footer?: ReactNode;
}) {
  const idx = SETUP_STEPS.findIndex((s) => s.key === step);
  const prev = SETUP_STEPS[idx - 1];
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <Button variant="ghost" size="icon" asChild aria-label="Back">
          <Link to={prev ? `/app/agents/${agentId}/${prev.key}` : "/app"}><ChevronLeft className="h-5 w-5" /></Link>
        </Button>
        <p className="text-sm font-semibold">Step {idx + 1} of {SETUP_STEPS.length}</p>
        <div className="ml-auto"><SetupStepper agentId={agentId} current={step} /></div>
      </div>
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 text-muted-foreground">{description}</p>}
        <div className="mt-8">{children}</div>
      </div>
      {footer && (
        <div className="sticky bottom-16 border-t bg-background/90 backdrop-blur sm:bottom-0">
          <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-4 py-3 sm:px-6">{footer}</div>
        </div>
      )}
    </div>
  );
}
