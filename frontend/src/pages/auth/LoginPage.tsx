import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, GoogleButton, OrDivider } from "@/features/auth/AuthShell";
import { signInWithGoogle } from "@/features/auth/oauth";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get("next") || "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match. Try again or reset your password." : error.message);
      return;
    }
    navigate(next, { replace: true });
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your AI agents."
      footer={<>New to BuildStart? <Link to="/signup" className="font-medium text-brand-700 hover:underline">Create an account</Link></>}
    >
      <GoogleButton
        loading={google}
        onClick={async () => {
          setGoogle(true);
          const err = await signInWithGoogle(next);
          if (err) { setGoogle(false); toast.error(err); }
        }}
      />
      <OrDivider />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs text-neutral-500 hover:text-ink">Forgot password?</Link>
          </div>
          <div className="relative">
            <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 pr-10" />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="h-11 w-full" disabled={loading || !email || !password}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Log in
        </Button>
      </form>
    </AuthShell>
  );
}
