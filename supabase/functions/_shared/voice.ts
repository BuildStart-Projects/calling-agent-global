// Voice previews with Gemini Live — the same model and prebuilt voices the Calling Agent uses in the Go engine.
import { HttpError } from "./http.ts";

const WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Synthesises `text` with a Gemini Live voice. Returns 16-bit mono PCM at 24 kHz. */
export async function livePreviewPcm(p: { model: string; voice: string; instruction: string; text: string; timeoutMs?: number }): Promise<Uint8Array> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new HttpError(503, "voice_unconfigured", "Voice previews are not configured.");
  const model = p.model.startsWith("models/") ? p.model : `models/${p.model}`;

  return await new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(`${WS}?key=${encodeURIComponent(key)}`);
    const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => { ws.close(); reject(new HttpError(504, "voice_timeout", "The voice preview took too long. Please try again.")); }, p.timeoutMs ?? 25_000);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (err) return reject(err);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (!total) return reject(new HttpError(502, "voice_empty", "No audio was produced. Please try again."));
      const pcm = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { pcm.set(c, off); off += c.length; }
      resolve(pcm);
    };
    ws.onopen = () => ws.send(JSON.stringify({
      setup: {
        model,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: p.voice } } },
        },
        systemInstruction: { parts: [{ text: p.instruction }] },
      },
    }));
    ws.onmessage = async (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : await new Blob([ev.data]).text();
      const msg = JSON.parse(raw);
      if (msg.setupComplete) {
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: p.text }] }], turnComplete: true } }));
        return;
      }
      for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) chunks.push(b64ToBytes(part.inlineData.data));
      }
      if (msg.serverContent?.turnComplete) finish();
    };
    ws.onerror = () => finish(new HttpError(502, "voice_error", "Couldn't generate the voice preview."));
    ws.onclose = (ev) => { if (ev.code !== 1000 && ev.code !== 1005 && !chunks.length) finish(new HttpError(502, "voice_closed", `Voice service closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`)); };
  });
}

/** Wraps 16-bit mono PCM in a WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** Counts words in any script (CJK-safe). */
export function wordCount(text: string, locale = "en"): number {
  const seg = new Intl.Segmenter(locale, { granularity: "word" });
  return [...seg.segment(text)].filter((s) => s.isWordLike).length;
}
