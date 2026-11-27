import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { MapPin, MessageCircle, Phone, ShoppingBag, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/format";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

type Order = {
  id: string; ref: string; items: Array<{ name: string; qty: number; total_minor: number; options?: Record<string, string> }>; subtotal_minor: number; delivery_fee_minor: number;
  total_minor: number; currency: string; fulfillment: "delivery" | "pickup"; address: string | null; payment_method: string | null; customer_name: string | null;
  customer_phone: string | null; status: "new" | "confirmed" | "preparing" | "completed" | "cancelled"; source: string; notes: string | null; is_test: boolean; created_at: string;
};
const TABS: Array<[Order["status"], string]> = [["new", "New"], ["confirmed", "Confirmed"], ["preparing", "Preparing"], ["completed", "Completed"], ["cancelled", "Cancelled"]];
const NEXT: Partial<Record<Order["status"], [Order["status"], string]>> = { new: ["confirmed", "Confirm order"], confirmed: ["preparing", "Start preparing"], preparing: ["completed", "Mark completed"] };

export default function OrdersPage() {
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Order["status"]>("new");
  const [open, setOpen] = useState<Order | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["orders", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => (await supabase.from("orders").select("*").eq("workspace_id", workspace!.id).eq("is_test", false).order("created_at", { ascending: false }).limit(300)).data as Order[],
  });
  useEffect(() => {
    if (!workspace?.id) return;
    const ch = supabase.channel("orders-live").on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `workspace_id=eq.${workspace.id}` }, (p) => {
      if (p.eventType === "INSERT") toast.success(`New order ${(p.new as Order).ref}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [workspace?.id, qc]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(([s]) => [s, (data ?? []).filter((o) => o.status === s).length])), [data]);
  const rows = (data ?? []).filter((o) => o.status === tab);
  const setStatus = async (o: Order, status: Order["status"]) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", o.id);
    if (error) return toast.error("Couldn't update the order.");
    toast.success(`${o.ref} → ${status}`); setOpen(null); qc.invalidateQueries({ queryKey: ["orders"] });
  };
  return (
    <>
      <PageHeader title="Orders" description="Orders taken by your agent on calls and WhatsApp." />
      <PageBody className="space-y-4">
        <div className="flex gap-1.5 overflow-x-auto">{TABS.map(([s, l]) => <button key={s} onClick={() => setTab(s)} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", tab === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l}{counts[s] ? <span className="ml-1.5 tabular opacity-80">{counts[s]}</span> : null}</button>)}</div>
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !rows.length ? <EmptyState icon={ShoppingBag} title={tab === "new" ? "No new orders" : `No ${tab} orders`} description="Orders appear here the moment a customer confirms one." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((o) => (
              <button key={o.id} onClick={() => setOpen(o)} className="surface p-4 text-left transition-colors hover:border-brand-500/50">
                <div className="flex items-center justify-between"><span className="font-semibold">{o.ref}</span><span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}</span></div>
                <p className="mt-1 text-sm">{o.customer_name ?? "Customer"}</p>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{o.fulfillment === "delivery" ? <Truck className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />}{o.fulfillment} · {o.source === "call" ? <Phone className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}</span>
                  <span className="font-display text-lg font-semibold tabular">{formatMoney(o.total_minor, o.currency)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </PageBody>
      <Sheet open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {open && (
            <>
              <SheetHeader><SheetTitle>Order {open.ref}</SheetTitle><p className="text-sm text-muted-foreground">{format(new Date(open.created_at), "PPp")} · via {open.source}</p></SheetHeader>
              <div className="mt-6 space-y-4 text-sm">
                <div className="rounded-xl border p-4">
                  {open.items.map((i, idx) => <div key={idx} className="flex justify-between py-1"><span>{i.qty}× {i.name}{i.options && Object.keys(i.options).length ? <span className="text-muted-foreground"> ({Object.values(i.options).join(", ")})</span> : null}</span><span className="tabular">{formatMoney(i.total_minor, open.currency)}</span></div>)}
                  <div className="mt-2 space-y-1 border-t pt-2 text-muted-foreground">
                    <div className="flex justify-between"><span>Subtotal</span><span className="tabular">{formatMoney(open.subtotal_minor, open.currency)}</span></div>
                    {open.fulfillment === "delivery" && <div className="flex justify-between"><span>Delivery</span><span className="tabular">{formatMoney(open.delivery_fee_minor, open.currency)}</span></div>}
                  </div>
                  <div className="mt-2 flex justify-between border-t pt-2 font-semibold"><span>Total</span><span className="tabular">{formatMoney(open.total_minor, open.currency)}</span></div>
                </div>
                <div className="space-y-1.5 rounded-xl border p-4">
                  <p className="font-medium">{open.customer_name ?? "Customer"}</p>
                  {open.customer_phone && <p><a className="text-brand-700 hover:underline dark:text-brand-300" href={`https://wa.me/${open.customer_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{open.customer_phone}</a></p>}
                  <p className="flex items-start gap-1.5 text-muted-foreground">{open.fulfillment === "delivery" ? <><MapPin className="mt-0.5 h-4 w-4" />{open.address}</> : <><Store className="mt-0.5 h-4 w-4" />Pickup</>}</p>
                  {open.payment_method && <p className="text-muted-foreground">Payment: {open.payment_method}</p>}
                  {open.notes && <p className="text-muted-foreground">{open.notes}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {NEXT[open.status] && <Button onClick={() => setStatus(open, NEXT[open.status]![0])}>{NEXT[open.status]![1]}</Button>}
                  {open.status !== "cancelled" && open.status !== "completed" && <Button variant="outline" className="text-destructive" onClick={() => setStatus(open, "cancelled")}>Cancel order</Button>}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
