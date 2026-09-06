import { notFound } from 'next/navigation';
import { isV2 } from '@/lib/v2';
import { tenantSlugFromHeaders } from '@/lib/tenant-server';
import { InsightsView } from './insights-view';

/**
 * Insights — a v2 route with no v1 counterpart.
 *
 * The gate is resolved HERE, on the server, once, before anything renders —
 * see V2_PLAN.md §3. This file is the entire branch; nothing below it knows a
 * gate exists. It copies `integrations/page.tsx` exactly, because the shape is
 * the same: a brand-new route rather than a strangled screen.
 *
 * So the off state is `notFound()` rather than a legacy component — a tenant
 * that is not on v2 sees the portal's normal 404, exactly as it did yesterday
 * when this route did not exist at all. No v1 behaviour changes for anyone,
 * because there is no v1 behaviour here to change.
 *
 * `tenantSlugFromHeaders()` never throws and returns null on any failure, so an
 * unresolvable tenant falls through to `notFound()` too. The gate fails closed
 * onto the pre-existing behaviour, never open onto unfinished code.
 *
 * ── Why this is its own area and not a rename of /reports ────────────────────
 *
 * This screen is intended to REPLACE `/reports` and `/pl-dashboard`, but it
 * does not touch either of them and neither of them knows it exists. Both keep
 * working byte for byte for all 57 tenants while this one is proved on the
 * canary — that is the strangler rule, and it is what makes the eventual
 * cleanup three deletions rather than an unpicking job.
 *
 * ── Permissions ─────────────────────────────────────────────────────────────
 *
 * `/insights` is mapped to the EXISTING `reports` tab key in
 * `lib/permissions.ts`. That mapping is not optional: `getTabKeyForRoute()`
 * returns null for an unlisted route and `canAccessRoute()` treats null as
 * ALLOWED, so an unmapped `/insights` would be readable by every manager
 * regardless of what they were granted — and this page is the operator's whole
 * P&L. Reusing `reports` rather than minting a new key also avoids having to
 * mirror a new key into the hardcoded `ALLOWED_TAB_KEYS` arrays in the
 * `update-manager-permissions` and `admin-create-user` edge functions and
 * backfill every existing manager. Anyone who may read the reports may read
 * this; nobody new gains access.
 *
 * The view itself is a Client Component (period state + React Query) and lives
 * in a sibling file, because a Server Component is what makes the gate
 * resolvable without a flash — the two cannot be the same file.
 */
export default async function InsightsPage() {
  const tenantSlug = await tenantSlugFromHeaders();

  if (!isV2('insights', tenantSlug)) {
    notFound();
  }

  return <InsightsView />;
}
