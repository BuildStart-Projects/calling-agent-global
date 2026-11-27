// Settings: business details, profile & theme, sign-in & security, support, data export, delete workspace.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Download, Loader2, Mail, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { supabase, callFunction } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { useSupportContacts } from "@/features/account/AccountGuards";
import { CurrencySelect } from "@/components/common/CurrencySelect";

const TIMEZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; } })();
const COUNTRIES: Array<{ code: string; name: string }> = (() => {
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  const out: Array<{ code: string; name: string }> = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    try { const name = dn.of(code); if (name && name !== code && !/^[A-Z]{2}$/.test(name) && !["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"].includes(code)) out.push({ code, name }); } catch { /* not a region */ }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
})();

function Section({ title, description, children, danger }: { title: string; description?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={danger ? "rounded-xl border border-destructive/40 bg-card p-5" : "rounded-xl border bg-card p-5"}>
      <h2 className={danger ? "font-semibold text-destructive" : "font-semibold"}>{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="space-y-1.5"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
);

export default function SettingsPage() {
  const { workspace, user, role, refresh, emailVerified } = useAuth();
  const canEdit = role === "owner" || role === "admin";
  return (
    <>
      <PageHeader title="Settings" description="Your business, your profile and your account." />
      <PageBody className="grid max-w-3xl gap-5 pb-10">
        {workspace && <BusinessSection key={workspace.id} canEdit={canEdit} onSaved={refresh} />}
        {user && <ProfileSection />}
        {user && <SecuritySection email={user.email ?? ""} verified={emailVerified} providers={(user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider ?? "email"]} />}
        <SupportSection />
        <DataSection />
        {role === "owner" && workspace && <DangerSection name={workspace.name} />}
      </PageBody>
    </>
  );
}

function BusinessSection({ canEdit, onSaved }: { canEdit: boolean; onSaved: () => void }) {
  const { workspace } = useAuth();
  const [f, setF] = useState({ name: workspace!.name, country: workspace!.country ?? "", timezone: workspace!.timezone, currency: workspace!.currency, notify_email: workspace!.notify_email ?? "" });
  const [busy, setBusy] = useState(false);
  const dirty = f.name !== workspace!.name || f.country !== (workspace!.country ?? "") || f.timezone !== workspace!.timezone || f.currency !== workspace!.currency || f.notify_email !== (workspace!.notify_email ?? "");
  const save = async () => {
    if (!f.name.trim()) return toast.error("Business name can't be empty.");
    if (f.notify_email && !/^\S+@\S+\.\S+$/.test(f.notify_email)) return toast.error("That alert email doesn't look right.");
    setBusy(true);
    const { error } = await supabase.from("workspaces").update({ name: f.name.trim().slice(0, 120), country: f.country || null, timezone: f.timezone, currency: f.currency, notify_email: f.notify_email.trim() || null }).eq("id", workspace!.id);
    setBusy(false);
    if (error) toast.error("Couldn't save. Please try again."); else { toast.success("Saved"); onSaved(); }
  };
  return (
    <Section title="Business" description={canEdit ? "Used on invoices, in your agents' greetings and for scheduling." : "Only the owner or an admin can change these."}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name"><Input value={f.name} disabled={!canEdit} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Country">
          <Select value={f.country || undefined} disabled={!canEdit} onValueChange={(v) => setF({ ...f, country: v })}>
            <SelectTrigger><SelectValue placeholder="Choose your country" /></SelectTrigger>
            <SelectContent className="max-h-72">{COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Time zone" hint="Campaign calling windows and reports use this.">
          <Select value={f.timezone} disabled={!canEdit} onValueChange={(v) => setF({ ...f, timezone: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">{(TIMEZONES.includes(f.timezone) ? TIMEZONES : [f.timezone, ...TIMEZONES]).map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Default currency" hint="Used for new agents. Each agent's prices can use its own currency in Knowledge.">
          <CurrencySelect value={f.currency} disabled={!canEdit} onChange={(v) => setF({ ...f, currency: v })} />
        </Field>
        <Field label="Alert email (optional)" hint="Where we send billing and account alerts. Defaults to your sign-in email.">
          <Input type="email" value={f.notify_email} disabled={!canEdit} placeholder="owner@yourbusiness.com" onChange={(e) => setF({ ...f, notify_email: e.target.value })} />
        </Field>
      </div>
      {canEdit && <Button className="mt-4" disabled={!dirty || busy} onClick={save}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button>}
    </Section>
  );
}

function ProfileSection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { data: profile } = useQuery({
    queryKey: ["profile", user!.id],
    queryFn: async () => (await supabase.from("profiles").select("full_name,theme_pref,marketing_opt_in").eq("id", user!.id).maybeSingle()).data as { full_name: string | null; theme_pref: string; marketing_opt_in: boolean } | null,
  });
  const [name, setName] = useState("");
  useEffect(() => { if (profile) setName(profile.full_name ?? ""); }, [profile]);
  const patch = async (p: Record<string, unknown>, msg?: string) => {
    const { error } = await supabase.from("profiles").update(p).eq("id", user!.id);
    if (error) toast.error("Couldn't save."); else { if (msg) toast.success(msg); qc.invalidateQueries({ queryKey: ["profile", user!.id] }); }
  };
  return (
    <Section title="Your profile">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <div className="flex gap-2"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /><Button variant="outline" disabled={name === (profile?.full_name ?? "")} onClick={() => patch({ full_name: name.trim() || null }, "Saved")}>Save</Button></div>
        </Field>
        <Field label="Appearance">
          <Select value={theme ?? "system"} onValueChange={(v) => { setTheme(v); patch({ theme_pref: v }); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="system">Match my device</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent>
          </Select>
        </Field>
      </div>
      <label className="mt-4 flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
        <span><span className="font-medium">Product news</span><span className="block text-xs text-muted-foreground">An occasional email about new features. No spam.</span></span>
        <Switch checked={Boolean(profile?.marketing_opt_in)} onCheckedChange={(v) => patch({ marketing_opt_in: v }, v ? "Subscribed" : "Unsubscribed")} />
      </label>
    </Section>
  );
}

function SecuritySection({ email, verified, providers }: { email: string; verified: boolean; providers: string[] }) {
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState<"pw" | "verify" | null>(null);
  const google = providers.includes("google");
  const hasPassword = providers.includes("email");
  const savePw = async () => {
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== pw2) return toast.error("The passwords don't match.");
    setBusy("pw");
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(null);
    if (error) toast.error(/reauth|recent/i.test(error.message) ? "For your security, sign out and sign in again, then change your password." : error.message);
    else { toast.success(hasPassword ? "Password changed" : "Password added. You can now also sign in with email."); setPw(""); setPw2(""); }
  };
  const resend = async () => {
    setBusy("verify");
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setBusy(null);
    if (error) toast.error(/rate|seconds/i.test(error.message) ? "Please wait a minute before asking for another email." : "Couldn't send the email. Please try again later."); else toast.success("Verification email sent. Check your inbox.");
  };
  return (
    <Section title="Sign-in & security">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <div>
          <p className="font-medium">{email}</p>
          <p className="text-xs text-muted-foreground">{[google && "Google", hasPassword && "Email & password"].filter(Boolean).join(" · ") || "Email"} · {verified ? <span className="text-success">Verified</span> : <span className="text-warning">Not verified</span>}</p>
        </div>
        {!verified && <Button size="sm" variant="outline" disabled={busy === "verify"} onClick={resend}>{busy === "verify" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Resend verification email</Button>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label={hasPassword ? "New password" : "Add a password"}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Confirm password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <Button variant="outline" disabled={!pw || busy === "pw"} onClick={savePw}>{busy === "pw" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{hasPassword ? "Change" : "Add"}</Button>
      </div>
    </Section>
  );
}

function SupportSection() {
  const { data } = useSupportContacts();
  const email = data?.email ?? "hello@buildstart.io";
  return (
    <Section title="Help & support" description="We're happy to help with setup, billing or anything else.">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><a href={`mailto:${email}`}><Mail className="mr-2 h-4 w-4" />{email}</a></Button>
        {data?.priority_whatsapp && <Button variant="outline" asChild><a href={`https://wa.me/${data.priority_whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"><MessageCircle className="mr-2 h-4 w-4" />Priority WhatsApp</a></Button>}
        {data?.onboarding_url && <Button variant="outline" asChild><a href={data.onboarding_url} target="_blank" rel="noreferrer">Book an onboarding call</a></Button>}
      </div>
    </Section>
  );
}

function DataSection() {
  const { workspace } = useAuth();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const data = await callFunction<Record<string, unknown>>("account", { action: "export" });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `buildstart-${(workspace?.name ?? "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Section title="Your data" description="Download your contacts, conversations, call summaries, bookings, orders, leads and knowledge as one file. Recordings aren't included.">
      <Button variant="outline" onClick={download} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Export my data</Button>
    </Section>
  );
}

function DangerSection({ name }: { name: string }) {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const match = useMemo(() => confirm.trim() === name.trim(), [confirm, name]);
  const del = async () => {
    setBusy(true);
    try { await callFunction("account", { action: "request_deletion", confirm_name: confirm, reason: reason.trim() || undefined }); setOpen(false); refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Section title="Delete workspace" danger description="Disconnects WhatsApp, stops your agents and campaigns, and cancels your subscription. Everything is permanently erased after 30 days. Until then, support can restore it.">
      <Button variant="destructive" onClick={() => setOpen(true)}><Trash2 className="mr-2 h-4 w-4" />Delete workspace</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{name}”?</DialogTitle>
            <DialogDescription>Your agents go offline straight away. Paid credits aren't refunded. Export your data first if you need it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={`Type ${name} to confirm`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
            <Field label="Why are you leaving? (optional)"><Textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} placeholder="It helps us improve" /></Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!match || busy} onClick={del}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete workspace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
