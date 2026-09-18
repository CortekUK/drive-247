import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
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
 * `serverIsV2()` never throws: an unresolvable tenant, a missing row, a read
 * error, an unknown `portal_experience` value or a missing column GRANT all
 * fall through to `notFound()`. The gate fails closed onto the pre-existing
 * behaviour, never open onto unfinished code.
 *
 * It resolves BOTH sources — the `V2_AREAS` slug list and the tenant's own
 * `portal_experience` column — from one cached read, which is why it replaced
 * the bare `isV2(area, await tenantSlugFromHeaders())` this file used to call.
 * A self-serve tenant is flagged on the row and is in no slug list, and the
 * lean gate already routes it here: `app-sidebar-v2` hides `/reports` and
 * `/pl-dashboard` for a lean tenant and the v2 login lands on `/insights`
 * instead, so gating this route on the list alone would have left a brand-new
 * tenant with no money screen at all.
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
  if (!(await serverIsV2('insights'))) {
    notFound();
  }

  return <InsightsView />;
}
