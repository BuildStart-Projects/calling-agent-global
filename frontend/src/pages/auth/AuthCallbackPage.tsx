import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { FullPageSpinner } from "@/components/common/FullPageSpinner";
import { AuthShell } from "@/features/auth/AuthShell";

/** Handles email-confirmation and OAuth redirects, then applies stashed locale defaults for new Google users. */
export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const next = params.get("next") || "/app";
    const errDesc = params.get("error_description");
    if (errDesc) { setFailed(errDesc); return; }
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      const stash = sessionStorage.getItem("bs.signup.locale");
      if (stash) {
        sessionStorage.removeItem("bs.signup.locale");
        try { await supabase.rpc("apply_locale_defaults", { p_locale: JSON.parse(stash) }); } catch { /* non-blocking */ }
      }
      navigate(next, { replace: true });
    };
    supabase.auth.getSession().then(({ data }) => { if (data.session) finish(); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (s) finish(); });
    const timeout = setTimeout(() => { if (!done) setFailed("This link is invalid or has expired."); }, 8000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(timeout); };
  }, [navigate, params]);

  if (failed) {
    return (
      <AuthShell title="We couldn't sign you in" subtitle={failed}>
        <Link to="/login" className="font-medium text-brand-700 hover:underline">Back to log in</Link>
      </AuthShell>
    );
  }
  return <FullPageSpinner />;
}
