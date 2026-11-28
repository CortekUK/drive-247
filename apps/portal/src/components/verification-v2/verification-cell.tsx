"use client";

/**
 * The one status, with Verify or Remind beside it (spec 03.3 to 03.10). Used on the customers list
 * row and on the customer's page. Viewers and view-only managers see the status only.
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { asStatus, REMIND_ON, STATUS_LABEL, STATUS_TONE, VERIFY_ON } from "@/lib/verification-v2/api";
import { VerifyDialogV2 } from "./verify-dialog-v2";

/** An open check past its end shows as Expired before the sweep writes it (spec 03.2). */
export function shownStatus(status: unknown, expiresAt?: string | null) {
  const s = asStatus(status);
  if ((s === "link_sent" || s === "in_progress") && expiresAt && new Date(expiresAt).getTime() <= Date.now()) return "expired";
  return s;
}

export function VerificationCell({ customerId, customerName, status, warning, size = "xs", className }: {
  customerId: string;
  customerName: string;
  status: unknown;
  warning?: string | null;
  size?: "xs" | "sm";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { canEdit } = useManagerPermissions();
  const s = asStatus(status);
  const action = VERIFY_ON.includes(s) ? "Verify" : REMIND_ON.includes(s) ? "Remind" : null;

  return (
    <span className={cn("inline-flex items-center gap-2", className)} onClick={(e) => e.stopPropagation()}>
      <span className={cn("font-medium", STATUS_TONE[s])}>{STATUS_LABEL[s]}</span>
      {s === "verified" && warning && (
        <span title={warning} aria-label={warning} className="text-[#dc2626]"><AlertTriangle className="size-3.5" /></span>
      )}
      {action && canEdit("customers") && (
        <Button size={size} variant="outline" onClick={() => setOpen(true)}>{action}</Button>
      )}
      {open && <VerifyDialogV2 open={open} onOpenChange={setOpen} customerId={customerId} customerName={customerName} />}
    </span>
  );
}
