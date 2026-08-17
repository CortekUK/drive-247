/**
 * useAccountingBanners — the Xero / Zoho connection notice, as a stack source.
 *
 * WHY THIS EXISTS RATHER THAN AN ✕ BOLTED ONTO THE OLD COMPONENT
 * -------------------------------------------------------------
 * `dashboard/accounting-connection-expired-banner.tsx` renders itself directly
 * in the dashboard layout and has no dismissal — it even imports lucide's `X`
 * and never uses it, which reads like someone intended one and stopped.
 *
 * Adding a close button there would have meant a second dismissal mechanism
 * living beside the stack's: another localStorage key shape, another set of
 * rules about when a dismissed notice comes back, and a bar that sits outside
 * the queue and so cannot participate in the one-at-a-time slot. Moving the
 * notice into the stack instead gives it the ✕, the queue position and the
 * per-tenant dismissal memory in one step, and leaves exactly one place where
 * "how do banners behave" is defined.
 *
 * WHAT IS DELIBERATELY PRESERVED
 * ------------------------------
 *   · The copy, verbatim — an operator should not be able to tell this moved.
 *   · Amber, not red. A broken accounting sync does not stop a car going out;
 *     it stops rows appearing in a ledger. Reserving red for money that is
 *     actually unsecured is the whole reason the deposit banner can be trusted.
 *   · Hidden on /settings, because the operator is already where the fix is.
 *
 * DISMISSAL: 24h, not forever. The connection stays broken until someone
 * reconnects, and nothing in the system heals it unattended — so a permanent
 * dismissal would silently stop financial data syncing with no reminder. The
 * fingerprint includes the connection status, so a change re-raises it at once.
 */
"use client";

import { useMemo } from "react";

import { useAccountingConnections } from "@/hooks/use-accounting-connection";
import { fingerprint, type AppBanner } from "../banner-types";

export function useAccountingBanners(): AppBanner[] {
  const { data: connections } = useAccountingConnections();

  return useMemo(() => {
    const broken = (connections ?? []).find(
      (c) => c.status === "expired" || c.status === "error",
    );
    if (!broken) return [];

    const providerLabel = broken.provider === "xero" ? "Xero" : "Zoho Books";

    return [
      {
        id: "accounting-connection",
        severity: "warning",
        scope: "app",
        // The operator is already on the page that fixes this.
        hideOnPathPrefix: ["/settings"],
        title: (
          <>
            <span className="font-medium">
              Your {providerLabel} connection has expired.
            </span>{" "}
            <span>New financial events aren&apos;t syncing. Reconnect to resume.</span>
          </>
        ),
        // Screen readers and the live region get flat text, never JSX.
        plainTitle: `Your ${providerLabel} connection has expired. New financial events aren't syncing.`,
        action: {
          label: "Reconnect →",
          href: "/settings?tab=accounting",
        },
        dismissal: {
          // Comes back tomorrow: the sync stays broken until a human acts, and a
          // silent permanent dismissal would quietly stop the books updating.
          ttlMs: 24 * 60 * 60 * 1000,
          label: "Dismiss for today",
          tooltip: "This comes back tomorrow if the connection is still expired.",
          // Re-raises immediately if the provider or status changes.
          fingerprint: fingerprint(broken.provider, broken.status),
        },
      },
    ];
  }, [connections]);
}
