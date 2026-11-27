import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";

export function useNotifications() {
  const { workspace } = useAuth();
  return useQuery({
    queryKey: ["notifications", workspace?.id],
    enabled: Boolean(workspace?.id),
    refetchInterval: 30_000,
    queryFn: async () => (await supabase.from("notifications").select("*").eq("workspace_id", workspace!.id).order("created_at", { ascending: false }).limit(100)).data as Array<{ id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }>,
  });
}

export default function NotificationsPage() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const unread = (data ?? []).filter((n) => !n.read_at);
  return (
    <>
      <PageHeader title="Notifications" actions={unread.length > 0 && <Button variant="outline" size="sm" onClick={async () => { await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unread.map((n) => n.id)); qc.invalidateQueries({ queryKey: ["notifications"] }); }}><CheckCheck className="mr-1 h-4 w-4" />Mark all read</Button>} />
      <PageBody>
        {!data?.length ? <EmptyState icon={Bell} title="You're all caught up" description="Alerts about calls, handoffs and your account appear here." /> : (
          <div className="overflow-hidden rounded-xl border bg-card">
            {data.map((n) => (
              <Link key={n.id} to={n.link ?? "#"} className={cn("flex gap-3 border-b px-4 py-3.5 last:border-0 hover:bg-muted/40", !n.read_at && "bg-accent/40")}>
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand-500")} />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{n.title}</span>{n.body && <span className="block text-sm text-muted-foreground">{n.body}</span>}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
              </Link>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
