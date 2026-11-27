import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { compileCalling, compileMessaging, engineConfig, ensureShortTexts, loadCompileContext, sha256 } from "./compiler.ts";
import { engine } from "./engine.ts";
import { chargeUsage } from "./credits.ts";

/** Compiles both agents' prompts and (when the agent is registered with the engine) pushes the voice config. */
export async function compileAgent(db: SupabaseClient, agentId: string, opts: { pushEngine?: boolean } = {}) {
  let ctx = await loadCompileContext(db, agentId);
  const short = await ensureShortTexts(db, ctx);
  if (short.updated) ctx = await loadCompileContext(db, agentId);
  if (short.usage.input_tokens) {
    await chargeUsage(db, { workspaceId: ctx.workspace.id, agentId, agentKind: "orchestrator", meter: "orchestrator_tokens", usage: short.usage, refType: "compile", refId: agentId });
  }
  const calling = await compileCalling(db, ctx);
  const messaging = await compileMessaging(db, ctx);
  const now = new Date().toISOString();
  const callingHash = await sha256(calling.prompt);
  await db.from("channel_configs").update({ compiled_prompt: calling.prompt, compiled_hash: callingHash, template_version: calling.version, compiled_at: now }).eq("agent_id", agentId).eq("channel", "calling");
  await db.from("channel_configs").update({ compiled_prompt: messaging.prompt, compiled_hash: await sha256(messaging.prompt), template_version: messaging.version, compiled_at: now }).eq("agent_id", agentId).eq("channel", "messaging");
  await db.from("agent_blueprints").update({ pending_compile: false }).eq("agent_id", agentId);

  let engineSynced = false;
  let engineError: string | null = null;
  const shouldPush = opts.pushEngine ?? Boolean(ctx.agent.engine_session_id);
  if (shouldPush && Deno.env.get("ENGINE_BASE_URL")) {
    try {
      await engine.putAgentConfig(agentId, engineConfig(ctx, calling.prompt));
      engineSynced = true;
    } catch (e) {
      engineError = (e as Error).message;
    }
    await db.from("agents").update({ engine_synced_at: engineSynced ? now : ctx.agent.engine_synced_at, engine_sync_error: engineError }).eq("id", agentId);
  }
  return { callingChars: calling.prompt.length, messagingChars: messaging.prompt.length, engineSynced, engineError };
}
