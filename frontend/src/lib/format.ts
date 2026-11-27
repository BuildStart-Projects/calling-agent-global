export function formatCredits(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  const v = Math.max(0, n);
  return v >= 100 ? Math.floor(v).toLocaleString() : (Math.floor(v * 10) / 10).toLocaleString();
}

export function formatMoney(minor: number, currency = "USD", locale?: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
