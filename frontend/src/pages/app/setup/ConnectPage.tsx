import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Info, Loader2, MoreVertical, PartyPopper, RefreshCw, Smartphone } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { callFunction } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { SetupShell } from "@/features/setup/SetupShell";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";

type Status = { state: "not_connected" | "qr" | "connecting" | "connected" | "expired"; qr?: string; phone?: string };

export default function ConnectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { emailVerified } = useAuth();
  const { data: k } = useAgentKnowledge(id);
  const [status, setStatus] = useState<Status | null>(null);
  const [starting, setStarting] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [live, setLive] = useState(false);
  const startedAt = useRef(0);
  const timer = useRef<number>();

  const poll = useCallback(async () => {
    try {
      const s = await callFunction<Status>("wa-connect", { agent_id: id, action: "status" });
      if (Date.now() - startedAt.current > 180_000 && s.state !== "connected") { setStatus({ state: "expired" }); return; }
      setStatus(s);
      if (s.state === "connected") { qc.invalidateQueries({ queryKey: ["knowledge", id] }); qc.invalidateQueries({ queryKey: ["agents"] }); return; }
    } catch { /* keep polling */ }
    timer.current = window.setTimeout(poll, 2000);
  }, [id, qc]);

  useEffect(() => {
    if (k?.agent.wa_status === "connected") setStatus({ state: "connected", phone: k.agent.wa_phone ?? undefined });
    if (k?.agent.status === "live") setLive(true);
  }, [k?.agent.wa_status, k?.agent.wa_phone, k?.agent.status]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = async (action: "start" | "regenerate") => {
    setStarting(true);
    try {
      const s = await callFunction<Status>("wa-connect", { agent_id: id, action });
      startedAt.current = Date.now();
      setStatus(s);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(poll, 2000);
    } catch (e) { toast.error((e as Error).message); } finally { setStarting(false); }
  };

  const goLive = async () => {
    setGoingLive(true);
    try { await callFunction("agent-control", { agent_id: id, action: "go_live" }); setLive(true); qc.invalidateQueries({ queryKey: ["agents"] }); }
    catch (e) { toast.error((e as Error).message); } finally { setGoingLive(false); }
  };

  return (
    <SetupShell agentId={id} step="connect" title="Connect your WhatsApp" description="Link the WhatsApp number your customers already use — just like WhatsApp Web.">
      {!emailVerified && <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">Verify your email first — check your inbox for the confirmation link.</div>}
      <AnimatePresence mode="wait">
        {live ? (
          <motion.div key="live" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="relative overflow-hidden rounded-3xl border bg-card p-10 text-center shadow-glow">
            <div className="pointer-events-none absolute inset-0 bg-brand-radial" />
            <PartyPopper className="relative mx-auto h-12 w-12 text-brand-600" />
            <h2 className="relative mt-4 text-3xl font-semibold">Your agent is live 🎉</h2>
            <p className="relative mt-2 text-muted-foreground">It's answering calls and messages on {status?.phone ?? k?.agent.wa_phone}.</p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" onClick={() => navigate("/app")}>Go to dashboard</Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/app/knowledge")}>Add more knowledge</Button>
            </div>
          </motion.div>
        ) : status?.state === "connected" ? (
          <motion.div key="connected" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center rounded-3xl border bg-card p-10 text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260 }}><CheckCircle2 className="h-14 w-14 text-brand-500" /></motion.div>
            <h2 className="mt-4 text-2xl font-semibold">Connected as {status.phone}</h2>
            <p className="mt-2 max-w-md text-muted-foreground">Everything's ready. Go live to start answering calls and messages.</p>
            <Button size="lg" className="mt-6 bg-brand-gradient text-white shadow-glow hover:opacity-95" onClick={goLive} disabled={goingLive}>{goingLive && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Go live</Button>
          </motion.div>
        ) : (
          <motion.div key="qr" className="grid gap-8 rounded-3xl border bg-card p-6 sm:p-10 md:grid-cols-[300px_1fr]">
            <div className="flex flex-col items-center">
              <div className="relative flex h-[280px] w-[280px] items-center justify-center rounded-2xl border-2 border-brand-500/40 bg-white p-4">
                {status?.state === "qr" && status.qr ? (
                  <motion.div key={status.qr} initial={{ opacity: 0 }} animate={{ opacity: 1 }}><QRCodeSVG value={status.qr} size={240} level="M" /></motion.div>
                ) : status?.state === "expired" ? (
                  <div className="text-center text-sm text-neutral-600"><p className="font-medium">QR code expired</p><Button size="sm" className="mt-3" onClick={() => start("regenerate")}><RefreshCw className="mr-1 h-3.5 w-3.5" />New code</Button></div>
                ) : status?.state === "connecting" ? (
                  <div className="text-center text-sm text-neutral-600"><Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" /><p className="mt-3">Linking… keep WhatsApp open</p></div>
                ) : (
                  <Button size="lg" onClick={() => start("start")} disabled={starting || !emailVerified}>{starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Show QR code</Button>
                )}
              </div>
              {status?.state === "qr" && <p className="mt-3 text-xs text-muted-foreground">The code refreshes automatically</p>}
            </div>
            <div>
              <ol className="space-y-5">
                {[
                  [Smartphone, <>Open <b>WhatsApp</b> or <b>WhatsApp Business</b> on the phone for this number</>],
                  [MoreVertical, <>Tap <b>⋮ / Settings → Linked devices</b></>],
                  [CheckCircle2, <>Tap <b>Link a device</b> and scan this code</>],
                ].map(([Icon, t], i) => {
                  const I = Icon as typeof Smartphone;
                  return <li key={i} className="flex gap-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white">{i + 1}</span><span className="pt-1"><I className="mr-1.5 inline h-4 w-4 text-muted-foreground" />{t as React.ReactNode}</span></li>;
                })}
              </ol>
              <div className="mt-8 flex gap-3 rounded-xl bg-muted/60 p-4 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <ul className="space-y-1 text-muted-foreground">
                  <li>Your AI will answer calls and messages on this number, and can place campaign calls from it.</li>
                  <li>Keep your phone online at least every few days so it stays linked.</li>
                  <li>Messages you send from your phone pause the AI for that chat.</li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </SetupShell>
  );
}
