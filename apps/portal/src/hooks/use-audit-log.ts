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
    if (!tenant?.id) {
      console.warn("No tenant context for audit log");
      return;
    }

    try {
      const { error } = await supabase.from("audit_logs").insert({
        action,
        actor_id: appUser?.id || null,
        entity_type: entityType,
        entity_id: entityId,
        details,
        tenant_id: tenant.id,
      });

      if (error) {
        console.error("Failed to create audit log:", error);
      } else {
        // Invalidate audit logs cache
        queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
        queryClient.invalidateQueries({ queryKey: ["audit-log-actions"] });
      }
    } catch (err) {
      console.error("Error creating audit log:", err);
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
