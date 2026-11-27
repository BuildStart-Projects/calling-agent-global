import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, MessageCircle, Pencil, Phone, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/EmptyState";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/lib/supabase";
import { addDays, dayKey, fmt, fromZoned, zoned } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { useAgents } from "@/features/agents/useAgents";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";
import { WeeklyHoursDialog } from "@/features/blueprint/sections";

type Booking = {
  id: string; ref: string; service_name: string | null; service_id: string | null; starts_at: string; ends_at: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show"; source: string; customer_name: string | null;
  customer_phone: string | null; address: string | null; notes: string | null; is_test: boolean;
};
type View = "week" | "day" | "month";
const HOUR_PX = 56;
const STATUS: Record<Booking["status"], { label: string; block: string; chip: string }> = {
  confirmed: { label: "Confirmed", block: "bg-brand-600 text-white border-brand-700", chip: "bg-success/10 text-success" },
  pending: { label: "Pending", block: "bg-warning/15 text-foreground border-warning border-dashed", chip: "bg-warning/10 text-warning" },
  completed: { label: "Completed", block: "bg-muted text-muted-foreground border-border", chip: "bg-muted text-muted-foreground" },
  no_show: { label: "No-show", block: "bg-destructive/10 text-destructive border-destructive/40", chip: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", block: "bg-muted/50 text-muted-foreground line-through border-border", chip: "bg-muted text-muted-foreground" },
};
const SOURCE_ICON: Record<string, typeof Phone> = { call: Phone, whatsapp: MessageCircle, manual: Pencil, campaign: Phone, playground: MessageCircle };

export default function BookingsPage() {
  const { data: agents } = useAgents();
  const bookingAgents = (agents ?? []).filter((a) => a.type === "booking");
  const [agentId, setAgentId] = useState<string>();
  useEffect(() => { if (!agentId && bookingAgents[0]) setAgentId(bookingAgents[0].id); }, [bookingAgents, agentId]);
  if (agents && !bookingAgents.length) return <div className="p-8"><EmptyState icon={CalendarDays} title="No booking agent yet" description="Create a Booking Agent to take appointments into your calendar." action={<Button asChild><Link to="/app/new">Create a Booking Agent</Link></Button>} /></div>;
  return agentId ? <Calendar agentId={agentId} agents={bookingAgents} onAgent={setAgentId} /> : <div className="p-8"><Skeleton className="h-96 rounded-2xl" /></div>;
}

function Calendar({ agentId, agents, onAgent }: { agentId: string; agents: Array<{ id: string; name: string }>; onAgent: (id: string) => void }) {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { data: k } = useAgentKnowledge(agentId);
  const tz = k?.bookingSettings?.timezone ?? "UTC";
  const [view, setView] = useState<View>("week");
  useEffect(() => { if (isMobile) setView("day"); }, [isMobile]);
  const today = zoned(new Date(), tz);
  const [anchor, setAnchor] = useState(() => ({ y: today.y, m: today.m, d: today.d }));
  const [showCancelled, setShowCancelled] = useState(false);
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [newAt, setNewAt] = useState<Date | null | undefined>(undefined);
  const [hoursOpen, setHoursOpen] = useState(false);

  const range = useMemo(() => {
    if (view === "day") return { start: anchor, days: 1 };
    if (view === "week") { const dow = addDays(anchor, 0).dow; return { start: addDays(anchor, -((dow + 6) % 7)), days: 7 }; }
    const first = { y: anchor.y, m: anchor.m, d: 1 };
    const startDow = addDays(first, 0).dow;
    return { start: addDays(first, -((startDow + 6) % 7)), days: 42 };
  }, [view, anchor]);
  const days = useMemo(() => Array.from({ length: range.days }, (_, i) => addDays(range.start, i)), [range]);
  const fromUtc = fromZoned(range.start.y, range.start.m, range.start.d, 0, 0, tz);
  const endDay = addDays(range.start, range.days);
  const toUtc = fromZoned(endDay.y, endDay.m, endDay.d, 0, 0, tz);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["bookings", agentId, fromUtc.toISOString(), toUtc.toISOString()],
    queryFn: async () => (await supabase.from("bookings").select("*").eq("agent_id", agentId).gte("starts_at", fromUtc.toISOString()).lt("starts_at", toUtc.toISOString()).order("starts_at")).data as Booking[],
  });
  useEffect(() => {
    const ch = supabase.channel(`bookings-${agentId}`).on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `agent_id=eq.${agentId}` }, () => qc.invalidateQueries({ queryKey: ["bookings", agentId] })).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [agentId, qc]);
  const visible = (bookings ?? []).filter((b) => showCancelled || b.status !== "cancelled");

  const rules = k?.rules ?? [];
  const minHour = Math.max(0, Math.min(8, ...rules.map((r) => Number(r.start_time.slice(0, 2)))) - 1);
  const maxHour = Math.min(24, Math.max(19, ...rules.map((r) => Number(r.end_time.slice(0, 2)) + (r.end_time.slice(3, 5) !== "00" ? 1 : 0))) + 1);
  const step = (dir: number) => setAnchor((a) => view === "month" ? { y: a.m + dir > 12 ? a.y + 1 : a.m + dir < 1 ? a.y - 1 : a.y, m: ((a.m - 1 + dir + 12) % 12) + 1, d: 1 } : addDays(a, dir * (view === "week" ? 7 : 1)));
  const title = view === "month"
    ? fmt(fromZoned(anchor.y, anchor.m, 15, 12, 0, tz), tz, { month: "long", year: "numeric" })
    : view === "week" ? `${fmt(fromZoned(days[0]!.y, days[0]!.m, days[0]!.d, 12, 0, tz), tz, { month: "short", day: "numeric" })} – ${fmt(fromZoned(days[6]!.y, days[6]!.m, days[6]!.d, 12, 0, tz), tz, { month: "short", day: "numeric", year: "numeric" })}`
    : fmt(fromZoned(anchor.y, anchor.m, anchor.d, 12, 0, tz), tz, { weekday: "long", month: "long", day: "numeric" });
  const upcoming = (bookings ?? []).filter((b) => new Date(b.starts_at) > new Date() && ["confirmed", "pending"].includes(b.status)).slice(0, 5);

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col pb-16 sm:pb-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <h1 className="mr-2 text-lg font-semibold">Bookings</h1>
        {agents.length > 1 && <Select value={agentId} onValueChange={onAgent}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent></Select>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setHoursOpen(true)}><Settings2 className="mr-1 h-4 w-4" /><span className="hidden sm:inline">Availability</span></Button>
          <Button size="sm" onClick={() => setNewAt(null)}><Plus className="mr-1 h-4 w-4" />New booking</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6">
        <Button variant="outline" size="sm" onClick={() => setAnchor({ y: today.y, m: today.m, d: today.d })}>Today</Button>
        <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
        <p className="font-medium">{title}</p>
        <div className="ml-auto flex items-center gap-2">
          <label className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />Show cancelled</label>
          <span className="hidden text-xs text-muted-foreground lg:inline">🌐 {tz}</span>
          <div className="flex rounded-lg border p-0.5">
            {(["day", "week", "month"] as View[]).map((v) => <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-2.5 py-1 text-xs capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v}</button>)}
          </div>
        </div>
      </div>

      {isLoading || !k ? <div className="p-6"><Skeleton className="h-96" /></div> : view === "month" ? (
        <MonthGrid days={days} month={anchor.m} bookings={visible} tz={tz} today={today} onDay={(d) => { setAnchor(d); setView("day"); }} />
      ) : view === "day" && isMobile ? (
        <DayAgenda day={anchor} bookings={visible} tz={tz} onOpen={setOpenBooking} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto">
            <div className="sticky top-0 z-10 grid border-b bg-background" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(110px, 1fr))` }}>
              <div />
              {days.map((d) => {
                const isToday = d.y === today.y && d.m === today.m && d.d === today.d;
                const exc = k.rules.length && !k.rules.some((r) => r.weekday === d.dow);
                return (
                  <div key={dayKey(d)} className="border-l px-2 py-2 text-center">
                    <p className="text-[11px] uppercase text-muted-foreground">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.dow]}</p>
                    <p className={cn("mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold", isToday && "bg-primary text-primary-foreground")}>{d.d}</p>
                    {exc ? <p className="text-[10px] text-muted-foreground">Closed</p> : null}
                  </div>
                );
              })}
            </div>
            <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(110px, 1fr))`, height: (maxHour - minHour) * HOUR_PX }}>
              <div className="relative">
                {Array.from({ length: maxHour - minHour }, (_, i) => <span key={i} className="absolute right-2 -translate-y-2 text-[10px] text-muted-foreground" style={{ top: i * HOUR_PX }}>{String(minHour + i).padStart(2, "0")}:00</span>)}
              </div>
              {days.map((d) => (
                <DayColumn key={dayKey(d)} day={d} tz={tz} minHour={minHour} maxHour={maxHour} rules={k.rules} bookings={visible} today={today}
                  onOpen={setOpenBooking} onEmpty={(at) => setNewAt(at)} />
              ))}
            </div>
          </div>
          <aside className="hidden w-72 shrink-0 border-l p-4 xl:block">
            <p className="text-sm font-semibold">Upcoming</p>
            {upcoming.length ? <ul className="mt-3 space-y-2">{upcoming.map((b) => (
              <li key={b.id}><button onClick={() => setOpenBooking(b)} className="w-full rounded-lg border p-2.5 text-left text-sm hover:bg-muted/50">
                <p className="font-medium">{b.customer_name ?? "Customer"}</p>
                <p className="text-xs text-muted-foreground">{b.service_name ?? "Appointment"} · {fmt(new Date(b.starts_at), tz, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </button></li>))}</ul> : <p className="mt-3 text-sm text-muted-foreground">Nothing scheduled in this range.</p>}
            <div className="mt-6 space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-brand-50 ring-1 ring-brand-500/30" />Available</p>
              <p className="flex items-center gap-2"><span className="hatched h-3 w-3 rounded" />Closed</p>
              <p className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-brand-600" />Confirmed</p>
              <p className="flex items-center gap-2"><span className="h-3 w-3 rounded border border-dashed border-warning bg-warning/15" />Pending</p>
            </div>
          </aside>
        </div>
      )}

      <Sheet open={Boolean(openBooking)} onOpenChange={(o) => !o && setOpenBooking(null)}>
        <SheetContent className="w-full sm:max-w-md">{openBooking && <BookingDetail booking={openBooking} tz={tz} onDone={() => { setOpenBooking(null); qc.invalidateQueries({ queryKey: ["bookings", agentId] }); }} />}</SheetContent>
      </Sheet>
      {newAt !== undefined && k && <NewBookingDialog agentId={agentId} tz={tz} at={newAt} services={k.catalog.filter((c) => c.kind === "service")} onClose={() => setNewAt(undefined)} onSaved={() => qc.invalidateQueries({ queryKey: ["bookings", agentId] })} />}
      {hoursOpen && k && <WeeklyHoursDialog k={k} onClose={() => setHoursOpen(false)} />}
    </div>
  );
}

function DayColumn({ day, tz, minHour, maxHour, rules, bookings, today, onOpen, onEmpty }: {
  day: { y: number; m: number; d: number; dow: number }; tz: string; minHour: number; maxHour: number; rules: Array<{ weekday: number; start_time: string; end_time: string }>;
  bookings: Booking[]; today: { y: number; m: number; d: number; h: number; min: number }; onOpen: (b: Booking) => void; onEmpty: (at: Date) => void;
}) {
  const dayRules = rules.filter((r) => r.weekday === day.dow);
  const toPx = (h: number, m: number) => ((h - minHour) + m / 60) * HOUR_PX;
  const items = bookings.filter((b) => { const z = zoned(new Date(b.starts_at), tz); return z.y === day.y && z.m === day.m && z.d === day.d; });
  // side-by-side lanes for overlaps
  const lanes: Booking[][] = [];
  for (const b of items) {
    const lane = lanes.find((l) => new Date(l[l.length - 1]!.ends_at) <= new Date(b.starts_at));
    if (lane) lane.push(b); else lanes.push([b]);
  }
  const isToday = day.y === today.y && day.m === today.m && day.d === today.d;
  return (
    <div className={cn("relative border-l", !dayRules.length && "hatched")}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const mins = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60 / 30) * 30;
        onEmpty(fromZoned(day.y, day.m, day.d, minHour + Math.floor(mins / 60), mins % 60, tz));
      }}>
      {Array.from({ length: maxHour - minHour }, (_, i) => <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} />)}
      {dayRules.map((r, i) => {
        const [sh, sm] = r.start_time.split(":").map(Number); const [eh, em] = r.end_time.split(":").map(Number);
        return <div key={i} className="pointer-events-none absolute inset-x-0 bg-brand-50/70" style={{ top: toPx(sh!, sm!), height: toPx(eh!, em!) - toPx(sh!, sm!) }} />;
      })}
      {isToday && <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-destructive" style={{ top: toPx(today.h, today.min) }}><span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" /></div>}
      {lanes.map((lane, li) => lane.map((b) => {
        const s = zoned(new Date(b.starts_at), tz); const e = zoned(new Date(b.ends_at), tz);
        const top = toPx(s.h, s.min); const height = Math.max(24, toPx(e.h, e.min) - top - 2);
        const Icon = SOURCE_ICON[b.source] ?? Pencil;
        return (
          <button key={b.id} onClick={() => onOpen(b)} className={cn("absolute z-[6] overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition-transform hover:scale-[1.02]", STATUS[b.status].block)}
            style={{ top: top + 1, height, left: `calc(${(li / lanes.length) * 100}% + 2px)`, width: `calc(${100 / lanes.length}% - 4px)` }}>
            <span className="flex items-center gap-1 font-semibold"><Icon className="h-3 w-3 shrink-0" /><span className="truncate">{b.customer_name ?? "Customer"}</span></span>
            <span className="block truncate opacity-90">{b.service_name ?? "Appointment"}</span>
            {height > 44 && <span className="block opacity-80">{String(s.h).padStart(2, "0")}:{String(s.min).padStart(2, "0")}</span>}
          </button>
        );
      }))}
    </div>
  );
}

function MonthGrid({ days, month, bookings, tz, today, onDay }: { days: Array<{ y: number; m: number; d: number; dow: number }>; month: number; bookings: Booking[]; tz: string; today: { y: number; m: number; d: number }; onDay: (d: { y: number; m: number; d: number }) => void }) {
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) { const z = zoned(new Date(b.starts_at), tz); const key = dayKey(z); byDay.set(key, [...(byDay.get(key) ?? []), b]); }
  return (
    <div className="grid flex-1 grid-cols-7 overflow-auto border-t">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b border-l px-2 py-1.5 text-[11px] uppercase text-muted-foreground">{d}</div>)}
      {days.map((d) => {
        const list = byDay.get(dayKey(d)) ?? [];
        const isToday = d.y === today.y && d.m === today.m && d.d === today.d;
        return (
          <button key={dayKey(d)} onClick={() => onDay(d)} className={cn("min-h-[92px] border-b border-l p-2 text-left hover:bg-muted/40", d.m !== month && "bg-muted/30 text-muted-foreground")}>
            <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", isToday && "bg-primary text-primary-foreground")}>{d.d}</span>
            <div className="mt-1 space-y-0.5">
              {list.slice(0, 3).map((b) => <p key={b.id} className={cn("truncate rounded px-1 text-[10px]", STATUS[b.status].chip)}>{fmt(new Date(b.starts_at), tz, { hour: "2-digit", minute: "2-digit" })} {b.customer_name ?? ""}</p>)}
              {list.length > 3 && <p className="text-[10px] text-muted-foreground">+{list.length - 3} more</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DayAgenda({ day, bookings, tz, onOpen }: { day: { y: number; m: number; d: number }; bookings: Booking[]; tz: string; onOpen: (b: Booking) => void }) {
  const list = bookings.filter((b) => { const z = zoned(new Date(b.starts_at), tz); return z.y === day.y && z.m === day.m && z.d === day.d; });
  if (!list.length) return <div className="p-6"><EmptyState icon={CalendarDays} title="No bookings this day" description="New bookings from calls and chats appear here instantly." /></div>;
  return (
    <ul className="flex-1 space-y-2 overflow-y-auto p-4">
      {list.map((b) => (
        <li key={b.id}><button onClick={() => onOpen(b)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left">
          <span className="w-14 text-sm font-semibold tabular">{fmt(new Date(b.starts_at), tz, { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.customer_name ?? "Customer"}</span><span className="block truncate text-xs text-muted-foreground">{b.service_name ?? "Appointment"}</span></span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS[b.status].chip)}>{STATUS[b.status].label}</span>
        </button></li>
      ))}
    </ul>
  );
}

function BookingDetail({ booking: b, tz, onDone }: { booking: Booking; tz: string; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [newTime, setNewTime] = useState("");
  const setStatus = async (status: Booking["status"]) => {
    setBusy(status);
    const { error } = await supabase.from("bookings").update({ status }).eq("id", b.id);
    setBusy(null);
    if (error) toast.error("Couldn't update the booking."); else { toast.success(`Marked ${STATUS[status].label.toLowerCase()}`); onDone(); }
  };
  const reschedule = async () => {
    const m = newTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return;
    setBusy("reschedule");
    const at = fromZoned(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz);
    const { data, error } = await supabase.rpc("reschedule_booking", { p_booking: b.id, p_start: at.toISOString() });
    setBusy(null);
    if (error || !data?.ok) toast.error("That time isn't available. Pick another or adjust availability."); else { toast.success("Rescheduled"); onDone(); }
  };
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">{b.customer_name ?? "Customer"} <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[b.status].chip)}>{STATUS[b.status].label}</span></SheetTitle>
        <p className="text-sm text-muted-foreground">{b.ref}{b.is_test && " · test booking"}</p>
      </SheetHeader>
      <div className="mt-6 space-y-4 text-sm">
        <div className="rounded-xl border p-4">
          <p className="font-medium">{b.service_name ?? "Appointment"}</p>
          <p className="mt-1 flex items-center gap-1.5 text-muted-foreground"><Clock className="h-4 w-4" />{fmt(new Date(b.starts_at), tz, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} – {fmt(new Date(b.ends_at), tz, { hour: "2-digit", minute: "2-digit" })}</p>
          <p className="mt-1 text-xs text-muted-foreground">Booked via {b.source}</p>
        </div>
        {(b.customer_phone || b.address || b.notes) && (
          <div className="space-y-1 rounded-xl border p-4">
            {b.customer_phone && <p>📞 <a className="text-brand-700 hover:underline dark:text-brand-300" href={`https://wa.me/${b.customer_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{b.customer_phone}</a></p>}
            {b.address && <p>📍 {b.address}</p>}
            {b.notes && <p className="text-muted-foreground">{b.notes}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {b.status === "pending" && <Button onClick={() => setStatus("confirmed")} disabled={Boolean(busy)}>Confirm</Button>}
          {["confirmed", "pending"].includes(b.status) && <Button variant="outline" onClick={() => setStatus("completed")} disabled={Boolean(busy)}>Mark completed</Button>}
          {["confirmed", "pending"].includes(b.status) && <Button variant="outline" onClick={() => setStatus("no_show")} disabled={Boolean(busy)}>No-show</Button>}
          {b.status !== "cancelled" && <Button variant="outline" className="text-destructive" onClick={() => setStatus("cancelled")} disabled={Boolean(busy)}>Cancel booking</Button>}
        </div>
        {["confirmed", "pending"].includes(b.status) && (
          <div className="space-y-2 rounded-xl border p-4">
            <Label htmlFor="resched">Reschedule ({tz})</Label>
            <div className="flex gap-2"><Input id="resched" type="datetime-local" value={newTime} onChange={(e) => setNewTime(e.target.value)} /><Button onClick={reschedule} disabled={!newTime || busy === "reschedule"}>{busy === "reschedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move"}</Button></div>
          </div>
        )}
      </div>
    </>
  );
}

function NewBookingDialog({ agentId, tz, at, services, onClose, onSaved }: { agentId: string; tz: string; at: Date | null; services: Array<{ id: string; name: string; duration_minutes: number | null }>; onClose: () => void; onSaved: () => void }) {
  const z = at ? zoned(at, tz) : null;
  const [when, setWhen] = useState(z ? `${z.y}-${String(z.m).padStart(2, "0")}-${String(z.d).padStart(2, "0")}T${String(z.h).padStart(2, "0")}:${String(z.min).padStart(2, "0")}` : "");
  const [service, setService] = useState(services[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [outside, setOutside] = useState(false);
  const save = async (force = false) => {
    const m = when.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m || !name.trim()) return;
    setBusy(true);
    const start = fromZoned(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, tz);
    const { data, error } = await supabase.rpc("book_slot", { p_agent: agentId, p_service: service || null, p_start: start.toISOString(), p_contact: null, p_name: name, p_phone: phone || null, p_notes: notes || null, p_address: null, p_source: "manual", p_is_test: false, p_force: force });
    setBusy(false);
    if (error) return toast.error("Couldn't create the booking.");
    if (!data.ok) { setOutside(true); return; }
    toast.success(`Booked ${data.ref}`);
    onSaved(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New booking</DialogTitle><DialogDescription>Times are in {tz}.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Service</Label>
            <Select value={service} onValueChange={setService}><SelectTrigger><SelectValue placeholder="Choose a service" /></SelectTrigger><SelectContent>{services.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="nb-when">Date & time</Label><Input id="nb-when" type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setOutside(false); }} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="nb-name">Customer name</Label><Input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="nb-phone">Phone</Label><Input id="nb-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="nb-notes">Notes</Label><Textarea id="nb-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {outside && <p className="rounded-lg bg-warning/10 p-3 text-sm">That time is outside your availability or already full. Book it anyway?</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {outside ? <Button onClick={() => save(true)} disabled={busy}>Book anyway</Button> : <Button onClick={() => save(false)} disabled={busy || !name.trim() || !when}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Book</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
