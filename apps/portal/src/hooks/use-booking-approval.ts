import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuditLog } from "./use-audit-log";

interface ApproveBookingParams {
  paymentId: string;
  approvedBy?: string;
}

interface RejectBookingParams {
  paymentId: string;
  rejectedBy?: string;
  reason?: string;
}

interface BookingActionResult {
  success: boolean;
  paymentId: string;
  rentalId?: string;
  message?: string;
  error?: string;
}

export const useApproveBooking = () => {
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  return useMutation({
    mutationFn: async ({
      paymentId,
      approvedBy,
    }: ApproveBookingParams): Promise<BookingActionResult> => {
      console.log("Approving booking, payment ID:", paymentId);

      const { data, error } = await supabase.functions.invoke(
        "capture-booking-payment",
        {
          body: { paymentId, approvedBy },
        }
      );

      if (error) {
        console.error("Error approving booking:", error);
        throw new Error(error.message || "Failed to approve booking");
      }

      if (!data.success) {
        throw new Error(data.error || "Failed to approve booking");
      }

      return data;
    },
    onSuccess: (data) => {
      console.log("Booking approved successfully:", data);

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["pending-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["pending-bookings-count"] });
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });

      // Audit log for rental creation
      if (data.rentalId) {
        logAction({
          action: "rental_created",
          entityType: "rental",
          entityId: data.rentalId,
          details: { payment_id: data.paymentId, method: "booking_approved" }
        });
      }

      // Audit log for payment capture
      logAction({
        action: "payment_captured",
        entityType: "payment",
        entityId: data.paymentId,
        details: { rental_id: data.rentalId }
      });

      toast({
        title: "Booking Approved",
        description: `Payment captured successfully. Rental is now active.`,
      });
    },
    onError: (error: Error) => {
      console.error("Booking approval failed:", error);
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve booking",
        variant: "destructive",
      });
    },
  });
};

export const useRejectBooking = () => {
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  return useMutation({
    mutationFn: async ({
      paymentId,
      rejectedBy,
      reason,
    }: RejectBookingParams): Promise<BookingActionResult & { reason?: string }> => {
      console.log("Rejecting booking, payment ID:", paymentId);

      const { data, error } = await supabase.functions.invoke(
        "cancel-booking-preauth",
        {
          body: { paymentId, rejectedBy, reason },
        }
      );

      if (error) {
        console.error("Error rejecting booking:", error);
        throw new Error(error.message || "Failed to reject booking");
      }

      if (!data.success) {
        throw new Error(data.error || "Failed to reject booking");
      }

      return { ...data, reason };
    },
    onSuccess: (data) => {
      console.log("Booking rejected successfully:", data);

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ["pending-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["pending-bookings-count"] });
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });

      // Audit log
      if (data.rentalId) {
        logAction({
          action: "rental_cancelled",
          entityType: "rental",
          entityId: data.rentalId,
          details: { payment_id: data.paymentId, reason: data.reason, method: "booking_rejected" }
        });
      }

      toast({
        title: "Booking Rejected",
        description: "Pre-authorization released. Customer will not be charged.",
      });
    },
    onError: (error: Error) => {
      console.error("Booking rejection failed:", error);
      toast({
        title: "Rejection Failed",
        description: error.message || "Failed to reject booking",
        variant: "destructive",
      });
    },
  });
};
