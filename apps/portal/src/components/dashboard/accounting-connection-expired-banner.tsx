/**
 * AccountingConnectionExpiredBanner — Sprint 6 hardening.
 *
 * Top-of-app banner that appears whenever the tenant has an expired/error
 * connection to Xero or Zoho. The `refresh-accounting-tokens` cron flips
 * connection.status='expired' after 3 consecutive 4xx token refreshes and
 * inserts a reminders row with rule_code='accounting_connection_expired'.
 *
 * We read directly from `accounting_connections_public` view (cheaper than
 * scanning reminders) and surface a one-click [Reconnect] CTA deep-linking
 * to /settings?tab=accounting.
 *
 * Hides itself when:
 *   - Operator is already on the accounting settings page (avoid noise)
 *   - All connections are 'active' or 'revoked' (revoked = operator chose to disconnect)
 */
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccountingConnections } from "@/hooks/use-accounting-connection";

export function AccountingConnectionExpiredBanner() {
  const pathname = usePathname();
  const onAccountingPage = pathname?.startsWith("/settings") && (pathname?.includes("accounting") || true);
  // Always hide on the settings page since the operator's already there.
  const hideOnSettings = pathname?.startsWith("/settings");

  const { data: connections } = useAccountingConnections();

  // Find the first expired/error connection — usually there's only one.
  const expired = useMemo(() => {
    return (connections ?? []).find((c) => c.status === "expired" || c.status === "error");
  }, [connections]);

  if (!expired) return null;
  if (hideOnSettings) return null;
  void onAccountingPage; // referenced for future granularity if needed

  const providerLabel = expired.provider === "xero" ? "Xero" : "Zoho Books";

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-amber-900">
            Your {providerLabel} connection has expired.
          </span>{" "}
          <span className="text-amber-800">
            New financial events aren&apos;t syncing. Reconnect to resume.
          </span>
        </div>
        <Button asChild size="sm" className="h-8 bg-amber-700 text-xs text-white hover:bg-amber-800">
          <Link href="/settings?tab=accounting">Reconnect →</Link>
        </Button>
      </div>
    </div>
  );
}
