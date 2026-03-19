import { supabase } from "@/integrations/supabase/client";

/**
 * Log a customer-initiated audit event to the audit_logs table.
 * All booking-app actions use actor_id: null (no staff actor).
 * Silently no-ops if tenantId or entityId is missing — never throws.
 */
export async function logCustomerAudit(params: {
  action: string;
  entityType: string;
  entityId: string;
  tenantId: string | null | undefined;
  details?: Record<string, any>;
}) {
  const { action, entityType, entityId, tenantId, details = {} } = params;

  if (!tenantId || !entityId) return;

  try {
    const { error } = await supabase.from("audit_logs").insert({
      action,
      actor_id: null,
      entity_type: entityType,
      entity_id: entityId,
      tenant_id: tenantId,
      details,
    });

    if (error) {
      console.error(`[Audit] Failed: "${action}"`, error);
    }
  } catch (err) {
    console.error("[Audit] Error:", err);
  }
}
