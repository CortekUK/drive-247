"use client";

import { useState } from "react";
import { HEADER_ACTIONS_V2 } from "@/components/shared/header-icon-button-v2";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { InvoicesTab } from "./invoices-tab";

/**
 * Finances — one screen: invoices, and under each invoice its charges, the
 * payments that paid them, and a receipt per payment.
 *
 * One header ("Finances", a subtitle, and the Invoices tab's actions on the
 * subtitle line — portalled into `actionsSlot`), then the hero row, then the
 * invoice list. There is no tab strip: payments live under their invoices, and
 * fines are charges like any other (the Fines screen keeps `/fines`).
 */
export function FinancesView() {
  const { canView } = useManagerPermissions();
  // A callback ref into state, so the tab re-renders — and portals its
  // actions in — once the header element exists.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  if (!canView("invoices")) {
    return (
      <div className="container mx-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">You don&apos;t have access to Invoices.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">Finances</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Every invoice, the payments made against it, and a receipt for each
          </p>
        </div>
        <div ref={setActionsSlot} className={`flex items-center gap-2 ${HEADER_ACTIONS_V2}`} />
      </div>

      <InvoicesTab actionsSlot={actionsSlot} />
    </div>
  );
}
