import Mustache from "npm:mustache@4.2.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Prompts are plain text, never HTML: disable Mustache escaping.
Mustache.escape = (s: string) => s;

export function render(template: string, vars: Record<string, unknown>): string {
  return Mustache.render(template, vars).replace(/\n{3,}/g, "\n\n").trim();
}

const cache = new Map<string, { body: string; version: number; at: number }>();

/** Loads the active version of a prompt template (cached 60 s per isolate). */
export async function template(db: SupabaseClient, key: string): Promise<{ body: string; version: number }> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const { data } = await db.from("prompt_templates").select("body,version").eq("key", key).eq("active", true).maybeSingle();
  const v = { body: data?.body ?? "", version: data?.version ?? 0, at: Date.now() };
  cache.set(key, v);
  return v;
}
