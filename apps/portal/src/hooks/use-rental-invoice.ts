import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface RentalInvoiceBreakdown {
  id: string;
  rentalFee: number;
  taxAmount: number;
  serviceFee: number;
  securityDeposit: number;
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
          tax_amount,
          service_fee,
          security_deposit,
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
        rentalFee: data.rental_fee || 0,
        taxAmount: data.tax_amount || 0,
        serviceFee: data.service_fee || 0,
        securityDeposit: data.security_deposit || 0,
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
