import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  country: string | null;
  timezone: string;
  currency: string;
  status: "active" | "suspended";
  plan_id: string | null;
  plan_period_end?: string | null;
  stripe_customer_id?: string | null;
};

export type Wallet = {
  workspace_id: string;
  total: number;
  plan_remaining: number;
  plan_expires_at: string | null;
  topup_remaining: number;
  next_topup_expiry: string | null;
  next_topup_expiry_amount: number | null;
};

type AuthState = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  workspace: Workspace | null;
  wallet: Wallet | null;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  signOut: () => Promise<void>;
  refresh: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const qc = useQueryClient();

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      qc.invalidateQueries({ queryKey: ["me"] });
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const userId = session?.user?.id;

  const meQuery = useQuery({
    queryKey: ["me", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(*)")
        .eq("user_id", userId!)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const workspace = (membership?.workspace ?? null) as unknown as Workspace | null;
      let wallet: Wallet | null = null;
      if (workspace) {
        const { data } = await supabase.from("wallet_balance").select("*").eq("workspace_id", workspace.id).maybeSingle();
        wallet = (data as Wallet) ?? null;
      }
      const { data: isAdmin } = await supabase.rpc("is_platform_admin");
      return { workspace, wallet, isPlatformAdmin: Boolean(isAdmin) };
    },
  });

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      workspace: meQuery.data?.workspace ?? null,
      wallet: meQuery.data?.wallet ?? null,
      isPlatformAdmin: meQuery.data?.isPlatformAdmin ?? false,
      emailVerified: Boolean(session?.user?.email_confirmed_at),
      signOut: async () => {
        await supabase.auth.signOut();
        qc.clear();
      },
      refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
    }),
    [ready, session, meQuery.data, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
