import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import { useQueryClient } from "@tanstack/react-query";

export type AuditAction =
  // Vehicle actions
  | "vehicle_created"
  | "vehicle_updated"
  | "vehicle_deleted"
  | "vehicle_status_changed"
  // Rental actions
  | "rental_created"
  | "rental_updated"
  | "rental_cancelled"
  | "rental_closed"
  | "rental_deleted"
  | "rental_extended"
  | "rental_extension_approved"
  | "rental_extension_rejected"
  // Customer actions
  | "customer_created"
  | "customer_updated"
  | "customer_deleted"
  | "customer_blocked"
  | "customer_unblocked"
  | "customer_approved"
  | "customer_rejected"
  // Payment actions
  | "payment_created"
  | "payment_refunded"
  | "payment_captured"
  | "payment_failed"
  // Fine actions
  | "fine_created"
  | "fine_updated"
  | "fine_deleted"
  | "fine_charged"
  | "fine_waived"
  | "fine_paid"
  | "fine_appeal_successful"
  | "fine_authority_payment"
  // Invoice actions
  | "invoice_created"
  | "invoice_updated"
  | "invoice_deleted"
  | "invoice_sent"
  // Document actions
  | "document_uploaded"
  | "document_updated"
  | "document_deleted"
  // Plate actions
  | "plate_created"
  | "plate_updated"
  | "plate_deleted"
  | "plate_assigned"
  | "plate_unassigned"
  // Identity/Blocklist actions
  | "identity_blocked"
  | "identity_unblocked"
  // User actions
  | "user_created"
  | "user_updated"
  | "user_deleted"
  // Blocked dates / Working hours
  | "blocked_date_created"
  | "blocked_date_deleted"
  | "working_hours_updated"
  // Reminder actions
  | "reminder_updated"
  | "reminder_bulk_updated"
  | "reminder_rule_updated"
  | "reminder_rules_bulk_updated"
  | "reminder_rules_reset"
  // CMS actions
  | "cms_page_created"
  | "cms_page_published"
  | "cms_page_unpublished"
  | "cms_section_updated"
  | "cms_section_visibility_toggled"
  | "cms_media_uploaded"
  | "cms_media_deleted"
  | "cms_media_updated"
  // Message actions
  | "message_sent"
  // Settings actions
  | "settings_updated"
  // Promotion actions
  | "promotion_created"
  | "promotion_updated"
  | "promotion_deleted"
  // Testimonial actions
  | "testimonial_created"
  | "testimonial_updated"
  | "testimonial_deleted"
  // FAQ actions
  | "faq_created"
  | "faq_updated"
  | "faq_deleted"
  // Location actions
  | "location_created"
  | "location_updated"
  | "location_deleted"
  // Holiday actions
  | "holiday_created"
  | "holiday_updated"
  | "holiday_deleted"
  // Warning dialog shown actions
  | "rental_delete_warning_shown"
  | "rental_cancel_warning_shown"
  | "rental_close_warning_shown"
  | "rental_reject_warning_shown"
  | "vehicle_dispose_warning_shown"
  | "vehicle_undo_dispose_warning_shown"
  | "invoice_delete_warning_shown"
  | "customer_reject_warning_shown"
  | "payment_refund_warning_shown"
  | "data_cleanup_warning_shown"
  | "fine_appeal_warning_shown"
  | "blocked_date_delete_warning_shown"
  | "working_hours_update_warning_shown"
  | "fine_bulk_charge_warning_shown"
  | "fine_bulk_waive_warning_shown"
  | "customer_unblock_warning_shown"
  | "identity_remove_warning_shown"
  | "settings_reset_warning_shown"
  | "agreement_template_clear_warning_shown"
  | "location_delete_warning_shown"
  | "holiday_delete_warning_shown"
  | "testimonial_delete_warning_shown"
  | "faq_delete_warning_shown"
  | "promotion_delete_warning_shown"
  | "payment_create_dialog_shown"
  // Form/creation dialog shown actions
  | "customer_form_dialog_shown"
  | "customer_document_upload_dialog_shown"
  | "user_create_dialog_shown"
  | "fine_create_dialog_shown"
  | "fine_authority_payment_dialog_shown"
  | "invoice_send_dialog_shown"
  | "insurance_document_upload_dialog_shown"
  | "insurance_policy_dialog_shown"
  | "buy_insurance_dialog_shown"
  | "rental_review_dialog_shown"
  | "vehicle_expense_dialog_shown"
  | "service_record_dialog_shown"
  | "vehicle_form_dialog_shown"
  | "plate_form_dialog_shown"
  | "plate_assign_dialog_shown"
  // Other
  | string;

export type EntityType =
  | "vehicle"
  | "rental"
  | "customer"
  | "payment"
  | "fine"
  | "invoice"
  | "document"
  | "plate"
  | "identity"
  | "user"
  | "settings"
  | "blocked_date"
  | "working_hours"
  | "reminder"
  | "reminder_rule"
  | "cms_page"
  | "cms_section"
  | "cms_media"
  | "message"
  | "promotion"
  | "testimonial"
  | "faq"
  | "location"
  | "holiday"
  | "insurance"
  | string;

export interface AuditLogParams {
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  details?: Record<string, any>;
}

export function useAuditLog() {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const logAction = async ({
    action,
    entityType,
    entityId,
    details = {},
  }: AuditLogParams) => {
    if (!tenant?.id || !appUser?.id) return;

    try {
      const { error } = await supabase.from("audit_logs").insert({
        action,
        actor_id: appUser.id,
        entity_type: entityType,
        entity_id: entityId,
        details,
        tenant_id: tenant.id,
      });

      if (error) {
        console.error(`[AuditLog] Failed: "${action}"`, error);
      } else {
        queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
        queryClient.invalidateQueries({ queryKey: ["audit-log-actions"] });
      }
    } catch (err) {
      console.error("[AuditLog] Error:", err);
    }
  };

  return { logAction };
}

// Standalone function for use outside of React components
export async function createAuditLog(params: {
  action: AuditAction;
  entityType: EntityType;
  entityId: string;
  details?: Record<string, any>;
  actorId?: string | null;
  tenantId: string;
}) {
  const { action, entityType, entityId, details = {}, actorId, tenantId } = params;

  try {
    const { error } = await supabase.from("audit_logs").insert({
      action,
      actor_id: actorId || null,
      entity_type: entityType,
      entity_id: entityId,
      details,
      tenant_id: tenantId,
    });

    if (error) {
      console.error("Failed to create audit log:", error);
    }
  } catch (err) {
    console.error("Error creating audit log:", err);
  }
}
