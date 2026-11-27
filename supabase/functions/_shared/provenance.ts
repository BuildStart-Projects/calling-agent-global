// Provenance check (anti-hallucination): numbers the Orchestrator saves must come from the owner's words or uploaded documents.

const WORD_DURATIONS: Array<[RegExp, number]> = [
  [/half (an )?hour/i, 30], [/\b(an|one|1) ?(hour|hr)\b/i, 60], [/hour and a half|1\.5 ?(hours|hrs)/i, 90], [/quarter (of an )?hour/i, 15],
];
const WORD_TIMES: Array<[RegExp, number]> = [[/\bnoon\b|\bmidday\b/i, 12], [/\bmidnight\b/i, 0]];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100,
  single: 1, couple: 2, pair: 2, dozen: 12,
};

export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (w in NUMBER_WORDS) out.add(String(NUMBER_WORDS[w]));
  for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = m[0].replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n)) {
      out.add(String(n));
      if (Number.isInteger(n)) out.add(String(n));
    }
  }
  // "1,500" style thousands
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+/g)) out.add(String(Number(m[0].replace(/,/g, ""))));
  return out;
}

export class Provenance {
  private nums: Set<string>;
  private digits: string;
  constructor(private source: string) {
    this.nums = numbersIn(source);
    this.digits = source.replace(/\D/g, "");
  }
  hasNumber(n: number): boolean {
    return this.nums.has(String(n)) || this.nums.has(String(Number(n.toFixed(2))));
  }
  price(n: number | null | undefined): boolean {
    if (n == null) return true;
    return this.hasNumber(n);
  }
  duration(min: number | null | undefined): boolean {
    if (min == null) return true;
    if (this.hasNumber(min) || this.hasNumber(min / 60)) return true;
    return WORD_DURATIONS.some(([re, v]) => v === min && re.test(this.source));
  }
  time(hhmm: string): boolean {
    const [h, m] = hhmm.split(":").map(Number);
    if (h == null || Number.isNaN(h)) return false;
    if (WORD_TIMES.some(([re, v]) => v === h && re.test(this.source))) return true;
    const hourOk = this.hasNumber(h) || (h > 12 && this.hasNumber(h - 12)) || (h === 0 && this.hasNumber(12));
    return hourOk && (!m || this.hasNumber(m) || this.source.includes(`:${String(m).padStart(2, "0")}`) || m === 30 && /half/i.test(this.source));
  }
  phone(p: string | null | undefined): boolean {
    if (!p) return true;
    const d = p.replace(/\D/g, "");
    return d.length >= 7 && this.digits.includes(d.slice(-7));
  }
  /** Every number inside free text (e.g. an FAQ answer) must appear in the source. */
  text(t: string | null | undefined): boolean {
    if (!t) return true;
    for (const n of numbersIn(t)) if (!this.nums.has(n)) return false;
    return true;
  }
}
