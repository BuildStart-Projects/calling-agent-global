// All text AI (Orchestrator, Messaging Agent, extraction, summaries, translations) goes through the
// Lovable-hosted `ai-generate` transport (Gemini models), same as Local CRM:
//   POST AI_GENERATE_URL  header x-bot-key: BOT_API_KEY  body { model, messages, maxTokens, temperature }
//   → { text, model, finishReason, usage: { promptTokens, completionTokens } }
// The transport has no native function calling or streaming, so agents use a JSON action protocol (see json-agent.ts).
// The Calling Agent is NOT here — it runs on Gemini Live inside the Go engine.

import { HttpError } from "./http.ts";

export type Usage = { input_tokens: number; output_tokens: number; estimated: boolean };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const MODELS = {
  orchestrator: "google/gemini-3-flash-preview",
  messaging: "google/gemini-3-flash-preview",
  extractor: "google/gemini-2.5-flash-lite",
  summarizer: "google/gemini-3-flash-preview",
  light: "google/gemini-2.5-flash-lite",
} as const;

export async function aiGenerate(p: { model: string; messages: ChatMessage[]; maxTokens?: number; temperature?: number; timeoutMs?: number }): Promise<{ text: string; usage: Usage; finishReason: string }> {
  const url = Deno.env.get("AI_GENERATE_URL");
  const key = Deno.env.get("BOT_API_KEY");
  if (!url || !key) throw new HttpError(503, "llm_unconfigured", "AI is not configured.");

  // Thinking models (2.5-flash / pro) spend part of the budget on reasoning; keep a floor so replies aren't empty.
  const maxTokens = Math.max(p.maxTokens ?? 800, /flash-lite/.test(p.model) ? 64 : 512);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), p.timeoutMs ?? 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-key": key },
        body: JSON.stringify({ model: p.model, messages: p.messages, maxTokens, temperature: p.temperature ?? 0.3 }),
        signal: ctl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(res.status === 429 ? 429 : 502, "llm_busy", "AI is busy. Please retry in a moment.");
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1) ** 2));
        continue;
      }
      if (!res.ok) throw new HttpError(502, "llm_error", `AI request failed (${res.status}).`);
      const j = await res.json();
      const usage: Usage = j.usage
        ? { input_tokens: j.usage.promptTokens ?? 0, output_tokens: j.usage.completionTokens ?? 0, estimated: false }
        : { input_tokens: estimateTokens(p.messages.map((m) => m.content).join("\n")), output_tokens: estimateTokens(j.text ?? ""), estimated: true };
      return { text: String(j.text ?? ""), usage, finishReason: String(j.finishReason ?? "") };
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status !== 502) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof HttpError ? lastErr : new HttpError(502, "llm_unreachable", "Couldn't reach the AI. Please try again.");
}

export function addUsage(a: Usage, b: Usage): Usage {
  return { input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, estimated: a.estimated || b.estimated };
}

/** Parses the first JSON object in a model reply (tolerates ``` fences and leading prose). */
export function parseJsonObject<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { /* ignore */ }
  }
  return null;
}

/** Rough fallback when a provider omits usage (≈4 chars/token). */
export function estimateTokens(s: string): number {
  return Math.ceil((s?.length ?? 0) / 4);
}
