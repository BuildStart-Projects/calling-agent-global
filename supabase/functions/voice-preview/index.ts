// Voice previews (≤10 words, any supported language) with the Calling Agent's Gemini Live model. Cached by hash.
// Also translates the preview text when the owner changes language. Both are billed to the Orchestrator.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { livePreviewPcm, pcmToWav, truncateWords, wordCount } from "../_shared/voice.ts";
import { render, template } from "../_shared/templating.ts";
import { PERSONA } from "../_shared/compiler.ts";
import { sha256 } from "../_shared/compiler.ts";
import { chargeUsage, hasCredits } from "../_shared/credits.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { publicUrl } from "../_shared/supabase.ts";
import { aiGenerate, MODELS } from "../_shared/llm.ts";

const Preview = z.object({
  voice: z.string().min(2).max(40),
  language: z.string().min(2).max(12),
  style: z.enum(["friendly", "professional", "energetic", "reassuring"]).default("friendly"),
  text: z.string().min(1).max(120),
  agent_id: z.string().uuid().optional(),
});
const Translate = z.object({
  action: z.literal("translate"),
  language: z.string().min(2).max(12),
  text: z.string().min(1).max(200),
  agent_id: z.string().uuid().optional(),
});

type Db = ReturnType<typeof serviceClient>;

serveHandler("voice-preview", async (req) => {
  const user = await requireUser(req);
  const raw = await readJson(req);
  const db = serviceClient();
  const { data: m } = await db.from("workspace_members").select("workspace_id, workspaces(plan_id, plans(limits))").eq("user_id", user.id).limit(1).maybeSingle();
  const workspaceId = m?.workspace_id as string | undefined;
  if (!workspaceId) throw new HttpError(403, "forbidden", "Workspace not found.");

  if ((raw as { action?: string })?.action === "translate") {
    const body = Translate.safeParse(raw);
    if (!body.success) throw new HttpError(400, "invalid", "Invalid translation request.");
    return json(req, await translate(db, user.id, workspaceId, body.data));
  }

  const body = Preview.safeParse(raw);
  if (!body.success) throw new HttpError(400, "invalid", "Invalid preview request.");
  const { voice, language, style } = body.data;
  const agentId = await ownAgent(db, workspaceId, body.data.agent_id);
  const text = body.data.text.trim().replace(/\s+/g, " ");
  if (wordCount(text, language) > 10) throw new HttpError(400, "too_long", "Previews are limited to 10 words.");

  const [{ data: v }, { data: lang }] = await Promise.all([
    db.from("voices").select("name").eq("name", voice).eq("active", true).maybeSingle(),
    db.from("languages").select("code,label").eq("code", language).eq("active", true).maybeSingle(),
  ]);
  if (!v || !lang) throw new HttpError(400, "invalid", "Unknown voice or language.");

  // Replaying an already generated preview costs nothing (no new AI work).
  const hash = await sha256([voice, language, style, text.toLowerCase()].join("|"));
  const { data: hit } = await db.from("voice_preview_cache").select("storage_path").eq("hash", hash).maybeSingle();
  if (hit) return json(req, { url: await signed(db, hit.storage_path), cached: true });

  if (!(await hasCredits(db, workspaceId, 0.1))) throw new HttpError(402, "out_of_credits", "You're out of credits. Top up or upgrade to preview more voices.");
  // Uncached previews are rate-limited per user per day (plan limit).
  const limit = Number((m as any)?.workspaces?.plans?.limits?.voice_preview_daily ?? 10);
  await enforceRateLimit(db, `voice-preview:${user.id}`, limit, 86_400, `You've reached today's preview limit (${limit}). Try again tomorrow or upgrade.`);

  const { data: models } = await db.from("platform_settings").select("value").eq("key", "models").maybeSingle();
  const model = (models?.value?.live_preview as string) ?? "models/gemini-3.1-flash-live-preview";
  const instruction = render((await template(db, "preview.voice")).body, { language_name: lang.label, persona_style_description: PERSONA[style] });
  const pcm = await livePreviewPcm({ model, voice, instruction, text });
  const path = `cache/${hash}.wav`;
  const up = await db.storage.from("voice-previews").upload(path, pcmToWav(pcm), { contentType: "audio/wav", upsert: true });
  if (up.error) throw new HttpError(500, "storage", "Couldn't save the preview.");
  await db.from("voice_preview_cache").upsert({ hash, storage_path: path, voice, language });
  await chargeUsage(db, { workspaceId, agentId, agentKind: "orchestrator", meter: "voice_preview", units: 1, refType: "voice_preview", refId: hash });
  return json(req, { url: await signed(db, path), cached: false });
});

/** Translates the preview text into the chosen language (≤10 words), billed as Orchestrator tokens. */
async function translate(db: Db, userId: string, workspaceId: string, p: z.infer<typeof Translate>) {
  const agentId = await ownAgent(db, workspaceId, p.agent_id);
  const { data: lang } = await db.from("languages").select("code,label").eq("code", p.language).eq("active", true).maybeSingle();
  if (!lang) throw new HttpError(400, "invalid", "Unknown language.");
  if (!(await hasCredits(db, workspaceId, 0.01))) throw new HttpError(402, "out_of_credits", "You're out of credits. Top up or upgrade to keep going.");
  await enforceRateLimit(db, `preview-translate:${userId}`, 40, 3600, "Too many translations. Please wait a few minutes.");

  const { data: models } = await db.from("platform_settings").select("value").eq("key", "models").maybeSingle();
  const model = (models?.value?.light as string) ?? MODELS.light;
  const system = render((await template(db, "preview.translate")).body, { language_name: `${lang.label} (${lang.code})` });
  const ask = async (extra = "") => {
    const res = await aiGenerate({ model, temperature: 0.2, maxTokens: 120, messages: [{ role: "system", content: system + extra }, { role: "user", content: p.text.trim() }] });
    await chargeUsage(db, { workspaceId, agentId, agentKind: "orchestrator", meter: "orchestrator_tokens", usage: res.usage, model, refType: "preview_translation", refId: agentId ?? undefined });
    // Keep only the first line, without wrapping quotes.
    const line = res.text.trim().split("\n").map((s) => s.trim()).find(Boolean) ?? "";
    return line.replace(/^["'“”‘’«»「」]+|["'“”‘’«»「」]+$/g, "").trim();
  };
  let text = await ask();
  if (!text) throw new HttpError(502, "translate_failed", "Couldn't translate right now. You can type the text yourself.");
  // Some scripts count more "words" than expected (e.g. Japanese particles): ask once for a shorter line, then hard-cap.
  if (wordCount(text, lang.code) > 10) text = (await ask(" Make it shorter: a brief greeting of about 6 words.")) || text;
  text = truncateWords(text, lang.code, 10);
  return { text, language: lang.code };
}

/** Returns the agent id only if it belongs to the caller's workspace (used to attribute usage). */
async function ownAgent(db: Db, workspaceId: string, agentId?: string): Promise<string | null> {
  if (!agentId) return null;
  const { data } = await db.from("agents").select("id").eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  return data?.id ?? null;
}

async function signed(db: Db, path: string) {
  const { data } = await db.storage.from("voice-previews").createSignedUrl(path, 3600);
  return publicUrl(data?.signedUrl ?? null);
}
