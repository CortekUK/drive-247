import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/stores/auth-store";

export interface RejectCustomerRequest {
  customerId: string;
  reason: string;
}

export interface ApproveCustomerRequest {
  customerId: string;
  notes?: string;
}

// Hook for customer status actions (reject/approve)
export function useCustomerStatusActions() {
  const queryClient = useQueryClient();
  const { appUser } = useAuth();

  // Reject a customer
  const rejectCustomer = useMutation({
    mutationFn: async ({ customerId, reason }: RejectCustomerRequest) => {
      // Get current customer status for audit log
      const { data: customer, error: fetchError } = await supabase
        .from("customers")
        .select("status, name")
        .eq("id", customerId)
        .single();

      if (fetchError) throw fetchError;

      const previousStatus = customer?.status;

      // Update customer status to Rejected
      const { error: updateError } = await supabase
        .from("customers")
        .update({
          status: "Rejected",
          rejection_reason: reason,
          rejected_at: new Date().toISOString(),
          rejected_by: appUser?.id || null,
        })
        .eq("id", customerId);

      if (updateError) throw updateError;

      // Create audit log entry
      const { error: auditError } = await supabase.from("audit_logs").insert({
        action: "customer_rejected",
        actor_id: appUser?.id || null,
        entity_type: "customer",
        entity_id: customerId,
        details: {
          customer_name: customer?.name,
          previous_status: previousStatus,
          new_status: "Rejected",
          reason: reason,
        },
      });

      if (auditError) {
        console.error("Failed to create audit log:", auditError);
      }

      return { customerId, customerName: customer?.name };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      toast.success(`${data.customerName} has been rejected`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to reject customer");
    },
  });

  // Approve a customer (change status from Rejected to Active)
  const approveCustomer = useMutation({
    mutationFn: async ({ customerId, notes }: ApproveCustomerRequest) => {
      // Get current customer status for audit log
      const { data: customer, error: fetchError } = await supabase
        .from("customers")
        .select("status, name, rejection_reason")
        .eq("id", customerId)
        .single();

      if (fetchError) throw fetchError;

      const previousStatus = customer?.status;
      const previousReason = customer?.rejection_reason;

      // Update customer status to Active and clear rejection fields
      const { error: updateError } = await supabase
        .from("customers")
        .update({
          status: "Active",
          rejection_reason: null,
          rejected_at: null,
          rejected_by: null,
        })
        .eq("id", customerId);

      if (updateError) throw updateError;

      // Create audit log entry
      const { error: auditError } = await supabase.from("audit_logs").insert({
        action: "customer_approved",
        actor_id: appUser?.id || null,
        entity_type: "customer",
        entity_id: customerId,
        details: {
          customer_name: customer?.name,
          previous_status: previousStatus,
          new_status: "Active",
          previous_rejection_reason: previousReason,
          notes: notes || null,
        },
      });

      if (auditError) {
        console.error("Failed to create audit log:", auditError);
      }

      return { customerId, customerName: customer?.name };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["customers-list"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      toast.success(`${data.customerName} has been approved`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to approve customer");
    },
  });

  return {
    rejectCustomer,
    approveCustomer,
    isLoading: rejectCustomer.isPending || approveCustomer.isPending,
  };
}
