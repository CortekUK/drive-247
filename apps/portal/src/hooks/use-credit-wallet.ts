import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isLeanTenant } from "@/lib/lean-areas";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";

export interface CreditWallet {
  id: string;
  tenant_id: string;
  balance: number;
  test_balance: number;
  lifetime_purchased: number;
  lifetime_used: number;
  test_lifetime_purchased: number;
  test_lifetime_used: number;
  low_balance_threshold: number;
  auto_refill_enabled: boolean;
  auto_refill_threshold: number;
  auto_refill_amount: number;
  auto_refill_package_id: string | null;
  stripe_payment_method_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  tenant_id: string;
  wallet_id: string;
  type: "purchase" | "usage" | "refund" | "gift" | "adjustment" | "auto_refill";
  amount: number;
  balance_after: number;
  category: string | null;
  description: string | null;
  reference_id: string | null;
  reference_type: string | null;
  package_id: string | null;
  stripe_payment_id: string | null;
  performed_by: string | null;
  is_test_mode: boolean;
  created_at: string;
}

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  bonus_credits: number;
  price_cents: number;
  currency: string;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
}

export interface CreditCost {
  id: string;
  category: string;
  cost_credits: number;
  label: string;
  description: string | null;
  is_active: boolean;
}

export function useCreditWallet() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch wallet
  const walletQuery = useQuery({
    queryKey: ["credit-wallet", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_credit_wallets")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .maybeSingle();

      if (error) throw error;
      return data as CreditWallet | null;
    },
    enabled: !!tenant,
  });

  // Fetch transactions
  const transactionsQuery = useQuery({
    queryKey: ["credit-transactions", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("credit_transactions")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data || []) as CreditTransaction[];
    },
    enabled: !!tenant,
  });

  // Fetch packages
  const packagesQuery = useQuery({
    queryKey: ["credit-packages"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("credit_packages")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data || []) as CreditPackage[];
    },
  });

  // Fetch service costs
  const costsQuery = useQuery({
    queryKey: ["credit-costs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("credit_costs")
        .select("*")
        .eq("is_active", true);

      if (error) throw error;
      return (data || []) as CreditCost[];
    },
  });

  // Create checkout session to buy credits (custom amount)
  const buyCredits = useMutation({
    // `termsAccepted` is optional so existing callers keep compiling, but the
    // credits page always sends it. Buying credits is a real charge on a route
    // explicitly whitelisted past the paywall
    // (layout.tsx: pathname === "/credits"), so a tenant created via
    // CreateTenantDialog — which provisions no subscription_plans row and
    // therefore never triggers the paywall at all — could otherwise spend money
    // having accepted nothing.
    mutationFn: async (
      arg: number | { credits: number; termsAccepted?: boolean },
    ) => {
      const credits = typeof arg === "number" ? arg : arg.credits;
      const termsAccepted = typeof arg === "number" ? undefined : arg.termsAccepted;

      // Built here rather than at module scope: it has to read the location at
      // the moment of the click, not at import.
      //
      // CANARY ONLY, and the fallback is the OLD behaviour byte for byte.
      // Following the current location is needed because on the canary the
      // credits UI also renders inside /subscription, and coming back to a
      // fixed /credits would silently relocate the operator at the exact moment
      // they have just paid. Nowhere else renders it in two places, so nowhere
      // else needs the change — and this is a live money path, so the other 36
      // keep the URL they have always been sent to.
      const returnUrl = (status: "success" | "cancelled") => {
        if (!isLeanTenant(tenant?.slug)) {
          return `${window.location.origin}/credits?status=${status}`;
        }
        const url = new URL(window.location.href);
        url.searchParams.set("status", status);
        return url.toString();
      };

      const { data: sessionData, error } = await supabase.functions.invoke(
        "create-credit-checkout",
        {
          body: {
            credits,
            tenantId: tenant!.id,
            // Come back to WHERE THE BUY STARTED, not to a fixed page.
            //
            // The credits UI now renders in two places — standalone at
            // `/credits`, and as the Credits tab of `/subscription` (the
            // "Billing" row in the rail). Hardcoding `/credits` here meant
            // buying from the Billing tab silently relocated you to a different
            // screen on the way back from Stripe, which reads as the app losing
            // your place at the exact moment you have just paid.
            //
            // `pathname + search` preserves the tab, so `?tab=credits` survives
            // the round trip; `status` is appended to whatever is already
            // there rather than replacing it.
            successUrl: returnUrl("success"),
            cancelUrl: returnUrl("cancelled"),
            ...(termsAccepted === true ? { acceptedTos: true } : {}),
          },
        }
      );

      if (error) throw error;
      if (sessionData?.error) throw new Error(sessionData.error);
      return sessionData;
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create checkout session");
    },
  });

  // Update auto-refill settings
  const updateAutoRefill = useMutation({
    mutationFn: async (settings: {
      enabled?: boolean;
      threshold?: number;
      amount?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "manage-credit-wallet",
        {
          body: {
            action: "update_auto_refill",
            tenantId: tenant!.id,
            ...settings,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-wallet", tenant?.id] });
      toast.success("Auto-refill settings updated");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update auto-refill settings");
    },
  });

  const balance = walletQuery.data?.balance ?? 0;
  const testBalance = walletQuery.data?.test_balance ?? 0;
  const isLowBalance =
    walletQuery.data != null &&
    balance <= (walletQuery.data.low_balance_threshold || 10);

  return {
    wallet: walletQuery.data,
    balance,
    testBalance,
    isLowBalance,
    transactions: transactionsQuery.data || [],
    packages: packagesQuery.data || [],
    costs: costsQuery.data || [],
    isLoading:
      walletQuery.isLoading || transactionsQuery.isLoading,
    isPackagesLoading: packagesQuery.isLoading,
    buyCredits,
    updateAutoRefill,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ["credit-wallet", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["credit-transactions", tenant?.id] });
    },
  };
}
