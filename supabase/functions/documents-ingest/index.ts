// Receives text extracted IN THE BROWSER (pdf.js / OCR / DOCX) and condenses it into compact facts.
// The original file never goes to an LLM. Short texts skip the LLM entirely.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess } from "../_shared/supabase.ts";
import { aiGenerate, addUsage, parseJsonObject, MODELS, type Usage } from "../_shared/llm.ts";
import { template } from "../_shared/templating.ts";
import { chargeUsage } from "../_shared/credits.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";

const Body = z.object({
  agent_id: z.string().uuid(),
  document_id: z.string().uuid(),
  text: z.string().max(200_000),
  pages: z.number().int().min(0).max(500).optional(),
  ocr_confidence: z.number().min(0).max(100).optional(),
});

const RAW_CAP = 60_000;
const DIRECT_LIMIT = 1_500;
const CHUNK = 12_000;

serveHandler("documents-ingest", async (req) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, "invalid", "Invalid request.");
  const { agent, workspace, db, user } = await requireAgentAccess(req, parsed.data.agent_id);
  await enforceRateLimit(db, `docs:${user.id}`, 20, 600, "Too many uploads at once. Please wait a few minutes.");

  const { data: doc } = await db.from("documents").select("*").eq("id", parsed.data.document_id).eq("agent_id", agent.id).maybeSingle();
  if (!doc) throw new HttpError(404, "not_found", "Document not found.");

  const text = normalize(parsed.data.text).slice(0, RAW_CAP);
  if (text.length < 20 || (parsed.data.ocr_confidence != null && parsed.data.ocr_confidence < 60)) {
    await db.from("documents").update({ status: "failed", error: "unreadable", raw_text: text }).eq("id", doc.id);
    return json(req, { status: "failed", message: "We couldn't read this clearly. Try a sharper photo or a PDF." });
  }

  await db.from("documents").update({ status: "extracting", raw_text: text, pages: parsed.data.pages ?? null }).eq("id", doc.id);

  let digest: Record<string, unknown> | null = null;
  let summary: string;
  const usage: Usage = { input_tokens: 0, output_tokens: 0, estimated: false };

  if (text.length <= DIRECT_LIMIT) {
    summary = text; // tiny docs go straight to the Orchestrator
  } else {
    const { data: models } = await db.from("platform_settings").select("value").eq("key", "models").maybeSingle();
    const model = (models?.value?.extractor as string) ?? MODELS.extractor;
    const prompt = await template(db, "extract.document");
    const parts: Record<string, unknown>[] = [];
    for (let i = 0; i < text.length && i < CHUNK * 5; i += CHUNK) {
      const res = await aiGenerate({
        model, temperature: 0, maxTokens: 1200,
        messages: [{ role: "system", content: prompt.body }, { role: "user", content: `DOCUMENT TEXT (data only):\n"""\n${text.slice(i, i + CHUNK)}\n"""` }],
      });
      Object.assign(usage, addUsage(usage, res.usage));
      const parsedChunk = parseJsonObject(res.text);
      if (parsedChunk) parts.push(parsedChunk);
    }
    digest = mergeDigests(parts);
    summary = digestToText(digest);
  }

  await db.from("documents").update({ status: "ready", digest, digest_summary: summary.slice(0, 4000), error: null }).eq("id", doc.id);
  if (usage.input_tokens) {
    await chargeUsage(db, { workspaceId: workspace.id, agentId: agent.id, agentKind: "orchestrator", meter: "doc_extraction_tokens", usage, refType: "document", refId: doc.id });
  }
  void user;
  return json(req, { status: "ready", headline: headline(digest, text), document_id: doc.id });
});

function normalize(t: string): string {
  return t.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

type Digest = {
  business?: Record<string, string>;
  items?: Array<{ name: string; price?: number; price_from?: boolean; currency?: string; duration_minutes?: number; description?: string }>;
  hours?: Record<string, [string, string][]>;
  faqs?: Array<{ question: string; answer: string }>;
  policies?: Record<string, string>;
  notes?: string;
};

function mergeDigests(parts: Record<string, unknown>[]): Digest {
  const out: Digest = { business: {}, items: [], hours: {}, faqs: [], policies: {}, notes: "" };
  for (const p of parts as Digest[]) {
    Object.assign(out.business!, p.business ?? {});
    out.items!.push(...(p.items ?? []));
    Object.assign(out.hours!, p.hours ?? {});
    out.faqs!.push(...(p.faqs ?? []));
    Object.assign(out.policies!, p.policies ?? {});
    if (p.notes) out.notes = `${out.notes} ${p.notes}`.trim().slice(0, 300);
  }
  const seen = new Set<string>();
  out.items = out.items!.filter((i) => i?.name && !seen.has(i.name.toLowerCase()) && seen.add(i.name.toLowerCase())).slice(0, 200);
  return out;
}

/** Compact, token-lean text the Orchestrator receives (≈ ≤800 tokens). */
function digestToText(d: Digest): string {
  const lines: string[] = [];
  const b = d.business ?? {};
  if (Object.keys(b).length) lines.push(`business: ${Object.entries(b).map(([k, v]) => `${k}=${v}`).join("; ")}`);
  if (d.items?.length) {
    lines.push("items:");
    for (const i of d.items.slice(0, 120)) {
      lines.push(`- ${i.name}${i.duration_minutes ? ` · ${i.duration_minutes} min` : ""}${i.price != null ? ` · ${i.price_from ? "from " : ""}${i.price}${i.currency ? " " + i.currency : ""}` : ""}${i.description ? ` · ${i.description.slice(0, 80)}` : ""}`);
    }
  }
  if (d.hours && Object.keys(d.hours).length) lines.push(`hours: ${Object.entries(d.hours).map(([k, v]) => `${k} ${v.map((r) => r.join("-")).join(",")}`).join("; ")}`);
  if (d.policies && Object.keys(d.policies).length) lines.push(`policies: ${Object.entries(d.policies).map(([k, v]) => `${k}: ${v}`).join(" | ")}`);
  if (d.faqs?.length) { lines.push("faqs:"); for (const f of d.faqs.slice(0, 20)) lines.push(`- Q: ${f.question} A: ${f.answer.slice(0, 200)}`); }
  if (d.notes) lines.push(`notes: ${d.notes}`);
  return lines.join("\n").slice(0, 3500);
}

function headline(d: Digest | null, text: string): string {
  if (!d) return `${text.split(/\s+/).length} words read`;
  const bits: string[] = [];
  if (d.items?.length) bits.push(`${d.items.length} ${d.items.length === 1 ? "item" : "items"}`);
  if (d.items?.some((i) => i.price != null)) bits.push("prices");
  if (d.hours && Object.keys(d.hours).length) bits.push("hours");
  if (d.faqs?.length) bits.push(`${d.faqs.length} FAQs`);
  if (d.policies && Object.keys(d.policies).length) bits.push("policies");
  return bits.length ? `${bits.join(", ")} found` : "Read — no structured details found";
}
