// Runs every minute (pg_cron). Starts scheduled campaigns, enforces safety, sends pre-call messages and dials targets.
import { serveHandler, HttpError, json, log } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { isServiceOrCron } from "../_shared/cron.ts";
import { engine } from "../_shared/engine.ts";
import { hasCredits } from "../_shared/credits.ts";
import { notify } from "../_shared/runtime-tools.ts";
import { agentProfile, fillVars, firstName, inCallingWindow, platformSetting, renderCampaignContext, type Schedule } from "../_shared/campaigns.ts";

const STALE_CALL_MS = 20 * 60_000;

serveHandler("campaign-dispatcher", async (req, { requestId }) => {
  if (!isServiceOrCron(req)) throw new HttpError(401, "unauthorized", "Service only.");
  const db = serviceClient();
  const flags = await platformSetting(db, "feature_flags", { campaigns_live: false });
  if (!flags.campaigns_live) return json(req, { skipped: "campaigns_disabled" });
  const safety = await platformSetting(db, "campaign_safety", { quiet_start: "21:00", quiet_end: "08:00", failure_pause_ratio: 0.4, failure_window: 20 });
  const now = new Date();

  // Scheduled → running.
  await db.from("campaigns").update({ status: "running" }).eq("status", "scheduled").lte("schedule->>start_at", now.toISOString());

  // Stale "calling" targets (no webhook arrived): release for retry.
  await db.from("campaign_targets").update({ status: "queued", locked_at: null, next_attempt_at: new Date(Date.now() + 30 * 60_000).toISOString() })
    .eq("status", "calling").lt("locked_at", new Date(Date.now() - STALE_CALL_MS).toISOString());

  const { data: running } = await db.from("campaigns").select("*, agent:agents(*)").eq("status", "running").limit(200);
  const stats = { campaigns: running?.length ?? 0, dialed: 0, notified: 0, paused: 0, completed: 0 };

  for (const c of running ?? []) {
    const agent = c.agent as Record<string, any>;
    const s = (c.schedule ?? {}) as Schedule;
    const pause = async (reason: string, title: string, body: string) => {
      await db.from("campaigns").update({ status: "paused", pause_reason: reason }).eq("id", c.id);
      await notify(db, c.workspace_id, "campaign", title, body, `/app/campaigns/${c.id}`);
      stats.paused++;
    };
    try {
      if (s.end_at && new Date(s.end_at) < now) { await finish(c, "Campaign ended at its scheduled end time."); continue; }
      if (agent.wa_status !== "connected" || !agent.engine_session_id) { await pause("agent_offline", `⏸ “${c.name}” paused`, "WhatsApp is disconnected. Reconnect it, then resume the campaign."); continue; }
      if (!(await hasCredits(db, c.workspace_id, 1))) { await pause("no_credits", `⏸ “${c.name}” paused`, "You're out of credits. Top up or upgrade, then resume."); continue; }

      // Failure-rate guard over the most recent attempts.
      const { data: recent } = await db.from("campaign_targets").select("status").eq("campaign_id", c.id).gt("attempts", 0).not("status", "in", "(queued,notified,calling)").order("last_attempt_at", { ascending: false }).limit(safety.failure_window);
      if ((recent?.length ?? 0) >= safety.failure_window && recent!.filter((r) => r.status === "failed").length / recent!.length >= safety.failure_pause_ratio) {
        await pause("failure_rate", `⚠️ “${c.name}” paused`, "Many calls are failing. Check the numbers in this campaign and your WhatsApp connection."); continue;
      }

      const { count: open } = await db.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["queued", "notified", "calling"]);
      if (!open) { await finish(c, "All contacts have been called."); continue; }

      // Pacing: concurrency, gap between dials, daily cap.
      const { count: inFlight } = await db.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "calling");
      let slots = Math.max(0, (s.concurrency ?? 1) - (inFlight ?? 0));
      if (!slots) continue;
      if (c.last_dial_at && Date.now() - +new Date(c.last_dial_at) < (s.gap_seconds ?? 30) * 1000) continue;
      const { count: today } = await db.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).gte("last_attempt_at", new Date(Date.now() - 86_400_000).toISOString());
      slots = Math.min(slots, Math.max(0, (s.daily_cap ?? 80) - (today ?? 0)));
      if (!slots) continue;

      const profile = await agentProfile(db, agent);
      const { data: due } = await db.from("campaign_targets").select("*").eq("campaign_id", c.id).in("status", ["queued", "notified"]).lte("next_attempt_at", now.toISOString()).order("next_attempt_at").limit(50);
      const dnc = new Set(((await db.from("dnc_list").select("phone_e164").eq("workspace_id", c.workspace_id).in("phone_e164", (due ?? []).map((d) => d.phone_e164))).data ?? []).map((d) => d.phone_e164));

      for (const t of due ?? []) {
        if (!slots) break;
        if (dnc.has(t.phone_e164)) { await db.from("campaign_targets").update({ status: "skipped_dnc" }).eq("id", t.id); continue; }
        const tz = s.window_tz === "business" ? profile.tz : t.local_tz ?? profile.tz;
        if (!inCallingWindow(s, tz, safety, now)) continue;
        const vars = { business_name: profile.name, first_name: firstName(t.name) || t.variables?.first_name || "", ...(t.variables ?? {}) };

        // Optional heads-up message, then dial after the lead time.
        if (s.pre_call_message?.enabled && !t.pre_call_sent_at && t.attempts === 0) {
          try { await engine.sendText(agent.engine_session_id, t.phone_e164, fillVars(s.pre_call_message.text ?? "", vars)); } catch (e) { console.error(JSON.stringify({ where: "pre_call", error: String(e) })); }
          await db.from("campaign_targets").update({ status: "notified", pre_call_sent_at: now.toISOString(), next_attempt_at: new Date(Date.now() + (s.pre_call_message.lead_minutes ?? 10) * 60_000).toISOString() }).eq("id", t.id);
          stats.notified++; continue;
        }

        // Claim (optimistic: only if still queued/notified) before dialing.
        const { data: claimed } = await db.from("campaign_targets").update({ status: "calling", locked_at: now.toISOString(), attempts: t.attempts + 1, last_attempt_at: now.toISOString() })
          .eq("id", t.id).in("status", ["queued", "notified"]).select("id").maybeSingle();
        if (!claimed) continue;
        try {
          const r = await engine.startCall(agent.engine_session_id, {
            phone: t.phone_e164, client_ref: t.id, greeting: fillVars(c.opening_line ?? "", vars),
            context: await renderCampaignContext(db, c, t, profile.name), max_call_seconds: s.max_call_seconds ?? 300,
          });
          await db.from("campaign_targets").update({ last_call_id: r.call_id ?? null }).eq("id", t.id);
          await db.from("campaigns").update({ last_dial_at: new Date().toISOString() }).eq("id", c.id);
          stats.dialed++; slots--;
          break; // one dial per campaign per tick keeps the gap honest
        } catch (e) {
          const msg = String(e);
          const permanent = /invalid|not.?on.?whatsapp|400|404/i.test(msg);
          await db.from("campaign_targets").update({ status: permanent || t.attempts + 1 > 3 ? "failed" : "queued", locked_at: null, next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(), outcome_summary: msg.slice(0, 200) }).eq("id", t.id);
          log("campaign-dispatcher", requestId, { campaign: c.id, target: t.id, dial_error: msg.slice(0, 200) });
          if (/409|busy|in.?call/i.test(msg)) break; // engine busy: wait for next tick
        }
      }
    } catch (e) {
      log("campaign-dispatcher", requestId, { campaign: c.id, error: String(e).slice(0, 300) });
    }
  }

  async function finish(c: Record<string, any>, why: string) {
    await db.from("campaign_targets").update({ status: "cancelled" }).eq("campaign_id", c.id).in("status", ["queued", "notified"]);
    await db.from("campaigns").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", c.id);
    const { data: st } = await db.from("campaign_stats").select("*").eq("campaign_id", c.id).maybeSingle();
    await notify(db, c.workspace_id, "campaign", `✅ “${c.name}” finished`, `${why} ${st ? `${st.answered} answered · ${st.converted} converted of ${st.total}.` : ""}`, `/app/campaigns/${c.id}`);
    stats.completed++;
  }

  log("campaign-dispatcher", requestId, stats);
  return json(req, stats);
});
