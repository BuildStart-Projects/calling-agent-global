// Voice previews (≤10 words, any supported language) with the Calling Agent's Gemini Live model. Cached by hash.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { livePreviewPcm, pcmToWav, wordCount } from "../_shared/voice.ts";
import { render, template } from "../_shared/templating.ts";
import { PERSONA } from "../_shared/compiler.ts";
import { sha256 } from "../_shared/compiler.ts";
import { chargeUsage } from "../_shared/credits.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { publicUrl } from "../_shared/supabase.ts";

const Body = z.object({
  voice: z.string().min(2).max(40),
  language: z.string().min(2).max(12),
  style: z.enum(["friendly", "professional", "energetic", "reassuring"]).default("friendly"),
  text: z.string().min(1).max(120),
});

serveHandler("voice-preview", async (req) => {
  const user = await requireUser(req);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "invalid", "Invalid preview request.");
  const { voice, language, style } = body.data;
  const text = body.data.text.trim().replace(/\s+/g, " ");
  if (wordCount(text, language) > 10) throw new HttpError(400, "too_long", "Previews are limited to 10 words.");

  const db = serviceClient();
  const [{ data: v }, { data: lang }] = await Promise.all([
    db.from("voices").select("name").eq("name", voice).eq("active", true).maybeSingle(),
    db.from("languages").select("code,label").eq("code", language).eq("active", true).maybeSingle(),
  ]);
  if (!v || !lang) throw new HttpError(400, "invalid", "Unknown voice or language.");

  const hash = await sha256([voice, language, style, text.toLowerCase()].join("|"));
  const { data: hit } = await db.from("voice_preview_cache").select("storage_path").eq("hash", hash).maybeSingle();
  if (hit) return json(req, { url: await signed(db, hit.storage_path), cached: true });

  // Uncached previews are rate-limited per user per day (plan limit).
  const { data: m } = await db.from("workspace_members").select("workspace_id, workspaces(plan_id, plans(limits))").eq("user_id", user.id).limit(1).maybeSingle();
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
  if (m?.workspace_id) await chargeUsage(db, { workspaceId: m.workspace_id, agentKind: "calling", meter: "voice_preview", units: 1, refType: "voice_preview", refId: hash });
  return json(req, { url: await signed(db, path), cached: false });
});

async function signed(db: ReturnType<typeof serviceClient>, path: string) {
  const { data } = await db.storage.from("voice-previews").createSignedUrl(path, 3600);
  return publicUrl(data?.signedUrl ?? null);
}
