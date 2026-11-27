import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, Phone, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callFunction } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { SetupShell } from "@/features/setup/SetupShell";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";

type Msg = { id: number; me: boolean; text: string; note?: string };
const SUGGESTIONS = ["Hi! What services do you offer?", "How much does it cost?", "What's the weather today?", "Can I talk to a person?"];

export default function TestPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: k } = useAgentKnowledge(id);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  const send = async (value?: string) => {
    const t = (value ?? text).trim();
    if (!t || busy) return;
    setText("");
    setMsgs((m) => [...m, { id: Date.now(), me: true, text: t }]);
    setBusy(true);
    try {
      const r = await callFunction<{ reply: string; refused: boolean; actions: string[] }>("playground-chat", { agent_id: id, message: t });
      const note = r.refused ? "Off-topic → fixed reply" : r.actions.includes("handoff_to_human") ? "Would alert you on WhatsApp" : r.actions.includes("capture_lead") ? "Saved as a lead" : undefined;
      setMsgs((m) => [...m, { id: Date.now() + 1, me: false, text: r.reply, note }]);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <SetupShell
      agentId={id} step="test" title="Try your agent"
      description="Chat exactly like a customer would on WhatsApp. Nothing is sent to real customers."
      footer={<Button size="lg" onClick={() => navigate(`/app/agents/${id}/connect`)}>Connect WhatsApp</Button>}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="overflow-hidden rounded-2xl border shadow-soft">
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">{(k?.blueprint.business?.name ?? "B")[0]}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{k?.blueprint.business?.name ?? "Your business"}</p><p className="text-xs text-white/70">{busy ? "typing…" : "online"}</p></div>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" aria-label="Restart test" onClick={async () => { await callFunction("playground-chat", { agent_id: id, reset: true }); setMsgs([]); }}><RotateCcw className="h-4 w-4" /></Button>
          </div>
          <div className="h-[420px] space-y-2 overflow-y-auto bg-[#efeae2] p-4 dark:bg-[#0b141a]">
            {msgs.length === 0 && <p className="mx-auto mt-24 max-w-xs rounded-lg bg-white/80 p-3 text-center text-xs text-neutral-600 dark:bg-white/10 dark:text-white/70">Send a message to see how your agent replies.</p>}
            <AnimatePresence initial={false}>
              {msgs.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex flex-col", m.me ? "items-end" : "items-start")}>
                  <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm", m.me ? "bg-[#d9fdd3] text-neutral-900 dark:bg-[#005c4b] dark:text-white" : "bg-white text-neutral-900 dark:bg-[#202c33] dark:text-white")}>
                    {m.text.split(/(\*[^*]+\*)/g).map((part, i) => part.startsWith("*") && part.endsWith("*") ? <b key={i}>{part.slice(1, -1)}</b> : part)}
                  </div>
                  {m.note && <span className="mt-1 rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-white/10 dark:text-white/70">{m.note}</span>}
                </motion.div>
              ))}
            </AnimatePresence>
            {busy && <div className="w-fit rounded-lg bg-white px-3 py-2 dark:bg-[#202c33]"><Loader2 className="h-4 w-4 animate-spin text-neutral-500" /></div>}
            <div ref={end} />
          </div>
          <div className="flex flex-wrap gap-1.5 border-t bg-background px-3 pt-2">
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-accent">{s}</button>)}
          </div>
          <div className="flex gap-2 bg-background p-3">
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Type a message" className="h-11" />
            <Button size="icon" className="h-11 w-11 rounded-full" onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send"><ArrowUp className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-5">
            <ShieldCheck className="h-5 w-5 text-brand-600" />
            <p className="mt-3 font-semibold">It only says what you told it</p>
            <p className="mt-1 text-sm text-muted-foreground">Prices and times are checked against your information before each reply is sent. Unrelated questions get a polite fixed answer.</p>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <Phone className="h-5 w-5 text-brand-600" />
            <p className="mt-3 font-semibold">Test a call</p>
            <p className="mt-1 text-sm text-muted-foreground">{k?.agent.wa_phone ? <>Call <b className="text-foreground">{k.agent.wa_phone}</b> on WhatsApp from another phone.</> : "After connecting WhatsApp, call your number from another phone to hear your agent."}</p>
          </div>
        </div>
      </div>
    </SetupShell>
  );
}
