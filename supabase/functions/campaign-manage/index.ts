// Campaign CRUD for owners: draft, AI script, targets (file rows / contacts / quick audiences), launch, pause, resume, cancel.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess, serviceClient } from "../_shared/supabase.ts";
import { aiGenerate, MODELS, parseJsonObject } from "../_shared/llm.ts";
import { chargeUsage, hasCredits } from "../_shared/credits.ts";
import { render, template } from "../_shared/templating.ts";
import { agentProfile, fillVars, firstName, normalizePhone, platformSetting, quickAudience, renderCampaignContext, type AudienceRow, type QuickType, type Schedule } from "../_shared/campaigns.ts";

const QUICK = ["leads_24h", "missed_callers", "confirm_tomorrow", "retry_no_answers", "win_back", "follow_up_inquiries", "feedback"] as const;
const GOAL = ["lead_follow_up", "missed_callers", "booking_confirmation", "promotion", "reactivation", "feedback", "custom"] as const;
const QUICK_GOAL: Record<QuickType, (typeof GOAL)[number]> = { leads_24h: "lead_follow_up", follow_up_inquiries: "lead_follow_up", missed_callers: "missed_callers", confirm_tomorrow: "booking_confirmation", retry_no_answers: "custom", win_back: "reactivation", feedback: "feedback" };
const QUICK_BRIEF: Record<QuickType, string> = {
  leads_24h: "Call people who enquired in the last 24 hours, answer their question and help them take the next step.",
  follow_up_inquiries: "Follow up with people who enquired a few days ago and haven't decided yet.",
  missed_callers: "Call back people whose calls we missed and help them with what they needed.",
  confirm_tomorrow: "Confirm tomorrow's appointment. If they can't make it, offer to reschedule.",
  retry_no_answers: "Try again with people who didn't answer last time.",
  win_back: "Check in with customers we haven't seen for a while and invite them back.",
  feedback: "Ask recent customers how their experience was and whether anything could be better.",
};

const Row = z.object({ phone: z.string().min(4).max(40), name: z.string().max(120).optional().nullable(), vars: z.record(z.string().max(300)).optional() });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), agent_id: z.string().uuid(), goal_type: z.enum(GOAL).default("custom"), brief: z.string().max(1500).optional(), quick: z.enum(QUICK).optional() }),
  z.object({ action: z.literal("generate_script"), campaign_id: z.string().uuid(), brief: z.string().min(5).max(1500) }),
  z.object({ action: z.literal("update"), campaign_id: z.string().uuid(), patch: z.object({ name: z.string().min(1).max(120).optional(), goal_type: z.enum(GOAL).optional(), script: z.record(z.unknown()).optional(), opening_line: z.string().max(400).optional(), schedule: z.record(z.unknown()).optional() }) }),
  z.object({ action: z.literal("add_rows"), campaign_id: z.string().uuid(), rows: z.array(Row).max(5000), source: z.string().max(120).optional() }),
  z.object({ action: z.literal("add_contacts"), campaign_id: z.string().uuid(), contact_ids: z.array(z.string().uuid()).max(5000).optional(), tag: z.string().max(60).optional() }),
  z.object({ action: z.literal("add_quick"), campaign_id: z.string().uuid(), quick: z.enum(QUICK) }),
  z.object({ action: z.literal("quick_counts"), agent_id: z.string().uuid() }),
  z.object({ action: z.literal("remove_targets"), campaign_id: z.string().uuid(), target_ids: z.array(z.string().uuid()).max(5000) }),
  z.object({ action: z.literal("preview"), campaign_id: z.string().uuid() }),
  z.object({ action: z.literal("launch"), campaign_id: z.string().uuid(), consent: z.literal(true) }),
  z.object({ action: z.literal("pause"), campaign_id: z.string().uuid() }),
  z.object({ action: z.literal("resume"), campaign_id: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), campaign_id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), campaign_id: z.string().uuid() }),
]);

export const DEFAULT_SCHEDULE: Schedule = {
  start_at: null, end_at: null, window_tz: "contact",
  windows: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [["10:00", "18:00"]]])) as Schedule["windows"],
  concurrency: 1, gap_seconds: 30, daily_cap: 80, retries: { max: 1, spacing_minutes: 120 },
  pre_call_message: { enabled: false, lead_minutes: 10, text: "Hi {{first_name}}, this is {{business_name}}. We'll give you a quick call in a few minutes." },
  no_answer_message: { enabled: false, text: "Hi {{first_name}}, we tried to call you from {{business_name}}. Reply here whenever suits you." },
};

serveHandler("campaign-manage", async (req) => {
  const body = Body.parse(await readJson(req));
  const db = serviceClient();

  // Resolve agent + access (campaign actions resolve via the campaign's agent).
  let campaign: Record<string, any> | null = null;
  let agentId: string;
  if ("campaign_id" in body) {
    const { data } = await db.from("campaigns").select("*").eq("id", body.campaign_id).maybeSingle();
    if (!data) throw new HttpError(404, "not_found", "Campaign not found.");
    campaign = data; agentId = data.agent_id;
  } else agentId = body.agent_id;
  const { agent, user, workspace } = await requireAgentAccess(req, agentId, ["owner", "admin"]);
  const profile = await agentProfile(db, agent);
  const editable = () => { if (!campaign || !["draft", "scheduled", "paused"].includes(campaign.status)) throw new HttpError(409, "not_editable", "Pause the campaign to change it."); };

  switch (body.action) {
    case "draft": {
      if (agent.type === "messaging") throw new HttpError(400, "no_calling", "This agent doesn't make calls.");
      const goal = body.quick ? QUICK_GOAL[body.quick] : body.goal_type;
      const { data: c, error } = await db.from("campaigns").insert({
        workspace_id: agent.workspace_id, agent_id: agent.id, name: body.quick ? quickName(body.quick) : "New campaign", goal_type: goal,
        schedule: { ...DEFAULT_SCHEDULE, daily_cap: (await platformSetting(db, "campaign_safety", { default_daily_cap: 80 })).default_daily_cap }, created_by: user.id,
      }).select("*").single();
      if (error) throw error;
      campaign = c;
      const brief = body.brief ?? (body.quick ? QUICK_BRIEF[body.quick] : null);
      if (brief) campaign = await writeScript(c, brief);
      if (body.quick) { const added = await addRows(c, (await quickAudience(db, agent.workspace_id, agent.id, body.quick, profile.tz)).map(toRow), `quick:${body.quick}`); return json(req, { campaign, added }); }
      return json(req, { campaign });
    }
    case "generate_script": editable(); return json(req, { campaign: await writeScript(campaign!, body.brief) });
    case "update": {
      editable();
      const patch: Record<string, unknown> = { ...body.patch };
      if (body.patch.schedule) patch.schedule = await sanitizeSchedule({ ...campaign!.schedule, ...body.patch.schedule });
      if (body.patch.script) patch.script = { ...campaign!.script, ...body.patch.script };
      const { data } = await db.from("campaigns").update(patch).eq("id", campaign!.id).select("*").single();
      return json(req, { campaign: data });
    }
    case "add_rows": editable(); return json(req, { added: await addRows(campaign!, body.rows, body.source ?? "file") });
    case "add_contacts": {
      editable();
      let q = db.from("contacts").select("id,phone_e164,name,push_name,do_not_contact").eq("workspace_id", agent.workspace_id).eq("do_not_contact", false).not("phone_e164", "is", null).limit(5000);
      if (body.contact_ids?.length) q = q.in("id", body.contact_ids);
      else if (body.tag) q = q.contains("tags", [body.tag]);
      const { data } = await q;
      return json(req, { added: await addRows(campaign!, (data ?? []).map((c) => ({ phone: c.phone_e164!, name: c.name ?? c.push_name, vars: { first_name: firstName(c.name ?? c.push_name) }, contact_id: c.id })), body.tag ? `tag:${body.tag}` : "contacts") });
    }
    case "add_quick": editable(); return json(req, { added: await addRows(campaign!, (await quickAudience(db, agent.workspace_id, agent.id, body.quick, profile.tz)).map(toRow), `quick:${body.quick}`) });
    case "quick_counts": {
      const out: Record<string, number> = {};
      await Promise.all(QUICK.map(async (q) => { out[q] = (await quickAudience(db, agent.workspace_id, agent.id, q, profile.tz)).length; }));
      return json(req, { counts: out });
    }
    case "remove_targets": editable(); await db.from("campaign_targets").delete().eq("campaign_id", campaign!.id).in("id", body.target_ids).in("status", ["queued", "notified"]); return json(req, { ok: true });
    case "preview": {
      const { data: t } = await db.from("campaign_targets").select("*").eq("campaign_id", campaign!.id).limit(1).maybeSingle();
      const target = t ?? { name: "Alex", variables: { first_name: "Alex" } };
      return json(req, {
        opening_line: fillVars(campaign!.opening_line ?? "", { business_name: profile.name, first_name: firstName(target.name) || target.variables?.first_name || "", ...(target.variables ?? {}) }),
        context: await renderCampaignContext(db, campaign!, target, profile.name),
        estimate: await estimate(campaign!),
      });
    }
    case "launch": {
      editable();
      const flags = await platformSetting(db, "feature_flags", { campaigns_live: false });
      if (!flags.campaigns_live) throw new HttpError(403, "campaigns_disabled", "Campaign calling isn't enabled on this platform yet.");
      if (!user.email_confirmed_at) throw new HttpError(403, "email_unverified", "Verify your email before launching a campaign.");
      if (agent.wa_status !== "connected") throw new HttpError(409, "not_connected", "Connect WhatsApp before launching.");
      if (agent.status !== "live") throw new HttpError(409, "agent_not_live", "Put your agent live before launching.");
      if (!campaign!.opening_line?.trim() || !campaign!.script?.purpose) throw new HttpError(400, "no_script", "Add a purpose and opening line first.");
      const est = await estimate(campaign!);
      if (!est.targets) throw new HttpError(400, "no_targets", "Add at least one number to call.");
      if (!(await hasCredits(db, workspace.id, Math.min(est.credits, 2)))) throw new HttpError(402, "out_of_credits", "You need credits to launch. Top up or upgrade.");
      const { count: active } = await db.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", ["running", "scheduled"]);
      if ((active ?? 0) >= (profile.limits.max_active_campaigns ?? 1)) throw new HttpError(402, "plan_limit", "Your plan's active campaign limit is reached. Upgrade or finish another campaign.");
      const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
      const { data: used } = await db.from("campaigns").select("id, targets:campaign_targets(count)").eq("workspace_id", workspace.id).gte("launched_at", monthStart.toISOString());
      const usedTargets = (used ?? []).reduce((n, c: any) => n + (c.targets?.[0]?.count ?? 0), 0);
      if (usedTargets + est.targets > (profile.limits.max_campaign_targets_per_month ?? 100)) throw new HttpError(402, "plan_limit", `Your plan allows ${profile.limits.max_campaign_targets_per_month ?? 100} campaign contacts a month.`);
      const s = campaign!.schedule as Schedule;
      const future = s.start_at && new Date(s.start_at) > new Date();
      const { data } = await db.from("campaigns").update({ status: future ? "scheduled" : "running", pause_reason: null, consent_attested_at: new Date().toISOString(), consent_attested_by: user.id, launched_at: new Date().toISOString() }).eq("id", campaign!.id).select("*").single();
      return json(req, { campaign: data, estimate: est });
    }
    case "pause": {
      if (!["running", "scheduled"].includes(campaign!.status)) throw new HttpError(409, "not_running", "Campaign isn't running.");
      const { data } = await db.from("campaigns").update({ status: "paused", pause_reason: "user" }).eq("id", campaign!.id).select("*").single();
      return json(req, { campaign: data });
    }
    case "resume": {
      if (campaign!.status !== "paused") throw new HttpError(409, "not_paused", "Campaign isn't paused.");
      if (agent.wa_status !== "connected") throw new HttpError(409, "not_connected", "Reconnect WhatsApp first.");
      if (!(await hasCredits(db, workspace.id, 1))) throw new HttpError(402, "out_of_credits", "Top up to resume.");
      const { data } = await db.from("campaigns").update({ status: "running", pause_reason: null }).eq("id", campaign!.id).select("*").single();
      return json(req, { campaign: data });
    }
    case "cancel": {
      await db.from("campaign_targets").update({ status: "cancelled" }).eq("campaign_id", campaign!.id).in("status", ["queued", "notified"]);
      const { data } = await db.from("campaigns").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", campaign!.id).select("*").single();
      return json(req, { campaign: data });
    }
    case "delete": {
      if (!["draft", "cancelled", "completed"].includes(campaign!.status)) throw new HttpError(409, "not_deletable", "Cancel the campaign first.");
      await db.from("campaigns").delete().eq("id", campaign!.id);
      return json(req, { ok: true });
    }
  }

  // ───────── helpers (closures over agent/profile) ─────────
  function toRow(a: AudienceRow) { return { phone: a.phone, name: a.name, vars: a.variables, contact_id: a.contact_id }; }

  async function writeScript(c: Record<string, any>, brief: string) {
    const t = await template(db, "campaign.script_writer");
    const langName = new Intl.DisplayNames(["en"], { type: "language" }).of(profile.language.split("-")[0]!) ?? "English";
    const system = render(t.body, { industry: profile.industry, business_name: profile.name, brief: brief.replace(/"/g, "'"), goal_type: c.goal_type, language_name: langName });
    const res = await aiGenerate({ model: MODELS.orchestrator, messages: [{ role: "system", content: system }, { role: "user", content: "Write the campaign." }], maxTokens: 900, temperature: 0.4 });
    await chargeUsage(db, { workspaceId: agent.workspace_id, agentId: agent.id, agentKind: "orchestrator", meter: "orchestrator_tokens", usage: res.usage, refType: "campaign", refId: c.id, campaignId: c.id });
    const j = parseJsonObject<Record<string, any>>(res.text);
    if (!j) throw new HttpError(502, "ai_failed", "Couldn't write the script. Try again.");
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x: string) => x.slice(0, 200)) : []);
    const script = {
      purpose: String(j.purpose ?? brief).slice(0, 300), key_points: arr(j.key_points, 4), offer: j.offer ? String(j.offer).slice(0, 200) : null,
      offer_validity: j.offer_validity ? String(j.offer_validity).slice(0, 80) : null, questions_to_ask: arr(j.questions_to_ask, 3),
      success_definition: String(j.success_definition ?? "").slice(0, 200), collect_fields: arr(j.collect_fields, 5), brief,
    };
    // No invented offers: drop an offer the owner's brief doesn't support (any number in the offer must appear in the brief).
    if (script.offer && (script.offer.match(/\d+/g) ?? []).some((n) => !brief.includes(n))) { script.offer = null; script.offer_validity = null; }
    const opening = String(j.opening_line ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 30).join(" ");
    const { data } = await db.from("campaigns").update({ script, opening_line: opening || null, name: c.name === "New campaign" && j.name ? String(j.name).slice(0, 60) : c.name }).eq("id", c.id).select("*").single();
    return data!;
  }

  async function addRows(c: Record<string, any>, rows: Array<{ phone: string; name?: string | null; vars?: Record<string, string>; contact_id?: string | null }>, source: string) {
    const dnc = new Set(((await db.from("dnc_list").select("phone_e164").eq("workspace_id", agent.workspace_id)).data ?? []).map((d) => d.phone_e164));
    const { data: existing } = await db.from("campaign_targets").select("phone_e164").eq("campaign_id", c.id);
    const seen = new Set((existing ?? []).map((e) => e.phone_e164));
    let invalid = 0, duplicates = 0, skippedDnc = 0;
    const out: Record<string, unknown>[] = [];
    for (const r of rows) {
      const n = normalizePhone(r.phone, profile.country);
      if (!n) { invalid++; continue; }
      if (seen.has(n.e164)) { duplicates++; continue; }
      seen.add(n.e164);
      if (dnc.has(n.e164)) { skippedDnc++; continue; }
      const name = r.name?.trim() || null;
      out.push({ campaign_id: c.id, contact_id: r.contact_id ?? null, phone_e164: n.e164, name, local_tz: n.tz ?? profile.tz, variables: { first_name: firstName(name), ...(r.vars ?? {}) } });
    }
    // Link to existing contacts by phone (no new contacts are created until someone is actually called).
    const unlinked = out.filter((o) => !o.contact_id).map((o) => o.phone_e164 as string);
    if (unlinked.length) {
      const { data: cs } = await db.from("contacts").select("id,phone_e164,do_not_contact").eq("workspace_id", agent.workspace_id).in("phone_e164", unlinked.slice(0, 1000));
      const byPhone = new Map((cs ?? []).map((x) => [x.phone_e164, x]));
      for (const o of out) { const m = byPhone.get(o.phone_e164 as string); if (m) o.contact_id = m.id; }
      for (let i = out.length - 1; i >= 0; i--) if (byPhone.get(out[i]!.phone_e164 as string)?.do_not_contact) { out.splice(i, 1); skippedDnc++; }
    }
    for (let i = 0; i < out.length; i += 500) {
      const { error } = await db.from("campaign_targets").insert(out.slice(i, i + 500));
      if (error) throw error;
    }
    const summary = { ...(c.source_summary ?? {}) };
    summary[source] = (summary[source] ?? 0) + out.length;
    await db.from("campaigns").update({ source_summary: summary }).eq("id", c.id);
    return { added: out.length, invalid, duplicates, dnc: skippedDnc };
  }

  async function sanitizeSchedule(s: Record<string, any>): Promise<Schedule> {
    const safety = await platformSetting(db, "campaign_safety", { max_daily_cap: 300 });
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    const windows: Schedule["windows"] = {};
    for (const d of ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]) {
      const w = (s.windows?.[d] ?? []).filter((x: unknown) => Array.isArray(x) && hhmm.test(x[0]) && hhmm.test(x[1]) && x[0] < x[1]).slice(0, 3);
      if (w.length) windows[d] = w;
    }
    const iso = (v: unknown) => (typeof v === "string" && !isNaN(+new Date(v)) ? new Date(v).toISOString() : null);
    const clamp = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
    const text = (v: unknown, d: string) => (typeof v === "string" ? v.slice(0, 400) : d);
    return {
      start_at: iso(s.start_at), end_at: iso(s.end_at), window_tz: s.window_tz === "business" ? "business" : "contact", windows,
      concurrency: clamp(s.concurrency, 1, profile.limits.max_concurrent_campaign_calls ?? 1, 1),
      gap_seconds: clamp(s.gap_seconds, 10, 600, 30), daily_cap: clamp(s.daily_cap, 1, safety.max_daily_cap, 80),
      retries: { max: clamp(s.retries?.max, 0, 3, 1), spacing_minutes: clamp(s.retries?.spacing_minutes, 30, 1440, 120) },
      pre_call_message: { enabled: Boolean(s.pre_call_message?.enabled), lead_minutes: clamp(s.pre_call_message?.lead_minutes, 2, 120, 10), text: text(s.pre_call_message?.text, DEFAULT_SCHEDULE.pre_call_message!.text!) },
      no_answer_message: { enabled: Boolean(s.no_answer_message?.enabled), text: text(s.no_answer_message?.text, DEFAULT_SCHEDULE.no_answer_message!.text!) },
      max_call_seconds: clamp(s.max_call_seconds, 60, profile.limits.max_call_seconds ?? 600, Math.min(300, profile.limits.max_call_seconds ?? 300)),
    };
  }

  async function estimate(c: Record<string, any>) {
    const { count } = await db.from("campaign_targets").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).in("status", ["queued", "notified"]);
    const { data: rule } = await db.from("credit_rules").select("credits").eq("meter", "campaign_call_minutes").eq("unit", "per_minute").lte("effective_from", new Date().toISOString()).order("effective_from", { ascending: false }).limit(1).maybeSingle();
    const perMin = Number(rule?.credits ?? 1);
    const targets = count ?? 0;
    // Typical: ~60% answer, ~1.5 min average answered call; unanswered attempts cost nothing.
    return { targets, credits: Math.ceil(targets * 0.6 * 1.5 * perMin), max_credits: Math.ceil(targets * ((c.schedule?.max_call_seconds ?? 300) / 60) * perMin) };
  }
});

function quickName(q: QuickType) {
  return { leads_24h: "Last 24h leads", follow_up_inquiries: "Enquiry follow-up", missed_callers: "Missed callers", confirm_tomorrow: "Confirm tomorrow's bookings", retry_no_answers: "Retry no-answers", win_back: "Win back customers", feedback: "Customer feedback" }[q];
}
