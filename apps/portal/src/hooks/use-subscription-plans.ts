import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/stores/auth-store";

export interface SubscriptionPlan {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  features: string[];
  amount: number;
  currency: string;
  interval: string;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
  is_active: boolean;
  sort_order: number;
  trial_days: number;
  billing_model: string;
  created_at: string;
  updated_at: string;
}

export const useSubscriptionPlans = () => {
  const { tenant } = useTenant();
  // The session is part of this query's identity, not just its permission.
  //
  // THE BUG THIS FIXES: TenantProvider mounts above AuthInitializer and `tenants`
  // is anon-readable, so `tenant` goes non-null BEFORE anyone is signed in. A
  // logged-out visitor to "/" mounts the dashboard layout (hooks run above its
  // early returns) and this query fired with the anon key. RLS on
  // subscription_plans FILTERS rather than errors, so it came back HTTP 200 with
  // [] — cached as a genuine SUCCESS. Login is a client navigation, so the same
  // in-memory QueryClient survived it and staleTime kept that poisoned entry
  // fresh. The layout then read "this tenant has nothing to sell", which makes
  // showSetupGate false AND sets nothingToBuy, releasing the gate latch — so the
  // paywall never opened. Only a full reload (which wipes the cache) fixed it,
  // which is exactly the "works after refresh" symptom that was reported.
  const { session, user } = useAuth();
  return useQuery({
    // user id in the key so a result fetched as one identity can never be served
    // to another (also covers sign-out -> sign-in as a different account).
    // Appended last, so existing prefix-based invalidations still match.
    queryKey: ["subscription-plans", tenant?.id, user?.id ?? "anon"],
    queryFn: async () => {
      // Second line of defence, because `session` in the store is a snapshot and
      // the client is the thing that actually signs the request. If GoTrue's
      // token refresh fails (its own 5xx while PostgREST is healthy), supabase-js
      // falls back to the anon key — and an anon read of this table is not an
      // error, it is an empty list, which reads as "no plans to sell" and quietly
      // drops the paywall. Ask the client what it will actually send, and treat
      // "nothing" as a failure so the query lands on the ERROR path: the layout
      // treats errored plans as "unknown" and KEEPS the gate up (fail-closed),
      // rather than trusting a zero-row answer nobody was authorised to receive.
      const { data: sessionNow } = await supabase.auth.getSession();
      if (!sessionNow.session) {
        throw new Error("Not authenticated — refusing to read plans anonymously");
      }

      const { data, error } = await (supabase as any)
        .from("subscription_plans")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as SubscriptionPlan[];
    },
    // !!session is load-bearing: without it a signed-out render answers a
    // paywall question. While disabled the query stays pending, so the layout's
    // `plansResolved` stays false, `gateStateKnown` stays false and it holds the
    // skeleton — fail-closed — instead of painting an ungated dashboard.
    enabled: !!tenant && !!session,
    staleTime: 60_000,
    // The dashboard paywall holds the first paint until this query settles,
    // so cap the failure path at one retry instead of the default three
    // exponential-backoff attempts.
    retry: 1,
  });
};
