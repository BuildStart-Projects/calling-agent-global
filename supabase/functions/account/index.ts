// Account lifecycle: delete an agent, export workspace data, request workspace deletion (30-day grace), daily purge (cron).
import { z } from "npm:zod@3.25.76";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serveHandler, HttpError, json, log, readJson } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/supabase.ts";
import { isServiceOrCron } from "../_shared/cron.ts";
import { engine } from "../_shared/engine.ts";
import { stripe } from "../_shared/stripe.ts";

const GRACE_DAYS = 30;
const BUCKETS = ["documents", "catalog-media", "campaign-imports", "inbound-media"];

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete_agent"), agent_id: z.string().uuid(), confirm_name: z.string() }),
  z.object({ action: z.literal("export") }),
  z.object({ action: z.literal("request_deletion"), confirm_name: z.string(), reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("purge") }),
]);

serveHandler("account", async (req, { requestId }) => {
  const body = Body.parse(await readJson(req));
  const db = serviceClient();

  if (body.action === "purge") {
    if (!isServiceOrCron(req)) throw new HttpError(401, "unauthorized", "Not allowed.");
    const { data: due } = await db.from("workspaces").select("id,name").eq("status", "pending_deletion").lte("deletion_scheduled_for", new Date().toISOString()).limit(20);
    const done: string[] = [];
    for (const w of due ?? []) {
      try { await purgeWorkspace(db, w.id); done.push(w.id); } catch (e) { log("account", requestId, { purge_failed: w.id, error: String(e) }); }
    }
    return json(req, { purged: done.length });
  }

  const user = await requireUser(req);
  const { data: m } = await db.from("workspace_members").select("role, workspace:workspaces(*)").eq("user_id", user.id).limit(1).maybeSingle();
  const ws = m?.workspace as unknown as Record<string, any> | undefined;
  if (!ws) throw new HttpError(404, "not_found", "Workspace not found.");

  switch (body.action) {
    case "delete_agent": {
      if (!["owner", "admin"].includes(m!.role)) throw new HttpError(403, "forbidden", "Only the owner or an admin can delete agents.");
      const { data: agent } = await db.from("agents").select("*").eq("id", body.agent_id).eq("workspace_id", ws.id).maybeSingle();
      if (!agent) throw new HttpError(404, "not_found", "Agent not found.");
      if (body.confirm_name.trim() !== agent.name.trim()) throw new HttpError(400, "confirm_mismatch", "Type the agent's name exactly to confirm.");
      await teardownAgent(db, agent);
      for (const b of BUCKETS) await removePrefix(db, b, `${ws.id}/${agent.id}`);
      const { error } = await db.from("agents").delete().eq("id", agent.id);
      if (error) throw error;
      return json(req, { deleted: true });
    }

    case "export": {
      const [agents, contacts, leads, bookings, orders, calls, campaigns] = await Promise.all([
        db.from("agents").select("id,name,type,status,industry_key,wa_phone,handoff_phone_e164,created_at").eq("workspace_id", ws.id),
        db.from("contacts").select("id,name,push_name,phone_e164,tags,notes,source,do_not_contact,first_seen_at,last_seen_at").eq("workspace_id", ws.id).limit(50_000),
        db.from("leads").select("id,agent_id,contact_id,intent,summary,details,status,urgency,source,created_at").eq("workspace_id", ws.id).eq("is_test", false).limit(50_000),
        db.from("bookings").select("*").eq("workspace_id", ws.id).limit(50_000),
        db.from("orders").select("*").eq("workspace_id", ws.id).limit(50_000),
        db.from("calls").select("id,agent_id,contact_id,direction,caller_number,started_at,ended_at,duration_seconds,outcome,summary,transcript,campaign_id").eq("workspace_id", ws.id).limit(50_000),
        db.from("campaigns").select("id,name,status,created_at").eq("workspace_id", ws.id),
      ]);
      const agentIds = (agents.data ?? []).map((a) => a.id);
      const [catalog, faqs, convos] = agentIds.length ? await Promise.all([
        db.from("catalog_items").select("*").in("agent_id", agentIds),
        db.from("faqs").select("*").in("agent_id", agentIds),
        db.from("conversations").select("id,agent_id,contact_id,summary,created_at,messages(direction,sender,type,text,created_at)").in("agent_id", agentIds).eq("is_test", false).limit(5_000),
      ]) : [{ data: [] }, { data: [] }, { data: [] }];
      return json(req, {
        exported_at: new Date().toISOString(),
        workspace: { id: ws.id, name: ws.name, country: ws.country, timezone: ws.timezone, created_at: ws.created_at },
        agents: agents.data, knowledge: { catalog: catalog.data, faqs: faqs.data },
        contacts: contacts.data, conversations: convos.data, calls: calls.data, leads: leads.data, bookings: bookings.data, orders: orders.data, campaigns: campaigns.data,
      });
    }

    case "request_deletion": {
      if (m!.role !== "owner") throw new HttpError(403, "forbidden", "Only the workspace owner can delete the workspace.");
      if (ws.status === "pending_deletion") return json(req, { status: "pending_deletion", scheduled_for: ws.deletion_scheduled_for });
      if (body.confirm_name.trim() !== String(ws.name).trim()) throw new HttpError(400, "confirm_mismatch", "Type the workspace name exactly to confirm.");
      const { data: agents } = await db.from("agents").select("*").eq("workspace_id", ws.id);
      for (const a of agents ?? []) await teardownAgent(db, a);
      await db.from("campaigns").update({ status: "cancelled" }).eq("workspace_id", ws.id).in("status", ["draft", "scheduled", "running", "paused"]);
      // Stop future charges; credits already paid stay until the period ends (restorable by support within the grace period).
      const { data: subs } = await db.from("subscriptions").select("id,stripe_subscription_id").eq("workspace_id", ws.id).in("status", ["active", "trialing", "past_due"]);
      for (const s of subs ?? []) {
        if (!s.stripe_subscription_id) continue;
        try { await stripe("POST", `/subscriptions/${s.stripe_subscription_id}`, { cancel_at_period_end: true }); await db.from("subscriptions").update({ cancel_at_period_end: true }).eq("id", s.id); }
        catch (e) { log("account", requestId, { stripe_cancel_failed: s.stripe_subscription_id, error: String(e) }); }
      }
      const scheduled = new Date(Date.now() + GRACE_DAYS * 86_400_000).toISOString();
      const { error } = await db.from("workspaces").update({ status: "pending_deletion", deletion_requested_at: new Date().toISOString(), deletion_scheduled_for: scheduled, deletion_reason: body.reason ?? null }).eq("id", ws.id);
      if (error) throw error;
      log("account", requestId, { deletion_requested: ws.id, scheduled });
      return json(req, { status: "pending_deletion", scheduled_for: scheduled });
    }
  }
});

/** Disconnects WhatsApp and removes the engine config, then marks the agent offline. Best effort on the engine side. */
async function teardownAgent(db: SupabaseClient, agent: Record<string, any>) {
  const sids = new Set<string>();
  if (agent.engine_session_id) sids.add(agent.engine_session_id);
  try { for (const s of (await engine.listSessions(agent.id)).sessions ?? []) sids.add(s.id); } catch { /* engine unreachable: still continue */ }
  for (const sid of sids) { await engine.logout(sid).catch(() => null); await engine.deleteSession(sid).catch(() => null); }
  await engine.deleteAgentConfig(agent.id).catch(() => null);
  await db.from("agents").update({ status: "paused", pause_reason: "user", wa_status: "not_connected", wa_jid: null, engine_session_id: null }).eq("id", agent.id);
  await db.from("campaigns").update({ status: "cancelled" }).eq("agent_id", agent.id).in("status", ["draft", "scheduled", "running", "paused"]);
}

/** Removes every object under `prefix` (folders are listed recursively). */
async function removePrefix(db: SupabaseClient, bucket: string, prefix: string) {
  const { data } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!data?.length) return;
  const files = data.filter((o) => o.id).map((o) => `${prefix}/${o.name}`);
  for (const dir of data.filter((o) => !o.id)) await removePrefix(db, bucket, `${prefix}/${dir.name}`);
  for (let i = 0; i < files.length; i += 100) await db.storage.from(bucket).remove(files.slice(i, i + 100));
  if (data.length === 1000) await removePrefix(db, bucket, prefix);
}

async function purgeWorkspace(db: SupabaseClient, wsId: string) {
  const { data: agents } = await db.from("agents").select("*").eq("workspace_id", wsId);
  for (const a of agents ?? []) await teardownAgent(db, a);
  const { data: subs } = await db.from("subscriptions").select("stripe_subscription_id").eq("workspace_id", wsId).in("status", ["active", "trialing", "past_due"]);
  for (const s of subs ?? []) if (s.stripe_subscription_id) await stripe("DELETE", `/subscriptions/${s.stripe_subscription_id}`).catch(() => null);
  for (const b of BUCKETS) await removePrefix(db, b, wsId);
  const { data: members } = await db.from("workspace_members").select("user_id").eq("workspace_id", wsId);
  const { error } = await db.from("workspaces").delete().eq("id", wsId);
  if (error) throw error;
  // Remove sign-in accounts that no longer belong to any workspace (and aren't platform admins).
  for (const mem of members ?? []) {
    const [{ count }, { data: admin }] = await Promise.all([
      db.from("workspace_members").select("user_id", { count: "exact", head: true }).eq("user_id", mem.user_id),
      db.from("platform_admins").select("user_id").eq("user_id", mem.user_id).maybeSingle(),
    ]);
    if (!count && !admin) await db.auth.admin.deleteUser(mem.user_id);
  }
}
