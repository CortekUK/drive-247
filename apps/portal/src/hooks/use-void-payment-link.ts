import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

// Voids a single unpaid/stale payment LINK (a payments row with a checkout session)
// without touching the rental. Server-side (void-payment-link edge function) fail-closed
// guards refuse anything that carries real money, so the worst a caller can do is cancel
// an already-dead unpaid link. On success we refresh the link panels (rental + customer)
// so the voided row re-renders as "Voided".
export function useVoidPaymentLink() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  return useMutation({
    mutationFn: async (args: { paymentId: string; reason?: string; voidedBy?: string }) => {
      const { data, error } = await supabase.functions.invoke("void-payment-link", {
        body: {
          paymentId: args.paymentId,
          reason: args.reason,
          voidedBy: args.voidedBy,
        },
      });
      if (error) throw new Error(error.message || "Failed to void payment link");
      if (data && data.success === false) {
        throw new Error(data.error || "Failed to void payment link");
      }
      return data;
    },
    onSuccess: () => {
      // Every surface that reads the payments table must refresh, no matter which
      // entry point voided the link (rental/customer detail panel OR the Payments tab).
      queryClient.invalidateQueries({ queryKey: ["rental-payment-links", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["customer-payment-links", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["payments-data"] });
      queryClient.invalidateQueries({ queryKey: ["payment-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payments-chart-data"] });
    },
  });
}
