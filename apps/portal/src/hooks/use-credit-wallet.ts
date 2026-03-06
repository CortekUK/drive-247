import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
    mutationFn: async (credits: number) => {
      const { data: sessionData, error } = await supabase.functions.invoke(
        "create-credit-checkout",
        {
          body: {
            credits,
            tenantId: tenant!.id,
            successUrl: `${window.location.origin}/credits?status=success`,
            cancelUrl: `${window.location.origin}/credits?status=cancelled`,
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
