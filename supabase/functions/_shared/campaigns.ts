// Campaign helpers: phone normalisation + contact-local timezone, calling windows, context rendering, quick audiences.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parsePhoneNumberFromString, type CountryCode } from "npm:libphonenumber-js@1.12.10/max";
import { render, template } from "./templating.ts";

// Primary timezone per calling country (fallback: business timezone). Multi-zone countries use their most populous zone.
const COUNTRY_TZ: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City", BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
  CO: "America/Bogota", CL: "America/Santiago", PE: "America/Lima", GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin",
  ES: "Europe/Madrid", IT: "Europe/Rome", NL: "Europe/Amsterdam", BE: "Europe/Brussels", PT: "Europe/Lisbon", CH: "Europe/Zurich", AT: "Europe/Vienna",
  SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw", RO: "Europe/Bucharest", GR: "Europe/Athens",
  TR: "Europe/Istanbul", RU: "Europe/Moscow", UA: "Europe/Kyiv", AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar", KW: "Asia/Kuwait", EG: "Africa/Cairo",
  ZA: "Africa/Johannesburg", NG: "Africa/Lagos", KE: "Africa/Nairobi", GH: "Africa/Accra", MA: "Africa/Casablanca", IN: "Asia/Kolkata", LK: "Asia/Colombo",
  PK: "Asia/Karachi", BD: "Asia/Dhaka", NP: "Asia/Kathmandu", SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", ID: "Asia/Jakarta", PH: "Asia/Manila",
  TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh", CN: "Asia/Shanghai", HK: "Asia/Hong_Kong", JP: "Asia/Tokyo", KR: "Asia/Seoul", AU: "Australia/Sydney", NZ: "Pacific/Auckland",
};

export function normalizePhone(raw: string, defaultCountry?: string | null): { e164: string; tz: string | null } | null {
  const p = parsePhoneNumberFromString(String(raw).trim(), (defaultCountry ?? undefined) as CountryCode | undefined);
  if (!p || !p.isValid()) return null;
  const type = p.getType();
  if (type === "FIXED_LINE" || type === "PREMIUM_RATE" || type === "TOLL_FREE" || type === "SHARED_COST") return null; // WhatsApp needs mobile-capable
  return { e164: p.number, tz: p.country ? COUNTRY_TZ[p.country] ?? null : null };
}

export type Schedule = {
  start_at?: string | null; end_at?: string | null;
  windows?: Record<string, [string, string][]>; window_tz?: "contact" | "business";
  concurrency?: number; gap_seconds?: number; daily_cap?: number;
  retries?: { max?: number; spacing_minutes?: number };
  pre_call_message?: { enabled?: boolean; lead_minutes?: number; text?: string };
  no_answer_message?: { enabled?: boolean; text?: string };
  max_call_seconds?: number;
};

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function localParts(date: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { dow: DOW.indexOf(String(p.weekday).toLowerCase().slice(0, 3)), hhmm: `${p.hour}:${p.minute}` };
}

/** True when `now` is inside the campaign's calling windows and outside the platform quiet hours, in `tz`. */
export function inCallingWindow(s: Schedule, tz: string, quiet: { quiet_start: string; quiet_end: string }, now = new Date()): boolean {
  const { dow, hhmm } = localParts(now, tz);
  const inQuiet = quiet.quiet_start > quiet.quiet_end ? hhmm >= quiet.quiet_start || hhmm < quiet.quiet_end : hhmm >= quiet.quiet_start && hhmm < quiet.quiet_end;
  if (inQuiet) return false;
  const windows = s.windows ?? { mon: [["10:00", "18:00"]], tue: [["10:00", "18:00"]], wed: [["10:00", "18:00"]], thu: [["10:00", "18:00"]], fri: [["10:00", "18:00"]], sat: [["10:00", "18:00"]] };
  return (windows[DOW[dow]!] ?? []).some(([a, b]) => hhmm >= a && hhmm < b);
}

export function fillVars(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? "")).replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

export async function renderCampaignContext(db: SupabaseClient, campaign: Record<string, any>, target: Record<string, any>, businessName: string) {
  const t = await template(db, "calling.outbound");
  const s = campaign.script ?? {};
  const vars = target.variables ?? {};
  const known = Object.entries(vars).filter(([k, v]) => v && !["first_name"].includes(k)).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ");
  return render(t.body, {
    contact_name_or_customer: target.name ?? vars.first_name ?? "the customer",
    business_name: businessName,
    purpose: s.purpose ?? "follow up with the customer",
    key_points: (s.key_points ?? []).map((k: string) => `- ${k}`).join("\n"),
    offer: s.offer ?? "", offer_validity: s.offer_validity ?? "",
    questions: (s.questions_to_ask ?? []).join("; "),
    success_definition: s.success_definition ?? "the customer's need is understood and the next step is agreed",
    collect: (s.collect_fields ?? []).join(", "),
    contact_vars: known,
  });
}

export function firstName(name?: string | null) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

// ───────── Quick campaigns ─────────
export type QuickType = "leads_24h" | "missed_callers" | "confirm_tomorrow" | "retry_no_answers" | "win_back" | "follow_up_inquiries" | "feedback";
export type AudienceRow = { contact_id: string | null; phone: string; name: string | null; variables: Record<string, string> };

export async function quickAudience(db: SupabaseClient, workspaceId: string, agentId: string, type: QuickType, tz: string): Promise<AudienceRow[]> {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const withPhone = (rows: Array<{ id?: string; contact_id?: string; phone_e164?: string | null; name?: string | null; push_name?: string | null; extra?: Record<string, string> }>) => {
    const seen = new Set<string>();
    return rows.filter((r) => r.phone_e164 && !seen.has(r.phone_e164) && seen.add(r.phone_e164))
      .map((r) => ({ contact_id: r.contact_id ?? r.id ?? null, phone: r.phone_e164!, name: r.name ?? r.push_name ?? null, variables: { first_name: firstName(r.name ?? r.push_name), ...(r.extra ?? {}) } }));
  };
  const dnc = new Set(((await db.from("dnc_list").select("phone_e164").eq("workspace_id", workspaceId)).data ?? []).map((d) => d.phone_e164));
  const keep = (rows: AudienceRow[]) => rows.filter((r) => !dnc.has(r.phone));

  if (type === "leads_24h" || type === "follow_up_inquiries") {
    const q = db.from("leads").select("contact:contacts(id,phone_e164,name,push_name,do_not_contact),intent,summary").eq("workspace_id", workspaceId).eq("is_test", false).in("status", ["new", "contacted"]);
    const { data } = type === "leads_24h" ? await q.gte("created_at", iso(now - 86_400_000)).eq("status", "new") : await q.lte("created_at", iso(now - 3 * 86_400_000)).gte("created_at", iso(now - 14 * 86_400_000));
    return keep(withPhone((data ?? []).filter((l: any) => l.contact && !l.contact.do_not_contact).map((l: any) => ({ ...l.contact, contact_id: l.contact.id, extra: { inquiry: (l.summary ?? l.intent ?? "").slice(0, 160) } }))));
  }
  if (type === "missed_callers") {
    const { data: missed } = await db.from("calls").select("contact_id,caller_number,created_at,contact:contacts(id,phone_e164,name,push_name,do_not_contact)").eq("agent_id", agentId).eq("outcome", "missed").gte("created_at", iso(now - 48 * 3600_000));
    const { data: answered } = await db.from("calls").select("contact_id,created_at").eq("agent_id", agentId).gt("duration_seconds", 0).gte("created_at", iso(now - 48 * 3600_000));
    const reached = new Map((answered ?? []).map((a) => [a.contact_id, a.created_at]));
    return keep(withPhone((missed ?? []).filter((m: any) => m.contact && !m.contact.do_not_contact && !(reached.get(m.contact_id) && reached.get(m.contact_id)! > m.created_at)).map((m: any) => ({ ...m.contact, contact_id: m.contact.id }))));
  }
  if (type === "confirm_tomorrow") {
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(now + 86_400_000));
    const { data } = await db.from("bookings").select("contact_id,customer_phone,customer_name,service_name,starts_at,contact:contacts(id,phone_e164,name,do_not_contact)").eq("agent_id", agentId).in("status", ["confirmed", "pending"]).eq("is_test", false)
      .gte("starts_at", iso(now)).lte("starts_at", iso(now + 2 * 86_400_000));
    return keep(withPhone((data ?? []).filter((b: any) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(b.starts_at)) === tomorrow && !b.contact?.do_not_contact)
      .map((b: any) => ({ contact_id: b.contact_id, phone_e164: b.contact?.phone_e164 ?? b.customer_phone, name: b.customer_name ?? b.contact?.name, extra: { last_service: b.service_name ?? "", booking_time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(b.starts_at)) } }))));
  }
  if (type === "retry_no_answers") {
    const { data: last } = await db.from("campaigns").select("id").eq("agent_id", agentId).in("status", ["completed", "paused", "running"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!last) return [];
    const { data } = await db.from("campaign_targets").select("contact_id,phone_e164,name,variables").eq("campaign_id", last.id).in("status", ["no_answer", "busy"]);
    return keep((data ?? []).map((t) => ({ contact_id: t.contact_id, phone: t.phone_e164, name: t.name, variables: t.variables ?? {} })));
  }
  if (type === "win_back" || type === "feedback") {
    const since = type === "feedback" ? iso(now - 7 * 86_400_000) : null;
    const [b, o] = await Promise.all([
      db.from("bookings").select("contact_id,service_name,starts_at").eq("agent_id", agentId).eq("is_test", false).eq("status", "completed").not("contact_id", "is", null),
      db.from("orders").select("contact_id,created_at").eq("agent_id", agentId).eq("is_test", false).eq("status", "completed").not("contact_id", "is", null),
    ]);
    const lastByContact = new Map<string, { at: string; service?: string }>();
    for (const x of b.data ?? []) if (!lastByContact.has(x.contact_id) || lastByContact.get(x.contact_id)!.at < x.starts_at) lastByContact.set(x.contact_id, { at: x.starts_at, service: x.service_name ?? undefined });
    for (const x of o.data ?? []) if (!lastByContact.has(x.contact_id) || lastByContact.get(x.contact_id)!.at < x.created_at) lastByContact.set(x.contact_id, { at: x.created_at });
    const ids = [...lastByContact.entries()].filter(([, v]) => since ? v.at >= since : v.at <= iso(now - 60 * 86_400_000)).map(([k]) => k);
    if (!ids.length) return [];
    const { data: contacts } = await db.from("contacts").select("id,phone_e164,name,push_name,do_not_contact,last_inbound_at").in("id", ids);
    return keep(withPhone((contacts ?? []).filter((c) => !c.do_not_contact && (since || !c.last_inbound_at || c.last_inbound_at <= iso(now - 60 * 86_400_000)))
      .map((c) => ({ ...c, contact_id: c.id, extra: { last_service: lastByContact.get(c.id)?.service ?? "" } }))));
  }
  return [];
}

export async function agentProfile(db: SupabaseClient, agent: Record<string, any>) {
  const [{ data: bp }, { data: ws }, { data: bs }, { data: cc }] = await Promise.all([
    db.from("agent_blueprints").select("data").eq("agent_id", agent.id).maybeSingle(),
    db.from("workspaces").select("country,timezone,locale,plan:plans(limits)").eq("id", agent.workspace_id).single(),
    db.from("booking_settings").select("timezone").eq("agent_id", agent.id).maybeSingle(),
    db.from("channel_configs").select("language").eq("agent_id", agent.id).eq("channel", "calling").maybeSingle(),
  ]);
  const b = (bp?.data ?? {}) as Record<string, any>;
  return {
    name: (b.business?.name as string) || agent.name,
    industry: (b.business?.industry as string) || agent.industry_key || "business",
    tz: bs?.timezone && bs.timezone !== "UTC" ? bs.timezone : ws?.timezone ?? "UTC",
    country: ws?.country ?? null,
    language: cc?.language ?? ws?.locale ?? "en-US",
    limits: ((ws as any)?.plan?.limits ?? {}) as Record<string, number>,
  };
}

export async function platformSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return { ...fallback, ...(data?.value ?? {}) } as T;
}
