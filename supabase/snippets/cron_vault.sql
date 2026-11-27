-- One-time per environment: lets pg_cron call the background Edge Functions
-- (campaign-dispatcher, messaging-worker, agent-compile sweep). Run in the SQL editor.
-- Replace the two placeholders; never commit real values.
--   <PROJECT_URL>  e.g. https://oowaokkcyytizclzwaca.supabase.co
--   <CRON_SECRET>  the same value as the CRON_SECRET Edge Function secret
select vault.create_secret('<PROJECT_URL>', 'edge_base_url', 'Base URL for pg_cron → Edge Functions');
select vault.create_secret('<CRON_SECRET>', 'cron_secret', 'Shared secret checked by background functions');
-- Verify (shows names only):
select name, created_at from vault.secrets where name in ('edge_base_url', 'cron_secret');
