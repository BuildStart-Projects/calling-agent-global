import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { SetupStepper, SETUP_STEPS } from "./BuilderPage";

/** Temporary page for setup steps that ship in later phases (voice, messaging, handoff, test, connect). */
export default function SetupStepPage() {
  const { id = "", step = "voice" } = useParams();
  const s = SETUP_STEPS.find((x) => x.key === step) ?? SETUP_STEPS[1];
  return (
    <div>
      <div className="flex h-14 items-center gap-3 border-b px-4 sm:px-6">
        <Button variant="ghost" size="icon" asChild><Link to={`/app/agents/${id}/build`} aria-label="Back"><ChevronLeft className="h-5 w-5" /></Link></Button>
        <p className="text-sm font-semibold">{s.label}</p>
        <div className="ml-auto"><SetupStepper agentId={id} current={s.key} /></div>
      </div>
      <div className="p-6">
        <EmptyState icon={Hammer} title={`${s.label} is being built`} description="This setup step arrives in the next phase. Your blueprint is saved — you can keep refining it." action={<Button asChild variant="outline"><Link to={`/app/agents/${id}/build`}>Back to builder</Link></Button>} />
      </div>
    </div>
  );
}
