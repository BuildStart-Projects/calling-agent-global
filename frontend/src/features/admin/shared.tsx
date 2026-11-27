import { useEffect, useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callFunction, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const adminApi = <T = unknown,>(body: Record<string, unknown>) => callFunction<T>("admin-api", body);
export async function adminRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message.includes("mfa_required") ? "Verify with your authenticator app." : error.message);
  return data as T;
}
export const usd = (minor: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
export const num = (n: number, d = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(Number(n ?? 0));

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && <div className="flex items-center justify-between gap-2 border-b px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{actions}</div>}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>;
}

/** Superadmin requires TOTP (AAL2). Enrolls on first visit, verifies on later sessions. */
export function MfaGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "verify" | "enroll">("loading");
  const [factorId, setFactorId] = useState<string>();
  const [uri, setUri] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") return setState("ok");
      const { data: f } = await supabase.auth.mfa.listFactors();
      const verified = f?.totp?.find((x) => x.status === "verified");
      if (verified) { setFactorId(verified.id); return setState("verify"); }
      for (const stale of f?.all?.filter((x) => x.status !== "verified") ?? []) await supabase.auth.mfa.unenroll({ factorId: stale.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `BuildStart admin ${new Date().toISOString().slice(0, 10)}` });
      if (error) { toast.error(error.message); return; }
      setFactorId(data.id); setUri(data.totp.uri); setSecret(data.totp.secret); setState("enroll");
    })();
  }, []);
  const verify = async () => {
    if (!factorId) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) { toast.error("That code didn't work. Try the next one."); setCode(""); return; }
    setState("ok");
  };
  if (state === "ok") return <>{children}</>;
  if (state === "loading") return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-2xl border bg-card p-6 text-center">
      <ShieldCheck className="mx-auto h-8 w-8 text-brand-400" />
      <h1 className="mt-3 text-lg font-semibold">{state === "enroll" ? "Set up two-factor authentication" : "Verify it's you"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{state === "enroll" ? "Superadmin needs an authenticator app. Scan this code, then enter the 6-digit code." : "Enter the 6-digit code from your authenticator app."}</p>
      {state === "enroll" && uri && <div className="mx-auto mt-4 w-fit rounded-xl bg-white p-3"><QRCodeSVG value={uri} size={168} /></div>}
      {state === "enroll" && secret && <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{secret}</p>}
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); verify(); }}>
        <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="text-center tracking-[0.3em]" />
        <Button disabled={code.length !== 6 || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}</Button>
      </form>
    </div>
  );
}

/** Single-series daily bars with hover tooltips and a table fallback. */
export function DailyBars({ title, rows, value, format }: { title: string; rows: Array<{ day: string } & Record<string, unknown>>; value: string; format: (n: number) => string }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const vals = rows.map((r) => Number(r[value] ?? 0));
  const max = Math.max(1, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);
  return (
    <Card title={<span>{title} <span className="ml-1 font-normal text-muted-foreground">{format(total)} total</span></span>} actions={<button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setTable(!table)}>{table ? "Chart" : "Table"}</button>}>
      {table ? (
        <div className="max-h-56 overflow-y-auto text-sm">{rows.map((r, i) => <div key={r.day} className="flex justify-between border-b py-1 last:border-0"><span className="text-muted-foreground">{r.day}</span><span className="tabular">{format(vals[i]!)}</span></div>)}</div>
      ) : (
        <div className="relative">
          <div className="flex h-40 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => (
              <div key={r.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                <div className={cn("w-full rounded-t-[4px] bg-brand-500 transition-opacity", hover !== null && hover !== i && "opacity-50")} style={{ height: `${Math.max(vals[i]! > 0 ? 2 : 0, (vals[i]! / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{rows[0]?.day.slice(5)}</span><span>{rows[rows.length - 1]?.day.slice(5)}</span></div>
          {hover !== null && rows[hover] && (
            <div className="pointer-events-none absolute -top-2 rounded-md border bg-popover px-2 py-1 text-xs shadow" style={{ left: `clamp(0px, calc(${(hover / rows.length) * 100}% - 40px), calc(100% - 100px))` }}>
              <span className="text-muted-foreground">{rows[hover]!.day}</span> · <span className="font-medium tabular">{format(vals[hover]!)}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
