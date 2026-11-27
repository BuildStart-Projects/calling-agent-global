// Reply validator (IMPLEMENTATION_PLAN.md Appendix D.6) — deterministic, not an LLM.
// Every amount, time, long number (phone) and URL in a draft reply must come from the knowledge,
// this turn's tool results, or the customer's own messages.
import { numbersIn } from "./provenance.ts";

const AMOUNT = /(?:[$€£₹¥₦₱]|\b(?:usd|eur|gbp|inr|lkr|aud|cad|aed|sgd|zar|ngn|kes|php|myr|idr|pkr|brl|mxn)\b)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:[$€£₹¥]|\b(?:usd|eur|gbp|inr|lkr|aud|cad|aed|sgd|zar|ngn|kes|php|myr|idr|pkr|brl|mxn|dollars?|euros?|pounds?|rupees?)\b)/gi;
const TIME = /\b\d{1,2}(?::\d{2})\s?(?:am|pm)?\b|\b\d{1,2}\s?(?:am|pm)\b/gi;
const LONGNUM = /\+?\d[\d\s-]{6,}\d/g;
const URL = /https?:\/\/[^\s)]+/gi;

export type ValidationIssue = { kind: "amount" | "time" | "number" | "url"; value: string };

export function validateReply(reply: string, allowedText: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowedNums = numbersIn(allowedText);
  const allowedDigits = allowedText.replace(/\D/g, "");
  const lowerAllowed = allowedText.toLowerCase();

  for (const m of reply.matchAll(AMOUNT)) {
    const n = Number(m[0].replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && !allowedNums.has(String(n))) issues.push({ kind: "amount", value: m[0].trim() });
  }
  for (const m of reply.matchAll(TIME)) {
    const [hRaw, mRaw] = m[0].replace(/\s?(am|pm)/i, "").split(":");
    let h = Number(hRaw);
    const pm = /pm/i.test(m[0]);
    if (pm && h < 12) h += 12;
    const ok = allowedNums.has(String(h)) || allowedNums.has(String(h % 12 || 12)) || (h > 12 && allowedNums.has(String(h - 12)));
    const minOk = !mRaw || mRaw === "00" || allowedNums.has(String(Number(mRaw))) || lowerAllowed.includes(`:${mRaw}`);
    if (!ok || !minOk) issues.push({ kind: "time", value: m[0].trim() });
  }
  for (const m of reply.matchAll(LONGNUM)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length >= 7 && !allowedDigits.includes(d.slice(-7))) issues.push({ kind: "number", value: m[0].trim() });
  }
  for (const m of reply.matchAll(URL)) {
    if (!lowerAllowed.includes(m[0].toLowerCase().replace(/[.,]+$/, ""))) issues.push({ kind: "url", value: m[0] });
  }
  return issues;
}
