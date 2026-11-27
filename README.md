# BuildStart — Global AI Sales Agent Platform

Self-serve SaaS: businesses create an AI agent that answers **WhatsApp calls** and **messages** and runs **outbound call campaigns**, powered by the shared Go engine (`buildstart-calling-agent`).

The full plan lives in [`reports/IMPLEMENTATION_PLAN.md`](reports/IMPLEMENTATION_PLAN.md).

## Repository layout

| Path | What |
|---|---|
| `frontend/` | Vite + React 18 + TypeScript + Tailwind + shadcn/ui SPA (deployed on Vercel) |
| `supabase/migrations/` | Database schema, RLS, credit engine, seed catalog |
| `supabase/functions/` | Edge Functions (`_shared/` = HTTP, auth, engine client, LLM clients, credits, HMAC, fixed messages) |
| `supabase/tests/database/` | pgTAP tests (`supabase test db`) |
| `tools/engine-mock/` | Deno mock of the Go engine contract, for local dev and tests |
| `resources/` | Original brand assets (processed copies in `frontend/public/brand/`) |

## Local development

```bash
# 1. Database + auth (Docker)
npx supabase start -x studio,imgproxy,vector,logflare,supavisor,mailpit,postgres-meta
npx supabase test db                 # run pgTAP tests

# 2. Frontend
cd frontend
cp .env.example .env.local           # fill VITE_SUPABASE_ANON_KEY from `npx supabase status`
npm install
npm run dev                          # http://localhost:8080

# 3. Engine mock (optional, needs Deno)
deno run -A tools/engine-mock/main.ts
```

## Environments & secrets

Frontend (Vercel): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV`, and optionally `VITE_SITE_URL` (custom domain; otherwise
the Vercel production domain is used for the sitemap, robots.txt and canonical URLs). Company and legal details live in `frontend/src/config/company.ts`.

Edge Function secrets (`npx supabase secrets set --env-file …`):

| Secret | Purpose |
|---|---|
| `AI_GENERATE_URL`, `BOT_API_KEY` | AI proxy for Orchestrator, Messaging Agent, summaries |
| `GEMINI_API_KEY` | Gemini Live voice previews |
| `ENGINE_BASE_URL`, `GO_API_KEY_GLOBAL`, `ENGINE_WEBHOOK_SECRET` | Go calling engine (platform `global`) |
| `APP_ORIGINS`, `APP_URL` | CORS allow-list; base URL for Stripe return links |
| `CRON_SECRET` | Auth for pg_cron → background functions |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Billing (test keys first) |

Never commit secrets — `.env*` files are git-ignored.

## Production backend (self-hosted Supabase "supabase3")

The Global platform runs on the self-hosted instance at `https://supabase3.buildstart.io`
(`/opt/supabase-project3`, compose project `supabase3`). **The same server hosts other Supabase instances: never
touch any other folder, compose project or database.**

- Functions: `SSH_KEY=… ./tools/deploy-supabase3.sh functions`. Secrets live only on the server in
  `/opt/supabase-project3/global-app.env` (chmod 600), loaded by the functions service via `env_file`.
- Migrations: `SSH_KEY=… DB_PASSWORD=… ./tools/deploy-supabase3.sh migrations` (SSH tunnel to the instance's local pooler port).
- Vault (`edge_base_url` = `http://api-gw:8000`, `cron_secret`) is set, so pg_cron jobs run.
- Auth settings (site URL, redirect URLs, SMTP, Google) are in the instance's `.env`; restart only `auth` after changes.
- Engine URLs for the Go server: `https://supabase3.buildstart.io/functions/v1/engine-webhook` and `/engine-tools`.

## Background jobs

`pg_cron` jobs (migrations 014 and 017). Each environment needs the two Vault entries in `supabase/snippets/cron_vault.sql`.

| Job | Schedule | Does |
|---|---|---|
| `bs-campaign-dispatcher` | every minute | dials campaign targets inside their windows |
| `bs-messaging-worker` | every minute | sends Messaging Agent replies |
| `bs-compile-sweep` | every 5 min | recompiles changed agents; resumes agents paused for credits once credits are back |
| `bs-credit-cycles` | hourly | Free plan cycles, lot expiry, low-balance and top-up-expiry reminders |
| `bs-retention` | daily 02:41 UTC | expires recordings/transcripts past the plan's `recording_retention_days` |
| `bs-account-purge` | daily 03:23 UTC | erases workspaces 30 days after the owner asked to delete them |

Agents pause automatically when the balance reaches 0 (the engine's `voice_enabled` goes false) and resume when credits are added.

## Stripe setup

1. Set `STRIPE_SECRET_KEY` (test key) and `APP_URL`.
2. Add a webhook endpoint `https://<project>.supabase.co/functions/v1/stripe-webhook` with events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.created|updated|deleted`, `charge.refunded`, `charge.dispute.created`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Enable the Customer Portal in Stripe (payment methods, invoices, cancel at period end).
Products and prices are created automatically on first checkout from the plans and packs edited in Superadmin.

## Superadmin

Insert your user id into `public.platform_admins`, then open `/admin`. First visit enrolls a TOTP authenticator (required).
Campaign calling is off until **Settings → feature_flags → campaigns_live** is switched on.
