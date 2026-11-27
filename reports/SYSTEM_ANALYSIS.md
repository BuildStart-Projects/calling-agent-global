# Calling Agent Platform: Full System Analysis & Global Build Plan

> **Date:** 2026-11-25
> **Scope:** All three repositories in `calling-agent-development/`
> - `buildstart-calling-agent`: Go WhatsApp + VoIP + Gemini Live engine (`development` @ `fe2fda4`)
> - `buildstart-wacaller`: Sri Lanka Local CRM (`master` @ `a18511e`)
> - `calling-agent-global`: new Global Platform (empty, `d0952f4`)
>
> **Method:** I read the two existing reports in this folder (`GO_SERVER_DETAILS.md`, `CURRENT_CRM.md`) and `buildstart-calling-agent/reports/CRM_MIGRATION_PLAN.md`, then checked their claims against the actual source in both repos. Findings marked **[NEW]** don't appear in either earlier report. Findings marked **[CORRECTION]** change what an earlier report says.

---

## 0. TL;DR

1. **There's a production security emergency, and it has to be fixed before Global is built.** Both GitHub repos are **public**. The Go repo includes the **production Postgres superuser password**, hardcoded as a fallback DSN pointing at the public IP `178.104.127.220:5432` (`cmd/server/main.go`, in git history since commit `dda1d54`). The Go HTTP API is also almost fully **unauthenticated** and open to any origin (CORS `*`). Anyone on the internet can list every tenant's sessions, read live call transcripts, open a live call's audio stream, dial out from any client's WhatsApp number, or delete their session. Details are in §3.
2. **The Go server is close to ready as a shared engine for voice.** Prompt, voice, greeting and fallback are already passed through generically from `whatsapp_infra.agent_configs`. The Sri Lanka persona now lives in the Local CRM (`agent-sync-wacaller`).
3. **It isn't ready to serve two platforms at once.** It has one global post-call webhook, no inbound text-message webhook, a cross-tenant fallback in the scheduler and in `/api/calls/dial`, always-on auto-answer and auto-callback with no per-business setting, and an SSE stream that broadcasts every tenant's data. Global needs about 6 targeted Go changes (§6), all of which can stay backward-compatible with Local.
4. **Recommended Global shape:** a separate app database (its own Supabase project, or at minimum its own schema) plus a server-side **"engine gateway"** that is the *only* thing allowed to talk to the Go server and `whatsapp_infra`. Browsers never call the Go server directly, unlike Local CRM today.
5. **Use Go (whatsmeow) for both text and voice in Global.** Don't bring WAHA across. One QR code per number, one connection.

---

## 1. The System Today

### 1.1 Topology

```
                     Browser (Local CRM SPA on Vercel)
                     │            │                        │
       Supabase JWT  │            │ direct, no auth        │ direct, no auth
                     ▼            ▼                        ▼
  ┌──────────────────────────┐  EventSource /api/events  fetch /api/sessions…
  │ Self-hosted Supabase     │            │                        │
  │ (Hetzner 178.104.127.220)│            ▼                        ▼
  │  • wacaller_customization│   ┌─────────────────────────────────────────┐
  │  • whatsapp_infra (RLS   │◄──┤ Go engine  :8080  (nginx → buildstart-  │
  │    OFF, 21 tables)       │   │ calling-agent.buildstart.io)            │
  │  • ~470 other tenants'   │   │  • whatsmeow multi-session (1 number =  │
  │    edge functions/schemas│   │    1 session = 1 business_id)           │
  │  • Edge fns *-wacaller ──┼──►│  • VoIP: SRTP/MLow/Opus ↔ 16 kHz PCM    │
  └──────────────────────────┘   │  • Gemini Live (bidi WS, 24 kHz out)    │
            ▲      ▲             │  • Stereo WAV recorder → MinIO          │
            │      │             │  • Scheduler (60 s poll)                │
   WAHA webhook   post-call      │  • Post-call webhook (single URL)       │
            │      webhook ◄─────┤  • Static operator console at "/"       │
  ┌─────────┴──┐                 └─────────────────────────────────────────┘
  │ WAHA server│  (Local CRM text bot only: second QR code)
  └────────────┘
```

### 1.2 Who owns what

| Concern | Owner | Storage |
|---|---|---|
| WhatsApp device login and crypto keys | Go (whatsmeow) | `whatsapp_infra.whatsmeow_*` |
| Session ↔ business mapping | Go | `whatsapp_infra.whatsapp_sessions` (`session_id`, `business_id uuid`, `jid`) |
| Voice persona, prompt, greeting, fallback text, voice | **Platform** writes, Go reads on every call | `whatsapp_infra.agent_configs` (PK `business_id`) |
| Call records and transcripts | Go writes | `whatsapp_infra.call_logs` |
| Recordings | Go writes | MinIO `call-recordings/<business_id>/<call_id>.wav` (public URL) |
| Outbound call queue | Platform inserts, Go polls and dispatches | `whatsapp_infra.scheduled_calls` |
| LID → phone mapping | Go | `whatsapp_infra.whatsmeow_lid_map` (global, not per-tenant) |
| Post-call intelligence (dossier, follow-up text) | **Platform** (Local: `post-call-wacaller`) | Local CRM |
| Text chatbot (Local) | Local CRM via **WAHA** | `wacaller_customization.message_queue`, `conversations`, … |
| Catalog, FAQs, orders, staff, billing | Local CRM | `wacaller_customization.*` |

**Key contract:** the Go engine is a dumb, region-agnostic pipe. Platforms set behaviour by writing `agent_configs` rows and react by receiving the post-call webhook. That's the right design, and Global should use it as-is.

### 1.3 Call lifecycle (verified in `cmd/server/session.go`)

**Inbound**
1. A `CallOffer` arrives, and `createCall` loads `agent_configs` for the session's `business_id`. **If there's no row, Gemini is disabled for that call** (silent call).
2. The caller's phone number is pulled from the `caller_pn` attribute, and the LID→PN mapping is saved.
3. Gemini Live is pre-warmed while the phone rings. The greeting is pre-synthesised from `greeting_message`.
4. The call is **always auto-answered after 1.2 s** (`if true {` hardcoded).
5. On `Active`, recording starts and the buffered greeting plays.
6. On end:
   - If the call was really answered (peer audio or conversation) and has ≥ 2 transcript turns, the post-call webhook fires.
   - If an **inbound call was missed**, the `fallback_message` text is sent, then after 4 s an **automatic callback** is placed (8 s debounce per peer).

**Outbound:** `POST /api/sessions/{sid}/calls`, the scheduler, or an auto-callback, then `startOutgoingWithGreeting`.

**Text messages:** `handleIncomingMessage` *only* looks for callback keywords. Nothing else is forwarded anywhere.

### 1.4 Local CRM (`buildstart-wacaller`)

The detail in `CURRENT_CRM.md` checked out accurately. Summary:
- **Text:** WAHA → `webhook-wsender` → `message_queue` (deduplicated, per-tenant lock, 3 retries, `pg_cron` sweep) → `process-message` → `ai-chat` (Gemini 3 Flash, hidden `<ORDER_JSON>` / `<USED_FAQS>` / media tags) → `send-whatsapp` → WAHA.
- **Voice:**
  - `agent-sync-wacaller` prepends `LOCAL_BASE_PROMPT` and enforces Aoede.
  - `wa-pair-wacaller` finds or creates the Go session.
  - The browser talks to Go directly for QR, SSE, pair and delete.
  - `get-calls-wacaller` and `schedule-call-wacaller` read and write `whatsapp_infra`.
  - `post-call-wacaller` builds the Sinhala BuildStart lead dossier and sends a WhatsApp follow-up through Go `/messages/send`.
- **Tenancy:** `business_id = staff_accounts.owner_id || auth.uid()`.

---

## 2. Corrections & Additions to the Existing Reports

| # | Item | Status | Detail |
|---|---|---|---|
| C1 | "Only `/messages/send` is authenticated" | Confirmed, and **worse than described** | The unauthenticated surface includes `DELETE /api/sessions/{sid}`, `POST /api/sessions` (anyone can create sessions), `/logout`, all dial endpoints, the **live audio WebSocket** `/api/calls/{id}/audio` (read **and inject** audio), WebRTC attach, `/agent` toggle, and the **static operator console served at `/`**. See §3. |
| C2 | SSE leaks across tenants | Confirmed, and **worse than described** | `/api/events` broadcasts `incoming` / `call-status` events with `stream_url` plus live `agent-transcript` text for every tenant. Combined with C1, any anonymous listener can find a live call and tap its audio. |
| C3 | `GET /api/history` | **[NEW] Bug** | `listCallHistory("", n)` builds `… LIMIT $2` but passes only one argument, so Postgres always errors. The unscoped `/api/history` and the broker's startup history preload therefore always fall back to the in-memory list. Session-scoped history works. (`cmd/server/sessionstore.go`, `listCallHistory`) |
| C4 | `call_logs` writes | **[NEW] Risk** | Every transcript chunk and state change fires `go saveCallRecord(...)` as an *unordered* goroutine upsert. A late "ringing" or "connected" write can land after "ended" and roll back `status`/`ended_at`/`duration`, or leave a shorter `transcript_json`. Platforms should treat the **post-call webhook payload** as the source of truth for transcripts, not `call_logs` read immediately after the call. |
| C5 | Callback keyword matching | **[NEW] Behaviour bug** | `strings.Contains(text, "call me")` matches "**don't** call me". There is also **no group filter**, so "call me" in any group the number belongs to triggers an outbound AI call to that group member. |
| C6 | Scheduler status | **[NEW]** | `scheduled_calls.status = 'completed'` means "dial started", not "answered". Global must join to `call_logs` for the real outcome, and `scheduled_calls` has no `call_id` column to join on. |
| C7 | `post-call-wacaller` tenant guard | **[NEW] Cross-platform hazard** | It decides "is this business local?" with `auth.admin.getUserById(businessId)` on the **shared** Supabase auth. If Global users live in the same `auth.users` and Global uses `auth.uid()` as `business_id`, **Local CRM will send Sinhala BuildStart sales summaries to Global customers.** Global must not reuse that ID space (see §5.2), and the guard should check `wacaller_customization.profiles` instead. |
| C8 | Hardcoded DB credentials | **[NEW] Critical** | See §3, S1. |
| C9 | CI | **[NEW]** | `ci.yml` runs on `main` only, but production deploys from `development`. Production code isn't covered by CI. |
| C10 | Gemini Live tools | **[NEW] Capability gap** | No `tools` / function-calling in the Live setup. The voice agent can only *talk*. It can't book, look up an order, transfer, or end the call on intent. That's a major capability gap for Global. |
| C11 | "Global" already exists in Local | **[NEW] Context** | `sync-usage-crm-global-wacaller` posts usage to an external Lovable admin CRM with `source_system: "global"` and calls RPC `get_global_contact_usage` across schemas. The name "Global" is already used. Pick distinct names (e.g. schema `callagent_global`, functions `*-cag`) to avoid confusion. |

---

## 3. Security Findings: Fix Before Building Global

These affect **every current Local CRM customer today**. They aren't Global-specific.

| ID | Severity | Finding | Where |
|---|---|---|---|
| **S1** | 🔴 Critical | **Production Postgres superuser password committed to a public GitHub repo.** It's the fallback DSN when `DATABASE_URL` is unset, and it targets the public IP on port `5432`. It's in history since `dda1d54`, and both `BuildStart-io/buildstart-calling-agent` and the `yasiru2003` fork are **PUBLIC**. That database holds ~470 other tenants' data. | `cmd/server/main.go` (`defaultDB`) |
| **S2** | 🔴 Critical | Unauthenticated session control: create, delete, logout, pair. Anyone can delete any client's WhatsApp line. | `httpapi.go` routes |
| **S3** | 🔴 Critical | Unauthenticated dialing from any tenant's number (`/api/calls/dial` with no `session_id` uses the first connected session). This allows toll-fraud and spam, and gets numbers banned. | `handleDirectDial`, `defaultSession()` |
| **S4** | 🔴 Critical | Live call eavesdropping and audio injection via `/api/calls/{id}/audio`. Call IDs leak through public SSE. | `handleDirectAudioWS`, `broker.serveSSE` |
| **S5** | 🟠 High | Public SSE stream of every tenant's sessions, QR codes (**hijack a pairing in progress**), callers' numbers and live transcripts. | `/api/events` |
| **S6** | 🟠 High | `whatsapp_infra` has RLS off, and PostgREST exposes it. Anyone with the anon key can read every tenant's transcripts and `agent_configs`. | DB config |
| **S7** | 🟡 Medium | Recordings are public URLs on MinIO. The paths are guessable when `business_id` is known (it's in SSE). | `recorder.go` |
| **S8** | 🟡 Medium | Webhook secret compared with `!==` (not constant-time). Low risk, but trivial to fix. | `post-call-wacaller` |

**Remediation order:**
1. **Today:** Rotate the Postgres password, and every secret that lived next to it.
2. **Today:** Firewall `5432` to localhost / the docker network.
3. **Today:** Remove the fallback DSN from `main.go`. Consider rewriting git history, but assume the leaked password is compromised either way.
4. Put `requireAPIKey` (or per-platform API keys, §6 G1) on **every** Go route except `/health`.
5. Bind Go to `127.0.0.1` behind nginx.
6. Stop serving the operator console publicly, or put basic auth on it in nginx.
7. Remove `whatsapp_infra` from `PGRST_DB_SCHEMAS`, or enable RLS with no policies.
8. Make the MinIO bucket private and serve recordings through presigned URLs.

Local CRM's browser-direct calls (`VoiceAgentConnection.tsx`) will break once Go requires keys. Move them into `wa-pair-wacaller` (which is exactly the pattern Global should use anyway), **in the same release**.

---

## 4. What Global Needs That the Engine Doesn't Give Yet

| Need | Engine today | Gap |
|---|---|---|
| Multiple platforms receiving post-call events | One `POST_CALL_WEBHOOK_URL` | **G2** |
| WhatsApp **text** AI agent on the same number | Inbound messages dropped | **G3** |
| Per-business behaviour (text-only, no auto-answer, no auto-callback, business hours) | Global env flag / `if true` | **G4** |
| Tenant isolation on API, SSE, scheduler | Cross-tenant fallbacks | **G1, G5** |
| Voice agent actions (book, CRM update, transfer, hang up) | None | **G6** |
| Multi-language greeting and persona | Supported. Platform compiles `business_prompt` and `greeting_message` | none |
| Voice choice | Any Gemini voice name passes through | none |
| Usage metering and billing | `call_logs.duration` only; one shared Gemini key | Platform-side, via webhook |
| Media messages (send images/files) | Text only (`Conversation`) | Small Go addition |
| Horizontal scale | One process; scheduler assumes a single replica | Later (§8) |

---

## 5. Recommended Architecture for `calling-agent-global`

### 5.1 Shape

```
  Global Web App (Vercel: Next.js or Vite SPA)
        │  user JWT (Global auth)
        ▼
  Global API / Edge Functions  ◄── the ONLY component with GO_API_KEY_GLOBAL
  │  • auth + workspace membership + RBAC
  │  • agent compiler → upserts whatsapp_infra.agent_configs
  │  • session/QR proxy (filtered SSE relay → browser)
  │  • dial / schedule / campaigns
  │  • inbound-message webhook → queue → text-agent worker → Go send
  │  • post-call webhook → summaries, CRM, usage metering, outbound webhooks
        │                                  ▲
        │ HTTPS + API key                  │ HMAC-signed webhooks
        ▼                                  │
  Go engine (shared with Local) ───────────┘
        │
        ▼
  whatsapp_infra (engine-owned; Global touches only via service role, server-side)
```

**Principles**
1. **Browsers never reach Go or `whatsapp_infra`.** Everything goes through the Global API, which checks that `business_id` belongs to the caller's workspace.
2. **Global app data lives outside `wacaller_customization` and `whatsapp_infra`.** Preferred: a **separate Supabase project** (own auth, own RLS, no blast radius on the ~470-tenant shared host). Fallback: a dedicated schema such as `callagent_global` on the shared host, with all the same isolation rules as `AGENTS.md`.
3. **Treat the engine like a third-party API.** Version its contract (`/api/v1`), and never write to `call_logs` / `whatsapp_sessions` directly.

### 5.2 Identity mapping (important)

- `whatsapp_infra.business_id` is a bare `uuid` with no FK. Local uses `auth.uid()`.
- **Global should use a dedicated `line_id` / `agent_id` UUID per WhatsApp number** (generated in Global's DB), **not** the user's auth ID. This:
  - lets one workspace own many numbers or agents (`wa-pair-wacaller`-style "first session for this business" lookups assume 1 : 1);
  - avoids colliding with Local CRM's `getUserById` guard (C7);
  - lets a number move between users without rewriting engine rows.
- Store the mapping in Global: `workspaces 1─* lines (id = business_id, session_id, jid, platform='global')`.

### 5.3 Proposed Global data model (first cut)

| Table | Purpose |
|---|---|
| `workspaces`, `workspace_members(role)` | Tenancy and RBAC (owner, admin, agent, viewer) |
| `lines` | One per WhatsApp number. `id` = engine `business_id`; `session_id`, `jid`, `status`, `voice_enabled`, `text_enabled`, `auto_answer`, `auto_callback`, `business_hours`, `timezone` |
| `agents` | Persona definitions: `language(s)`, `voice`, `tone`, `greeting`, `fallback_message`, `instructions`, `currency`, `country` |
| `knowledge_items` (products, FAQs, docs) | Compiled into `business_prompt`. Use `include_in_voice` / `include_in_text` flags (as in Local's `add_to_calling_agent`) |
| `contacts`, `conversations`, `messages` | Unified text and call timeline per contact |
| `calls` | Mirror of the engine call, filled from the **webhook payload** (transcript, duration, direction, outcome, recording key, AI summary, lead fields) |
| `campaigns`, `campaign_targets` | Outbound calling with consent, quiet hours, retries. Writes `scheduled_calls` |
| `inbound_queue` | Port of Local's `message_queue` pattern (dedupe on `wa_message_id`, per-contact lock, retries, cron sweep) |
| `usage_events`, `plans`, `subscriptions` | Per-minute voice and per-message text metering, from webhooks |
| `webhook_endpoints` | Customer-facing outbound webhooks (call.completed, lead.created) |

### 5.4 Agent compiler (replaces Local's `generateFaqSync` + `LOCAL_BASE_PROMPT`)

Server-side, run on every save:
```
business_prompt = render(
  GLOBAL_BASE_PERSONA[language/style],   // like LOCAL_BASE_PROMPT, but parameterised
  agent.instructions,
  knowledge (currency-aware, ≤ size budget),
  hard rules (short turns, don't invent prices, consent/AI disclosure line)
)
upsert whatsapp_infra.agent_configs(business_id=line.id, business_prompt, greeting_message,
                                    fallback_message, voice_model=agent.voice)
```
- **Upsert the row *before* pairing.** Otherwise the first inbound call is silent (§1.3).
- Keep a **size budget**. The whole prompt goes into every Live session, so large catalogs need summarising (or tools, G6).
- Translate or let the user edit `greeting_message` per language. Gemini speaks it verbatim.
- Store the compiled prompt hash in `lines` so you can tell when the engine row is stale.

### 5.5 Text agent on Go (after G3)

Port Local's proven pipeline, with Go in place of WAHA:
`Go inbound webhook → enqueue (dedupe by message_id) → 200` → worker (per-contact lock, takeover check, quota check, last N messages) → LLM → `POST /api/sessions/{sid}/messages/send`.
Keep Local's lessons: return 200 immediately, use a cron safety sweep, provide a human-takeover switch, and strip hidden action tags before sending.

---

## 6. Required Go Engine Changes (backward-compatible with Local)

Do these in `buildstart-calling-agent` on `development`, in this order. Each one defaults to today's behaviour, so Local CRM is unaffected.

| ID | Change | Notes / Local compatibility |
|---|---|---|
| **G0** | Security hotfix (§3): no fallback DSN, auth on all routes, bind localhost, protect static console | Local's browser calls move into `wa-pair-wacaller` in the same release |
| **G1** | **Per-platform API keys.** `platform_keys` table or env `API_KEYS=local:<k1>,global:<k2>`. A key's platform is stamped on sessions it creates (`whatsapp_sessions.platform`, default `'local'`), and every `{sid}` / call route checks the caller owns that session. `GET /api/sessions` and `/api/calls` filter by platform and optional `?business_id=` | Needs one additive column (coordinate: `whatsapp_infra` DDL) |
| **G2** | **Per-session webhook routing.** Add `webhook_url`, `webhook_secret` (and `events[]`) to `agent_configs` or the platform record. Fall back to `POST_CALL_WEBHOOK_URL` when null. Sign with **HMAC-SHA256 of body + timestamp**. Add retries with backoff (today a non-2xx is just logged and lost) | Local keeps the env URL |
| **G3** | **Inbound message webhook.** Forward non-`IsFromMe`, non-status, optionally non-group `events.Message` as `message.received` (`session_id`, `business_id`, `message_id`, `from_jid`, `sender_pn`, `push_name`, `timestamp`, `type`, `text`, media metadata) through the same routing as G2. Only for sessions with `text_webhook_enabled` | Off by default, so Local (WAHA) is unaffected |
| **G4** | **Per-business behaviour flags** in `agent_configs`: `auto_answer` (default true), `auto_callback` (default true, AND-ed with the env flag), `voice_enabled`, optional `callback_keywords[]` (default today's list). Fix C5 (word-boundary match, skip groups and negations) | Defaults equal current behaviour |
| **G5** | **Remove cross-tenant fallbacks.** `scheduler.go` must not pick another business's session, and `/api/calls/dial` must require `session_id`. Add `scheduled_calls.call_id` and `scheduled_calls.error` so outcomes can be joined (C6). Wrap the `FOR UPDATE SKIP LOCKED` in a real transaction | Local always has its own session, so this is a pure safety fix |
| **G6** | **Gemini Live function calling.** Optional `tools_json` in `agent_configs`. Go forwards `toolCall` to the platform webhook (`tool.invoke`, synchronous, short timeout) and returns `toolResponse`. Built-in tools: `end_call`, `send_whatsapp_text` | Unlocks booking and CRM actions in Global. Local unaffected when null |
| G7 | Fix C3 (history SQL) and C4 (serialise `call_logs` writes per call, e.g. one writer goroutine per call, or a `WHERE status <> 'ended'` guard) | Bug fixes |
| G8 | Media send (`/messages/send` with `image_url` / `document_url`), so the Global text agent can send catalog images | Additive |
| G9 | Run CI on `development` too, and add tests for tenant isolation (cross-session access returns 403) | |

**Schema coordination:** G1, G2, G4 and G5 add columns to `whatsapp_infra`. The project rules forbid DDL there without coordinating both systems, so treat these as additive-only migrations (new nullable columns or columns with defaults), reviewed for both platforms, applied before the Go deploy.

---

## 7. Phased Roadmap

| Phase | Deliverable | Depends on |
|---|---|---|
| **P0: Stop the bleeding** (days) | S1–S6 fixed, Local CRM switched to server-side Go calls, CI on `development` | — |
| **P1: Engine multi-platform** | G1, G2, G4, G5, G7 deployed. Local verified unchanged (inbound call, auto-callback, post-call summary) | P0 |
| **P2: Global MVP (voice)** | Auth and workspaces, line pairing (QR via filtered SSE relay), agent builder (language, voice, greeting, knowledge, compiler), call logs with transcript, signed recording URLs, test call, post-call AI summary | P1 |
| **P3: Global text agent** | G3, G8, inbound queue and worker, inbox with human takeover, unified contact timeline | P2 |
| **P4: Outbound & business** | Campaigns (consent, quiet hours per contact timezone, retry rules), usage metering and billing (Stripe), customer webhooks | P2 |
| **P5: Actions & scale** | G6 tools (calendar booking, CRM push, transfer), engine capacity planning (§8) | P3 |

---

## 8. Risks & Open Questions

**Platform risk**
- **whatsmeow is unofficial WhatsApp Web.** Automated calling and messaging at scale risks **number bans**, and WhatsApp protocol changes can break calling with no notice (see the `err-client-outdated` handling already in the code). For a *global* commercial product, assess Meta's official WhatsApp Business Calling API (Cloud API) as a second transport behind the same engine contract, or at least set user-facing warmup and volume limits.
- **Single process, single VPS.** All tenants of both platforms share one Go binary (max 8 concurrent calls per session) and one Gemini API key (quota and cost). Need a per-platform Gemini key option, call-minute metering, and a capacity test (`scripts/e2e_call_eval.go` is a starting point) before onboarding paying Global tenants.
- **Compliance.** Global outbound AI calls fall under rules like TCPA (US), GDPR and PECR (EU/UK), and various AI-disclosure rules. Campaigns need consent records, opt-out ("stop"), an AI-disclosure line in the greeting, recording-consent options per country, and data-retention settings for recordings and transcripts.

**Decisions needed from you**
1. **Where does Global's data live:** a separate Supabase project (recommended), or a new schema on the shared Hetzner instance? If shared, what's the schema name and edge-function suffix? (`AGENTS.md` only defines rules for `wacaller`.)
2. **Global stack:** keep Vite + React + Supabase Edge (same as Local), or Next.js + a small Node/Go API service? The engine gateway has a long-lived SSE relay, which fits a real server better than edge functions.
3. **Who owns Go engine changes** (G0–G9)? They touch a production system Local customers depend on.
4. **Billing model** for Global (per minute, per seat, per number)? This decides what to meter in P2.
5. **Official API vs whatsmeow** for Global long-term (see above).
