import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuditLog } from "./use-audit-log";

interface CancelRefundParams {
  rentalId: string;
  paymentId?: string;
  refundType: "full" | "partial" | "none";
  refundAmount?: number;
  reason: string;
  cancelledBy: string;
  tenantId?: string;
}

interface CancelRefundResult {
  success: boolean;
  message?: string;
  refund?: {
    type: string;
    refundId?: string;
    amount?: number;
    status?: string;
    message?: string;
  };
  notificationData?: {
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    vehicleName: string;
    vehicleReg?: string;
    bookingRef: string;
    reason: string;
    refundType: string;
    refundAmount?: number;
  };
  error?: string;
}

export const useCancelRental = () => {
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  return useMutation({
    mutationFn: async (params: CancelRefundParams): Promise<CancelRefundResult & { params: CancelRefundParams }> => {
      // Call the cancel-rental-refund edge function
      const { data, error } = await supabase.functions.invoke("cancel-rental-refund", {
        body: params,
      });

      if (error) {
        throw new Error(error.message || "Failed to cancel rental");
      }

      if (!data.success) {
        throw new Error(data.error || "Cancellation failed");
      }

      // Send cancellation notification if we have notification data
      if (data.notificationData && data.notificationData.customerEmail) {
        try {
          await supabase.functions.invoke("notify-booking-cancelled", {
            body: data.notificationData,
          });
        } catch (notifyError) {
          console.error("Failed to send cancellation notification:", notifyError);
          // Don't fail the whole operation if notification fails
        }
      }

      return { ...data, params };
    },
    onSuccess: (data) => {
      const { params } = data;
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["rental"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["pending-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });

      // Audit log for rental cancellation
      logAction({
        action: "rental_cancelled",
        entityType: "rental",
        entityId: params.rentalId,
        details: {
          reason: params.reason,
          refund_type: params.refundType,
          refund_amount: params.refundAmount,
          cancelled_by: params.cancelledBy,
          payment_id: params.paymentId
        }
      });

      // Audit log for refund if applicable
      if (data.refund && params.paymentId && (data.refund.type === "full" || data.refund.type === "partial")) {
        logAction({
          action: "payment_refunded",
          entityType: "payment",
          entityId: params.paymentId,
          details: {
            refund_type: data.refund.type,
            refund_amount: data.refund.amount,
            rental_id: params.rentalId
          }
        });
      }

      let successMessage = "Rental cancelled successfully.";
      if (data.refund) {
        if (data.refund.type === "full" || data.refund.type === "partial") {
          successMessage += ` Refund of $${data.refund.amount?.toLocaleString()} processed.`;
        } else if (data.refund.type === "cancelled") {
          successMessage += " Payment hold released.";
        }
      }

      toast({
        title: "Cancellation Complete",
        description: successMessage,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cancellation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
};
