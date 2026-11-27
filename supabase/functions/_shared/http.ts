// Shared HTTP plumbing for BuildStart Edge Functions: CORS allow-list, JSON helpers, typed errors, request logging.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const DEFAULT_ORIGINS = ["http://localhost:8080", "http://127.0.0.1:8080"];

function allowedOrigin(origin: string | null): string {
  const list = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = list.length ? list : DEFAULT_ORIGINS;
  if (!origin) return all[0]!;
  for (const o of all) {
    if (o === origin) return origin;
    // wildcard subdomain support, e.g. https://*.vercel.app
    if (o.includes("*")) {
      const re: RegExp = new RegExp("^" + o.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", "[a-z0-9-]+") + "$");
      if (re.test(origin)) return origin;
    }
  }
  return all[0]!;
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req.headers.get("origin")),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req), ...extra },
  });
}

export type Handler = (req: Request, ctx: { requestId: string }) => Promise<Response>;

/** Wraps a handler with CORS preflight, uniform error shape and structured logs. */
export function serveHandler(name: string, handler: Handler) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    const requestId = crypto.randomUUID();
    const started = performance.now();
    try {
      const res = await handler(req, { requestId });
      log(name, requestId, { status: res.status, ms: Math.round(performance.now() - started) });
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        log(name, requestId, { status: err.status, code: err.code, ms: Math.round(performance.now() - started) });
        return json(req, { error: { code: err.code, message: err.message } }, err.status);
      }
      if ((err as { name?: string })?.name === "ZodError") {
        const issue = (err as { issues?: Array<{ path: Array<string | number>; message: string }> }).issues?.[0];
        log(name, requestId, { status: 400, code: "invalid_request", field: issue?.path.join(".") });
        return json(req, { error: { code: "invalid_request", message: issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request." } }, 400);
      }
      console.error(JSON.stringify({ fn: name, requestId, level: "error", error: String(err), stack: (err as Error)?.stack }));
      return json(req, { error: { code: "internal", message: "Something went wrong. Please try again." } }, 500);
    }
  });
}

export function log(fn: string, requestId: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ fn, requestId, ...fields }));
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "bad_json", "Request body must be valid JSON.");
  }
}
