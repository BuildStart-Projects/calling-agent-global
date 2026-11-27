import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PlanFeature = { label: string; included: boolean; highlight?: boolean; tooltip?: string };
export type Plan = {
  id: string;
  key: "free" | "pro" | "enterprise" | string;
  name: string;
  tagline: string | null;
  price_minor: number;
  currency: string;
  interval: "month";
  monthly_credits: number;
  features: PlanFeature[];
  badge: string | null;
  cta_label: string | null;
  sort: number;
};
export type TopupPack = {
  id: string;
  name: string;
  credits: number;
  price_minor: number;
  currency: string;
  validity_days: number;
  badge: string | null;
  sort: number;
};

export function usePublicPricing() {
  return useQuery({
    queryKey: ["public-pricing"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [plans, packs] = await Promise.all([
        supabase.from("plans").select("id,key,name,tagline,price_minor,currency,interval,monthly_credits,features,badge,cta_label,sort").eq("active", true).order("sort"),
        supabase.from("topup_packs").select("id,name,credits,price_minor,currency,validity_days,badge,sort").eq("active", true).order("sort"),
      ]);
      if (plans.error) throw plans.error;
      if (packs.error) throw packs.error;
      return { plans: (plans.data ?? []) as Plan[], packs: (packs.data ?? []) as TopupPack[] };
    },
  });
}
