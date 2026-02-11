import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";

export interface TenantSubscription {
  id: string;
  tenant_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  status: string;
  plan_name: string;
  amount: number;
  currency: string;
  interval: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  trial_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantSubscriptionInvoice {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  stripe_invoice_id: string;
  stripe_invoice_pdf: string | null;
  stripe_hosted_invoice_url: string | null;
  status: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  paid_at: string | null;
  invoice_number: string | null;
  created_at: string;
  updated_at: string;
}

export function useTenantSubscription() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const subscriptionQuery = useQuery({
    queryKey: ["tenant-subscription", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_subscriptions")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .in("status", ["active", "trialing", "past_due"])
        .maybeSingle();

      if (error) throw error;
      return data as TenantSubscription | null;
    },
    enabled: !!tenant,
    staleTime: 30_000,
    retry: false,
  });

  const invoicesQuery = useQuery({
    queryKey: ["tenant-subscription-invoices", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_subscription_invoices")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as TenantSubscriptionInvoice[];
    },
    enabled: !!tenant,
    staleTime: 30_000,
    retry: false,
  });

  // Check for past subscriptions (expired trials / canceled)
  const pastSubscriptionQuery = useQuery({
    queryKey: ["tenant-past-subscription", tenant?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("tenant_subscriptions")
        .select("id, status, trial_end, ended_at, canceled_at")
        .eq("tenant_id", tenant!.id)
        .in("status", ["canceled", "incomplete_expired", "unpaid"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!tenant && !subscriptionQuery.data,
    staleTime: 60_000,
  });

  const createCheckoutSession = useMutation({
    mutationFn: async ({
      planId,
      successUrl,
      cancelUrl,
    }: {
      planId: string;
      successUrl: string;
      cancelUrl: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "create-subscription-checkout",
        {
          body: {
            tenantId: tenant!.id,
            planId,
            successUrl,
            cancelUrl,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { sessionId: string; url: string };
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create checkout session");
    },
  });

  const createPortalSession = useMutation({
    mutationFn: async ({ returnUrl }: { returnUrl: string }) => {
      const { data, error } = await supabase.functions.invoke(
        "create-subscription-portal-session",
        {
          body: {
            tenantId: tenant!.id,
            returnUrl,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { url: string };
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to open billing portal");
    },
  });

  const refetch = () => {
    queryClient.invalidateQueries({
      queryKey: ["tenant-subscription", tenant?.id],
    });
    queryClient.invalidateQueries({
      queryKey: ["tenant-subscription-invoices", tenant?.id],
    });
  };

  const isSubscribed =
    subscriptionQuery.data?.status === "active" ||
    subscriptionQuery.data?.status === "trialing";

  // Tenant had a subscription that's no longer active (expired trial or canceled)
  const hasExpiredSubscription = !isSubscribed && !!pastSubscriptionQuery.data;

  const isTrialing = subscriptionQuery.data?.status === "trialing";

  const trialDaysRemaining = (() => {
    if (!isTrialing || !subscriptionQuery.data?.trial_end) return 0;
    const now = new Date();
    const trialEnd = new Date(subscriptionQuery.data.trial_end);
    const diff = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  })();

  // Only consider "loading" when actually fetching, not when errored
  const isLoading = subscriptionQuery.isLoading && !subscriptionQuery.isError;

  return {
    subscription: subscriptionQuery.data,
    isSubscribed,
    hasExpiredSubscription,
    isTrialing,
    trialDaysRemaining,
    isLoading,
    invoices: invoicesQuery.data || [],
    invoicesLoading: invoicesQuery.isLoading,
    createCheckoutSession,
    createPortalSession,
    refetch,
  };
}
