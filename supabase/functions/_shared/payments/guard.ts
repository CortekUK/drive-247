/**
 * Square integration — the Stripe-path guard.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT IN stripe-client.ts
 *
 * Four separate area plans proposed throwing inside `getConnectAccountId` when
 * the tenant is on Square. Measured: 43 files import getConnectAccountId; only 5
 * import TENANT_STRIPE_COLUMNS. The other 38 hand-roll their tenant select, so
 * `payment_provider` arrives `undefined`, `undefined === 'square'` is false, and
 * the guard is INERT in 38 of 43 importers. Worse, the 5 files where it WOULD
 * have fired are all deposit-hold / saved-card paths — which are out of scope for
 * Square entirely. The guard's whole reachable surface was out of scope.
 *
 * So the guard moved here, is called EXPLICITLY at the point the tenant row
 * resolves, and only in the ~20 functions a Square tenant can actually reach.
 * The other 33 call sites across 26 files get zero diff.
 *
 * FAIL DIRECTION — deliberate and asymmetric:
 *   runtime: fails OPEN on undefined  -> protects Stripe (an un-selected column
 *            can never block a live Stripe payment)
 *   CI:      fails CLOSED on a missing select -> protects Square correctness
 *            (a call site that guards without selecting the column is a build
 *            error, so the runtime open-failure is unreachable in practice)
 *
 * The DB backstop that converts "the other 33 sites are unreachable" from a
 * belief into an enforced fact is payments_provider_handle_exclusivity_check:
 * a Square payment physically cannot carry a stripe_* handle.
 */

import { ProviderId, ProviderResolution } from "./types.ts";

export class WrongProviderError extends Error {
  constructor(readonly provider: ProviderId, readonly context: string) {
    super(
      `${context}: this operation is Stripe-only but tenant is on '${provider}'. ` +
        `This is a routing bug — the caller should have branched before reaching here.`,
    );
    this.name = "WrongProviderError";
  }
}

/**
 * Assert the tenant is on Stripe before running Stripe-only logic.
 *
 * Accepts either a resolution or a raw tenant row so callers can use whichever
 * they already have. `undefined`/absent provider passes — see FAIL DIRECTION.
 */
export function assertStripeTenant(
  tenant: ProviderResolution | Record<string, unknown>,
  context: string,
): void {
  const provider =
    "provider" in tenant
      ? (tenant as ProviderResolution).provider
      : (tenant as Record<string, unknown>).payment_provider;

  // Only 'square' blocks. undefined/null/'stripe'/anything else proceeds.
  if (provider === "square") throw new WrongProviderError("square", context);
}

/** Non-throwing form, for crons that must skip a row rather than abort a batch. */
export function isStripeTenant(
  tenant: ProviderResolution | Record<string, unknown>,
): boolean {
  const provider =
    "provider" in tenant
      ? (tenant as ProviderResolution).provider
      : (tenant as Record<string, unknown>).payment_provider;
  return provider !== "square";
}
