import { useEffect, useRef } from "react";
import { useAuditLog, type AuditAction, type EntityType } from "./use-audit-log";

interface UseAuditLogOnOpenParams {
  open: boolean;
  action: AuditAction;
  entityType: EntityType;
  entityId: string | undefined | null;
  details?: Record<string, any>;
}

export function useAuditLogOnOpen({
  open,
  action,
  entityType,
  entityId,
  details,
}: UseAuditLogOnOpenParams) {
  const { logAction } = useAuditLog();
  const prevOpenRef = useRef(false);
  const logActionRef = useRef(logAction);
  logActionRef.current = logAction;

  useEffect(() => {
    if (open && !prevOpenRef.current && entityId) {
      logActionRef.current({
        action,
        entityType,
        entityId,
        details: {
          event: "warning_dialog_shown",
          ...details,
        },
      });
    }
    prevOpenRef.current = open;
  }, [open, entityId]);
}
