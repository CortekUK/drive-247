/**
 * Bonzah sell-side gating.
 *
 * Bonzah test mode talks to the sandbox (bonzah.sb.insillion.com) on shared
 * platform credentials, so a policy issued there is NOT real cover — while
 * `stripe_mode` is independent, so the customer can still be charged real money
 * for it. Sandbox policies have already reached real renters, so selling is
 * blocked outright whenever the tenant is in test mode.
 *
 * `bonzah_sandbox_override` is the super-admin escape hatch for internal/demo
 * tenants that need to exercise the sandbox end-to-end.
 *
 * Mirrors:
 *  - server  : supabase/functions/_shared/bonzah-client.ts  → getBonzahSellability()
 *  - booking : apps/booking/src/config/tenant-config.ts     → isBonzahSellable()
 * The server is authoritative; this only decides what staff are allowed to click.
 *
 * SCOPE: gates SELLING a new policy only. Viewing, downloading, refreshing,
 * retrying and cancelling existing policies must keep working in every mode —
 * otherwise customers who already paid lose access to their certificate.
 */
export interface BonzahSellableTenant {
  integration_bonzah?: boolean | null;
  bonzah_mode?: 'test' | 'live' | null;
  bonzah_sandbox_override?: boolean | null;
}

export function isBonzahSellable(tenant: BonzahSellableTenant | null | undefined): boolean {
  if (!tenant) return false;
  if (tenant.integration_bonzah !== true) return false;
  if (tenant.bonzah_mode === 'live') return true;
  return tenant.bonzah_sandbox_override === true;
}

/** Why selling is blocked, for tooltips/banners. `null` when it is allowed. */
export function bonzahBlockedReason(
  tenant: BonzahSellableTenant | null | undefined
): string | null {
  if (isBonzahSellable(tenant)) return null;
  if (!tenant || tenant.integration_bonzah !== true) {
    return 'Bonzah insurance is not enabled for this account. Enable it in Settings → Integrations.';
  }
  return 'Bonzah is in test mode, so any policy issued would be a sandbox policy and not real cover. Complete Bonzah onboarding and switch to live mode to sell insurance.';
}
