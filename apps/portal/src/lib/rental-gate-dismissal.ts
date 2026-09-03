/**
 * Per-visit dismissal of the "Connect Stripe to create rentals" gate.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is NOT an authorisation control and must never be mistaken for one. It
 * decides one thing only: whether a UI dialog can be closed on the canary
 * tenant. Nothing here lets anyone take money. The server still refuses to
 * charge without a connected Stripe account — `create-checkout-session`,
 * `create-preauth-checkout` and every other payment path resolve the Connect
 * account themselves and fail without one. Dismissing this dialog buys access
 * to a FORM, not to a payment rail.
 *
 * WHY IT EXISTS
 * -------------
 * `northwind` is the canary tenant. It will never have a real Stripe Connect
 * account attached, because the whole point of it is exercising the rental flow
 * in Stripe TEST mode. The Connect gate is correct for the ~35 paying tenants
 * and stays hard-blocking for them; the canary needs a way past it.
 *
 * WHY IN-MEMORY, AND NOT storage
 * ------------------------------
 * Scope is "this visit": a module-level Set, so it dies with the JS context.
 * A reload, a new tab, or a fresh sign-in all re-raise the dialog. That is the
 * intended half-life for a permission-SHAPED (though not permission-bearing)
 * bypass — `localStorage` would make it indefinite and invisible, and
 * `sessionStorage` throws outright in some privacy contexts and would need
 * try/catch around every access for no gain.
 *
 * It does survive client-side navigation, which is the point: the operator
 * dismisses on /rentals/new, wanders to /rentals and back, and is not asked
 * again in the same sitting.
 *
 * KEYED ON SLUG, per lib/lean-areas.ts
 * ------------------------------------
 * Never on tenant id — the same tenant has a different primary key in every
 * environment, so an id key silently resolves to the wrong branch on
 * localhost. Keying per tenant also means one browser signed into two tenants
 * cannot leak a dismissal from one to the other.
 */

/** Slugs dismissed during this visit. Module-level: cleared by a reload. */
const dismissedSlugs = new Set<string>();

/** Subscribers, so a dismissal re-renders every mounted gate consumer. */
const listeners = new Set<() => void>();

/**
 * Bumped on every change, and returned as the `useSyncExternalStore` snapshot.
 *
 * The snapshot has to be a stable primitive — returning the Set itself, or a
 * derived boolean computed per call, makes React see a new value on every
 * render and loop. A version counter is stable between notifications.
 */
let version = 0;

export function subscribeRentalGateDismissal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRentalGateDismissalVersion(): number {
  return version;
}

/**
 * Server snapshot for SSR. Always 0: a dismissal is a client-side act during a
 * visit, so the server has, by construction, never seen one.
 */
export function getRentalGateDismissalServerVersion(): number {
  return 0;
}

/**
 * Has this tenant dismissed the gate during this visit?
 *
 * Fails CLOSED on an unresolved slug — an unknown tenant has dismissed nothing,
 * so the gate keeps blocking. Consistent with `isLeanTenant`, which also
 * refuses to treat an unresolved slug as the canary.
 */
export function isRentalGateDismissed(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return dismissedSlugs.has(tenantSlug);
}

/**
 * Record a dismissal for this tenant.
 *
 * A no-op for an unresolved slug: without a slug there is nothing to key on,
 * and writing under a placeholder would let the dismissal apply to whichever
 * tenant resolved next.
 *
 * Callers are responsible for checking the tenant may dismiss at all
 * (`isLeanTenant`) — this module only records the fact.
 */
export function dismissRentalGate(tenantSlug: string | null | undefined): void {
  if (!tenantSlug) return;
  if (dismissedSlugs.has(tenantSlug)) return;
  dismissedSlugs.add(tenantSlug);
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Test-only: drop all dismissals so cases cannot bleed into each other. */
export function __resetRentalGateDismissal(): void {
  dismissedSlugs.clear();
  version += 1;
  listeners.forEach((listener) => listener());
}
