'use client';

import { useTenant } from '@/contexts/TenantContext';
import { usePortalExperience } from '@/lib/v2-context';
import {
  isAreaHiddenForLean,
  isLeanTenant,
  isSettingsTabHiddenForLean,
  resolveBoldSignModeForLean,
  type LeanHiddenArea,
} from '@/lib/lean-areas';

/**
 * The lean-area gates, as hooks.
 *
 * `lib/lean-areas.ts` stays a pure module of functions that take a slug. This
 * file is how a Client Component asks the same questions without a slug, and
 * it exists because the answer stopped being derivable from the slug alone: a
 * tenant is now lean when its slug is in `LEAN_TENANTS` OR its row says
 * `portal_experience = 'v2'`, and the row is read on the server, once, in the
 * root layout. There is nothing in the browser that knows the column's value
 * except the context the layout filled.
 *
 * ── Why the hooks OR the two sources rather than trusting the server value ──
 *
 * `usePortalExperience().lean` is already `isLeanTenant(headerSlug) || onV2`, so
 * OR-ing `isLeanTenant(clientSlug)` on top of it looks redundant. It is not, and
 * the reason is that the two slugs come from different places: the server's
 * comes from `x-tenant-slug` (set by `proxy.ts`) and the client's from
 * `window.location.hostname` (`TenantContext`). They agree in every case that
 * exists today, including custom portal domains, because both resolve the same
 * way — but if they ever disagree, this arrangement can only ever hide MORE for
 * a lean tenant and never LESS for anyone. Dropping the client half would make
 * a divergence show up as the canary silently getting v1 areas back, which is
 * the failure mode with no error message.
 *
 * It also means these hooks answer correctly on the FIRST paint. The client
 * slug is null for a tick (`TenantContext` sets it in an effect), which is why
 * the pure functions fail open on a null slug; the server value has no such
 * tick. For a v1 tenant both halves are false either way, so nothing changes.
 *
 * ── Where these cannot be used ──────────────────────────────────────────────
 *
 * Hooks, so: top level of a component or another hook, unconditionally. For a
 * `.filter()` predicate, a callback, or a branch nested inside another
 * expression, hoist `const { onV2 } = usePortalExperience()` to the top of the
 * component and call the pure function with it — that is what its last
 * argument is for. Server Components ask `serverIsV2` / `resolvePortalGates`
 * in `lib/v2-server.ts` instead; `useTenant()` is a client context and answers
 * nothing there.
 */

/**
 * Is this tenant on the lean v2 product?
 *
 * Replaces `isLeanTenant(tenantSlug)` at a call site that has already got the
 * slug from `useTenant()` — the slug argument is no longer the whole answer.
 */
export function useIsLean(): boolean {
  const { lean } = usePortalExperience();
  const { tenantSlug } = useTenant();
  return lean || isLeanTenant(tenantSlug);
}

/** Should `area` be hidden from this tenant? Replaces `isAreaHidden(area, tenantSlug)`. */
export function useIsAreaHidden(area: LeanHiddenArea): boolean {
  return isAreaHiddenForLean(area, useIsLean());
}

/**
 * Should this Settings tab leave the settings NAVIGATION?
 *
 * Replaces `isSettingsTabHidden(tab, tenantSlug)`. Whether the tab's BODY still
 * renders is a separate question — see `settingsTabBoardCard`, and note that
 * `insurance` answers true here while remaining renderable.
 *
 * NO CALL SITE USES THIS TODAY, and that is not an oversight: all three
 * navigation surfaces ask the question from inside a `.filter()` predicate, a
 * `useCallback` or a `useEffect`, so they read `useIsLean()` once at the top and
 * pass it to `isSettingsTabHiddenForLean`. This is here for the first site that
 * can call a hook directly, and it is what the hook test asserts against, so
 * the two spellings cannot drift.
 */
export function useIsSettingsTabHidden(tabValue: string): boolean {
  return isSettingsTabHiddenForLean(tabValue, useIsLean());
}

/**
 * Should test/live mode switches, TEST badges and sandbox-override UI be hidden?
 *
 * Replaces `isTestModeUiHidden(tenantSlug)`. Presentation only: the tenant's
 * `stripe_mode` / `bonzah_mode` columns and the 66 edge functions that branch on
 * them are untouched.
 */
export function useIsTestModeUiHidden(): boolean {
  return useIsLean();
}

/**
 * The BoldSign mode a lean tenant signs in — always `live`.
 *
 * Replaces `resolveBoldSignMode(tenant.boldsign_mode, tenant.slug)` in a Client
 * Component. The route handlers under `app/api/esign/**` are NOT client code and
 * keep calling the pure function; they resolve `onV2` with
 * `readTenantOnV2ById` from `lib/portal-tenant.ts`.
 */
export function useBoldSignMode(tenantMode: string | null | undefined): 'test' | 'live' {
  return resolveBoldSignModeForLean(tenantMode, useIsLean());
}
