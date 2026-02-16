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
        categoryTotals[category].total += charge.amount;
        categoryTotals[category].remaining += charge.remaining_amount;
        categoryTotals[category].paid += charge.amount - charge.remaining_amount;
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

      // Get all refund entries for this rental grouped by category
      // Don't filter by tenant_id - rental_id is sufficient and refunds may have different tenant_id
      const { data: refunds, error: refundsError } = await supabase
        .from("ledger_entries")
        .select("id, category, amount, tenant_id, type")
        .eq("rental_id", rentalId)
        .eq("type", "Refund");

      if (refundsError) {
        console.error("[REFUND-BREAKDOWN] Error fetching refunds:", refundsError);
        throw refundsError;
      }

      console.log("[REFUND-BREAKDOWN] Query result for rental", rentalId, ":", refunds);

      // Group refunds by category (amounts are negative, so we use Math.abs)
      const categoryRefunds: Record<string, number> = {};

      refunds?.forEach((refund) => {
        const category = refund.category || "Other";
        if (!categoryRefunds[category]) {
          categoryRefunds[category] = 0;
        }
        // Refund amounts are stored as negative, so use Math.abs
        categoryRefunds[category] += Math.abs(refund.amount);
      });

      console.log("[REFUND-BREAKDOWN] Category refunds result:", categoryRefunds);

      return categoryRefunds;
    },
    enabled: !!tenant && !!rentalId,
    staleTime: 0, // Always refetch
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
};
