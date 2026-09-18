import { cache } from 'react';
import { isV2, V2_AREA_LIST, type V2Area } from '@/lib/v2';
import { isLeanTenant } from '@/lib/lean-areas';
import { readPortalOnV2 } from '@/lib/portal-tenant';
import { tenantSlugFromHeaders } from '@/lib/tenant-server';

/**
 * Every portal gate for THIS request, resolved once, on the server.
 *
 * The root layout hands the result to `V2Provider`, client components read it
 * back through `useV2` / `useIsLean` / `useIsAreaHidden`, and the handful of
 * v2-only server routes (`/integrations`, `/insights`, `/support`) ask
 * `serverIsV2` here. One slug read from the headers, one tenant row read, one
 * set of answers.
 *
 * ── Why this is not a module-level object ───────────────────────────────────
 *
 * It is a React `cache()` call, which is scoped to the request. A module-level
 * cache — a `let`, a Map keyed by slug, a memoised promise — would be shared by
 * every request the server process handles, and the failure is not a stale
 * answer but a WRONG TENANT's answer: whichever tenant happened to be first
 * would decide whether the next one saw v1 or v2. That is the single worst
 * outcome this gating model exists to prevent, and it would show up as "some
 * tenants randomly get the new UI" rather than as an error. There is a test
 * that resolves two tenants in sequence and asserts the second is unaffected by
 * the first.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 *
 * `tenantSlugFromHeaders()` never throws and answers null on anything it cannot
 * resolve; `readPortalOnV2()` never throws and answers false on a missing row,
 * a read error, an unknown column value or a missing grant. So the worst case
 * here is every flag false and `lean` false — which is v1, the screen every
 * tenant already had.
 */
export type PortalGates = {
  /** From `x-tenant-slug`, set by `proxy.ts`. Null on an unresolvable host. */
  tenantSlug: string | null;
  /** `tenants.portal_experience === 'v2'`. False on anything unknown. */
  onV2: boolean;
  /** One boolean per v2 area, keyed exactly as `V2Area`. */
  flags: Partial<Record<V2Area, boolean>>;
  /** Is this tenant on the lean product — slug list OR the row flag? */
  lean: boolean;
};

export const resolvePortalGates = cache(async (): Promise<PortalGates> => {
  const tenantSlug = await tenantSlugFromHeaders();
  const onV2 = await readPortalOnV2(tenantSlug);

  // The area list comes FROM `lib/v2`, not a second copy kept in step by hand —
  // a forgotten entry here is a gate that answers v1 for everyone, silently.
  const flags = Object.fromEntries(
    V2_AREA_LIST.map((area) => [area, isV2(area, tenantSlug, onV2)])
  ) as Partial<Record<V2Area, boolean>>;

  return {
    tenantSlug,
    onV2,
    flags,
    lean: isLeanTenant(tenantSlug, onV2),
  };
});

/**
 * Is this request's tenant on v2 for `area`?
 *
 * For Server Components that own a whole route and gate it before anything
 * renders — `/integrations`, `/insights`, `/support`. Those three used to call
 * `isV2(area, await tenantSlugFromHeaders())` directly, which skipped the row
 * flag: a self-serve tenant would have been given the v2 Settings navigation
 * (which HIDES the Stripe, Square, Twilio, Bonzah and BoldSign tabs, because
 * `/integrations` replaces them) while `/integrations` itself answered 404 —
 * leaving them no route at all to Stripe onboarding. The tab gate and the route
 * gate have to move together, so both now read from here.
 */
export async function serverIsV2(area: V2Area): Promise<boolean> {
  const { flags } = await resolvePortalGates();
  return flags[area] ?? false;
}
