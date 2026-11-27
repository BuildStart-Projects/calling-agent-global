// Booking + order tools. All prices, totals and slots come from the database (never from the model).
import type { RuntimeCtx } from "./runtime-tools.ts";
import { notify } from "./runtime-tools.ts";

type ToolDecl = { name: string; description: string; parameters: Record<string, unknown> };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

export const BOOKING_TOOLS: ToolDecl[] = [
  { name: "check_availability", description: "Find available appointment times. Only offer times returned by this tool.",
    parameters: obj({ service_ref: { type: "string", description: "Service ref like s1" }, date_from: { type: "string", description: "YYYY-MM-DD" }, date_to: { type: "string", description: "YYYY-MM-DD (optional)" }, part_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "any"] } }, ["date_from"]) },
  { name: "create_booking", description: "Book a time returned by check_availability after the customer confirmed.",
    parameters: obj({ service_ref: { type: "string" }, start_iso: { type: "string", description: "Exact start_iso from check_availability" }, customer_name: { type: "string" }, notes: { type: "string" }, address: { type: "string" } }, ["start_iso", "customer_name"]) },
  { name: "find_my_bookings", description: "List this customer's upcoming bookings.", parameters: obj({}) },
  { name: "cancel_booking", description: "Cancel one of this customer's bookings.", parameters: obj({ booking_ref: { type: "string", description: "Like B-1042" } }, ["booking_ref"]) },
  { name: "reschedule_booking", description: "Move one of this customer's bookings to a time returned by check_availability.",
    parameters: obj({ booking_ref: { type: "string" }, new_start_iso: { type: "string" } }, ["booking_ref", "new_start_iso"]) },
];

export const ORDER_TOOLS: ToolDecl[] = [
  { name: "quote_order", description: "Price an order from the catalog. Always use this — never calculate totals yourself.",
    parameters: obj({ items: { type: "array", items: obj({ item_ref: { type: "string", description: "Product ref like p3" }, qty: { type: "integer" }, options: { type: "object", description: "Chosen option per variant name" } }, ["item_ref", "qty"]) }, fulfillment: { type: "string", enum: ["delivery", "pickup"] }, address: { type: "string" } }, ["items", "fulfillment"]) },
  { name: "create_order", description: "Place an order from a quote_id after the customer confirmed the summary.",
    parameters: obj({ quote_id: { type: "string" }, customer_name: { type: "string" }, payment_method: { type: "string" }, notes: { type: "string" } }, ["quote_id", "customer_name"]) },
];

export const COMMERCE_TOOL_NAMES = new Set([...BOOKING_TOOLS, ...ORDER_TOOLS].map((t) => t.name));

async function agentTz(ctx: RuntimeCtx): Promise<string> {
  const { data } = await ctx.db.from("booking_settings").select("timezone").eq("agent_id", ctx.agent.id).maybeSingle();
  if (data?.timezone) return data.timezone;
  const { data: ws } = await ctx.db.from("workspaces").select("timezone").eq("id", ctx.workspaceId).single();
  return ws?.timezone ?? "UTC";
}
const label = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
const hourIn = (iso: string, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso)));
const fmtMoney = (minor: number, cur: string) => `${(minor / 100).toFixed(minor % 100 ? 2 : 0)} ${cur}`;

/** Accepts exact ISO with offset, or a local wall time ("2026-11-29T12:00") interpreted in the agent's timezone. */
function toUtcIso(input: string, tz: string): string | null {
  if (!input) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(input)) { const t = Date.parse(input); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const tzAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(asUtc - (tzAsUtc - asUtc)).toISOString();
}

async function serviceByRef(ctx: RuntimeCtx, ref?: string) {
  if (!ref) return null;
  const { data } = await ctx.db.from("catalog_items").select("id,name,ref,duration_minutes").eq("agent_id", ctx.agent.id).eq("ref", ref).eq("active", true).maybeSingle();
  return data;
}

async function slots(ctx: RuntimeCtx, serviceId: string | null, from: string, to: string) {
  const { data, error } = await ctx.db.rpc("get_available_slots", { p_agent: ctx.agent.id, p_service: serviceId, p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as Array<{ start_at: string; end_at: string }>;
}

/** Spread picks across the list so options aren't all back-to-back. */
function spread<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]!);
}

export async function runCommerceTool(name: string, a: Record<string, any>, ctx: RuntimeCtx): Promise<Record<string, unknown>> {
  const tz = await agentTz(ctx);
  switch (name) {
    case "check_availability": {
      const svc = await serviceByRef(ctx, a.service_ref);
      if (a.service_ref && !svc) return { ok: false, error: "unknown service_ref" };
      const from = /^\d{4}-\d{2}-\d{2}$/.test(a.date_from ?? "") ? a.date_from : new Date().toISOString().slice(0, 10);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(a.date_to ?? "") ? a.date_to : from;
      let list = await slots(ctx, svc?.id ?? null, from, to);
      const part = a.part_of_day ?? "any";
      if (part !== "any") list = list.filter((s) => { const h = hourIn(s.start_at, tz); return part === "morning" ? h < 12 : part === "afternoon" ? h >= 12 && h < 17 : h >= 17; });
      if (!list.length) {
        const next = await slots(ctx, svc?.id ?? null, to, new Date(Date.parse(to) + 14 * 86_400_000).toISOString().slice(0, 10));
        return { ok: true, slots: [], next_available: next[0] ? { start_iso: next[0].start_at, label: label(next[0].start_at, tz) } : null, timezone: tz };
      }
      return { ok: true, service: svc?.name ?? null, slots: spread(list, 6).map((s) => ({ start_iso: s.start_at, label: label(s.start_at, tz) })), timezone: tz };
    }
    case "create_booking": {
      const svc = await serviceByRef(ctx, a.service_ref);
      const start = toUtcIso(String(a.start_iso ?? ""), tz);
      if (!start) return { ok: false, error: "start_iso must be one of the start_iso values from check_availability" };
      const { data, error } = await ctx.db.rpc("book_slot", {
        p_agent: ctx.agent.id, p_service: svc?.id ?? null, p_start: start, p_contact: ctx.contact?.id ?? null,
        p_name: a.customer_name ?? ctx.contact?.name ?? null, p_phone: ctx.contact?.phone_e164 ?? null, p_notes: a.notes ?? null,
        p_address: a.address ?? null, p_source: ctx.channel === "call" ? "call" : ctx.channel === "playground" ? "playground" : "whatsapp", p_is_test: Boolean(ctx.sandbox),
      });
      if (error) return { ok: false, error: "could not book" };
      if (!data.ok) {
        const day = start.slice(0, 10);
        const alt = (await slots(ctx, svc?.id ?? null, day, new Date(Date.parse(day) + 3 * 86_400_000).toISOString().slice(0, 10))).slice(0, 3);
        return { ok: false, reason: "slot_taken", alternatives: alt.map((s) => ({ start_iso: s.start_at, label: label(s.start_at, tz) })) };
      }
      if (!ctx.sandbox) await notify(ctx.db, ctx.workspaceId, "booking", `📅 New booking ${data.ref}`, `${a.customer_name ?? "A customer"} · ${svc?.name ?? "Appointment"} · ${label(data.starts_at, tz)}`, "/app/bookings");
      return { ok: true, booking_ref: data.ref, status: data.status, label: label(data.starts_at, tz), service: svc?.name ?? null };
    }
    case "find_my_bookings": {
      if (!ctx.contact) return { ok: true, bookings: [] };
      const { data } = await ctx.db.from("bookings").select("ref,service_name,starts_at,status").eq("agent_id", ctx.agent.id).eq("contact_id", ctx.contact.id).gte("starts_at", new Date().toISOString()).in("status", ["pending", "confirmed"]).order("starts_at");
      return { ok: true, bookings: (data ?? []).map((b) => ({ booking_ref: b.ref, service: b.service_name, label: label(b.starts_at, tz), status: b.status })) };
    }
    case "cancel_booking":
    case "reschedule_booking": {
      if (!ctx.contact) return { ok: false, error: "unknown customer" };
      const { data: b } = await ctx.db.from("bookings").select("id,ref").eq("agent_id", ctx.agent.id).eq("contact_id", ctx.contact.id).eq("ref", String(a.booking_ref ?? "").toUpperCase()).in("status", ["pending", "confirmed"]).maybeSingle();
      if (!b) return { ok: false, error: "booking not found for this customer" };
      if (name === "cancel_booking") {
        await ctx.db.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
        if (!ctx.sandbox) await notify(ctx.db, ctx.workspaceId, "booking", `Booking ${b.ref} cancelled`, `Cancelled by the customer via ${ctx.channel}.`, "/app/bookings");
        return { ok: true, booking_ref: b.ref, status: "cancelled" };
      }
      const newStart = toUtcIso(String(a.new_start_iso ?? ""), tz);
      if (!newStart) return { ok: false, error: "new_start_iso must come from check_availability" };
      const { data } = await ctx.db.rpc("reschedule_booking", { p_booking: b.id, p_start: newStart });
      if (!data?.ok) return { ok: false, reason: "slot_taken" };
      return { ok: true, booking_ref: b.ref, label: label(newStart, tz) };
    }
    case "quote_order": return quote(a, ctx);
    case "create_order": {
      const { data: q } = await ctx.db.from("order_quotes").select("*").eq("id", a.quote_id).eq("agent_id", ctx.agent.id).maybeSingle();
      if (!q) return { ok: false, error: "unknown quote_id — call quote_order first" };
      if (Date.parse(q.expires_at) < Date.now()) return { ok: false, error: "quote expired — call quote_order again" };
      const { data: ref } = await ctx.db.rpc("next_ref", { p_agent: ctx.agent.id, p_prefix: "O" });
      const { data: bp } = await ctx.db.from("agent_blueprints").select("data").eq("agent_id", ctx.agent.id).single();
      const { data: order, error } = await ctx.db.from("orders").insert({
        ref, agent_id: ctx.agent.id, workspace_id: ctx.workspaceId, contact_id: ctx.contact?.id ?? null, items: q.lines,
        subtotal_minor: q.subtotal_minor, delivery_fee_minor: q.delivery_fee_minor, total_minor: q.total_minor, currency: q.currency,
        fulfillment: q.fulfillment, address: q.address, payment_method: a.payment_method ?? null, customer_name: a.customer_name ?? ctx.contact?.name ?? null,
        customer_phone: ctx.contact?.phone_e164 ?? null, notes: a.notes ?? null, is_test: Boolean(ctx.sandbox),
        source: ctx.channel === "call" ? "call" : ctx.channel === "playground" ? "playground" : "whatsapp",
      }).select("ref,total_minor,currency").single();
      if (error) return { ok: false, error: "could not place the order" };
      if (!ctx.sandbox) await notify(ctx.db, ctx.workspaceId, "order", `🛍️ New order ${order.ref}`, `${a.customer_name ?? "A customer"} · ${fmtMoney(order.total_minor, order.currency)} · ${q.fulfillment}`, "/app/orders");
      return { ok: true, order_ref: order.ref, total: fmtMoney(order.total_minor, order.currency), payment_instructions: (bp?.data as any)?.policies?.payment_instructions ?? null };
    }
  }
  return { ok: false, error: "unknown tool" };
}

async function quote(a: Record<string, any>, ctx: RuntimeCtx) {
  // Accept common aliases the model may use (id/ref/quantity).
  const items = (Array.isArray(a.items) ? a.items.slice(0, 30) : []).map((i: any) => ({ ...i, item_ref: i.item_ref ?? i.ref ?? i.id, qty: i.qty ?? i.quantity ?? 1 }));
  if (!items.length) return { ok: false, error: "no items" };
  const refs = items.map((i: any) => String(i.item_ref));
  const { data: cat } = await ctx.db.from("catalog_items").select("ref,name,price_minor,currency,variants").eq("agent_id", ctx.agent.id).eq("active", true).in("ref", refs);
  const byRef = new Map((cat ?? []).map((c) => [c.ref, c]));
  const lines: Array<{ ref: string; name: string; qty: number; unit_minor: number; total_minor: number; options: Record<string, string> }> = [];
  const problems: string[] = [];
  let currency = "";
  for (const it of items) {
    const c = byRef.get(String(it.item_ref));
    const qty = Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1)));
    if (!c) { problems.push(`unknown item ${it.item_ref}`); continue; }
    if (c.price_minor == null) { problems.push(`${c.name} has no price — the team must confirm`); continue; }
    let unit = c.price_minor;
    const chosen: Record<string, string> = {};
    for (const v of (c.variants ?? []) as Array<{ name: string; required?: boolean; options: Array<{ label: string; price_delta_minor?: number }> }>) {
      const pick = it.options?.[v.name];
      const opt = v.options.find((o) => o.label.toLowerCase() === String(pick ?? "").toLowerCase());
      if (!opt && v.required) { problems.push(`${c.name}: choose ${v.name} (${v.options.map((o) => o.label).join(", ")})`); continue; }
      if (opt) { unit += opt.price_delta_minor ?? 0; chosen[v.name] = opt.label; }
    }
    currency = c.currency ?? currency;
    lines.push({ ref: c.ref, name: c.name, qty, unit_minor: unit, total_minor: unit * qty, options: chosen });
  }
  if (problems.length) return { ok: false, problems };
  const { data: bp } = await ctx.db.from("agent_blueprints").select("data").eq("agent_id", ctx.agent.id).single();
  const del = (bp?.data as any)?.policies?.delivery ?? {};
  const subtotal = lines.reduce((s, l) => s + l.total_minor, 0);
  let fee = 0;
  if (a.fulfillment === "delivery") {
    if (!del.enabled) return { ok: false, error: "delivery is not offered — offer pickup" };
    if (!a.address) return { ok: false, error: "ask for the delivery address" };
    fee = del.fee != null ? Math.round(Number(del.fee) * 100) : 0;
    if (del.free_over != null && subtotal >= Math.round(Number(del.free_over) * 100)) fee = 0;
  }
  const { data: q } = await ctx.db.from("order_quotes").insert({
    agent_id: ctx.agent.id, contact_id: ctx.contact?.id ?? null, lines, subtotal_minor: subtotal, delivery_fee_minor: fee,
    total_minor: subtotal + fee, currency: currency || "USD", fulfillment: a.fulfillment === "delivery" ? "delivery" : "pickup", address: a.address ?? null,
  }).select("id").single();
  return {
    ok: true, quote_id: q!.id,
    lines: lines.map((l) => ({ name: l.name + (Object.keys(l.options).length ? ` (${Object.values(l.options).join(", ")})` : ""), qty: l.qty, unit: fmtMoney(l.unit_minor, currency), total: fmtMoney(l.total_minor, currency) })),
    subtotal: fmtMoney(subtotal, currency), delivery_fee: fmtMoney(fee, currency), total: fmtMoney(subtotal + fee, currency),
  };
}
