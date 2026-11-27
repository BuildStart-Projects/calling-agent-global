import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Copy, Link2Off, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { callFunction, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { SetupShell } from "@/features/setup/SetupShell";
import { useChannelConfigs, useSaveChannel, type ChannelConfig } from "@/features/setup/hooks";

const EMOJI: Array<{ key: ChannelConfig["emoji_level"]; label: string; sample: string }> = [
  { key: "none", label: "No emojis", sample: "You're booked for Tuesday at 3:00 PM." },
  { key: "light", label: "Light", sample: "You're booked for Tuesday at 3:00 PM ✅" },
  { key: "expressive", label: "Expressive", sample: "🎉 You're booked! 📅 Tuesday · 3:00 PM ✨" },
];

export default function MessagingPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: cfg } = useChannelConfigs(id);
  const save = useSaveChannel(id);
  const m = cfg?.messaging;
  const [welcome, setWelcome] = useState("");
  const [emoji, setEmoji] = useState<ChannelConfig["emoji_level"]>("light");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (m) { setWelcome((w) => w || m.welcome_message || ""); setEmoji(m.emoji_level); } }, [m]);

  const useSame = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("use_same_info_for_messaging", { p_agent: id });
    if (!error) await callFunction("agent-compile", { agent_id: id }).catch(() => null);
    setBusy(false);
    if (error) return toast.error("Couldn't copy the information.");
    qc.invalidateQueries({ queryKey: ["channel-configs", id] });
    toast.success("Messaging Agent is set up", { description: "It uses the same information as your Calling Agent." });
  };

  const onContinue = async () => {
    setBusy(true);
    try {
      await save("messaging", { welcome_message: welcome || null, emoji_level: emoji });
      await callFunction("agent-compile", { agent_id: id });
      navigate(`/app/agents/${id}/handoff`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!m) return <SetupShell agentId={id} step="messaging" title="Messaging Agent"><Skeleton className="h-72 rounded-2xl" /></SetupShell>;

  return (
    <SetupShell
      agentId={id} step="messaging" title="Set up your Messaging Agent"
      description="It replies to WhatsApp messages around the clock, using the same knowledge as your Calling Agent."
      footer={m.synced_from_calling ? <Button size="lg" onClick={onContinue} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue</Button> : undefined}
    >
      {!m.synced_from_calling ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow"><MessageCircle className="h-7 w-7" /></div>
          <h2 className="mt-5 text-xl font-semibold">One click and you're done</h2>
          <p className="mt-2 max-w-md text-muted-foreground">Your Messaging Agent can use everything you've told your Calling Agent — services, prices, hours, FAQs and policies.</p>
          <Button size="lg" className="mt-6" onClick={useSame} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Use the same information for the Messaging Agent</Button>
          <button onClick={() => navigate(`/app/knowledge`)} className="mt-3 text-sm text-muted-foreground hover:text-foreground">Customise separately in Knowledge</button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="flex items-center gap-2 rounded-xl border bg-card p-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"><Copy className="h-3 w-3" />Synced with Calling Agent</span>
            <span className="text-sm text-muted-foreground">Changes in Knowledge apply to both.</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={async () => { await save("messaging", { synced_from_calling: false }); }}><Link2Off className="mr-1 h-3.5 w-3.5" />Unlink</Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="welcome">Welcome message for new customers</Label>
            <Textarea id="welcome" value={welcome} onChange={(e) => setWelcome(e.target.value)} rows={2} placeholder="Written for you in your language when you continue" />
            <p className="text-xs text-muted-foreground">Sent once, naturally combined with the answer to their first question.</p>
          </div>
          <div>
            <Label>Emojis</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {EMOJI.map((e) => (
                <button key={e.key} onClick={() => setEmoji(e.key)} className={cn("rounded-xl border p-3 text-left", emoji === e.key ? "border-brand-500 bg-accent" : "hover:bg-muted")}>
                  <p className="text-sm font-medium">{e.label}</p>
                  <p className="mt-1.5 rounded-lg bg-[#dcf8c6] px-2.5 py-1.5 text-xs text-neutral-800">{e.sample}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </SetupShell>
  );
}
