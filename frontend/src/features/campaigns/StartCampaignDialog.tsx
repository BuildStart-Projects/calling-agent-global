// "Call these people": creates a draft campaign for chosen contacts and opens the wizard.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAgents } from "@/features/agents/useAgents";
import { manage, type AddResult } from "./api";

type Props = { contactIds: string[]; goal?: "lead_follow_up" | "custom"; label?: string; size?: "sm" | "default"; variant?: "default" | "outline"; onDone?: () => void };

export function StartCampaignButton({ contactIds, goal = "custom", label = "Call these", size = "sm", variant = "default", onDone }: Props) {
  const { data: agents } = useAgents();
  const callable = (agents ?? []).filter((a) => a.status !== "draft");
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const chosen = agentId || (callable.length === 1 ? callable[0]!.id : "");

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const { campaign } = await manage<{ campaign: { id: string } }>({ action: "draft", agent_id: chosen, goal_type: goal });
      const { added } = await manage<{ added: AddResult }>({ action: "add_contacts", campaign_id: campaign.id, contact_ids: contactIds });
      const skipped = added.invalid + added.dnc + added.duplicates;
      toast.success(`${added.added} contact${added.added === 1 ? "" : "s"} added${skipped ? ` · ${skipped} skipped (no mobile number or do-not-contact)` : ""}`);
      setOpen(false); onDone?.();
      nav(`/app/campaigns/${campaign.id}/edit`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <Button size={size} variant={variant} disabled={!contactIds.length} onClick={() => (callable.length === 1 ? start() : setOpen(true))}>
        {busy && !open ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Megaphone className="mr-1.5 h-3.5 w-3.5" />}{label}{contactIds.length ? ` (${contactIds.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Start a call campaign</DialogTitle>
            <DialogDescription>{callable.length ? `Your AI will call ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}. You'll write the message and pick times next.` : "Finish setting up an agent first. Campaign calls are made by your Calling Agent."}</DialogDescription>
          </DialogHeader>
          {callable.length > 1 && (
            <div className="space-y-1.5"><Label>Which agent should call?</Label>
              <Select value={agentId} onValueChange={setAgentId}><SelectTrigger><SelectValue placeholder="Choose an agent" /></SelectTrigger><SelectContent>{callable.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={start} disabled={!chosen || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
