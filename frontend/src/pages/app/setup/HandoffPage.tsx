import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callFunction, supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { SetupShell } from "@/features/setup/SetupShell";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";

export default function HandoffPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { workspace } = useAuth();
  const { data: k } = useAgentKnowledge(id);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // Load the saved number once; after that the field belongs to the user (clearing it must not refill it).
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !k) return;
    loaded.current = true;
    const saved = k.agent.handoff_phone_e164;
    if (saved) setPhone(parsePhoneNumberFromString(saved)?.formatInternational() ?? saved);
  }, [k]);

  const parsed = parsePhoneNumberFromString(phone, (workspace?.country ?? undefined) as CountryCode | undefined);
  const valid = Boolean(parsed?.isValid());
  const connected = k?.agent.wa_status === "connected";

  const saveNumber = async (thenContinue: boolean) => {
    if (!valid) return toast.error("Enter a valid phone number with country code.");
    setSaving(true);
    const { error } = await supabase.rpc("set_handoff_phone", { p_agent: id, p_phone: parsed!.number });
    setSaving(false);
    if (error) return toast.error(error.message.includes("same_as_agent_number") ? "Use a different number than your business WhatsApp." : "Couldn't save the number.");
    qc.invalidateQueries({ queryKey: ["knowledge", id] });
    if (thenContinue) navigate(`/app/agents/${id}/test`); else toast.success("Saved");
  };

  return (
    <SetupShell
      agentId={id} step="handoff" title="Where should we alert you?"
      description="When a customer asks to talk to a person, your agent sends a WhatsApp alert to this number with their details and a summary."
      footer={<>
        <Button variant="ghost" onClick={() => navigate(`/app/agents/${id}/test`)}>Skip for now</Button>
        <Button size="lg" onClick={() => saveNumber(true)} disabled={saving || !valid}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save & continue</Button>
      </>}
    >
      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="phone">Your personal WhatsApp number</Label>
            <Input id="phone" className="h-12 text-lg tabular" value={phone} placeholder="+1 415 555 0123" inputMode="tel" autoComplete="tel"
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s().-]/g, "").slice(0, 32))}
              onBlur={() => { if (parsed?.isValid()) setPhone(parsed.formatInternational()); }} />
            <p className="text-xs text-muted-foreground">{phone && !valid ? "That doesn't look like a complete number yet." : "Must be different from the business number your agent uses."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            {k?.agent.handoff_verified_at ? <CheckCircle2 className="h-5 w-5 text-brand-500" /> : <Send className="h-5 w-5 text-muted-foreground" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{k?.agent.handoff_verified_at ? "Test alert delivered" : "Send a test alert"}</p>
              <p className="text-muted-foreground">{connected ? "We'll send it from your agent's WhatsApp number." : "Available after you connect WhatsApp."}</p>
            </div>
            <Button variant="outline" size="sm" disabled={!connected || testing || !k?.agent.handoff_phone_e164} onClick={async () => {
              setTesting(true);
              try { await callFunction("handoff-test", { agent_id: id }); toast.success("Test alert sent — check your WhatsApp"); qc.invalidateQueries({ queryKey: ["knowledge", id] }); }
              catch (e) { toast.error((e as Error).message); } finally { setTesting(false); }
            }}>{testing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Send test</Button>
          </div>
        </div>
        <div className="rounded-2xl bg-[#0b141a] p-4 text-sm text-white shadow-soft">
          <p className="mb-3 flex items-center gap-2 text-xs text-white/60"><BellRing className="h-3.5 w-3.5" />Example alert</p>
          <div className="rounded-xl bg-[#005c4b] p-3 leading-relaxed">
            🙋 <b>Customer wants to talk to a person</b><br />From: Sarah (+44 7700 900123)<br />Via: WhatsApp chat<br />Reason: Wants to discuss a custom colour<br />Reply: wa.me/447700900123
          </div>
        </div>
      </div>
    </SetupShell>
  );
}
