import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Ban, MessageCircle, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { StartCampaignButton } from "@/features/campaigns/StartCampaignDialog";
import { cn } from "@/lib/utils";

type Contact = {
  id: string; name: string | null; push_name: string | null; phone_e164: string | null; source: string; do_not_contact: boolean; last_seen_at: string; tags: string[];
  conversations: Array<{ id: string; is_test: boolean }>;
};
type Filter = "all" | "callable" | "dnc";

export default function ContactsPage() {
  const { workspace } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const key = ["contacts", workspace?.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: Boolean(workspace?.id),
    queryFn: async () => (await supabase.from("contacts").select("id,name,push_name,phone_e164,source,do_not_contact,last_seen_at,tags,conversations(id,is_test)").eq("workspace_id", workspace!.id).neq("source", "playground").order("last_seen_at", { ascending: false }).limit(1000)).data as Contact[],
  });
  const rows = useMemo(() => (data ?? []).filter((c) =>
    (filter === "all" || (filter === "dnc" ? c.do_not_contact : !c.do_not_contact && c.phone_e164)) &&
    `${c.name ?? ""} ${c.push_name ?? ""} ${c.phone_e164 ?? ""} ${c.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())), [data, q, filter]);
  const selectable = rows.filter((c) => !c.do_not_contact && c.phone_e164);
  const allPicked = selectable.length > 0 && selectable.every((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const setDnc = async (c: Contact, v: boolean) => {
    qc.setQueryData<Contact[]>(key, (old) => old?.map((x) => (x.id === c.id ? { ...x, do_not_contact: v } : x)));
    const { error } = await supabase.from("contacts").update({ do_not_contact: v }).eq("id", c.id);
    if (error) { toast.error("Couldn't update."); qc.invalidateQueries({ queryKey: key }); return; }
    if (v) setPicked((s) => { const n = new Set(s); n.delete(c.id); return n; });
    toast.success(v ? "Won't be called or messaged by campaigns" : "Can be contacted again");
  };
  const openChat = (c: Contact) => { const conv = c.conversations.find((x) => !x.is_test); if (conv) nav(`/app/inbox?c=${conv.id}`); };

  return (
    <TooltipProvider delayDuration={200}>
      <PageHeader title="Contacts" description="Everyone who called or messaged your agents." />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or tag" className="pl-9" aria-label="Search contacts" /></div>
          <div className="flex gap-1.5">
            {([["all", "All"], ["callable", "Can contact"], ["dnc", "Do not contact"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm", filter === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{l}</button>
            ))}
          </div>
          <div className="ml-auto">{picked.size > 0 && <StartCampaignButton contactIds={[...picked]} label="Add to campaign" onDone={() => setPicked(new Set())} />}</div>
        </div>
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !rows.length ? (
          <EmptyState icon={Users} title={data?.length ? "No matches" : "No contacts yet"} description={data?.length ? "Try a different search or filter." : "Contacts are created automatically from calls and chats, and from numbers you import into campaigns."} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5"><Checkbox checked={allPicked} onCheckedChange={(v) => setPicked(v ? new Set(selectable.map((c) => c.id)) : new Set())} aria-label="Select all" /></th>
                  <th className="px-2 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Source</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Last seen</th>
                  <th className="px-4 py-2.5 text-right font-medium">Do not contact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const chat = c.conversations.some((x) => !x.is_test);
                  const canPick = !c.do_not_contact && Boolean(c.phone_e164);
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3"><Checkbox checked={picked.has(c.id)} disabled={!canPick} onCheckedChange={() => toggle(c.id)} aria-label={`Select ${c.name ?? c.phone_e164}`} /></td>
                      <td className="px-2 py-3">
                        <button onClick={() => openChat(c)} disabled={!chat} className={cn("text-left font-medium", chat && "hover:text-brand-700 hover:underline dark:hover:text-brand-300")}>
                          {c.name ?? c.push_name ?? "—"}{chat && <MessageCircle className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" />}
                        </button>
                        {c.do_not_contact && <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive"><Ban className="h-3 w-3" />Do not contact</span>}
                        {c.tags.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{c.tags.slice(0, 3).map((t) => <span key={t} className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{t}</span>)}</div>}
                      </td>
                      <td className="px-4 py-3 tabular text-muted-foreground">{c.phone_e164 ?? "—"}</td>
                      <td className="hidden px-4 py-3 capitalize text-muted-foreground md:table-cell">{c.source.replace(/_/g, " ")}</td>
                      <td className="hidden px-4 py-3 text-xs text-muted-foreground sm:table-cell">{formatDistanceToNow(new Date(c.last_seen_at), { addSuffix: true })}</td>
                      <td className="px-4 py-3 text-right">
                        <Tooltip><TooltipTrigger asChild><span className="inline-flex"><Switch checked={c.do_not_contact} onCheckedChange={(v) => setDnc(c, v)} aria-label="Do not contact" /></span></TooltipTrigger>
                          <TooltipContent>Campaigns skip this person. Your agent still answers if they reach out.</TooltipContent></Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Want to import a list? <Link to="/app/campaigns" className="text-brand-700 hover:underline dark:text-brand-300">Start a campaign</Link> and upload Excel, CSV, PDF or a photo.</p>
      </PageBody>
    </TooltipProvider>
  );
}
