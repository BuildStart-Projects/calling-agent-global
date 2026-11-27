// In-browser number extraction for campaign imports (no tokens, nothing uploaded but the final rows).
import { findPhoneNumbersInText, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { extractText, type ProgressFn } from "@/features/documents/extract";

export type ImportRow = { phone: string; name: string | null; vars: Record<string, string> };
export type ImportResult = { rows: ImportRow[]; columns?: { phone: string; name: string | null; extra: string[] }; scanned: number };

export const IMPORT_ACCEPT = ".csv,.tsv,.txt,.xlsx,.xls,.ods,.vcf,.pdf,.docx,.png,.jpg,.jpeg,.webp";
const SHEETJS = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

export function isMobileLike(raw: string, country?: string | null) {
  const p = parsePhoneNumberFromString(raw, (country ?? undefined) as CountryCode | undefined);
  if (!p?.isValid()) return null;
  const t = p.getType();
  return t === "FIXED_LINE" || t === "TOLL_FREE" || t === "PREMIUM_RATE" || t === "SHARED_COST" ? null : p.number;
}

export async function extractNumbers(file: File, country: string | null, onProgress: ProgressFn = () => {}): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv)$/.test(name)) return fromTable(parseCsv(await file.text(), name.endsWith(".tsv") ? "\t" : undefined), country);
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    onProgress("Reading spreadsheet…");
    const XLSX = await import(/* @vite-ignore */ SHEETJS);
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const all: string[][] = [];
    for (const sn of wb.SheetNames.slice(0, 5)) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" }) as unknown[][];
      all.push(...rows.map((r) => r.map((c) => String(c ?? "").trim())));
    }
    return fromTable(all, country);
  }
  if (name.endsWith(".vcf")) return fromVcf(await file.text(), country);
  const { text } = await extractText(file, onProgress);
  return fromText(text, country);
}

export function fromText(text: string, country: string | null): ImportResult {
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    for (const m of findPhoneNumbersInText(line, { defaultCountry: (country ?? undefined) as CountryCode | undefined })) {
      const e164 = isMobileLike(m.number.number, country);
      if (!e164 || seen.has(e164)) continue;
      seen.add(e164);
      // A name is the words right before the number on the same line (or right after it), if they look like a name.
      const nm = looksLikeName(line.slice(0, m.startsAt).trim().replace(/[|,;:\-–\t]+$/g, "").trim().split(/[|,;\t]|\s[-–]\s/).pop()?.trim() ?? "")
        ?? looksLikeName(line.slice(m.endsAt).trim().replace(/^[|,;:\-–\t]+/g, "").trim().split(/[|,;\t]|\s[-–]\s/)[0]?.trim() ?? "");
      rows.push({ phone: e164, name: nm, vars: {} });
    }
  }
  return { rows, scanned: rows.length };
}

function looksLikeName(v: string): string | null {
  if (!/^[\p{L}][\p{L} .'-]{1,40}$/u.test(v) || v.split(/\s+/).length > 4) return null;
  const c = v[0]!;
  return c !== c.toLowerCase() || c === c.toUpperCase() ? v : null; // capitalised, or a script without case
}

function fromVcf(text: string, country: string | null): ImportResult {
  const rows: ImportRow[] = [];
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    const fn = card.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim() ?? null;
    for (const tel of card.matchAll(/^TEL[^:]*:(.+)$/gim)) {
      const e164 = isMobileLike(tel[1]!.trim(), country);
      if (e164) { rows.push({ phone: e164, name: fn, vars: {} }); break; }
    }
  }
  return { rows, scanned: rows.length };
}

function fromTable(table: string[][], country: string | null): ImportResult {
  const data = table.filter((r) => r.some((c) => c.trim()));
  if (!data.length) return { rows: [], scanned: 0 };
  const width = Math.max(...data.map((r) => r.length));
  const sample = data.slice(0, 200);
  // Phone column = the one where most cells parse as a phone number.
  const scores = Array.from({ length: width }, (_, i) => sample.filter((r) => r[i] && /\d{6,}/.test(r[i]!.replace(/\D/g, "")) && parsePhoneNumberFromString(r[i]!, (country ?? undefined) as CountryCode | undefined)?.isValid()).length);
  const phoneCol = scores.indexOf(Math.max(...scores));
  if (scores[phoneCol] === 0) return fromText(table.map((r) => r.join(" , ")).join("\n"), country);
  const first = data[0]!;
  const hasHeader = !parsePhoneNumberFromString(first[phoneCol] ?? "", (country ?? undefined) as CountryCode | undefined)?.isValid();
  const headers = hasHeader ? first.map((h, i) => h.trim() || `column_${i + 1}`) : first.map((_, i) => `column_${i + 1}`);
  const body = hasHeader ? data.slice(1) : data;
  const nameCol = headers.findIndex((h, i) => i !== phoneCol && /name|customer|client|contact|nom|nombre|නම/i.test(h) && !/company|business|user ?name/i.test(h));
  const firstCol = headers.findIndex((h) => /^first[ _]?name$/i.test(h.trim()));
  const lastCol = headers.findIndex((h) => /^(last[ _]?name|surname|family[ _]?name)$/i.test(h.trim()));
  const extra = headers.map((h, i) => ({ h, i })).filter(({ i }) => i !== phoneCol && i !== nameCol && i !== firstCol && i !== lastCol).slice(0, 5);
  const key = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "").slice(0, 30) || "field";
  const rows: ImportRow[] = [];
  for (const r of body) {
    const e164 = isMobileLike(r[phoneCol] ?? "", country);
    if (!e164) continue;
    const name = nameCol >= 0 ? r[nameCol]?.trim() || null : firstCol >= 0 ? [r[firstCol], lastCol >= 0 ? r[lastCol] : ""].join(" ").trim() || null : null;
    const vars: Record<string, string> = {};
    for (const { h, i } of extra) if (r[i]?.trim()) vars[key(h)] = r[i]!.trim().slice(0, 200);
    rows.push({ phone: e164, name, vars });
  }
  return { rows, scanned: body.length, columns: { phone: headers[phoneCol]!, name: nameCol >= 0 ? headers[nameCol]! : firstCol >= 0 ? headers[firstCol]! : null, extra: extra.map((e) => key(e.h)) } };
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? ([",", ";", "\t"].map((c) => [c, (text.split("\n")[0] ?? "").split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0]);
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
