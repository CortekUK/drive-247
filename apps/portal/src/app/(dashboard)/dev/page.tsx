'use client';

import { DevPageBody } from '@/components/dev/dev-page';

/**
 * `/dev` — the developer page. Canary tenant only. See
 * `components/dev/dev-page.tsx` for the gate that remains and what dropping
 * the other ones costs.
 *
 * This file used to hold a BUILD gate — `process.env.NODE_ENV ===
 * 'development'`, written in the one shape that actually folds, so a
 * production build tree-shook `DevPageBody` and its reset actions out of the
 * bundle entirely. The request (Sep 20 2026) was to see the developer tool on
 * the LIVE portal, and that gate is precisely what made that impossible, so it
 * is gone and this route now renders in production like any other.
 *
 * What still refuses it:
 *   - the page itself, on `tenant.slug === NORTHWIND`, which renders the
 *     not-found page for every other tenant; and
 *   - `ROUTE_TO_TAB['/dev']` in `lib/permissions.ts`, which maps this route to
 *     a tab key no manager can hold. `canAccessRoute` treats an UNMAPPED route
 *     as allowed, so that entry is what stops a manager-role user on the
 *     canary being granted the page silently.
 */
export default function DevPage() {
  return <DevPageBody />;
}
