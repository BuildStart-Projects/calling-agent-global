// Minimal Stripe REST client (form-encoded) + webhook signature verification. No SDK needed in Deno.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";
import { timingSafeEqual } from "./hmac.ts";

const API = "https://api.stripe.com/v1";

function key() {
  const k = Deno.env.get("STRIPE_SECRET_KEY");
  if (!k) throw new HttpError(503, "billing_unavailable", "Payments aren't set up yet. Please try again later.");
  return k;
}

/** Flattens nested objects/arrays into Stripe's bracket form encoding. */
export function formEncode(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? formEncode(item as Record<string, unknown>, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(item))));
    else if (typeof v === "object") formEncode(v as Record<string, unknown>, name, out);
    else out.append(name, String(v));
  }
  return out;
}

export async function stripe<T = any>(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const url = method === "GET" && body ? `${API}${path}?${formEncode(body)}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: method !== "GET" && body ? formEncode(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) {
    console.error(JSON.stringify({ where: "stripe", path, status: res.status, type: j?.error?.type, code: j?.error?.code, message: j?.error?.message }));
    throw new HttpError(res.status >= 500 ? 502 : 400, "stripe_error", j?.error?.code === "resource_missing" ? "Billing record not found." : "Payment provider error. Please try again.");
  }
  return j as T;
}

/** Verifies `Stripe-Signature: t=..,v1=..` (HMAC-SHA256 of `${t}.${payload}`), 5-minute tolerance. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && timingSafeEqual(s, hex));
}

export async function ensureCustomer(db: SupabaseClient, ws: Record<string, any>, email: string | undefined): Promise<string> {
  if (ws.stripe_customer_id) return ws.stripe_customer_id;
  const c = await stripe<{ id: string }>("POST", "/customers", { email, name: ws.name, metadata: { workspace_id: ws.id } }, `cust-${ws.id}`);
  await db.from("workspaces").update({ stripe_customer_id: c.id }).eq("id", ws.id).is("stripe_customer_id", null);
  const { data } = await db.from("workspaces").select("stripe_customer_id").eq("id", ws.id).single();
  return data!.stripe_customer_id;
}

/** Lazily creates the Stripe product + price for a plan or pack; a changed price gets a new Stripe price. */
export async function ensurePrice(db: SupabaseClient, kind: "plan" | "pack", row: Record<string, any>): Promise<string> {
  if (row.stripe_price_id) return row.stripe_price_id;
  const table = kind === "plan" ? "plans" : "topup_packs";
  let product = row.stripe_product_id as string | null;
  if (!product) {
    const p = await stripe<{ id: string }>("POST", "/products", { name: kind === "plan" ? `BuildStart ${row.name}` : `BuildStart ${row.name} credits`, metadata: { kind, id: row.id } }, `prod-${kind}-${row.id}`);
    product = p.id;
  }
  const price = await stripe<{ id: string }>("POST", "/prices", {
    product, currency: String(row.currency ?? "USD").toLowerCase(), unit_amount: row.price_minor,
    ...(kind === "plan" ? { recurring: { interval: "month" } } : {}), metadata: { kind, id: row.id },
  }, `price-${kind}-${row.id}-${row.price_minor}-${row.currency}`);
  await db.from(table).update({ stripe_product_id: product, stripe_price_id: price.id }).eq("id", row.id);
  return price.id;
}

export function appUrl(path: string) {
  const base = (Deno.env.get("APP_URL") ?? (Deno.env.get("APP_ORIGINS") ?? "http://localhost:8080").split(",")[0]!.trim()).replace(/\*/g, "app").replace(/\/$/, "");
  return `${base}${path}`;
}
