import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface AuditLog {
  id: string;
  action: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any> | null;
  created_at: string;
  target_user_id: string | null;
  // Joined data
  actor?: {
    name: string | null;
    email: string;
  } | null;
}

export interface AuditLogsFilters {
  entityType?: string;
  action?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useAuditLogs(filters?: AuditLogsFilters) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["audit-logs", tenant?.id, filters],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      let query = supabase
        .from("audit_logs")
        .select(
          `
          id,
          action,
          actor_id,
          entity_type,
          entity_id,
          details,
          created_at,
          target_user_id,
          actor:app_users!audit_logs_actor_id_fkey (
            name,
            email
          )
        `
        )
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters?.entityType && filters.entityType !== "all") {
        query = query.eq("entity_type", filters.entityType);
      }

      if (filters?.action && filters.action !== "all") {
        query = query.eq("action", filters.action);
      }

      if (filters?.actorId && filters.actorId !== "all") {
        query = query.eq("actor_id", filters.actorId);
      }

      if (filters?.dateFrom) {
        query = query.gte("created_at", filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte("created_at", filters.dateTo + "T23:59:59");
      }

      const { data, error } = await query.limit(500);

      if (error) {
        console.error("Error fetching audit logs:", error);
        throw error;
      }

      return data as AuditLog[];
    },
    enabled: !!tenant,
  });
}

// Hook to get unique action types for filtering
export function useAuditLogActions() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["audit-log-actions", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("audit_logs")
        .select("action")
        .eq("tenant_id", tenant.id)
        .order("action");

      if (error) throw error;

      // Get unique actions
      const uniqueActions = [...new Set(data?.map((d) => d.action) || [])];
      return uniqueActions;
    },
    enabled: !!tenant,
  });
}

// Hook to get admin users for filtering
export function useAdminUsers() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["admin-users-list", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("app_users")
        .select("id, name, email")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });
}

// Helper to format action names for display — short single-line labels
export function formatActionName(action: string): string {
  const actionMap: Record<string, string> = {
    // Settings
    update_settings: "Settings Edit",
    settings_updated: "Settings Edit",
    // Users
    create_user: "User Add",
    update_user: "User Edit",
    delete_user: "User Delete",
    user_created: "User Add",
    user_updated: "User Edit",
    user_deleted: "User Delete",
    // Customers
    blocked_customer: "Blocked",
    unblocked_customer: "Unblocked",
    customer_created: "Customer Add",
    customer_updated: "Customer Edit",
    customer_deleted: "Customer Delete",
    customer_blocked: "Blocked",
    customer_unblocked: "Unblocked",
    customer_approved: "Approved",
    customer_rejected: "Rejected",
    // Identities
    identity_blocked: "ID Blocked",
    identity_unblocked: "ID Unblocked",
    // Vehicles
    vehicle_created: "Vehicle Add",
    vehicle_updated: "Vehicle Edit",
    vehicle_deleted: "Vehicle Delete",
    vehicle_status_changed: "Status Change",
    // Rentals
    rental_created: "Rental Add",
    rental_updated: "Rental Edit",
    rental_cancelled: "Cancelled",
    rental_closed: "Closed",
    rental_extended: "Extended",
    rental_deleted: "Rental Delete",
    // Payments
    payment_created: "Payment Add",
    payment_captured: "Captured",
    payment_refunded: "Refunded",
    payment_failed: "Pay Failed",
    // Fines
    fine_created: "Fine Add",
    fine_updated: "Fine Edit",
    fine_deleted: "Fine Delete",
    fine_charged: "Fine Charged",
    fine_waived: "Fine Waived",
    fine_paid: "Fine Paid",
    fine_appeal_successful: "Appeal Won",
    // Invoices
    invoice_created: "Invoice Add",
    invoice_updated: "Invoice Edit",
    invoice_deleted: "Invoice Delete",
    invoice_sent: "Invoice Sent",
    // Documents
    document_uploaded: "Doc Upload",
    document_updated: "Doc Edit",
    document_deleted: "Doc Delete",
    // Plates
    plate_created: "Plate Add",
    plate_updated: "Plate Edit",
    plate_deleted: "Plate Delete",
    plate_assigned: "Plate Assign",
    plate_unassigned: "Plate Remove",
    // Warning shown — short labels
    rental_delete_warning_shown: "Rental Warn",
    rental_cancel_warning_shown: "Cancel Warn",
    rental_close_warning_shown: "Close Warn",
    rental_reject_warning_shown: "Reject Warn",
    vehicle_dispose_warning_shown: "Dispose Warn",
    vehicle_undo_dispose_warning_shown: "Undo Warn",
    invoice_delete_warning_shown: "Invoice Warn",
    customer_reject_warning_shown: "Reject Warn",
    payment_refund_warning_shown: "Refund Warn",
    data_cleanup_warning_shown: "Cleanup Warn",
    fine_appeal_warning_shown: "Appeal Warn",
    blocked_date_delete_warning_shown: "Date Warn",
    working_hours_update_warning_shown: "Hours Warn",
    fine_bulk_charge_warning_shown: "Bulk Charge",
    fine_bulk_waive_warning_shown: "Bulk Waive",
    customer_unblock_warning_shown: "Unblock Warn",
    identity_remove_warning_shown: "ID Warn",
    settings_reset_warning_shown: "Reset Warn",
    agreement_template_clear_warning_shown: "Template Warn",
    location_delete_warning_shown: "Location Warn",
    holiday_delete_warning_shown: "Holiday Warn",
    testimonial_delete_warning_shown: "Review Warn",
    faq_delete_warning_shown: "FAQ Warn",
    promotion_delete_warning_shown: "Promo Warn",
    // Dialog shown — short labels
    payment_create_dialog_shown: "Payment View",
    customer_form_dialog_shown: "Customer View",
    customer_document_upload_dialog_shown: "Doc View",
    user_create_dialog_shown: "User View",
    fine_create_dialog_shown: "Fine View",
    fine_authority_payment_dialog_shown: "Authority View",
    invoice_send_dialog_shown: "Invoice View",
    insurance_document_upload_dialog_shown: "Insurance View",
    insurance_policy_dialog_shown: "Policy View",
    buy_insurance_dialog_shown: "Insurance View",
    rental_review_dialog_shown: "Review View",
    vehicle_expense_dialog_shown: "Expense View",
    service_record_dialog_shown: "Service View",
    vehicle_form_dialog_shown: "Vehicle View",
    plate_form_dialog_shown: "Plate View",
    plate_assign_dialog_shown: "Assign View",
    // CRUD completion actions
    promotion_created: "Promo Add",
    promotion_updated: "Promo Edit",
    promotion_deleted: "Promo Delete",
    testimonial_created: "Review Add",
    testimonial_updated: "Review Edit",
    testimonial_deleted: "Review Delete",
    faq_created: "FAQ Add",
    faq_updated: "FAQ Edit",
    faq_deleted: "FAQ Delete",
    location_created: "Location Add",
    location_updated: "Location Edit",
    location_deleted: "Location Delete",
    holiday_created: "Holiday Add",
    holiday_updated: "Holiday Edit",
    holiday_deleted: "Holiday Delete",
    // Auth
    login_success: "Login",
    login_failed: "Login Fail",
    logout: "Logout",
  };

  if (actionMap[action]) {
    return actionMap[action];
  }

  // Fallback for unmapped dialog/warning actions
  if (action.includes("_dialog_shown")) {
    const entity = action.replace("_dialog_shown", "").replace(/_/g, " ");
    const words = entity.split(" ");
    return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + " View";
  }
  if (action.includes("_warning_shown")) {
    const entity = action.replace("_warning_shown", "").replace(/_/g, " ");
    const words = entity.split(" ");
    return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + " Warn";
  }

  // Default: capitalize, max 3 words
  const words = action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  if (words.length > 3) return words.slice(0, 2).join(" ");
  return words.join(" ");
}

// Helper to get action color
export function getActionColor(action: string): string {
  // Warning dialog shown actions (orange) — must be checked first
  if (action.includes("warning_shown") || action.includes("dialog_shown")) {
    return "text-orange-600 bg-orange-50 dark:bg-orange-950/20";
  }
  // Destructive actions (red)
  if (
    action.includes("rejected") ||
    action.includes("deleted") ||
    action.includes("blocked") ||
    action.includes("cancelled") ||
    action.includes("failed") ||
    action.includes("waived")
  ) {
    return "text-red-600 bg-red-50 dark:bg-red-950/20";
  }
  // Success actions (green)
  if (
    action.includes("approved") ||
    action.includes("created") ||
    action.includes("unblocked") ||
    action.includes("captured") ||
    action.includes("paid") ||
    action.includes("uploaded") ||
    action.includes("assigned")
  ) {
    return "text-green-600 bg-green-50 dark:bg-green-950/20";
  }
  // Update/change actions (blue)
  if (
    action.includes("updated") ||
    action.includes("changed") ||
    action.includes("extended") ||
    action.includes("closed")
  ) {
    return "text-blue-600 bg-blue-50 dark:bg-blue-950/20";
  }
  // Financial actions (amber/yellow)
  if (
    action.includes("refunded") ||
    action.includes("charged")
  ) {
    return "text-amber-600 bg-amber-50 dark:bg-amber-950/20";
  }
  return "text-gray-600 bg-gray-50 dark:bg-gray-800";
}
