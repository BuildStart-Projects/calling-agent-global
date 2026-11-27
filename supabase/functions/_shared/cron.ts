import { timingSafeEqual } from "./hmac.ts";

/** Background endpoints accept either the service-role bearer or the pg_cron secret header. */
export function isServiceOrCron(req: Request): boolean {
  const bearer = req.headers.get("Authorization") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (service && bearer === `Bearer ${service}`) return true;
  const cron = Deno.env.get("CRON_SECRET") ?? "";
  const given = req.headers.get("x-cron-secret") ?? "";
  return Boolean(cron) && given.length === cron.length && timingSafeEqual(given, cron);
}
