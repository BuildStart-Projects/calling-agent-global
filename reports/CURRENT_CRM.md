# Current Local CRM (`buildstart-wacaller`) — Architecture, AI Messaging & Calling Agent Reference

> **Source analyzed**: `buildstart-wacaller` (`master` branch, commit `a18511e`) & live self-hosted Supabase (`wacaller_customization` / `whatsapp_infra`) on Hetzner (`178.104.127.220`).
> **Scope**: Deep analysis of the **AI Text Messaging** system, the **AI Voice Calling Agent** system, **Supabase Edge Functions**, and the **database / multi-tenant model**. *(Follow-up automation, order follow-up messaging, media storage pipelines, and broadcast campaigns are intentionally omitted per scope.)*

---

## 1. High-Level Architecture & Tech Stack

`buildstart-wacaller` is a multi-tenant WhatsApp Business CRM & Automation SPA built for the Sri Lankan market (Sinhala, Tamil, English, Singlish, Tanglish, LKR pricing). It operates **two separate WhatsApp transport integrations**:
1. **Text Chatbot & Live Inbox** $\rightarrow$ **WAHA** (WhatsApp HTTP API) brokered by Supabase Edge Functions + PostgreSQL message queue (`wacaller_customization`).
2. **Voice Calling Agent** $\rightarrow$ **`buildstart-calling-agent` Go VoIP Server** (`whatsmeow` + Pion WebRTC + MLow + Gemini Live) backed by the shared `whatsapp_infra` schema and MinIO S3.

```
  React 18 + Vite SPA (Vercel)
    |
    |-- Auth & Direct CRM CRUD (RLS-protected `wacaller_customization` schema)
    |-- Text WhatsApp API ---> Edge Functions ---> WAHA Server
    |-- Voice Admin/Logs  ---> Edge Functions (*-wacaller) ---> `whatsapp_infra` / Go Server
    +-- Voice QR SSE      ---> Direct EventSource / fetch ---> Go Server (https://buildstart-calling-agent.buildstart.io)
```

### Multi-Tenant Model (`owner_id` & `staff_accounts`)
- **Frontend (`frontend/src/hooks/useStaffAccess.ts`)**: Queries `wacaller_customization.staff_accounts` where `staff_user_id = user.id` and `is_active = true`. Computes `effectiveUserId = isStaff ? ownerId : user.id` and checks `permissions: string[]`.
- **Edge Functions**: All `-wacaller` calling functions resolve the tenant identically using `SUPABASE_SERVICE_ROLE_KEY`:
  ```ts
  const { data: staffData } = await supabaseWacaller
    .from("staff_accounts")
    .select("owner_id")
    .eq("staff_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  const businessId = staffData?.owner_id || user.id;
  ```
- **Schema Separation**:
  - `wacaller_customization`: Frontend Supabase client initializes with `{ db: { schema: "wacaller_customization" } }` (`src/integrations/supabase/client.ts`). All core CRM tables enforce Row-Level Security (`owner` + `staff_accounts` permission policies + `super_admin` policies).
  - `whatsapp_infra`: Private to Edge Functions (via `SUPABASE_SERVICE_ROLE_KEY`) and the Go server. RLS is **disabled** on `whatsapp_infra`; the browser never queries it directly *(except one legacy fallback delete in `VoiceAgentConnection.tsx:204`)*.

---

## 2. AI Text Messaging System

The text chatbot runs asynchronously via **WAHA webhooks $\rightarrow$ PostgreSQL queue $\rightarrow$ worker Edge Function $\rightarrow$ Gemini Flash REST $\rightarrow$ WAHA send API**.

```mermaid
flowchart TD
    WA["WhatsApp Customer"] -->|Text / Voice Note| WAHA["WAHA Session"]
    WAHA -->|POST webhook-wsender| WH["webhook-wsender / webhook-wsender-wacaller"]
    WH -->|Resolve @lid via WAHA /lids| WH
    WH -->|Upsert pending| Q["wacaller_customization.message_queue"]
    WH -->|Fire-and-forget POST| PM["process-message / process-message-wacaller"]
    CRON["pg_cron (* * * * *)"] -->|Safety-net POST| PM
    PM -->|Claim 1 msg per user_id| Q
    PM -->|Voice note? GEMINI_FLASH| TR["transcribe.ts (OpenRouter)"]
    PM -->|Insert inbound| CONV["wacaller_customization.conversations"]
    PM -->|Check settings / chat_takeovers / limits| AI["ai-chat / ai-chat-wacaller"]
    AI -->|Products + FAQs + History (10) + Settings| GEM["Gemini 3 Flash Preview (AI Gateway)"]
    GEM -->|Reply + hidden XML tags| AI
    AI -->|Parse ORDER_JSON / USED_FAQS / media| DB["orders, faq_usage_logs, ai_usage_logs"]
    PM -->|Insert outbound + Call| SW["send-whatsapp / send-whatsapp-wacaller"]
    SW -->|POST /api/sendText or Media| WAHA
```

### 2.1 WhatsApp Connection Management (`Settings.tsx` & `wsender-sessions-wacaller`)
- **UI**: Settings $\rightarrow$ WhatsApp tab (`frontend/src/pages/Settings.tsx`).
- **Session Naming**: Deterministic 1-session-per-user naming in `wsender-sessions-wacaller/index.ts`:
  - `sessionName = "u_" + userId.replace(/-/g, "").substring(0, 20)`
  - Stored in `wacaller_customization.user_wsender_sessions` (`user_id`, `session_id`, `session_name`, `session_api_key` — `session_api_key` is kept as an alias for the WAHA session name).
- **Actions (`?action=...`)**:
  - `list-sessions`: Queries `GET ${WAHA_BASE}/api/sessions/${sessionName}` and maps `WORKING` $\rightarrow$ `connected`, `SCAN_QR_CODE` $\rightarrow$ `need_qr`, `STARTING` $\rightarrow$ `connecting`, `STOPPED|FAILED` $\rightarrow$ `disconnected`.
  - `create-session`: Creates/updates WAHA `noweb` session (`fullSync: true`) with webhook pointing to `webhook-wsender-wacaller` (`events: ["message", "session.status"]`, linear retry 2s $\times$ 3). Note: If `WEBHOOK_URL_OVERRIDE` is set in env, it enforces `-wacaller`.
  - `get-qr`: Polls WAHA up to 12 times (1s interval), auto-starting `STOPPED|FAILED` sessions, and calls `GET /api/${sessionName}/auth/qr?format=image`, normalizing PNG bytes, base64, or raw QR text into `{ qrImage, qrCode, status }`.
  - `delete-session`: Immediately deletes `user_wsender_sessions` row and runs WAHA `logout`, `stop`, `DELETE` asynchronously (`EdgeRuntime.waitUntil` fallback after 8s).

### 2.2 Webhook Ingestion (`webhook-wsender-wacaller/index.ts`)
1. Accepts WAHA webhooks (`event: "message" | "message.any" | "session.status"`).
2. Ignores `fromMe === true`, group chats (`@g.us`), broadcasts (`@broadcast`), and newsletters (`@newsletter`).
3. Maps `body.session` $\rightarrow$ `user_id` via `user_wsender_sessions` (`session_id.eq` or `session_api_key.eq`).
4. **LID Resolution**: If `fromJid` ends with `@lid`, queries `GET ${WAHA_BASE}/api/${sessionName}/lids/${fromJid}` to extract the real phone number; falls back to full `@lid` JID if unresolved.
5. Extracts `messageText` (`wp.body` / `conversation` / `extendedTextMessage.text`), `messageType` (`text`, `image`, `video`, `ptt`, `audio`, `document`, `sticker`, `location`), `senderName`, and `wahaMessageId`.
6. **Idempotent Enqueue**: Upserts into `wacaller_customization.message_queue` with `onConflict: "wsender_message_id", ignoreDuplicates: true` and `status: "pending"`.
7. Triggers `process-message` fire-and-forget (`pg_cron` also hits it every minute as a safety net).

### 2.3 Sequential Queue Worker (`process-message-wacaller/index.ts`)
1. **Stale Recovery**: Resets rows stuck in `status = 'processing'` for `> 2 minutes` back to `'pending'`.
2. **Per-User Ordering & Concurrency Lock**: Processes up to `10` messages per invocation, querying currently busy `user_id`s (`status = 'processing'`) and picking the oldest `pending`/`failed` (`attempts < 3`) row for a **non-busy user**, claiming it atomically.
3. **Failure Retry Policy**: Failed attempts increment `attempts` (`max_attempts = 3`) and transition to `'failed'`, then `'dead'`.
4. **Inbound Processing Steps inside `processMessage()`**:
   - Inserts inbound message into `wacaller_customization.conversations`.
   - **Voice Note Transcription (`transcribe.ts`)**: For `ptt` / `audio`, downloads OGG audio from WAHA and calls OpenRouter (`google/gemini-2.5-flash`, fallback `google/gemini-2.5-flash-lite`) with verbatim Sri Lankan multilingual prompt (`Sinhala, Tamil, English, or Singlish`). On failure, sends apology message and aborts AI reply.
   - **Contact Quota Check**: Registers normalized contact key in `wacaller_customization.contact_usage` against `billing_cycle_start` and `platform_settings.plan_limits[plan_tier].contacts_per_month + addon_contacts`. Only **new** contacts in the cycle are blocked when exhausted.
   - **Enterprise Qualified Lead Alert**: On the 6th inbound message of an `"enterprise"` tier user, notifies `settings.order_notifications.phone` with the last 3 messages.
   - **Media Skip**: If message is pure `image`/`video`/`document`/`sticker`/`vcard`/`location` without text, stores it in `conversations` and skips AI reply.
   - **Auto-Response & Human Takeover Checks**:
     - Checks `settings` (`key = 'auto_responses'`, `value.enabled`, default `true`).
     - Checks `chat_takeovers` (`user_id`, `phone_number`, `is_taken_over = true`). If taken over by human agent, skips AI!
   - **Welcome Flow Check**: If total messages in `conversations` for `(user_id, phone_number)` is `<= 1`, sends configured welcome text unless `bypass_triggers` matches.
   - **AI Invocation**: Fetches the latest **10** rows from `conversations` (reversed chronologically) and calls `/functions/v1/ai-chat` with a **55s AbortController timeout**.
   - **Outbound Delivery**: Logs outbound message in `conversations` and invokes `send-whatsapp` (media first if any, then text).

### 2.4 Conversational AI Engine (`ai-chat-wacaller/index.ts`)
- **Model & Provider**:
  - Uses `"google/gemini-3-flash-preview"` (`maxTokens: 500`).
  - Dual transport: uses `AI_GENERATE_URL` + `x-bot-key: BOT_API_KEY` on self-hosted deployments, or `LOVABLE_API_KEY` (`ai.gateway.lovable.dev/v1/chat/completions`).
- **Context Assembled Per Request**:
  - Account status check (`profiles.is_paused` $\rightarrow$ `403`, monthly contact limit $\rightarrow$ `429`, monthly order limit flag).
  - Active `products` (`name`, `price` in `LKR`, `product_type` `physical|digital`, `delivery_price`, `description`, `images[]`, `video_url`, nested `variations` & required/optional `subVariants`).
  - Active `faqs` (prefixed with `[FAQ_ID:<uuid>]` and `is_tracked`).
  - `settings` (`welcome_message`, `payment_info.accounts[]` bank/digital/crypto, `delivery_settings.free_delivery_threshold`).
  - Last 10 conversation turns (`Customer:` / `Assistant:`).
- **Prompt Rules & Hidden XML Action Tags**:
  - Auto-detects customer language; forbids markdown `*bold*`/`_italic_`; enforces concise 2–4 line emoji-structured WhatsApp styling; enforces physical (shipping + COD/Bank + delivery fee) vs digital (email + Bank only) rules.
  - Instructs the LLM to append invisible machine tags at the **end** of replies:
    - `<ORDER_JSON>{...}</ORDER_JSON>`: Triggers order insertion into `wacaller_customization.orders` (with 5-minute duplicate check on `user_id + customer_phone + total_amount`) and sends an owner alert to `order_notifications.phone`.
    - `<IMAGE_URL>...</IMAGE_URL>` / `<VIDEO_URL>...</VIDEO_URL>`: Extracted and returned to `process-message` to send product media.
    - `<USED_FAQS>id1,id2</USED_FAQS>`: Logs tracked FAQ hits into `wacaller_customization.faq_usage_logs` and delivers up to 4 deduplicated `faq.media_urls`.
  - **Response Sanitization**: Aggressively strips all XML tags (complete and truncated), fenced code blocks, leaked JSON objects, standalone URLs, UUIDs, and `[FAQ_ID:...]` strings before returning `{ response, imageUrl, imageUrls, videoUrl, followupMessage, faqMedia }`.
  - Inserts a row in `wacaller_customization.ai_usage_logs`.

### 2.5 Outbound Delivery & Live Human Inbox (`send-whatsapp-wacaller` & `Conversations.tsx`)
- **`send-whatsapp-wacaller`**:
  - Converts recipient `to` via `toChatId()`: preserves JIDs containing `@`, maps `>= 15` digit IDs to `<digits>@lid`, otherwise `<digits>@c.us`.
  - Calls WAHA `/api/sendText`, `/api/sendImage`, `/api/sendVideo`, `/api/sendVoice`, or `/api/sendFile` using header `X-Api-Key: WAHA_API_KEY`.
- **`Conversations.tsx` (Live Chat & Human Takeover UI)**:
  - Lists threads grouped by `phone_number` from `conversations`, subscribes to Supabase Realtime `INSERT` events, shows `[Tracked FAQ]` badges from `faq_usage_logs`, toggles `chat_takeovers` (pause/resume AI bot per customer), and lets operators send manual replies via `send-whatsapp` + direct insert into `conversations`.
  - *(Note: `Conversations.tsx:267` subscribes to `{ event: "INSERT", schema: "public", table: "conversations" }` cleanly Relying on RLS for row delivery, and `fetchTakeovers` filters by `user.id` while `toggleTakeover` uses `effectiveUserId || user.id`.)*

---

## 3. AI Calling Agent System

Unlike the WAHA-based text bot, the **Voice Calling Agent** integrates directly with the **`buildstart-calling-agent` Go Server** and PostgreSQL schema **`whatsapp_infra`**, brokered by five `-wacaller` Edge Functions.

```mermaid
sequenceDiagram
    participant UI as CRM Frontend (Agent / Settings / Calls / Schedule)
    participant EF as Edge Functions (*-wacaller)
    participant InfraDB as PostgreSQL (whatsapp_infra)
    participant Go as Go Server (buildstart-calling-agent)
    participant Gem as Gemini Live & Flash

    UI->>EF: GET/POST /agent-sync-wacaller (JWT)
    EF->>InfraDB: UPSERT whatsapp_infra.agent_configs (LOCAL_BASE_PROMPT + user prompt, Aoede)
    UI->>EF: POST /wa-pair-wacaller (JWT)
    EF->>Go: GET/POST /api/sessions (business_id)
    UI->>Go: EventSource /api/events + POST /api/sessions/{sid}/pair
    Go-->>UI: SSE session-qr / auth-state (open)
    UI->>EF: POST /schedule-call-wacaller
    EF->>InfraDB: INSERT whatsapp_infra.scheduled_calls (pending)
    Go->>InfraDB: Poll scheduled_calls / Load agent_configs on call start
    Go<->Gem: Gemini Live 24kHz audio + transcripts
    Go->>InfraDB: Upsert whatsapp_infra.call_logs + recording_url
    Go->>EF: POST /post-call-wacaller (X-Webhook-Secret)
    EF->>Gem: Generate JSON Lead Dossier + Sinhala WhatsApp summary
    EF->>Go: POST /api/sessions/{sid}/messages/send (X-Api-Key)
```

### 3.1 Knowledge Compilation & Voice Config Sync (`Agent.tsx`, `Products.tsx`, `Faqs.tsx`, `agent-sync-wacaller`)
- **Selective Catalog Ingestion**: Both `Products.tsx` and `Faqs.tsx` expose an `"Add to Calling Agent"` switch (`add_to_calling_agent`, default `true`).
- **In-Browser Compiler (`Agent.tsx` `generateFaqSync()`)**:
  - Fetches active products (`is_active = true`, `add_to_calling_agent != false`) and active FAQs (`is_active = true`, `add_to_calling_agent != false`).
  - Generates Markdown under `--- BUSINESS KNOWLEDGE (AUTO-GENERATED) ---` ... `-------------------------------------------` (`[Products & Services]` with `LKR` price/type/description + `[Frequently Asked Questions]` `Q | A`).
  - Uses substring delimiter replacement (`indexOf`) so user-written prompt instructions before/after the block are preserved.
- **No Voice Picker in Local UI**: Notice `Agent.tsx` currently only renders inputs for `businessPrompt`, `greetingMessage`, and `fallbackMessage` — it does **not** send `voice_model` or let the user pick a language/voice.
- **Server-Side Local Persona Wrapper (`agent-sync-wacaller/index.ts`)**:
  - `POST`: Idempotently prepends `LOCAL_BASE_PROMPT` (Sri Lanka trusted voice sales consultant persona + Sinhala/Tamil/English/Singlish/Tanglish rules + `<20` words / 1–2 sentences rule + natural connectors `"හරි"`, `"ඇත්තටම"`, `"නේද?"`, `"சரி"`), enforces `voice_model = "Aoede"` (unless a non-legacy Gemini voice is explicitly passed), enforces `DEFAULT_LOCAL_FALLBACK` (Sinhala missed-call callback text) when blank, and upserts into `whatsapp_infra.agent_configs`.
  - `GET`: Reads `whatsapp_infra.agent_configs` for `businessId` and strips `LOCAL_BASE_PROMPT` (`stripLocalBasePrompt()`) so `Agent.tsx` only displays and edits the tenant's business instructions & knowledge.

### 3.2 WhatsApp Voice Line Pairing (`VoiceAgentConnection.tsx` & `wa-pair-wacaller`)
1. `VoiceAgentConnection.tsx` mounts $\rightarrow$ calls `POST /functions/v1/wa-pair-wacaller`.
2. `wa-pair-wacaller` resolves `businessId`, checks `GET ${GO_SERVER_URL}/api/sessions` for a session with matching `business_id`, or creates one via `POST ${GO_SERVER_URL}/api/sessions`.
3. Clicking **"Get QR Code"** or **"Regenerate QR"** directly from the browser:
   - Opens `EventSource("${GO_SERVER_URL}/api/events?session_id=...")` listening for `qr`, `session-qr`, `session-list`, `auth-state` / `state`.
   - Calls `POST ${GO_SERVER_URL}/api/sessions/${sid}/pair` when unpaired/logged_out/regenerating.
   - Starts a 3-second polling fallback on `GET ${GO_SERVER_URL}/api/sessions`.
   - Renders the raw WhatsApp QR string in the browser using `QRCodeSVG`.
4. **Delete Session**: Calls `DELETE ${GO_SERVER_URL}/api/sessions/${sid}` directly (with a fallback delete attempt against `supabase.from("whatsapp_sessions")` which fails harmlessly or is unused since `whatsapp_sessions` lives in `whatsapp_infra`, not `wacaller_customization`).

### 3.3 Call Logs, Transcripts & Audio Player (`Calls.tsx`, `get-calls-wacaller`, `CallAudioPlayer.tsx`)
- **`get-calls-wacaller`**: Authenticates JWT, resolves `businessId`, and returns `SELECT * FROM whatsapp_infra.call_logs WHERE business_id = businessId ORDER BY started_at DESC`.
- **`Calls.tsx`**:
  - Master-detail UI displaying `caller_number`, `direction` (`inbound`/`outbound`/`auto-callback`), `status`, `started_at`, `duration`.
  - **Transcript Aggregation**: Parses `transcript_json` and merges consecutive chunks with the same `role` (`user`/`caller` vs `agent`/`assistant`) into clean chat bubbles.
  - **`CallAudioPlayer.tsx`**: Plays `call.recording_url` (stereo WAV hosted on MinIO, e.g. `https://storage.buildstart.io/call-recordings/<business_id>/<call_id>.wav`) with play/pause, scrub bar, `1x`–`2x` playback speed, mute, and download.

### 3.4 Outbound Campaigns & Quick Test Call (`Schedule.tsx` & `schedule-call-wacaller`)
- **`Schedule.tsx`**:
  - **Bulk Schedule**: Splits textarea numbers by newline/comma, sends `{ numbers, gapMinutes }` to `POST /functions/v1/schedule-call-wacaller`.
  - **Quick Test Call**: Sends `{ numbers: [testNumber], gapMinutes: 0 }`.
  - Polls `GET /functions/v1/schedule-call-wacaller` every `5s` (top 50 rows) to display `pending` ("Scheduled"), `calling`, `completed`, and `failed_*` badges.
- **`schedule-call-wacaller`**: Strips spaces/dashes/parens/`+`, filters length $\ge 7$, computes `now + index * gapMinutes * 60000`, and bulk inserts into `whatsapp_infra.scheduled_calls` (polled every 60s by the Go server).

### 3.5 Post-Call Lead Dossier & WhatsApp Follow-Up (`post-call-wacaller`)
- Triggered asynchronously by the Go server (`POST_CALL_WEBHOOK_URL`) whenever an answered call ends with $\ge 2$ transcript entries.
- **Auth & Tenant Filter**:
  - Verifies `X-Webhook-Secret` against `_secrets.ts` / `POST_CALL_WEBHOOK_SECRET` (`401` on mismatch).
  - Checks `supabaseAdmin.auth.admin.getUserById(businessId)` — if `business_id` does not exist in Local CRM `auth.users`, cleanly returns `200 { skipped: true, reason: "business_not_in_local_crm" }`.
- **AI Dossier & Delivery**:
  - Calls Gemini (`google/gemini-3-flash-preview` via `AI_GENERATE_URL`+`BOT_API_KEY`, fallback Lovable/OpenRouter) to produce JSON (`business_name`, `caller_role`, `identified_pain_points`, `recommended_plan`, `objections_raised`, `deal_temperature`, `lead_score`, `whatsapp_summary_sinhala`, `next_action`).
  - Waits `3000ms` so the caller hangs up cleanly, then sends `whatsapp_summary_sinhala` to `peer_jid || caller_number` via Go server's authenticated `POST /api/sessions/{sid}/messages/send` (`X-Api-Key: GO_API_KEY`).

---

## 4. Complete Edge Functions Inventory (Messaging, Calling & Core)

> **Deployment Naming Quirk (Critical Context)**:
> Historically, the 5 core WAHA messaging functions were deployed on the shared Hetzner Supabase host **without** the `-wacaller` suffix (`/functions/v1/webhook-wsender`, `process-message`, `ai-chat`, `send-whatsapp`, `wsender-sessions`), and `pg_cron` job `#45` plus several internal `fetch()` / frontend calls still hit those unsuffixed names. Later, `-wacaller` copies were added (`*-wacaller`), while **all Calling Agent and admin functions** natively use `-wacaller`. All new/modified functions for this project must strictly keep the `-wacaller` suffix.

### A. AI Calling Agent Functions (`*-wacaller`)
| Function | Trigger / Caller | Auth | Reads / Writes | Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| `agent-sync-wacaller` | `Agent.tsx` (`GET`/`POST`) | Supabase User JWT (`getUser`) + staff check | Reads `staff_accounts`; R/W `whatsapp_infra.agent_configs` | Prepends/strips `LOCAL_BASE_PROMPT`, enforces `"Aoede"` voice & Sinhala fallback, syncs prompt/greeting/fallback. |
| `wa-pair-wacaller` | `VoiceAgentConnection.tsx` (`POST`) | Supabase User JWT (`getUser`) + staff check | Reads `staff_accounts`; calls Go `/api/sessions` | Looks up existing Go session for `business_id` or creates one (`POST /api/sessions`). |
| `get-calls-wacaller` | `Calls.tsx` (`GET`) | Supabase User JWT (`getUser`) + staff check | Reads `staff_accounts`; reads `whatsapp_infra.call_logs` | Returns sorted call history, transcripts, and `recording_url` for `business_id`. |
| `schedule-call-wacaller` | `Schedule.tsx` (`GET`/`POST`) | Supabase User JWT (`getUser`) + staff check | Reads `staff_accounts`; R/W `whatsapp_infra.scheduled_calls` | Lists queue (limit 50) and bulk-inserts staggered outbound call jobs (`status='pending'`). |
| `post-call-wacaller` | Go Server webhook (`POST`) | `X-Webhook-Secret` + `getUserById(businessId)` | Calls Gemini Flash API & Go `/api/sessions/{sid}/messages/send` | Generates Sinhala BuildStart Lead Dossier from transcript and sends WhatsApp summary via Go. |

### B. AI Text Messaging Functions (WAHA Pipeline)
| Function | Trigger / Caller | Auth | Reads / Writes | Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| `wsender-sessions-wacaller` *(deployed as `wsender-sessions`)* | `Settings.tsx` (`GET`/`POST`/`DELETE`) | JWT (`getClaims`) | R/W `user_wsender_sessions`; proxies WAHA `/api/sessions*` | Creates/restarts deterministic `u_<uid>` WAHA session, configures webhook, fetches QR, deletes session. |
| `webhook-wsender-wacaller` *(deployed as `webhook-wsender`)* | WAHA webhook (`POST`) | None (unauthenticated webhook; matches WAHA session name) | Reads `user_wsender_sessions`; upserts `message_queue`; triggers `process-message` | Normalizes WAHA message payloads, resolves `@lid` via WAHA `/lids`, enqueues idempotently. |
| `process-message-wacaller` *(deployed as `process-message`)* | `webhook-wsender` + `pg_cron` (`* * * * *`) | `Authorization` anon/service header | R/W `message_queue`, `conversations`, `contact_usage`, `settings`, `chat_takeovers`, `profiles` | Queue worker (per-`user_id` lock, retries); transcribes voice notes (`transcribe.ts`), checks quotas/takeover/welcome, calls `ai-chat` & `send-whatsapp`. |
| `ai-chat-wacaller` *(deployed as `ai-chat`)* | `process-message` (`POST`) | `service_role` Bearer | Reads `products`, `faqs`, `settings`, `profiles`, `platform_settings`, `contact_usage`, `conversations`; writes `orders`, `faq_usage_logs`, `ai_usage_logs` | Compiles prompt + catalog + history, calls Gemini 3 Flash, parses `<ORDER_JSON>` / `<USED_FAQS>` / media tags, strips markup, notifies owner on new orders. |
| `send-whatsapp-wacaller` *(deployed as `send-whatsapp`)* | `process-message`, `ai-chat`, `Conversations.tsx` | None / JWT / `service_role` (`verify_jwt=false`) | Calls WAHA `/api/sendText`, `/api/sendImage`, `/api/sendVideo`, `/api/sendVoice`, `/api/sendFile` | Normalizes recipient to `@c.us` or `@lid` (`>=15` digits) and dispatches via WAHA. |

### C. Supporting Auth, Staff & Sync Functions (Context)
- **`manage-staff-wacaller`**: Owner actions (`create_staff`, `update_staff`, `delete_staff`, `list_staff`) managing `auth.users` + `wacaller_customization.staff_accounts` (`permissions[]`).
- **`sync-usage-crm-wacaller` / `sync-usage-crm-global-wacaller`**: Usage reporting/sync helpers for external admin billing CRM.
- **`main-wacaller`**: Edge runtime dynamic router.

---

## 5. Key Insights & Architectural Lessons for `calling-agent-global`

1. **Dual-Engine Split Exists Today Only Because of Legacy WAHA**:
   - In `buildstart-wacaller`, text messages go through WAHA (requiring a separate QR scan in `Settings.tsx` $\rightarrow$ WhatsApp tab), while voice calls go through the Go server (`Settings.tsx` $\rightarrow$ Voice Agent tab).
   - For **`calling-agent-global`**, using the **Go server (`whatsmeow`) for BOTH voice and text** eliminates scanning two QR codes per business and eliminates WAHA session instability/memory overhead — once Go forwards inbound `events.Message` webhooks (just like WAHA's `webhook-wsender-wacaller` receives `message`), Global can reuse the exact same clean `message_queue` + async worker pattern (`webhook` $\rightarrow$ `queue` $\rightarrow$ `process-message` $\rightarrow$ `ai-chat` $\rightarrow$ Go `/api/sessions/{sid}/messages/send`)!
2. **Keep the `message_queue` + Per-Tenant Lock Pattern**:
   - Enqueuing webhooks immediately and returning `200`, deduplicating by `message_id`, enforcing 1 concurrent `processing` message per tenant, and having a 1-minute `pg_cron` sweep prevents duplicate replies, timeout drops, and race conditions in conversation history.
3. **Preserve Clean Prompt Separation (`agent_configs` vs User Instructions)**:
   - `buildstart-wacaller` currently hardcodes `"LKR"` prices in both `Agent.tsx` (`generateFaqSync()`) and `ai-chat-wacaller`, plus `LOCAL_BASE_PROMPT` (Sri Lanka) in `agent-sync-wacaller`, and has no language/voice selector UI.
   - In `calling-agent-global`, the catalog currency, language choice, persona rules, and Gemini prebuilt voice (`voice_model`) should all be dynamic/selectable per bot and compiled into `whatsapp_infra.agent_configs` from the Global backend/Edge Function.
4. **Never Replicate Direct Browser Calls to the Go Server**:
   - `VoiceAgentConnection.tsx` hits `https://buildstart-calling-agent.buildstart.io/api/sessions`, `/pair`, `/events`, and `DELETE` directly from the browser, and `Agent.tsx` still displays a slightly outdated subtitle saying *"the server handles that automatically"*. In `calling-agent-global`, proxy session/QR/dial/history actions through authenticated backend Edge Functions scoped strictly to the user's `business_id`.

