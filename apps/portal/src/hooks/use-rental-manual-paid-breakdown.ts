import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Returns Record<category, manual-paid amount> for a rental — i.e. how much
 * was paid towards each charge category via manually-recorded (non-Stripe)
 * payments. Used to decide whether the Undo button should show on each row
 * of the Payment Breakdown table.
 */
export const useRentalManualPaidBreakdown = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-manual-paid-breakdown", tenant?.id, rentalId],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!rentalId) return {};

      // Fetch charges for this rental — we'll join allocations from these.
      let chargesQuery = supabase
        .from("ledger_entries")
        .select("id, category")
        .eq("rental_id", rentalId)
        .eq("type", "Charge");

      if (tenant?.id) {
        chargesQuery = chargesQuery.eq("tenant_id", tenant.id);
      }

      const { data: charges, error: chargesError } = await chargesQuery;
      if (chargesError) throw chargesError;
      if (!charges || charges.length === 0) return {};

      const chargeIdToCategory: Record<string, string> = {};
      charges.forEach((c) => {
        chargeIdToCategory[c.id] = c.category || "Other";
      });

      // Fetch allocations against these charges, joined to manual payments.
      const { data: applications, error: appsError } = await supabase
        .from("payment_applications")
        .select(
          `
          charge_entry_id,
          amount_applied,
          payments!inner (
            id,
            stripe_payment_intent_id,
            status,
            refund_status
          )
        `
        )
        .in(
          "charge_entry_id",
          charges.map((c) => c.id)
        );

      if (appsError) throw appsError;

      const result: Record<string, number> = {};
      (applications || []).forEach((app: any) => {
        const p = app.payments;
        if (!p) return;
        if (p.stripe_payment_intent_id) return;
        if (p.status === "Reversed") return;
        if (p.refund_status === "completed" || p.refund_status === "processing") return;

        const cat = chargeIdToCategory[app.charge_entry_id];
        if (!cat) return;
        result[cat] = (result[cat] || 0) + Number(app.amount_applied);
      });

      return result;
    },
    enabled: !!tenant && !!rentalId,
    staleTime: 0,
    refetchOnMount: true,
  });
};
