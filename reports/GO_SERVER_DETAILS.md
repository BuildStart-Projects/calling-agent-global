# Go Calling & WhatsApp Server (`buildstart-calling-agent`) — Global Platform Integration Guide

> **Source analyzed**: `buildstart-calling-agent` (`development` branch, commit `fe2fda4`) & live production VPS (`178.104.127.220`).
> **Purpose**: Complete technical reference for building and connecting the Global Platform (`calling-agent-global`) to the shared Go VoIP, WhatsApp, and Gemini Multimodal Live server without breaking the existing Sri Lanka Local CRM (`buildstart-wacaller`).

---

## 1. Architecture & Shared Multi-Platform Topology

The Go binary (`buildstart-calling-server`) is a standalone multi-session WhatsApp Web (`whatsmeow`), VoIP/SRTP (`internal/voip`), WebRTC (`pion/webrtc/v4`), and Gemini Live (`internal/agent`) server running on Hetzner (`178.104.127.220:8080`, proxied via Nginx at `https://buildstart-calling-agent.buildstart.io`).

```
  Global Platform (Vercel + Supabase/Backend)       Local CRM (buildstart-wacaller)
                        \                                   /
                         +---> HTTPS / SSE / PostgreSQL <---+
                                          |
                                          v
                   Go Server (127.0.0.1:8080 / :443 via Nginx)
                     |-- whatsmeow multi-session manager (1 WhatsApp number per session)
                     |-- Native WhatsApp VoIP (MLow/Opus RTP <-> 16 kHz PCM)
                     |-- Gemini Multimodal Live bidirectional WebSocket
                     |-- Stereo WAV Call Recorder -> MinIO S3
                     |-- PostgreSQL (shared `whatsapp_infra` schema)
                     +-- Post-Call Webhook Dispatcher -> HTTP POST JSON
```

### Critical Shared-Infrastructure Constraints
1. **Same Binary & Same Database**: Both `buildstart-wacaller` (Local CRM) and the Global Platform share this Go process and the `whatsapp_infra` PostgreSQL schema.
2. **Database Schema Isolation**: Keep all Global Platform application tables (users, bots, knowledge bases, leads, billing, text chat logs, UI state) in a **dedicated schema or separate Supabase project** — **never** modify `wacaller_customization` or `whatsapp_infra` DDL without coordinating both systems.
3. **Edge Function Naming on Shared Supabase**: If the Global Platform deploys Edge Functions into the same Hetzner Supabase Docker volume (`/root/supabase/supabase/docker/volumes/functions/`), **never** overwrite or delete `*-wacaller` functions or unrelated tenant functions.
4. **Prompt & Persona Decoupling**: The Go server is now **100% region-agnostic**. It passes `whatsapp_infra.agent_configs.business_prompt`, `greeting_message`, `fallback_message`, and `voice_model` straight to Gemini Live / WhatsApp with no Sri Lanka or BuildStart system prompt injection.

---

## 2. Deployment, Runtime & Environment Configuration

| Component | Production Value / Behavior |
| :--- | :--- |
| Public Base URL | `https://buildstart-calling-agent.buildstart.io` |
| Systemd Service | `buildstart-calling-agent.service` (`LimitNOFILE=65535`, auto-restarts in `5s`) |
| Reverse Proxy (Nginx) | Proxies `/` $\rightarrow$ `http://127.0.0.1:8080`, `client_max_body_size 100M`, `proxy_buffering off`, `proxy_cache off`, WebSocket `proxy_read_timeout 86400`, `proxy_send_timeout 86400` |
| CLI Flags | `-addr :8080 -static /opt/buildstart-calling-agent/client/dist` (`-max-calls-per-session` defaults to `8`, `0` = unlimited; `-debug` enables `WA` logs) |
| WA Web Version Sync | On startup and on pairing / `err-client-outdated`, calls `whatsmeow.GetLatestVersion()` and `store.SetWAVersion()` (1h cache unless `force=true`) |
| Device Identity | `DESKTOP` / `Mac OS` `14.5.0` (`RequireFullSync = false`, `SupportCallLogHistory = true`) |

### Environment Variables (`/opt/buildstart-calling-agent/.env`)
`loadEnvFile(".env")` loads variables at startup only if not already set in the process environment.

| Variable | Required? | Purpose & Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | Yes | PostgreSQL DSN with `?search_path=whatsapp_infra&sslmode=disable` (connection pool: max `50` open, `10` idle) |
| `GEMINI_API_KEY` | Yes | Google AI Studio / Gemini API key used for all `BidiGenerateContent` Live sessions |
| `GEMINI_LIVE_MODEL` | No | Default: `"models/gemini-3.1-flash-live-preview"` |
| `PUBLIC_HOST` | Yes (prod) | Used to construct `stream_url` (`wss://<PUBLIC_HOST>/api/v1/calls/{id}/audio`); falls back to `r.Host` or `"localhost:8080"` |
| `GO_API_KEY` | Yes | Shared secret checked by `POST /api/sessions/{sid}/messages/send` (`X-Api-Key` or `Authorization: Bearer`) |
| `POST_CALL_WEBHOOK_URL` | Optional | HTTP endpoint notified with JSON `call.completed` payload after answered calls with $\ge 2$ transcript turns |
| `POST_CALL_WEBHOOK_SECRET` | Optional | Sent as `X-Webhook-Secret` header on post-call webhooks |
| `AUTO_CALLBACK_ENABLED` | No | Enabled by default; set to `"false"` to disable missed-call & keyword auto-callback globally |
| `MINIO_ENDPOINT` | For recordings | e.g. `127.0.0.1:9000` (if any of the 4 `MINIO_*` vars except bucket is empty, recording upload is skipped cleanly) |
| `MINIO_ACCESS_KEY` | For recordings | S3 access key |
| `MINIO_SECRET_KEY` | For recordings | S3 secret key |
| `MINIO_BUCKET` | No | Default: `"call-recordings"` |
| `MINIO_PUBLIC_URL` | For recordings | Base URL used to build `call_logs.recording_url` (`<MINIO_PUBLIC_URL>/<business_id>/<call_id>.wav`) |

---

## 3. HTTP, SSE & WebSocket API Reference

CORS is enabled globally on all routes:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Headers: Content-Type, X-Client-Id, Authorization, X-Api-Key`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

> **Important Security Notice**: Currently **only** `POST /api/sessions/{sid}/messages/send` (and `/api/v1/...`) enforces `GO_API_KEY`. All other endpoints are unauthenticated on the Go server and rely on upstream backend mediation or network policy. The Global Platform should **not** expose raw administrative session actions directly without authenticating the user and verifying `business_id` ownership in its own backend/Edge Functions.

---

### 3.1 Health & Status

#### `GET /health`, `/api/health`, `/api/v1/health`, `/status`, `/api/status`, `/api/v1/status`
Returns server status and aggregate session counts across **all** tenants.
```json
{
  "status": "online",
  "whatsapp_connected": true,
  "sessions_count": 1,
  "connected_count": 1,
  "phones": ["94740979087:97@s.whatsapp.net"],
  "timestamp": 1795600000
}
```

---

### 3.2 Real-Time Server-Sent Events (SSE)

#### `GET /api/events` or `GET /api/v1/events`
Optional client identifier via `X-Client-Id` header, `?clientId=...`, or `?session_id=...`.

**Connection behavior**:
- Sets `Content-Type: text/event-stream`, `X-Accel-Buffering: no`.
- Immediately pushes a snapshot consisting of `session-list` + any pending `session-qr` events, and triggers a `call-list` broadcast.
- Sends `: ping\n\n` keepalive every `20s`.
- Channel buffer per subscriber is `32` messages (non-blocking drop if slow).

**⚠️ Multi-Tenant Caveat on SSE**: `Broker` broadcasts **all sessions and all calls across every `business_id`** to every connected `/api/events` subscriber. Do **not** stream `/api/events` directly to untrusted multi-tenant Global browsers without either:
1. Adding per-`business_id` filtering on `/api/events` in Go, OR
2. Proxying/filtering events through a Global backend service.

**Event Payloads** (`data: <json>\n\n`):

| `type` | Payload Shape | Notes |
| :--- | :--- | :--- |
| `session-list` | `{ "type": "session-list", "sessions": [SessionInfo] }` | Sent on snapshot, create, pair, delete |
| `session-qr` / `qr` | `{ "type": "session-qr", "sessionId": "...", "qr": "<raw-qr-string>" }` | Emitted every QR refresh (~20s until scanned/timeout) |
| `auth-state` / `state` | `{ "type": "auth-state", "sessionId": "...", "paired": bool, "state": "connecting\|qr\|open\|logged_out", "qr": "..." }` | Emits both `auth-state` and legacy `state` |
| `call-list` | `{ "type": "call-list", "calls": [CallRecord] }` | Current active calls |
| `incoming` | `{ "type": "incoming", "sessionId": "...", "id": "...", "callId": "...", "call_id": "...", "peer": "...", "offeredAt": 179..., "stream_url": "wss://...", "streamUrl": "wss://..." }` | Inbound WhatsApp call offer |
| `incoming-claimed` | `{ "type": "incoming-claimed", "sessionId": "...", "id": "...", "owner": "auto-answer\|<clientId>" }` | When call accepted |
| `call-status` | `{ "type": "call-status", "sessionId": "...", "id": "...", "callId": "...", "status": "starting\|ringing\|connected\|ended", "peer": "...", "peerNumber": "...", "direction": "...", "startedAt": 179..., "outcome": "...", "triggerReason": "...", "stream_url": "...", "streamUrl": "..." }` | State updates |
| `call-event` | `{ "type": "call-event", "callId": "...", "eventType": "...", "message": "...", "details": "...", "timestamp": 179... }` | Detailed lifecycle trace |
| `agent-transcript` | `{ "type": "agent-transcript", "sessionId": "...", "callId": "...", "role": "user\|assistant\|system", "text": "...", "timestamp": 179... }` | Live STT/TTS transcripts (`user` = caller, `assistant` = Gemini) |
| `agent-status` | `{ "type": "agent-status", "sessionId": "...", "callId": "...", "enabled": bool, "state": "idle\|..." }` | Toggled via `/agent` |
| `call-ended` | `{ "type": "call-ended", "sessionId": "...", "id": "...", "callId": "...", "owner": "...", "reason": "...", "endedAt": 179..., "durationSeconds": 42, "outcome": "..." }` | Final call termination |

---

### 3.3 WhatsApp Sessions & QR Pairing

#### `GET /api/sessions` & `GET /api/v1/sessions`
Returns all in-memory sessions:
```json
{
  "sessions": [
    {
      "id": "c0b8de69bf918d7293343ad2604e5d4a",
      "business_id": "c300eeab-e6c2-474d-bccd-f2ca9fd05d7d",
      "jid": "94740979087:97@s.whatsapp.net",
      "state": "open",
      "paired": true
    }
  ]
}
```
(`qr` is omitted unless `state == "qr"`).

#### `GET /api/lines` & `GET /api/v1/lines`
Legacy/normalized wrapper returning both `lines` (`id`, `name`=`business_id`, `phone`=`jid`, `status`=`"ready"|"disconnected"`, `state`, `connected`, `paired`) and `sessions`.

#### `POST /api/sessions` & `POST /api/v1/sessions`
Creates a new 32-char hex session for a `business_id` UUID, inserts into `whatsapp_infra.whatsapp_sessions`, and immediately begins QR pairing.
- **Request**: `{ "business_id": "<uuid>" }` (`400` if empty; note `business_id` column is PostgreSQL `uuid`, so non-UUID strings will fail insert with `500`).
- **Response (`200`)**: `{ "id": "<32-hex-session-id>" }`
- **Note**: The QR code string is **not** returned synchronously in the `POST` response — it arrives via SSE (`session-qr` / `auth-state`) a moment later! Render the QR string client-side (e.g. `qrcode.react` / `qrcode`) rather than expecting a base64 PNG.

#### `POST /api/sessions/{sid}/pair` & `POST /api/v1/sessions/{sid}/pair`
Starts or restarts QR pairing on an existing unpaired session (e.g., after QR timeout sets `state: "logged_out"` or after `/logout`).
- Creates a fresh `whatsmeow.NewClient` and triggers `startPairing` $\rightarrow$ emits `session-qr` over SSE.
- **Response**: `204 No Content` (`400` if session doesn't exist or is already paired).

#### `POST /api/sessions/{sid}/logout` & `POST /api/v1/sessions/{sid}/logout`
Logs out of WhatsApp, clears `jid` in `whatsapp_sessions` (`''`), replaces client with unpaired device, sets `state: "logged_out"`. Keeps the `session_id` row.
- **Response**: `204 No Content` (`404` if session not found).

#### `DELETE /api/sessions/{sid}` & `DELETE /api/v1/sessions/{sid}`
Logs out / disconnects, deletes the `whatsmeow` device row, tears down active calls on that session, unregisters from memory, and deletes the `whatsapp_sessions` row (even if missing from memory, still cleans DB and returns `204`).
- **Response**: `204 No Content` (`404` only if `Delete` returns error, which currently never happens).

> **Important Pairing Lifecycle Gotcha**:
> If a user creates a session via `POST /api/sessions` and **never scans the QR code**, `whatsapp_sessions.jid` stays `''`. When the Go server next restarts, `SessionManager.Restore()` automatically **deletes any `whatsapp_sessions` row where `jid == ''`**! Your frontend/backend should handle missing `session_id` gracefully by recreating or pruning stale unpaired IDs.

---

### 3.4 Outbound WhatsApp Text Messaging (Authenticated)

#### `POST /api/sessions/{sid}/messages/send` & `POST /api/v1/sessions/{sid}/messages/send`
Synchronously sends a plain-text WhatsApp message (`waE2E.Message.Conversation`) from a paired session.

- **Authentication (Required)**:
  - `X-Api-Key: <GO_API_KEY>` **or** `Authorization: Bearer <GO_API_KEY>`
  - Compared with `subtle.ConstantTimeCompare`.
  - Returns `503` if `GO_API_KEY` is not set on server; `401` if missing/wrong.
- **Preconditions**:
  - `404` if `{sid}` does not exist.
  - `503` if session is not paired (`Store.ID == nil`).
- **Request Body (`application/json`)**:
  ```json
  {
    "to": "+14155551234",
    "text": "Thanks for speaking with us!"
  }
  ```
  - `message` is accepted as an alias if `text` is omitted.
  - Accepted formats for `to`:
    - Digits / E.164 phone (e.g. `"+447700900123"`, `"447700900123"`)
    - Full WhatsApp JID (`"447700900123@s.whatsapp.net"` or `"<digits>@lid"`)
    - `"LID: <digits>"`
  - **Automatic LID $\rightarrow$ Phone Resolution**: Go checks `whatsmeow_lid_map` for `rawTo` and normalized digits; if mapped, it resolves automatically to `<pn>@s.whatsapp.net`.
  - Always converts target via `ToNonAD()`.
- **Responses**:
  - `200 OK`: `{ "success": true, "message_id": "<wa-msg-id>", "to": "447700900123@s.whatsapp.net" }`
  - `400 Bad Request`: invalid JSON, missing `to`/`text`, invalid JID/phone.
  - `502 Bad Gateway`: `whatsmeow.SendMessage` error.

---

### 3.5 Voice Calls, Call Control & Audio Bridges

#### `POST /api/sessions/{sid}/calls`
Preferred multi-tenant outbound dial endpoint (explicit `{sid}`).
- **Request**: `{ "phone": "+14155551234" }` (`to` / `number` aliases accepted; `duration_ms`, `record` fields exist in struct but are unused).
- **Checks**:
  - `owner := clientID(r)` — returns `409 Conflict` if this `clientID` already owns another active call (`""` skips this if no active call has owner `""`, watch out if multiple callers omit `X-Client-Id`! Passing unique `X-Client-Id` or empty behavior: note `ownerActiveCall("")` returns `""` immediately, so omitting `X-Client-Id` disables single-call-per-operator lock).
  - Returns `429` if `sess.reg.count() >= maxCalls`.
  - Resolves LID $\rightarrow$ PN if stored in `whatsmeow_lid_map`, dials peer via `startOutgoing`.
- **Response (`200`)**:
  ```json
  {
    "call_id": "...",
    "callId": "...",
    "id": "...",
    "status": "ringing",
    "peer": "14155551234@s.whatsapp.net",
    "stream_url": "wss://buildstart-calling-agent.buildstart.io/api/v1/calls/<id>/audio",
    "call": { "callId": "...", "sessionId": "...", "status": "ringing", "streamUrl": "..." }
  }
  ```

#### `POST /api/calls/dial`, `/api/v1/calls/dial`, `POST /api/calls`, `/api/v1/calls`
Direct dial endpoint supporting `{ "phone"|"to"|"number"|"recipient", "session_id"?, "initial_greeting"? }`.
- **⚠️ Multi-Tenant Warning**: If `session_id` is omitted or not found, it falls back to `s.defaultSession()` (the first connected session on the entire server!). **Global Platform MUST ALWAYS pass `session_id`** (or use `POST /api/sessions/{sid}/calls`).

#### `GET /api/calls`, `/api/v1/calls`, `GET /api/calls/{id}`, `/api/v1/calls/{id}`
Lists all active calls or fetches a specific call record (`calls` map + in-memory `history`, returning `stream_url`). Again, unfiltered across businesses.

#### `GET /api/history`, `/api/v1/history`, `GET /api/sessions/{sid}/history`
Returns up to `50` historical `CallRecord` rows from `whatsapp_infra.call_logs` (or in-memory `history` fallback).
- Use `GET /api/sessions/{sid}/history` (not `/api/history`) to scope to a specific session, or query `whatsapp_infra.call_logs` by `business_id` from your backend.

#### Call Control Endpoints
- **Accept**: `POST /api/calls/{id}/accept`, `/api/v1/calls/{id}/accept`, `POST /api/sessions/{sid}/calls/{id}/accept`
- **Reject**: `POST /api/calls/{id}/reject`, `/api/v1/calls/{id}/reject`, `POST /api/sessions/{sid}/calls/{id}/reject`
- **Hangup / End**: `POST /api/calls/{id}/hangup`, `/api/calls/{id}/end`, `DELETE /api/calls/{id}` (and `/api/v1/...`), `DELETE /api/sessions/{sid}/calls/{id}`
- **Toggle Live AI Agent mid-call**:
  - `POST /api/sessions/{sid}/calls/{id}/agent` with `{ "enabled": true | false }`
  - Pauses/resumes feeding caller audio into Gemini Live and emits `agent-status` on SSE.

#### Browser / External Live Audio Bridges (Overrides Gemini AI!)
Attaching either bridge calls `ac.geminiLive.SetEnabled(false)` automatically so human/external audio does not collide with the built-in Gemini Live agent:
1. **WebRTC Data Channel (`POST /api/sessions/{sid}/calls/{id}/webrtc` or `/api/calls/{id}/webrtc`)**:
   - Request: `{ "sdp_offer": "<SDP>" }` $\rightarrow$ Response: `{ "sdp_answer": "<SDP>" }` (waits for ICE gathering complete).
   - Browser must open a WebRTC DataChannel labeled **`"pcm"`** carrying raw **16 kHz mono Int16 LE PCM** in both directions.
   - Terminal ICE failure/close automatically terminates the call (`OnTerminalICE`).
2. **WebSocket Audio (`GET /api/calls/{id}/audio`, `/api/v1/calls/{id}/audio`, `/ws/audio`)**:
   - Streams outbound caller audio as **16 kHz Int16 LE PCM** binary frames.
   - Accepts inbound binary Int16 LE PCM (default `16000` Hz; pass `?rate=24000` or any integer `rate` to resample to 16 kHz) or JSON text frames:
     - Audio payloads: `{ "audio"|"data"|"pcm"|"chunk": "<base64>" }`
     - Flush/Barge-in payloads: `{ "type": "clear"|"interrupt"|"flush" }` or `{ "event": "clear"|"interrupted" }` or `{ "action": "flush" }`.

---

## 4. PostgreSQL (`whatsapp_infra`) Schema & Behavior

Go shares the PostgreSQL cluster on Hetzner (`search_path=whatsapp_infra`).
PostgREST (`PGRST_DB_SCHEMAS`) includes `whatsapp_infra`, **AND all 21 tables in `whatsapp_infra` have `relrowsecurity = false` (RLS disabled) and `0` RLS policies**.

> **CRITICAL SECURITY RULE**: Never expose `whatsapp_infra` directly to frontend browser queries via Supabase client (`anon` key)! Every read/write to `whatsapp_infra` from the Global Platform **must** happen server-side (Edge Function or backend service using `service_role` or direct Postgres connection), enforcing user auth + tenant ownership (`business_id`).

### Core Application Tables in `whatsapp_infra`

#### 1. `whatsapp_infra.agent_configs`
| Column | Type | Default / Constraint | Go Usage |
| :--- | :--- | :--- | :--- |
| `business_id` | `uuid` | `PRIMARY KEY` | Tenant identifier matching `whatsapp_sessions.business_id` |
| `business_prompt` | `text` | nullable | Sent **verbatim** to Gemini Live `systemInstruction` |
| `greeting_message` | `text` | nullable | Pre-synthesized at call setup; defaults to `"Hello"` in Gemini agent if empty |
| `fallback_message` | `text` | nullable | WhatsApp text sent automatically before auto-callback if non-empty |
| `voice_model` | `text` | `'models/gemini-3.1-flash-live-preview'` | Gemini Live prebuilt voice name (e.g., `"Aoede"`, `"Puck"`, `"Kore"`, `"Charon"`, `"Fenrir"`) |
| `created_at`, `updated_at` | `timestamptz` | `now()` | Standard timestamps |

**⚠️ CRITICAL**: When a call starts (`Session.createCall`), Go runs:
```sql
SELECT COALESCE(business_prompt, ''), COALESCE(greeting_message, ''), COALESCE(fallback_message, ''), COALESCE(voice_model, 'models/gemini-3.1-flash-live-preview')
FROM whatsapp_infra.agent_configs
WHERE business_id = $1
```
If **no row exists** for that `business_id`, `sql.ErrNoRows` triggers:
`"failed to load agent config, falling back to disabled"` — **leaving `ac.geminiLive == nil` (no AI voice during calls!)**.
Therefore, the Global Platform **MUST** upsert a row in `whatsapp_infra.agent_configs` for every `business_id` before/when pairing its WhatsApp session!

#### 2. `whatsapp_infra.whatsapp_sessions`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `session_id` | `text` (PK) | 32-char hex generated by `POST /api/sessions` |
| `business_id` | `uuid` | Tenant identifier (no FK to `auth.users`, so Global can use any valid UUID per bot/workspace) |
| `jid` | `text` | Linked WhatsApp JID (`947...@s.whatsapp.net`) or `''` while unpaired |
| `device_data` | `text` | Nullable legacy column (whatsmeow stores crypto keys in `whatsmeow_*` tables) |
| `created_at`, `updated_at` | `timestamptz` | Server startup deletes any row with `jid = ''` or missing `whatsmeow_device` |

#### 3. `whatsapp_infra.call_logs`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | Auto-generated (`gen_random_uuid()`) |
| `call_id` | `text` (UNIQUE) | WhatsApp call ID; Go upserts `ON CONFLICT (call_id) DO UPDATE` throughout the call |
| `business_id` | `uuid` | Tenant UUID (Note: `wireCall` `OnStateChange` relies on initial `OnIncoming`/`startOutgoing` row; let Go handle writes) |
| `session_id` | `text` | Session ID that handled the call |
| `caller_number` | `text` | Formatted E.164 (`+<digits>`) or `"LID: <digits>"` |
| `direction` | `text` | `"inbound"`, `"outbound"`, or `"auto-callback"` |
| `started_at`, `connected_at`, `ended_at` | `timestamptz` | Call timing |
| `duration` | `integer` | Connected duration in seconds |
| `status` | `text` | `"starting"`, `"ringing"`, `"connected"`, `"ended"` |
| `transcript_json` | `jsonb` | Array of `{ "timestamp": <ms>, "role": "user"\|"assistant"\|"system", "text": "..." }` |
| `recording_url` | `text` | Updated asynchronously after call end (`<MINIO_PUBLIC_URL>/<business_id>/<call_id>.wav`) |

#### 4. `whatsapp_infra.scheduled_calls`
| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `uuid` (PK) | `gen_random_uuid()` |
| `business_id` | `uuid` | Target business |
| `phone_number` | `text` | Stripped of `+`, spaces, `-` when dialed |
| `scheduled_time` | `timestamptz` | Polled every `60s` (`WHERE status = 'pending' AND scheduled_time <= NOW()`) |
| `status` | `text` | Updated to `'completed'`, `'failed_no_session'`, or `'failed_dial_error'` |

**⚠️ Multi-Tenant Hazard in `scheduler.go`**:
1. If no session matches `c.BusinessID`, `scheduler.go` (lines 66–73) **falls back to dialing using ANY connected session on the server**! Ensure Global only inserts `scheduled_calls` for businesses that have an active session (or patch `scheduler.go` to remove the cross-tenant fallback before Global goes live with scheduled calls).
2. `SELECT ... FOR UPDATE SKIP LOCKED` runs outside a transaction block, which assumes a single Go server process (only run 1 Go replica).

#### 5. `whatsapp_infra.whatsmeow_lid_map` & `whatsmeow_*`
- `whatsmeow_lid_map` maps WhatsApp Privacy LIDs (`lid` PK) to real phone digits (`pn` UNIQUE). Go populates this on `CallOffer` when `caller_pn` attribute is present and uses it for `caller_number` resolution, auto-callback dialing, and `messages/send`.

---

## 5. Gemini Live Voice Engine Behavior & Rules

Implemented in `internal/agent/gemini_live.go`:
1. **Transport**: Bidirectional WebSocket to `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`.
2. **Model Normalization**:
   - Reads `GEMINI_LIVE_MODEL` (default `"models/gemini-3.1-flash-live-preview"`).
   - If the model string does not contain `"live"`, Go overrides it to `"models/gemini-3.1-flash-live-preview"`.
   - Strips `"google/"` and prepends `"models/"` if missing.
3. **Voice Selection (`agent_configs.voice_model`)**:
   - Passed verbatim as `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`.
   - Coerced to `"Aoede"` **only if** empty or starting with `"models/"`, `"dialog-"`, or `"piper-"`.
   - Therefore, Global Platform can freely let users pick any valid Gemini Live voice name (e.g., `Aoede`, `Puck`, `Charon`, `Kore`, `Fenrir`, `Zephyr`, `Leda`, `Orus`) by storing that voice name in `whatsapp_infra.agent_configs.voice_model`.
4. **System Prompt (`agent_configs.business_prompt`)**:
   - Sent **verbatim** in `setup.systemInstruction`.
   - **Global Platform responsibility**: Language selection, tone, rules, persona, FAQs, and business knowledge MUST all be assembled by Global Platform into `agent_configs.business_prompt`. Go adds nothing.
5. **Initial Greeting (`agent_configs.greeting_message`)**:
   - Pre-synthesized **while the phone is still ringing** (as soon as `setupComplete` arrives) via a prompt asking Gemini to speak only `greeting_message`, then buffered in memory and flushed `150ms` after call pickup (`CallStateActive`).
   - Falls back to `"Hello"` if `greeting_message` is empty.
   - Because Gemini responds strictly with `greeting_message`, **Global Platform should let the user customize (or auto-translate) `greeting_message` into their chosen language**!
6. **Latency & Barge-In Tuning**:
   - `thinkingConfig.thinkingBudget: 0`, `responseModalities: ["AUDIO"]`.
   - `automaticActivityDetection.prefixPaddingMs: 300` (`bargeInMinSpeechMs`), preventing short background noises or `"mm"` backchannels from interrupting the agent.
   - `goAway` handling: auto-reconnects seamlessly using `sessionResumption.handle`.
   - Caller audio is 16 kHz PCM (contiguous WhatsApp ~60ms frames + 40ms DTX silence fill after 75ms idle); Gemini 24 kHz output is resampled to 16 kHz and processed via `VoiceMasteringEngine`.

---

## 6. Post-Call Webhook (`POST_CALL_WEBHOOK_URL`)

When an **answered** call (`ConnectedAt != nil && (peerAudioReceived || hadConversation)`) ends with **$\ge 2$ transcript entries**, Go fires an async HTTP `POST` (`20s` timeout) to `POST_CALL_WEBHOOK_URL` with header `X-Webhook-Secret: <POST_CALL_WEBHOOK_SECRET>` (if configured):

```json
{
  "event": "call.completed",
  "call_id": "whatsapp-call-id",
  "session_id": "c0b8de69bf918d7293343ad2604e5d4a",
  "business_id": "c300eeab-e6c2-474d-bccd-f2ca9fd05d7d",
  "caller_number": "+14155551234",
  "peer_jid": "14155551234@s.whatsapp.net",
  "direction": "inbound",
  "duration_seconds": 64,
  "transcripts": [
    { "timestamp": 1795600010000, "role": "assistant", "text": "Hello! How can I help?" },
    { "timestamp": 1795600014000, "role": "user", "text": "Hi, I want pricing details." }
  ]
}
```
Note: `peer_jid` automatically resolves `@lid` to `@s.whatsapp.net` via `whatsmeow_lid_map` before sending.

---

## 7. Critical Gaps & Changes Required Before Global Platform Goes Live on This Go Server

The Go server is already decoupled for **voice calls** and **outbound manual/API text sending**, **however** connecting a second independent platform (Global CRM) reveals **5 specific gaps** the Global Platform implementer must plan for:

### Gap 1: Single Global `POST_CALL_WEBHOOK_URL` (Shared Routing Conflict)
- Right now, Go `.env` has a single `POST_CALL_WEBHOOK_URL` pointing to `buildstart-wacaller`'s `http://127.0.0.1:8000/functions/v1/post-call-wacaller`.
- `post-call-wacaller` verifies `business_id` against Local CRM's `auth.users` and returns `404` / ignores unknown businesses.
- **Options when implementing Global**:
  1. **Recommended (Cleanest)**: Add an optional `webhook_url` / `webhook_secret` column to `whatsapp_infra.agent_configs` (or `whatsapp_sessions`) — if set, Go dispatches to that session's webhook instead of (or in addition to) `POST_CALL_WEBHOOK_URL`; **or** support comma-separated `POST_CALL_WEBHOOK_URLS` / per-platform dispatcher in Go so Local CRM & Global Platform receive their own post-call webhooks cleanly.
  2. Alternatively, Global can run a small internal webhook fan-out proxy or poll/subscribe via SSE `call-ended` / DB sync.

### Gap 2: Inbound WhatsApp Text Messages Are Not Forwarded Anywhere Yet (Text Agent Support)
- Currently `Session.handleIncomingMessage(evt *events.Message)` (`cmd/server/session.go:468-487`) **only** checks if non-`IsFromMe` text matches `"call"`, `"call me"`, `"callback"`, `"call back"`, `"කතා කරන්න"`, or `"call කරන්න"` to trigger an auto-callback.
- All other inbound WhatsApp messages, replies, customer names (`evt.Info.PushName`), and media are **ignored**.
- **What Global needs for a WhatsApp Text AI Agent** (using the same Go WhatsApp QR connection):
  - Extend `handleIncomingMessage` in Go to forward incoming non-`IsFromMe` messages (`session_id`, `business_id`, `from_jid`, `sender_pn`, `push_name`, `message_id`, `timestamp`, `text`, `is_group`) to a webhook (e.g. `INBOUND_MESSAGE_WEBHOOK_URL` / per-session `message_webhook_url` with `X-Webhook-Secret`), ignoring status broadcasts (`status@broadcast`) and optionally groups (`evt.Info.IsGroup`).
  - The Global Edge Function / backend receives that webhook, runs its text LLM with the tenant's prompt + chat history, and replies by calling `POST /api/sessions/{sid}/messages/send` with `X-Api-Key: <GO_API_KEY>`.
  - *(Note: Local CRM uses WAHA for text chat, so adding an opt-in or Global-scoped inbound message webhook in Go will not interfere with Local CRM — just make sure Local CRM's session does NOT get auto-replied by Global!)*

### Gap 3: Multi-Tenant Safety on Go Endpoints & Scheduler
- **Session / Call Isolation**: `GET /api/sessions`, `GET /api/calls`, `GET /api/history`, and `GET /api/events` return data across **all** businesses. Never point Global frontend browsers directly at `https://buildstart-calling-agent.buildstart.io` for session listing, SSE, or dialing without proxying through Global's authenticated API (or adding `requireAPIKey` / `business_id` query filtering on Go routes).
- **Direct Dial Fallback**: Never call `POST /api/calls/dial` without `session_id`; otherwise Go picks `defaultSession()` (which could be a Local CRM client's WhatsApp number!). Always use `POST /api/sessions/{sid}/calls`.
- **Scheduler Cross-Tenant Fallback**: `cmd/server/scheduler.go:66-73` falls back to *any* connected session if `c.BusinessID` has no connected session. Fix this in Go before Global schedules outbound calls.

### Gap 4: Always-On Auto-Answer & Auto-Callback Behavior
- **Auto-Answer** (`session.go:370`): Every inbound WhatsApp call is currently auto-answered after `1200ms` (`if true`). There is no per-business toggle yet if a Global user wants "Text-only mode" (no call auto-answer) or "Human-only / WebRTC".
- **Auto-Callback & Text Triggers** (`session.go:480-563`):
  - Globally controlled by `AUTO_CALLBACK_ENABLED` (currently `true` for Local CRM).
  - If a Global user wants inbound missed calls **not** to call back automatically, `AUTO_CALLBACK_ENABLED` currently cannot be toggled per business (`agent_configs` has no `auto_callback_enabled` or `auto_answer_enabled` boolean column).
  - If `agent_configs.fallback_message` is `""` (empty), Go skips sending the pre-callback WhatsApp text, though it will still place the auto-callback call unless disabled.
  - Note: `handleIncomingMessage` still recognizes two Sinhala callback phrases (`"කතා කරන්න"`, `"call කරන්න"`) alongside English (`"call"`, `"call me"`, `"callback"`, `"call back"`).

### Gap 5: Optional Recording & Binary Size / Key Limits
- **Gemini Key**: Single global `GEMINI_API_KEY` on Go (all voice token costs accrue to that single Google AI key unless Go adds per-tenant key or usage metering via `call_logs.duration`).
- **Recordings**: Saved to the shared MinIO bucket `call-recordings/<business_id>/<call_id>.wav` (which cleanly isolates paths by `business_id` UUID). `CallAudioRecorder` only records when audio reaches >= `0.5s` (`sampleRate/2` samples).

---

## 8. Quick Integration Checklist for the Global Platform Implementer

1. **Provisioning a Business / Bot in Global**:
   - Generate/use a valid UUID as `business_id` (Global's workspace/bot/agent UUID).
   - Whenever the user saves voice settings, prompt, knowledge base, language, or voice in Global's DB, **sync/upsert** into `whatsapp_infra.agent_configs` (via Global's server-side Edge Function / backend using `service_role` — never from the browser):
     - `business_id`: Global bot/workspace UUID
     - `business_prompt`: Full assembled system instructions (persona + language rules + knowledge + FAQs)
     - `greeting_message`: Opening sentence spoken on call pickup (in chosen language)
     - `fallback_message`: Missed-call WhatsApp SMS (or `""` if unwanted)
     - `voice_model`: Selected Gemini Live prebuilt voice name (e.g. `"Aoede"`, `"Puck"`, `"Kore"`, `"Charon"`, `"Fenrir"`, etc.)
2. **Pairing WhatsApp QR**:
   - Backend checks if `business_id` already has a session in `whatsapp_infra.whatsapp_sessions`; if not, calls `POST /api/sessions` with `{ "business_id" }`.
   - If session exists and `paired == false`, calls `POST /api/sessions/{sid}/pair`.
   - Stream/relay `session-qr` and `auth-state` events (filtered strictly to that tenant's `sessionId`!) from `GET /api/events` to the Global UI, and render the `qr` string as a QR code.
3. **Sending WhatsApp Text Messages**:
   - Call `POST https://buildstart-calling-agent.buildstart.io/api/sessions/{sid}/messages/send` from Global's backend/Edge Function with header `X-Api-Key: <GO_API_KEY>` and body `{ "to": "...", "text": "..." }`.
4. **Coordinating Shared Go Server Updates (Phase 2 for Global)**:
   - Coordinate updates to `buildstart-calling-agent` to add:
     - Per-business/platform post-call webhook routing (so Local CRM keeps `post-call-wacaller` while Global receives its own post-call webhooks),
     - Inbound WhatsApp text webhook (`events.Message` forwarding) to power Global's WhatsApp Text AI Agent,
     - Per-session flags (e.g. `voice_enabled`, `text_agent_enabled`, `auto_callback_enabled`, `webhook_url`) and removing cross-tenant fallback in `scheduler.go`,
     - API-key protection + `?business_id=` filtering on `/api/sessions`, `/api/calls`, `/api/events`.

