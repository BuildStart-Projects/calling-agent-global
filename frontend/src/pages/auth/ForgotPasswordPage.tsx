import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/features/auth/AuthShell";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure link." footer={<Link to="/login" className="font-medium text-brand-700 hover:underline">Back to log in</Link>}>
      {sent ? (
        <div className="flex flex-col items-center rounded-2xl border bg-brand-50/50 p-8 text-center">
          <MailCheck className="h-10 w-10 text-brand-600" />
          <p className="mt-4 text-sm text-neutral-600">If an account exists for <span className="font-medium text-ink">{email}</span>, a reset link is on its way.</p>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true); setError(null);
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
            setLoading(false);
            if (error) setError(error.message); else setSent(true);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
          </div>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button className="h-11 w-full" disabled={loading || !email}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
