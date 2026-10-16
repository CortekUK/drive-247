"use client";

// ── Xero ──────────────────────────────────────────────────────────────────────
//
// The lean product's route to Xero. The panel, its screens and its data are
// shared with Zoho Books — one provider-agnostic engine, two adapters — in
// `accounting-v2-panel.tsx` (UI) and `supabase/functions/_shared/accounting-v2`
// (sync). This file only picks the provider for the registry.

import type { IntegrationPanelProps, PanelTenant } from "./_kit";
import { AccountingPanel, AccountingStatusChip } from "./accounting-v2-panel";

export function XeroStatus({ tenant }: { tenant: PanelTenant }) {
  return <AccountingStatusChip tenant={tenant} provider="xero" />;
}

export default function XeroPanel(props: IntegrationPanelProps) {
  return <AccountingPanel {...props} provider="xero" />;
}
