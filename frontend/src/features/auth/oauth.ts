import { supabase } from "@/lib/supabase";
import { detectLocaleDefaults } from "./AuthShell";

/** Starts Google OAuth. Locale defaults are stashed so the callback can apply them to a new workspace. */
export async function signInWithGoogle(next = "/app"): Promise<string | null> {
  sessionStorage.setItem("bs.signup.locale", JSON.stringify(detectLocaleDefaults()));
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  return error ? error.message : null;
}
