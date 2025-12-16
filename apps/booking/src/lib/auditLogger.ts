import { supabase } from "@/integrations/supabase/client";

interface AuditLogParams {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
}

/**
 * Logs an audit event with field-level diff tracking
 * Only includes changed fields in before/after
 */
export async function logAuditEvent({
  action,
  entityType,
  entityId,
  summary,
  before = {},
  after = {},
}: AuditLogParams) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.error("No authenticated user for audit log");
      return;
    }

    // Extract only changed fields
    const changedFields = getChangedFields(before, after);

    const auditData = {
      user_id: user.id,
      action,
      table_name: entityType.toLowerCase().replace(/\s+/g, "_"),
      record_id: entityId || null,
      old_values: changedFields.oldValues as any,
      new_values: changedFields.newValues as any,
      // IP and user agent can be captured server-side in production
    };

    const { error } = await supabase
      .from("audit_logs")
      .insert([auditData]);

    if (error) {
      console.error("Failed to log audit event:", error);
    }
  } catch (error) {
    console.error("Error in logAuditEvent:", error);
  }
}

/**
 * Compares two objects and returns only the changed fields
 */
function getChangedFields(
  before: Record<string, any>,
  after: Record<string, any>
): { oldValues: Record<string, any>; newValues: Record<string, any> } {
  const oldValues: Record<string, any> = {};
  const newValues: Record<string, any> = {};

  // Get all unique keys from both objects
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  allKeys.forEach((key) => {
    const beforeValue = before[key];
    const afterValue = after[key];

    // Deep comparison for objects and arrays
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      oldValues[key] = beforeValue;
      newValues[key] = afterValue;
    }
  });

  return { oldValues, newValues };
}

/**
 * Generates a human-readable summary from changed fields
 */
export function generateFieldSummary(
  entityType: string,
  changedFields: string[]
): string {
  if (changedFields.length === 0) return `Updated ${entityType}`;
  
  const fieldNames = changedFields
    .map(field => field
      .replace(/_/g, " ")
      .replace(/\b\w/g, l => l.toUpperCase())
    )
    .join(", ");
  
  return `Updated ${entityType}: ${fieldNames}`;
}