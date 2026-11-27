import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Ban, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

type Contact = { id: string; name: string | null; push_name: string | null; phone_e164: string | null; source: string; do_not_contact: boolean; last_seen_at: string; tags: string[] };

export default function ContactsPage() {
  const { workspace } = useAuth();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", workspace?.id],
    enabled: Boolean(workspace?.id),
    queryFn: async () => (await supabase.from("contacts").select("id,name,push_name,phone_e164,source,do_not_contact,last_seen_at,tags").eq("workspace_id", workspace!.id).neq("source", "playground").order("last_seen_at", { ascending: false }).limit(500)).data as Contact[],
  });
  const rows = useMemo(() => (data ?? []).filter((c) => `${c.name ?? ""} ${c.push_name ?? ""} ${c.phone_e164 ?? ""}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <>
      <PageHeader title="Contacts" description="Everyone who called or messaged your agents." />
      <PageBody className="space-y-4">
        <div className="relative max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" className="pl-9" /></div>
        {isLoading ? <Skeleton className="h-64 rounded-xl" /> : !rows.length ? <EmptyState icon={Users} title="No contacts yet" description="Contacts are created automatically from calls and chats." /> : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2.5 font-medium">Name</th><th className="px-4 py-2.5 font-medium">Number</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Source</th><th className="px-4 py-2.5 text-right font-medium">Last seen</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{c.name ?? c.push_name ?? "—"} {c.do_not_contact && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive"><Ban className="h-3 w-3" />Do not contact</span>}</td>
                    <td className="px-4 py-3 tabular text-muted-foreground">{c.phone_e164 ?? "—"}</td>
                    <td className="hidden px-4 py-3 capitalize text-muted-foreground sm:table-cell">{c.source.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.last_seen_at), { addSuffix: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Want to call a group of contacts? <Link to="/app/campaigns" className="text-brand-700 hover:underline dark:text-brand-300">Start a campaign</Link>.</p>
      </PageBody>
    </>
  );
}
