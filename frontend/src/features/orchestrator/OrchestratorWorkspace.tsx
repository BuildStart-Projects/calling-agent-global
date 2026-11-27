import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutPanelLeft } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";
import { BlueprintPanel } from "@/features/blueprint/BlueprintPanel";
import { useDocumentUpload } from "@/features/documents/useDocumentUpload";
import { OrchestratorChat } from "./OrchestratorChat";
import { useOrchestrator, type OrchestratorMode } from "./useOrchestrator";

type Props = {
  agentId: string;
  mode: OrchestratorMode;
  placeholder?: string;
  starterChips?: string[];
  renderDone?: (info: NonNullable<ReturnType<typeof useOrchestrator>["done"]>) => React.ReactNode;
  onOpenVoice?: () => void;
};

/** Chat on the left, live blueprint on the right (desktop/tablet); chat + bottom drawer on phones. */
export function OrchestratorWorkspace({ agentId, mode, placeholder, starterChips, renderDone, onOpenVoice }: Props) {
  const { workspace } = useAuth();
  const isMobile = useIsMobile();
  const orch = useOrchestrator(agentId, mode);
  const { data: k } = useAgentKnowledge(agentId);
  const uploads = useDocumentUpload(agentId, workspace?.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenPatches, setSeenPatches] = useState(0);
  const lastRetry = orch.messages.filter((m) => m.role === "user").at(-1);

  const chat = (
    <OrchestratorChat
      messages={orch.messages}
      streaming={orch.streaming}
      stream={orch.stream}
      readiness={orch.readiness}
      done={orch.done}
      error={orch.error}
      onSend={(t, a) => orch.send(t, a)}
      onRetry={() => { orch.clearError(); void orch.send(lastRetry?.content ?? null); }}
      uploads={uploads}
      placeholder={placeholder}
      starterChips={starterChips}
      showQuestionCounter={mode === "onboarding"}
      doneCard={orch.done && renderDone ? renderDone(orch.done) : null}
    />
  );
  const panel = <BlueprintPanel k={k} patchedPaths={orch.patchedPaths} readiness={orch.readiness} onOpenVoice={onOpenVoice} />;
  const unseen = Math.max(0, Object.keys(orch.patchedPaths).length - seenPatches);

  if (isMobile) {
    return (
      <div className="relative h-full">
        {chat}
        <AnimatePresence>
          {Object.keys(orch.patchedPaths).length > 0 && (
            <motion.button
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              onClick={() => { setDrawerOpen(true); setSeenPatches(Object.keys(orch.patchedPaths).length); }}
              className="absolute bottom-36 right-4 z-10 flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-background shadow-lg"
            >
              <LayoutPanelLeft className="h-4 w-4" />Blueprint{unseen > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-xs text-white">{unseen} new</span>}
            </motion.button>
          )}
        </AnimatePresence>
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent className="h-[85dvh]">
            <DrawerTitle className="sr-only">Blueprint</DrawerTitle>
            <div className="min-h-0 flex-1">{panel}</div>
          </DrawerContent>
        </Drawer>
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full" autoSaveId={`bs-orch-${mode}`}>
      <ResizablePanel defaultSize={52} minSize={36} className="min-w-0">{chat}</ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={48} minSize={32} className="min-w-0 bg-muted/30">{panel}</ResizablePanel>
    </ResizablePanelGroup>
  );
}
