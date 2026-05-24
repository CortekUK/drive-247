import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Subscribes to Supabase Realtime changes on tenant_subscriptions for the
 * current tenant and invalidates the relevant React Query caches whenever
 * Stripe webhooks update subscription state. Without this, the gate only
 * reacts to subscription changes after a page refresh.
 */
export function useTenantSubscriptionRealtime() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tenant?.id) return;

    const channel = supabase
      .channel(`tenant-subscription-${tenant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tenant_subscriptions",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["tenant-subscription", tenant.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["tenant-past-subscription", tenant.id],
          });
          queryClient.invalidateQueries({
            queryKey: ["tenant-subscription-invoices", tenant.id],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id, queryClient]);
}
