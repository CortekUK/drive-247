import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to live changes on an installment plan + its installments + its
 * notification timeline. Invalidates React Query caches so any consumer
 * (rental detail, customer portal, settings preview) updates without refresh.
 */
export function useInstallmentPlanRealtime(planId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!planId) return;
    const channel = supabase
      .channel(`installment-plan-${planId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "installment_plans", filter: `id=eq.${planId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["installment-plan"] });
          queryClient.invalidateQueries({ queryKey: ["installment-plan-full"] });
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "scheduled_installments", filter: `installment_plan_id=eq.${planId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["installment-plan"] });
          queryClient.invalidateQueries({ queryKey: ["installment-plan-full"] });
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "installment_notifications", filter: `installment_plan_id=eq.${planId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["installment-plan-events"] });
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [planId, queryClient]);
}

export default useInstallmentPlanRealtime;
