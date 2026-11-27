import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export async function enforceRateLimit(db: SupabaseClient, key: string, limit: number, windowSeconds: number, message = "Too many requests. Please wait a moment.") {
  const { data, error } = await db.rpc("hit_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) return; // fail open on limiter errors; abuse controls are layered
  if (data === false) throw new HttpError(429, "rate_limited", message);
}
