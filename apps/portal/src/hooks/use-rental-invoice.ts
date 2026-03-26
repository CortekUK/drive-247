import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface RentalInvoiceBreakdown {
  id: string;
  rentalFee: number;
  taxAmount: number;
  serviceFee: number;
  securityDeposit: number;
  insurancePremium: number;
  deliveryFee: number;
  extrasTotal: number;
  totalAmount: number;
  status: string | null;
}

/**
 * Hook to fetch invoice breakdown for a rental
 * Returns the breakdown of rental fee, tax, service fee, and security deposit
 */
export const useRentalInvoice = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-invoice", tenant?.id, rentalId],
    queryFn: async (): Promise<RentalInvoiceBreakdown | null> => {
      if (!rentalId) return null;

      let query = supabase
        .from("invoices")
        .select(`
          id,
          rental_fee,
          subtotal,
          tax_amount,
          service_fee,
          security_deposit,
          insurance_premium,
          delivery_fee,
          extras_total,
          total_amount,
          status
        `)
        .eq("rental_id", rentalId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        console.error("Error fetching rental invoice:", error);
        throw error;
      }

      if (!data) return null;

      return {
        id: data.id,
        rentalFee: data.rental_fee || data.subtotal || 0,
        taxAmount: data.tax_amount || 0,
        serviceFee: data.service_fee || 0,
        securityDeposit: data.security_deposit || 0,
        insurancePremium: data.insurance_premium || 0,
        deliveryFee: data.delivery_fee || 0,
        extrasTotal: data.extras_total || 0,
        totalAmount: data.total_amount || 0,
        status: data.status,
      };
    },
    enabled: !!tenant && !!rentalId,
  });
};

/**
 * Hook to fetch payment breakdown by category for a rental
 * Calculates how much has been paid towards each charge category
 */
export const useRentalPaymentBreakdown = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-payment-breakdown", tenant?.id, rentalId],
    queryFn: async () => {
      if (!rentalId) return null;

      // Get all charges for this rental grouped by category
      let chargesQuery = supabase
        .from("ledger_entries")
        .select("id, category, amount, remaining_amount")
        .eq("rental_id", rentalId)
        .eq("type", "Charge");

      if (tenant?.id) {
        chargesQuery = chargesQuery.eq("tenant_id", tenant.id);
      }

      const { data: charges, error: chargesError } = await chargesQuery;

      if (chargesError) throw chargesError;

      // Group charges by category
      const categoryTotals: Record<string, { total: number; paid: number; remaining: number }> = {};

      charges?.forEach((charge) => {
        const category = charge.category || "Other";
        if (!categoryTotals[category]) {
          categoryTotals[category] = { total: 0, paid: 0, remaining: 0 };
        }
        categoryTotals[category].total += Number(charge.amount);
        categoryTotals[category].remaining += Number(charge.remaining_amount);
        categoryTotals[category].paid += Number(charge.amount) - Number(charge.remaining_amount);
      });

      return categoryTotals;
    },
    enabled: !!tenant && !!rentalId,
  });
};

/**
 * Hook to fetch refund amounts by category for a rental
 * Returns how much has been refunded for each category
 */
export const useRentalRefundBreakdown = (rentalId: string | undefined) => {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["rental-refund-breakdown", tenant?.id, rentalId],
    queryFn: async () => {
      if (!rentalId) return null;

      console.log("[REFUND-BREAKDOWN] Fetching refunds for rental:", rentalId, "tenant:", tenant?.id);

      // Get all refund entries for this rental — include reference to scope per-extension
      const { data: refunds, error: refundsError } = await supabase
        .from("ledger_entries")
        .select("id, category, amount, tenant_id, type, reference, due_date")
        .eq("rental_id", rentalId)
        .eq("type", "Refund");

      if (refundsError) {
        console.error("[REFUND-BREAKDOWN] Error fetching refunds:", refundsError);
        throw refundsError;
      }

      // Group refunds by category (amounts are negative, so we use Math.abs)
      // For extension categories, also track which charge was refunded via payment_applications
      const categoryRefunds: Record<string, number> = {};
      // Also build a per-charge refund map (charge_entry_id → refund amount)
      const chargeRefunds: Record<string, number> = {};

      refunds?.forEach((refund) => {
        const category = refund.category || "Other";
        if (!categoryRefunds[category]) {
          categoryRefunds[category] = 0;
        }
        categoryRefunds[category] += Math.abs(refund.amount);
      });

      // For extension refunds, try to find which specific charge was refunded
      // by checking payment_applications linked to refund payments
      if (refunds && refunds.length > 0) {
        const extensionRefunds = refunds.filter(r => r.category?.startsWith('Extension'));
        if (extensionRefunds.length > 0) {
          // Get all charge entries for this rental to match refunds to specific charges
          const { data: charges } = await supabase
            .from("ledger_entries")
            .select("id, category, reference, due_date, amount")
            .eq("rental_id", rentalId)
            .eq("type", "Charge")
            .in("category", [...new Set(extensionRefunds.map(r => r.category!))]);

          // Match each refund to the most likely charge by category + closest amount
          extensionRefunds.forEach(refund => {
            const matchingCharges = charges?.filter(c => c.category === refund.category) || [];
            if (matchingCharges.length > 0) {
              // If only one charge with this category, assign refund to it
              if (matchingCharges.length === 1) {
                const chargeId = matchingCharges[0].id;
                chargeRefunds[chargeId] = (chargeRefunds[chargeId] || 0) + Math.abs(refund.amount);
              } else {
                // Multiple charges — match by closest amount
                const refundAmt = Math.abs(refund.amount);
                const best = matchingCharges.reduce((prev, curr) =>
                  Math.abs(curr.amount - refundAmt) < Math.abs(prev.amount - refundAmt) ? curr : prev
                );
                chargeRefunds[best.id] = (chargeRefunds[best.id] || 0) + Math.abs(refund.amount);
              }
            }
          });
        }
      }

      return { categoryRefunds, chargeRefunds };
    },
    enabled: !!tenant && !!rentalId,
    staleTime: 0, // Always refetch
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
};
