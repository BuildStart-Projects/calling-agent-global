import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./http.ts";

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Client acting as the calling user (RLS applies). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request): Promise<User> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "unauthorized", "Please sign in again.");
  const { data, error } = await serviceClient().auth.getUser(auth.slice(7));
  if (error || !data.user) throw new HttpError(401, "unauthorized", "Your session has expired. Please sign in again.");
  return data.user;
}

export type MemberContext = { user: User; workspaceId: string; role: "owner" | "admin" | "member" };

/** Resolves an agent the caller may act on, enforcing workspace membership. */
export async function requireAgentAccess(req: Request, agentId: string, roles: Array<MemberContext["role"]> = ["owner", "admin", "member"]) {
  const user = await requireUser(req);
  const db = serviceClient();
  const { data: agent } = await db.from("agents").select("*").eq("id", agentId).maybeSingle();
  if (!agent) throw new HttpError(404, "not_found", "Agent not found.");
  const { data: m } = await db.from("workspace_members").select("role").eq("workspace_id", agent.workspace_id).eq("user_id", user.id).maybeSingle();
  if (!m || !roles.includes(m.role)) throw new HttpError(404, "not_found", "Agent not found.");
  const { data: ws } = await db.from("workspaces").select("*").eq("id", agent.workspace_id).single();
  if (ws.status !== "active") throw new HttpError(403, ws.status === "pending_deletion" ? "workspace_deleting" : "workspace_suspended", ws.status === "pending_deletion" ? "This workspace is scheduled for deletion. Contact support to restore it." : "This workspace is suspended. Please contact support.");
  return { user, agent, workspace: ws, role: m.role as MemberContext["role"], db };
}

export async function requirePlatformAdmin(req: Request) {
  const user = await requireUser(req);
  const db = serviceClient();
  const { data } = await db.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!data) throw new HttpError(403, "forbidden", "Admins only.");
  // Money- and data-changing admin actions require MFA (AAL2).
  const token = req.headers.get("Authorization")!.slice(7);
  const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.aal !== "aal2") throw new HttpError(403, "mfa_required", "Please verify with your authenticator app.");
  return { user, db };
}

/** Storage URLs signed inside the runtime use the internal host; rewrite them to the public API URL. */
export function publicUrl(url: string | null): string | null {
  const pub = Deno.env.get("PUBLIC_SUPABASE_URL");
  if (!url || !pub) return url;
  // Replace scheme, hostname AND port: assigning `host` without a port keeps the internal one (e.g. api-gw:8000).
  try { const u = new URL(url); const p = new URL(pub); u.protocol = p.protocol; u.hostname = p.hostname; u.port = p.port; return u.toString(); } catch { return url; }
}
