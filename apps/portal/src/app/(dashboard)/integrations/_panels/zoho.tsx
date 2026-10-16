"use client";

// ── Zoho Books ────────────────────────────────────────────────────────────────
//
// The lean product's route to Zoho Books. Shares its panel and sync engine with
// Xero — see `accounting-v2-panel.tsx` and
// `supabase/functions/_shared/accounting-v2`. This file only picks the
// provider for the registry.

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import { AccountingPanel, AccountingStatusChip } from "./accounting-v2-panel";

export function ZohoStatus({ tenant }: { tenant: PanelTenant }) {
  return <AccountingStatusChip tenant={tenant} provider="zoho" />;
}

export default function ZohoPanel(props: IntegrationPanelProps) {
  return <AccountingPanel {...props} provider="zoho" />;
}
