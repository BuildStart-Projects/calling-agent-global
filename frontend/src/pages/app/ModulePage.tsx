import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { PageBody } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";

/** Fallback for unknown /app/* paths. */
export default function ModulePage() {
  return (
    <PageBody className="pt-10">
      <EmptyState icon={Wrench} title="Page not found" description="This section doesn't exist." action={<Button asChild><Link to="/app">Back to dashboard</Link></Button>} />
    </PageBody>
  );
}
