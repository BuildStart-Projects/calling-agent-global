// Orchestrator turn — streams SSE events to the builder / Knowledge UI.
// Events: token · blueprint_patch · skipped_locked · question · refused · readiness · done · error · end
import { z } from "npm:zod@3.25.76";
import { serveHandler, corsHeaders, HttpError, readJson, log } from "../_shared/http.ts";
import { requireAgentAccess } from "../_shared/supabase.ts";
import { aiGenerate, addUsage, parseJsonObject, MODELS, type ChatMessage, type Usage } from "../_shared/llm.ts";
import { template, render } from "../_shared/templating.ts";
import { compactBlueprint, readiness, type AgentType, type KnowledgeSnapshot } from "../_shared/blueprint.ts";
import { ORCHESTRATOR_TOOLS, actionSpecText, runOrchestratorTool, type ToolEvent } from "../_shared/orchestrator-tools.ts";
import { Provenance } from "../_shared/provenance.ts";
import { chargeUsage, hasCredits } from "../_shared/credits.ts";
import { FIXED } from "../_shared/fixed-messages.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { PROTOCOL, type Envelope } from "../_shared/orchestrator-protocol.ts";

const Body = z.object({
  agent_id: z.string().uuid(),
  session_id: z.string().uuid().optional(),
  mode: z.enum(["onboarding", "knowledge", "campaign_script"]).optional(),
  message: z.string().max(8000).nullable().optional(),
  attachment_ids: z.array(z.string().uuid()).max(5).optional(),
});

const TYPE_LABEL: Record<AgentType, string> = { booking: "Booking Agent", inquiry: "Inquiry Agent", order: "Order Agent" };

serveHandler("orchestrator-chat", async (req, { requestId }) => {
  if (req.method !== "POST") throw new HttpError(405, "method", "POST only");
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "invalid", "Invalid request.");
  const { agent, workspace, db, user } = await requireAgentAccess(req, body.data.agent_id);

  await rateLimit(db, user.id);

  // ── settings ──
  const { data: settingsRows } = await db.from("platform_settings").select("key,value").in("key", ["models", "orchestrator_max_questions", "first_agent_setup_free"]);
  const settings = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
  const model = (settings.models?.orchestrator as string) ?? MODELS.orchestrator;
  const maxQuestions = Number(settings.orchestrator_max_questions ?? 5);

  // ── session ──
  const mode = body.data.mode ?? (agent.status === "draft" ? "onboarding" : "knowledge");
  let session;
  if (body.data.session_id) {
    ({ data: session } = await db.from("orchestrator_sessions").select("*").eq("id", body.data.session_id).eq("agent_id", agent.id).maybeSingle());
  }
  if (!session) {
    ({ data: session } = await db.from("orchestrator_sessions").select("*").eq("agent_id", agent.id).eq("mode", mode).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle());
  }
  if (!session) {
    ({ data: session } = await db.from("orchestrator_sessions").insert({ agent_id: agent.id, mode, max_questions: maxQuestions }).select("*").single());
  }

  // First onboarding session for the workspace's first agent is free (setting).
  const { count: agentCount } = await db.from("agents").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).lt("created_at", agent.created_at);
  const free = Boolean(settings.first_agent_setup_free) && session.mode === "onboarding" && (agentCount ?? 0) === 0;
  if (!free && !(await hasCredits(db, workspace.id, 0.05))) throw new HttpError(402, "out_of_credits", "You're out of credits. Top up or upgrade to keep going.");

  // ── stream ──
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await runTurn({ send, db, agent, workspace, session, message: body.data.message ?? null, attachmentIds: body.data.attachment_ids ?? [], model, free, requestId });
      } catch (err) {
        console.error(JSON.stringify({ fn: "orchestrator-chat", requestId, level: "error", error: String(err) }));
        send("error", { message: err instanceof HttpError ? err.message : "Something went wrong. Please try again." });
      } finally {
        send("end", {});
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { ...corsHeaders(req), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
});

type TurnArgs = {
  send: (e: string, d: unknown) => void;
  db: Awaited<ReturnType<typeof requireAgentAccess>>["db"];
  agent: Record<string, any>;
  workspace: Record<string, any>;
  session: Record<string, any>;
  message: string | null;
  attachmentIds: string[];
  model: string;
  free: boolean;
  requestId: string;
};

async function runTurn(a: TurnArgs) {
  const { db, agent, workspace, session, send } = a;

  // Persist the owner's message + document digests.
  const docs = a.attachmentIds.length
    ? (await db.from("documents").select("id,filename,digest_summary,status").eq("agent_id", agent.id).in("id", a.attachmentIds)).data ?? []
    : [];
  const docNotes = docs.filter((d) => d.status === "ready" && d.digest_summary).map((d) => `[DOCUMENT ${d.filename}]\n${d.digest_summary}`);
  if (a.message?.trim() || docNotes.length) {
    await db.from("orchestrator_messages").insert({
      session_id: session.id, role: "user", content: a.message?.trim() ?? "",
      attachments: docs.map((d) => ({ id: d.id, filename: d.filename })),
    });
  }

  // History (last 8 messages) and provenance source (all owner words + documents).
  const { data: history } = await db.from("orchestrator_messages").select("role,content,attachments").eq("session_id", session.id).order("created_at", { ascending: false }).limit(8);
  const ordered = (history ?? []).reverse();
  const { data: readyDocs } = await db.from("documents").select("digest_summary,raw_text").eq("agent_id", agent.id).eq("status", "ready");
  const { data: allUserMsgs } = await db.from("orchestrator_messages").select("content").eq("session_id", session.id).eq("role", "user");
  const provenance = new Provenance([
    ...(allUserMsgs ?? []).map((m) => m.content),
    ...(readyDocs ?? []).map((d) => `${d.digest_summary ?? ""}\n${(d.raw_text ?? "").slice(0, 20000)}`),
  ].join("\n"));

  const convo: ChatMessage[] = [];
  ordered.forEach((m, i) => {
    if (m.role === "user") {
      const notes = i === ordered.length - 1 && docNotes.length ? `\n\n${docNotes.join("\n\n")}` : "";
      convo.push({ role: "user", content: (m.content || "(uploaded files)") + notes });
    } else if (m.role === "assistant" && m.content) {
      convo.push({ role: "assistant", content: m.content });
    }
  });
  if (!convo.length) convo.push({ role: "user", content: "(The owner just opened the builder. Start the conversation.)" });

  let questionsAsked: number = session.questions_asked;
  let completed = session.status === "completed";
  let reply = "";
  let question: { text: string; suggestions: string[]; index: number | null } | null = null;
  let refused = false;
  let finishInfo: Envelope["finish"] = null;
  const events: ToolEvent[] = [];
  let usage: Usage = { input_tokens: 0, output_tokens: 0, estimated: false };

  const emit = (e: ToolEvent) => { events.push(e); send(e.type, e); };
  const toolCtx = {
    db, agent: { id: agent.id, type: agent.type, wa_phone: agent.wa_phone }, workspace: { currency: workspace.currency, timezone: workspace.timezone },
    provenance, source: (docNotes.length ? "document" : "ai") as "ai" | "document", emit,
  };

  for (let round = 0; round < 2; round++) {
    const snapshot = await loadSnapshot(db, agent);
    const ready = readiness(agent.type, snapshot);
    const remaining = Math.max(0, session.max_questions - questionsAsked);
    const onboarding = session.mode === "onboarding";
    const allowQuestion = !onboarding || (!completed && remaining > 0);
    const allowFinish = onboarding && !completed;
    const actionNames = Object.keys(ORCHESTRATOR_TOOLS).filter((n) =>
      !["ask_question", "finish_onboarding", "decline_off_topic"].includes(n) && !(n === "set_availability" && agent.type !== "booking"));
    const system = (await buildSystemPrompt(db, { agent, workspace, session, snapshot, missing: ready.missing, questionsAsked, remaining, completed }))
      + "\n" + PROTOCOL(actionSpecText(actionNames), allowQuestion, allowFinish);

    let env: Envelope | null = null;
    for (let attempt = 0; attempt < 2 && !env; attempt++) {
      const res = await aiGenerate({ model: a.model, messages: [{ role: "system", content: system }, ...convo], maxTokens: 1500, temperature: 0.3 });
      usage = addUsage(usage, res.usage);
      env = parseJsonObject<Envelope>(res.text);
      if (!env) convo.push({ role: "assistant", content: res.text.slice(0, 2000) }, { role: "user", content: "That was not valid JSON. Reply again with ONLY the JSON object in the required format." });
    }
    if (!env) throw new HttpError(502, "llm_format", "The assistant had trouble replying. Please try again.");

    if (env.off_topic) { refused = true; break; }

    // Run actions.
    const results: Array<{ tool: string; result: Record<string, unknown> }> = [];
    for (const act of (env.actions ?? []).slice(0, 8)) {
      if (!act?.tool || !ORCHESTRATOR_TOOLS[act.tool] || !actionNames.includes(act.tool)) continue;
      results.push({ tool: act.tool, result: await runOrchestratorTool(act.tool, act.args ?? {}, toolCtx) });
    }
    const problems = results.filter(({ result }) =>
      result.ok === false || ["rejected_not_from_owner", "skipped_locked"].some((k) => Array.isArray(result[k]) && (result[k] as unknown[]).length));

    if (problems.length && round === 0) {
      // Let the model correct its reply (e.g. a value wasn't in the owner's words) before showing anything.
      convo.push({ role: "assistant", content: JSON.stringify(env) },
        { role: "user", content: `ACTION RESULTS: ${JSON.stringify(results)}\nSome values were not saved. Do not claim they were saved. If something important is missing, ask for it (if allowed). Reply again with the JSON object; only include actions that still need to run.` });
      continue;
    }

    reply = String(env.reply ?? "").trim();
    const q = env.question;
    if (q?.text && allowQuestion) {
      if (onboarding) questionsAsked += 1;
      question = { text: q.text.trim(), suggestions: (q.suggestions ?? []).map(String).filter(Boolean).slice(0, 4), index: onboarding ? questionsAsked : null };
    }
    if (env.finish && allowFinish) finishInfo = env.finish;
    break;
  }

  // Server-side guarantee: onboarding never goes past the question budget without finishing.
  if (session.mode === "onboarding" && !completed && !finishInfo && !question && questionsAsked >= session.max_questions) finishInfo = { summary: "", defaults_applied: [], recommended_next: [] };

  if (refused) {
    reply = FIXED.orchestrator_off_topic;
    send("refused", { text: reply });
  } else {
    if (reply) send("token", { text: reply });
    if (question) send("question", { text: question.text, suggestions: question.suggestions, index: question.index, max: session.mode === "onboarding" ? session.max_questions : null });
  }
  if (finishInfo && !refused) {
    completed = true;
    await db.from("orchestrator_sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", session.id);
    if (agent.status === "draft") await db.from("agents").update({ status: "ready" }).eq("id", agent.id);
    send("done", { summary: finishInfo.summary ?? "", defaults_applied: finishInfo.defaults_applied ?? [], recommended_next: finishInfo.recommended_next ?? [] });
  }

  // Persist assistant message, counters, readiness and a version snapshot.
  const content = refused ? reply : [reply, question?.text].filter(Boolean).join("\n\n");
  await db.from("orchestrator_messages").insert({
    session_id: session.id, role: "assistant", content, suggestions: question?.suggestions ?? [], events,
    question_index: question?.index ?? null, refused,
  });
  await db.from("orchestrator_sessions").update({ questions_asked: questionsAsked }).eq("id", session.id);

  const snapshot = await loadSnapshot(db, agent);
  const ready = readiness(agent.type, snapshot);
  const { data: bp } = await db.from("agent_blueprints").select("version,data").eq("agent_id", agent.id).single();
  const changed = events.some((e) => e.type === "blueprint_patch");
  const nextVersion = (bp?.version ?? 0) + (changed ? 1 : 0);
  await db.from("agent_blueprints").update({ readiness: ready.score, version: nextVersion }).eq("agent_id", agent.id);
  if (changed) {
    await db.from("agent_blueprint_versions").insert({
      agent_id: agent.id, version: nextVersion, changed_by: "orchestrator",
      change_summary: summarizeEvents(events), snapshot: { blueprint: bp?.data, catalog: snapshot.catalog, faqs: snapshot.faqs, handoff_phone: snapshot.handoffPhone },
    });
  }
  send("readiness", { score: ready.score, missing: ready.missing, questions_asked: questionsAsked, max_questions: session.max_questions, completed });

  if (usage.input_tokens || usage.output_tokens) {
    await chargeUsage(db, { workspaceId: workspace.id, agentId: agent.id, agentKind: "orchestrator", meter: "orchestrator_tokens", usage, model: a.model, refType: "orchestrator_session", refId: session.id, free: a.free });
  }
  log("orchestrator-chat", a.requestId, { agent: agent.id, mode: session.mode, questionsAsked, events: events.length, refused, in: usage.input_tokens, out: usage.output_tokens });
}

async function loadSnapshot(db: TurnArgs["db"], agent: Record<string, any>): Promise<KnowledgeSnapshot> {
  const [bp, cat, faqs, rules, ag] = await Promise.all([
    db.from("agent_blueprints").select("data,field_meta").eq("agent_id", agent.id).single(),
    db.from("catalog_items").select("ref,kind,name,price_minor,price_from,currency,duration_minutes,description,locked").eq("agent_id", agent.id).order("sort").order("created_at"),
    db.from("faqs").select("question,answer,locked").eq("agent_id", agent.id).order("sort").order("created_at"),
    db.from("availability_rules").select("weekday").eq("agent_id", agent.id),
    db.from("agents").select("handoff_phone_e164").eq("id", agent.id).single(),
  ]);
  const meta = (bp.data?.field_meta ?? {}) as Record<string, { locked?: boolean }>;
  return {
    blueprint: bp.data?.data ?? {},
    catalog: cat.data ?? [],
    faqs: faqs.data ?? [],
    availabilityDays: new Set((rules.data ?? []).map((r) => r.weekday)).size,
    handoffPhone: ag.data?.handoff_phone_e164 ?? null,
    lockedFields: Object.entries(meta).filter(([, m]) => m.locked).map(([k]) => k),
  };
}

async function buildSystemPrompt(db: TurnArgs["db"], p: {
  agent: Record<string, any>; workspace: Record<string, any>; session: Record<string, any>; snapshot: KnowledgeSnapshot;
  missing: string[]; questionsAsked: number; remaining: number; completed: boolean;
}) {
  const industryKey = await matchPlaybook(db, p.snapshot.blueprint.business?.industry ?? p.snapshot.blueprint.business?.description ?? "");
  const [base, modeT, typeT, playbook] = await Promise.all([
    template(db, "orchestrator.base"),
    template(db, `orchestrator.mode.${p.session.mode}`),
    template(db, `orchestrator.type.${p.agent.type}`),
    template(db, `playbook.${industryKey}`),
  ]);
  if (industryKey !== p.agent.industry_key) await db.from("agents").update({ industry_key: industryKey }).eq("id", p.agent.id);
  const countryName = p.workspace.country ? new Intl.DisplayNames(["en"], { type: "region" }).of(p.workspace.country) ?? p.workspace.country : "the owner's country";
  const vars = {
    max_questions: p.session.max_questions, questions_asked: p.questionsAsked, questions_remaining: p.remaining,
    workspace_currency: p.workspace.currency, workspace_timezone: p.workspace.timezone, workspace_country_name: countryName,
    agent_type_label: TYPE_LABEL[p.agent.type as AgentType], is_booking: p.agent.type === "booking",
    missing_required: p.missing.length ? p.missing.join("; ") : "none — everything required is in place",
    locked_fields: p.snapshot.lockedFields.join(", ") || "none",
    blueprint_compact: compactBlueprint(p.snapshot),
    business_name: p.snapshot.blueprint.business?.name ?? "the business",
    agent_language_name: "the agent's language",
  };
  const mode_module = render(modeT.body, vars) + (p.completed && p.session.mode === "onboarding" ? "\nSETUP IS COMPLETE: act as an editor now; do not ask new questions." : "");
  return render(base.body, { ...vars, mode_module, type_module: render(typeT.body, vars), playbook_module: render(playbook.body, vars) });
}

async function matchPlaybook(db: TurnArgs["db"], text: string): Promise<string> {
  const t = text.toLowerCase();
  if (!t) return "generic";
  const { data } = await db.from("industry_playbooks").select("key,match_keywords").eq("active", true);
  for (const p of data ?? []) if ((p.match_keywords as string[]).some((k) => t.includes(k))) return p.key;
  return "generic";
}

function summarizeEvents(events: ToolEvent[]): string {
  const paths = [...new Set(events.filter((e) => e.type === "blueprint_patch").map((e) => e.path.split(".")[0]))];
  return `Updated ${paths.join(", ")}`;
}

async function rateLimit(db: TurnArgs["db"], userId: string) {
  await enforceRateLimit(db, `orchestrator:${userId}`, 20, 60, "You're sending messages very quickly. Please wait a moment.");
}
