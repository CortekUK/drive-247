/**
 * Is this tenant's Stripe Connect actually usable — i.e. can it take money?
 *
 * WHY THIS EXACT RULE
 * -------------------
 * This is not a new rule. It is the rule the portal's own Connect status UI
 * already applies, lifted into one place so a second, subtly different
 * definition cannot drift away from what the operator is shown:
 *
 *   - components/settings/stripe-connect-settings.tsx → `isConnected`
 *       (`stripe_onboarding_complete && stripe_account_status === 'active'`,
 *        after early-returning to <OwnStripeSettings/> for own-account tenants)
 *   - hooks/use-setup-status.ts   → `stripeComplete`   (identical expression)
 *   - hooks/use-setup-reminder.ts → same shape
 *
 * `stripe_charges_enabled` is deliberately NOT used. It looks like the natural
 * signal — an account can exist and be onboarded yet still be unable to charge —
 * but it has ZERO references anywhere in the portal today, so nothing an
 * operator sees is derived from it. Measured against production the two rules
 * disagree for 11 of 57 tenants, so adopting it would mean this gate and the
 * Connect panel two clicks away told the operator different stories. If that
 * column is ever to become the source of truth it should be adopted by the
 * status UI first, and this predicate follows it.
 *
 * OWN-ACCOUNT TENANTS
 * -------------------
 * Operators on the `own` payment model connect their own Stripe via OAuth; the
 * legacy Express fields (`stripe_account_id`, `stripe_onboarding_complete`) stay
 * empty for them forever. Deriving readiness from those alone would tell an
 * operator who has already connected that Connect is incomplete — so a connected
 * own-account counts, exactly as use-setup-status has it.
 */
import { isLeanTenant } from '@/lib/lean-areas';

export interface StripeConnectTenant {
  stripe_onboarding_complete?: boolean | null;
  stripe_account_status?: string | null;
  own_stripe_account_id?: string | null;
  own_stripe_test_account_id?: string | null;
}

export function isStripeConnectUsable(
  tenant: StripeConnectTenant | null | undefined,
): boolean {
  if (!tenant) return false;
  const ownConnected =
    !!tenant.own_stripe_account_id || !!tenant.own_stripe_test_account_id;
  return (
    ownConnected ||
    (!!tenant.stripe_onboarding_complete && tenant.stripe_account_status === 'active')
  );
}

/** Where the operator goes to finish Connect. Matches use-setup-status's settingsPath. */
export const STRIPE_CONNECT_SETTINGS_PATH = '/settings?tab=payments';

/**
 * May this tenant open the New Rental form?
 *
 * GATED to lean tenants. This must NEVER go global: of the 18 tenants that
 * actually trade, 6 do not satisfy the Connect rule above, and blocking them
 * would stop real bookings on a live platform.
 *
 * Fails OPEN twice over, because a false positive here stops an operator
 * earning:
 *   - a non-lean tenant is never blocked, whatever its Connect state
 *   - a lean tenant whose row has not loaded yet is never blocked. `tenant` is
 *     null on first paint and on any query error; treating "unknown" as "not
 *     connected" would flash the block dialog at an operator who is fully set
 *     up, or strand them entirely if the query fails.
 */
export function isRentalCreationBlocked(
  tenant: StripeConnectTenant | null | undefined,
  tenantSlug: string | null | undefined,
): boolean {
  if (!isLeanTenant(tenantSlug)) return false;
  if (!tenant) return false;
  return !isStripeConnectUsable(tenant);
}
