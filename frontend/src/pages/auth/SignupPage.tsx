import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider, detectLocaleDefaults } from "@/features/auth/AuthShell";
import { signInWithGoogle } from "@/features/auth/oauth";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0..4
}

export default function SignupPage() {
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const score = useMemo(() => strength(password), [password]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    setLoading(true);
    const locale = detectLocaleDefaults();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/app/new`,
        data: { full_name: name.trim(), ...locale, plan_intent: params.get("plan") },
      },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    if (data.session) return; // email confirmation disabled → AuthProvider redirects
    setSentTo(email.trim());
    startCooldown();
  };

  const startCooldown = () => {
    setCooldown(45);
    const t = setInterval(() => setCooldown((c) => { if (c <= 1) { clearInterval(t); return 0; } return c - 1; }), 1000);
  };

  if (sentTo) {
    return (
      <AuthShell title="Check your inbox" subtitle={<>We sent a confirmation link to <span className="font-medium text-ink">{sentTo}</span>.</>}>
        <div className="flex flex-col items-center rounded-2xl border bg-brand-50/50 p-8 text-center">
          <MailCheck className="h-10 w-10 text-brand-600" />
          <p className="mt-4 text-sm text-neutral-600">Click the link in the email to activate your account. It can take a minute to arrive — check spam too.</p>
          <Button
            variant="outline"
            className="mt-6"
            disabled={cooldown > 0}
            onClick={async () => {
              const { error } = await supabase.auth.resend({ type: "signup", email: sentTo, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app/new` } });
              if (error) toast.error(error.message); else { toast.success("Email sent again"); startCooldown(); }
            }}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
          </Button>
        </div>
        <p className="mt-6 text-center text-sm text-neutral-600">Wrong email? <button className="font-medium text-brand-700 hover:underline" onClick={() => setSentTo(null)}>Go back</button></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your AI agent"
      subtitle="Free to start — no card required."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Log in</Link></>}
    >
      <GoogleButton
        label="Sign up with Google"
        loading={google}
        onClick={async () => {
          setGoogle(true);
          const err = await signInWithGoogle("/app/new");
          if (err) { setGoogle(false); toast.error(err); }
        }}
      />
      <OrDivider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input id="password" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 pr-10" />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {password && (
            <div className="flex items-center gap-2 pt-1">
              <div className="grid flex-1 grid-cols-4 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={cn("h-1 rounded-full", i < score ? (score >= 3 ? "bg-brand-500" : "bg-warning") : "bg-neutral-200")} />
                ))}
              </div>
              <span className="text-xs text-neutral-500">{["Too short", "Weak", "Okay", "Good", "Strong"][score]}</span>
            </div>
          )}
        </div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="h-11 w-full" disabled={loading || !email || !password}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create account
        </Button>
        <p className="text-center text-xs text-neutral-500">
          By continuing you agree to our <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
