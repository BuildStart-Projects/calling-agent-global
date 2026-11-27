// Minimal timezone helpers (Intl-based) so the calendar shows the business's local time on any device.

export type ZonedParts = { y: number; m: number; d: number; h: number; min: number; dow: number };

export function zoned(date: Date, tz: string): ZonedParts {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date).map((x) => [x.type, x.value]));
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: dows.indexOf(p.weekday) };
}

/** UTC instant for a wall-clock time in `tz`. */
export function fromZoned(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  const z = zoned(new Date(asUtc), tz);
  const tzAsUtc = Date.UTC(z.y, z.m - 1, z.d, z.h, z.min);
  return new Date(asUtc - (tzAsUtc - asUtc));
}

/** Calendar day (as plain y/m/d) shifted by n days. */
export function addDays(day: { y: number; m: number; d: number }, n: number) {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

export const dayKey = (x: { y: number; m: number; d: number }) => `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;

export function fmt(date: Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(date);
}
