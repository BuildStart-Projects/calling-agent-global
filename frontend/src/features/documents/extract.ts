// In-browser text extraction (free; no tokens). Heavy libraries are lazy-loaded on first use.

export type Extracted = { text: string; pages?: number; ocrConfidence?: number };
export type ProgressFn = (label: string, pct?: number) => void;

const MAX_PDF_PAGES = 30;

export const ACCEPTED_DOC_TYPES = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
} as const;

export function isAcceptedDoc(file: File): boolean {
  return Object.keys(ACCEPTED_DOC_TYPES).includes(file.type) || /\.(pdf|jpe?g|png|webp|heic|docx|txt)$/i.test(file.name);
}

export async function extractText(file: File, onProgress: ProgressFn = () => {}): Promise<Extracted> {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return extractPdf(file, onProgress);
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/.test(name)) return ocrImage(file, onProgress);
  if (name.endsWith(".docx")) {
    onProgress("Reading document…");
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: value };
  }
  return { text: await file.text() };
}

async function extractPdf(file: File, onProgress: ProgressFn): Promise<Extracted> {
  onProgress("Opening PDF…");
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const pageTexts: string[] = [];
  for (let i = 1; i <= pages; i++) {
    onProgress(`Reading page ${i} of ${pages}…`, (i / pages) * 100);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines using the y-coordinate so price lists keep their row structure.
    const rows = new Map<number, string[]>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]!);
      rows.set(y, [...(rows.get(y) ?? []), item.str]);
    }
    pageTexts.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, s]) => s.join(" ").trim()).filter(Boolean).join("\n"));
  }
  const joined = dropRepeatedLines(pageTexts);
  if (joined.replace(/\s/g, "").length > 40) return { text: joined, pages };

  // Scanned PDF → render pages and OCR them.
  onProgress("Scanned PDF — recognising text…");
  const texts: string[] = [];
  let conf = 0;
  for (let i = 1; i <= Math.min(pages, 10); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const res = await ocrImage(new File([blob], `page-${i}.png`, { type: "image/png" }), (l) => onProgress(`Page ${i}: ${l}`));
    texts.push(res.text);
    conf += res.ocrConfidence ?? 0;
  }
  return { text: texts.join("\n\n"), pages, ocrConfidence: conf / Math.max(1, texts.length) };
}

async function ocrImage(file: File, onProgress: ProgressFn): Promise<Extracted> {
  onProgress("Preparing image…");
  const image = await downscale(file, 2000);
  const { createWorker } = await loadTesseract();
  const worker = await createWorker(ocrLangs(), 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress("Recognising text…", Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text, ocrConfidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}

type TesseractWorker = { recognize: (img: Blob) => Promise<{ data: { text: string; confidence: number } }>; terminate: () => Promise<void> };
type TesseractModule = { createWorker: (langs: string, oem: number, opts: { logger: (m: { status: string; progress: number }) => void }) => Promise<TesseractWorker> };

/** Tesseract.js is loaded from the CDN on first use (its wasm core and language data come from the CDN anyway). */
async function loadTesseract(): Promise<TesseractModule> {
  const url = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js";
  return (await import(/* @vite-ignore */ url)) as TesseractModule;
}

/** Tesseract language packs guessed from the browser locale, always with English. */
function ocrLangs(): string {
  const map: Record<string, string> = { es: "spa", fr: "fra", de: "deu", it: "ita", pt: "por", nl: "nld", ar: "ara", hi: "hin", si: "sin", ta: "tam", id: "ind", tr: "tur", ru: "rus", pl: "pol", vi: "vie", th: "tha" };
  const lang = (navigator.language || "en").slice(0, 2);
  return map[lang] ? `eng+${map[lang]}` : "eng";
}

async function downscale(file: File, max: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob((b) => r(b ?? file), "image/png"));
  } catch {
    return file; // e.g. HEIC in browsers without support — tesseract may still read it
  }
}

/** Drops headers/footers that repeat on at least half the pages. */
function dropRepeatedLines(pages: string[]): string {
  if (pages.length < 3) return pages.join("\n\n");
  const counts = new Map<string, number>();
  for (const p of pages) for (const l of new Set(p.split("\n"))) counts.set(l, (counts.get(l) ?? 0) + 1);
  return pages.map((p) => p.split("\n").filter((l) => (counts.get(l) ?? 0) < pages.length / 2 || l.length > 80).join("\n")).join("\n\n");
}
