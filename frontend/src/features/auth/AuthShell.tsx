import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarCheck, Megaphone, PhoneIncoming } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

const SLIDES = [
  { icon: PhoneIncoming, title: "Every call answered", body: "Your AI picks up in a natural voice — day or night." },
  { icon: CalendarCheck, title: "Bookings on autopilot", body: "Real availability, confirmed instantly on WhatsApp." },
  { icon: Megaphone, title: "Leads called back", body: "One click to call everyone who inquired yesterday." },
];

export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 4200);
    return () => clearInterval(t);
  }, []);
  const S = SLIDES[i]!;
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link to="/" aria-label="BuildStart home"><Logo tone="light" className="h-7" /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-2 text-neutral-600">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-neutral-600">{footer}</div>}
        </div>
        <p className="text-center text-xs text-neutral-400">© {new Date().getFullYear()} BuildStart</p>
      </div>
      <div className="relative hidden overflow-hidden bg-[#0A0B0A] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-brand-500/25 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-20 h-[420px] w-[420px] rounded-full bg-brand-300/15 blur-[120px]" />
        <Logo tone="dark" className="relative h-8 self-start" />
        <div className="relative max-w-md">
          <AnimatePresence mode="wait">
            <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.35 }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow"><S.icon className="h-6 w-6" /></div>
              <p className="mt-6 font-display text-4xl font-semibold text-white">{S.title}</p>
              <p className="mt-3 text-lg text-white/65">{S.body}</p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-8 flex gap-2">
            {SLIDES.map((_, idx) => (
              <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-8 bg-brand-300" : "w-3 bg-white/20"}`} />
            ))}
          </div>
        </div>
        <p className="relative text-sm text-white/50">AI calling & messaging agents for WhatsApp.</p>
      </div>
    </div>
  );
}

export function GoogleButton({ onClick, loading, label = "Continue with Google" }: { onClick: () => void; loading?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border bg-white text-sm font-medium shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1S8.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c6.9 0 9.2-4.9 9.2-7.4 0-.5 0-.9-.1-1.3H12z" />
      </svg>
      {loading ? "Redirecting…" : label}
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-neutral-400">
      <span className="h-px flex-1 bg-neutral-200" /> or <span className="h-px flex-1 bg-neutral-200" />
    </div>
  );
}

/** Browser-detected defaults for the workspace; passed in sign-up metadata. */
export function detectLocaleDefaults() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const locale = navigator.language || "en-US";
  const region = (() => {
    try { return new Intl.Locale(locale).maximize().region ?? null; } catch { return null; }
  })();
  const currencyByRegion: Record<string, string> = {
    US: "USD", GB: "GBP", IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", BE: "EUR", AT: "EUR",
    FI: "EUR", GR: "EUR", CA: "CAD", AU: "AUD", NZ: "NZD", IN: "INR", LK: "LKR", AE: "AED", SA: "SAR", SG: "SGD",
    MY: "MYR", ZA: "ZAR", NG: "NGN", KE: "KES", BR: "BRL", MX: "MXN", JP: "JPY", PH: "PHP", ID: "IDR", PK: "PKR",
  };
  return { timezone, locale, country: region, currency: (region && currencyByRegion[region]) || "USD" };
}
