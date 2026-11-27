// Blueprint helpers: required-field readiness per agent type, compact rendering, locks.

export type AgentType = "booking" | "inquiry" | "order";

export type Blueprint = {
  business?: { name?: string; industry?: string; description?: string; address?: string; service_area?: string; website?: string; timezone?: string; currency?: string };
  hours?: Record<string, [string, string][]>;
  policies?: Record<string, unknown>;
  collect_fields?: string[];
  goal?: string;
  tone?: string;
  notes?: string;
  emergency_rule?: string;
  response_time?: string;
};

export type KnowledgeSnapshot = {
  blueprint: Blueprint;
  catalog: Array<{ ref: string; kind: string; name: string; price_minor: number | null; price_from: boolean; currency: string | null; duration_minutes: number | null; description: string | null; locked: boolean }>;
  faqs: Array<{ question: string; answer: string; locked: boolean }>;
  availabilityDays: number;
  handoffPhone: string | null;
  lockedFields: string[];
};

type Req = { key: string; label: string; weight: number; done: (k: KnowledgeSnapshot) => boolean };

const has = (s?: string | null) => Boolean(s && s.trim());
const basics: Req = { key: "business", label: "business name and what it does", weight: 20, done: (k) => has(k.blueprint.business?.name) && (has(k.blueprint.business?.description) || has(k.blueprint.business?.industry)) };
const handoff: Req = { key: "handoff", label: "handoff phone number", weight: 15, done: (k) => has(k.handoffPhone) };
const area: Req = { key: "area", label: "location or service area", weight: 10, done: (k) => has(k.blueprint.business?.address) || has(k.blueprint.business?.service_area) };
const hours: Req = { key: "hours", label: "opening hours or service area", weight: 10, done: (k) => Object.keys(k.blueprint.hours ?? {}).length > 0 || has(k.blueprint.business?.service_area) };

export const REQUIREMENTS: Record<AgentType, Req[]> = {
  booking: [
    basics,
    { key: "services", label: "at least one service with a duration", weight: 25, done: (k) => k.catalog.some((c) => c.kind === "service" && c.duration_minutes) },
    { key: "availability", label: "weekly availability", weight: 20, done: (k) => k.availabilityDays > 0 },
    { key: "collect", label: "customer details to collect", weight: 10, done: (k) => (k.blueprint.collect_fields?.length ?? 0) > 0 },
    area,
    handoff,
  ],
  inquiry: [
    basics,
    { key: "offerings", label: "offerings with prices or ranges", weight: 20, done: (k) => k.catalog.length > 0 },
    { key: "faqs", label: "top customer questions", weight: 20, done: (k) => k.faqs.length >= 2 },
    { key: "goal", label: "goal and details to collect", weight: 15, done: (k) => has(k.blueprint.goal) && (k.blueprint.collect_fields?.length ?? 0) > 0 },
    hours,
    handoff,
  ],
  order: [
    { ...basics, weight: 15 },
    { key: "catalog", label: "catalog with prices", weight: 30, done: (k) => k.catalog.some((c) => c.price_minor != null) },
    { key: "fulfillment", label: "delivery and/or pickup details", weight: 20, done: (k) => Boolean((k.blueprint.policies as { delivery?: { enabled?: boolean }; pickup?: { enabled?: boolean } })?.delivery?.enabled || (k.blueprint.policies as { pickup?: { enabled?: boolean } })?.pickup?.enabled) },
    { key: "payments", label: "payment methods", weight: 10, done: (k) => ((k.blueprint.policies as { payment_methods?: string[] })?.payment_methods?.length ?? 0) > 0 },
    { key: "collect", label: "order details to collect", weight: 10, done: (k) => (k.blueprint.collect_fields?.length ?? 0) > 0 },
    handoff,
  ],
};

export function readiness(type: AgentType, k: KnowledgeSnapshot): { score: number; missing: string[] } {
  const reqs = REQUIREMENTS[type];
  let score = 0;
  const missing: string[] = [];
  for (const r of reqs) {
    if (r.done(k)) score += r.weight;
    else missing.push(r.label);
  }
  return { score: Math.min(100, score), missing };
}

function money(minor: number | null, currency: string | null, from: boolean) {
  if (minor == null) return "";
  return `${from ? "from " : ""}${(minor / 100).toFixed(minor % 100 ? 2 : 0)} ${currency ?? ""}`.trim();
}

/** Compact text form of the current knowledge for the Orchestrator's context (token-lean). */
export function compactBlueprint(k: KnowledgeSnapshot): string {
  const lines: string[] = [];
  const b = k.blueprint;
  lines.push(`business: ${JSON.stringify(b.business ?? {})}`);
  if (b.hours && Object.keys(b.hours).length) lines.push(`hours: ${JSON.stringify(b.hours)}`);
  if (b.policies && Object.keys(b.policies).length) lines.push(`policies: ${JSON.stringify(b.policies)}`);
  if (b.collect_fields?.length) lines.push(`collect_fields: ${b.collect_fields.join(", ")}`);
  if (b.goal) lines.push(`goal: ${b.goal}`);
  if (b.tone) lines.push(`tone: ${b.tone}`);
  if (b.notes) lines.push(`notes: ${b.notes}`);
  lines.push(`handoff_phone: ${k.handoffPhone ?? "(not set)"}`);
  lines.push(`availability: ${k.availabilityDays ? `${k.availabilityDays} day(s) configured` : "(not set)"}`);
  lines.push(`catalog (${k.catalog.length}):`);
  for (const c of k.catalog.slice(0, 80)) {
    lines.push(`- [${c.ref}] ${c.name}${c.duration_minutes ? ` · ${c.duration_minutes} min` : ""}${c.price_minor != null ? ` · ${money(c.price_minor, c.currency, c.price_from)}` : ""}${c.locked ? " · LOCKED" : ""}`);
  }
  if (k.catalog.length > 80) lines.push(`- …and ${k.catalog.length - 80} more`);
  lines.push(`faqs (${k.faqs.length}):`);
  for (const f of k.faqs.slice(0, 30)) lines.push(`- Q: ${f.question}${f.locked ? " (LOCKED)" : ""}`);
  return lines.join("\n");
}

/** Deep-merge a patch into the blueprint, skipping locked paths. Returns applied + skipped paths. */
export function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>, locked: Set<string>, prefix = ""): { applied: string[]; skipped: string[] } {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (locked.has(path)) { skipped.push(path); continue; }
    const isPlainObject = value && typeof value === "object" && !Array.isArray(value) && path !== "hours";
    if (isPlainObject) {
      const child = (target[key] && typeof target[key] === "object" ? target[key] : {}) as Record<string, unknown>;
      const r = mergePatch(child, value as Record<string, unknown>, locked, path);
      target[key] = child;
      applied.push(...r.applied);
      skipped.push(...r.skipped);
    } else if (value === null || value === "") {
      delete target[key];
      applied.push(path);
    } else {
      target[key] = value;
      applied.push(path);
    }
  }
  return { applied, skipped };
}
