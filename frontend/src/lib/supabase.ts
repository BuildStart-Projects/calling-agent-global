import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || "http://localhost:54321", anonKey || "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Call an Edge Function with the user's JWT. Throws a readable Error on failure. */
export async function callFunction<T = unknown>(name: string, body?: unknown, init?: { method?: string }): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, {
    body: body as Record<string, unknown> | undefined,
    method: (init?.method as "POST" | "GET" | undefined) ?? "POST",
  });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const j = await ctx.json();
        message = j?.error?.message ?? message;
      }
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return data as T;
}
