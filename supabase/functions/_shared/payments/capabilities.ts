/**
 * Square integration — the capability manifest.
 *
 * BINDING RULE: every behavioural difference between processors lives HERE.
 * Zero hand-written provider gates anywhere else. A feature is switched off
 * because a CAPABILITY is false, never because `providerId === 'square'`.
 *
 * The distinction is not stylistic. Gating on the provider name spreads
 * knowledge of Square across ~30 files and makes provider #3 a re-audit of all
 * of them. Gating on a capability means provider #3 fills in this table and
 * every existing gate is already correct.
 *
 * Numbers here are measured from Square's published limits, not estimated.
 * Where Stripe has no documented ceiling that matters at our volumes, the value
 * is the practical limit we rely on.
 */

import { ProviderId } from "./types.ts";

export interface ProviderCapabilities {
  // ---- credential storage: THE axis that decides Square's v1 feature set ----
  /**
   * Can a card be stored during a hosted checkout and charged later with nobody
   * present? Square's hosted Payment Links CANNOT. This single flag — not the
   * feature names — is what switches off installments, auto-extend auto_charge,
   * charge-saved-card and deposit holds.
   *
   * NOTE the deliberate scope: renter-present flows (PAYG collection,
   * auto-extend pay_link mode) mint a fresh checkout session and email a link.
   * They do NOT depend on a stored credential and MUST stay ON for Square.
   */
  supportsStoredCredential: boolean;
  /** Charge an already-stored credential unattended (cron, webhook, reminder). */
  canChargeOffSession: boolean;

  // ---- checkout ----
  supportsHostedCheckout: boolean;
  /** Stripe Checkout Sessions expire; Square payment links have no documented TTL. */
  supportsPaymentLinkExpiry: boolean;
  /** Stripe has cancel_url; Square has only redirect_url (success path only). */
  supportsCancelUrl: boolean;
  /** Square requires a location_id on quick_pay; Stripe has no analogue. */
  requiresLocationId: boolean;

  // ---- capture ----
  supportsManualCapture: boolean;
  /** Capture LESS than authorised. Square's CompletePayment takes no amount. */
  supportsPartialCapture: boolean;
  /** Authorization holds (preauth). Out of scope for Square by product decision. */
  supportsAuthorizationHold: boolean;

  // ---- refunds ----
  supportsPartialRefund: boolean;
  maxPartialRefundsPerPayment: number;
  refundWindowDays: number;
  supportsUnlinkedRefund: boolean;
  /** Square refunds land PENDING and settle asynchronously; Stripe's are immediate. */
  refundsSettleAsynchronously: boolean;

  // ---- correlation limits (these drive metadata compaction) ----
  maxMetadataKeys: number;
  maxMetadataValueChars: number;
  maxReferenceIdChars: number;
  maxIdempotencyKeyChars: number;

  // ---- webhooks ----
  /** Square signs notification_url + body; Stripe signs body + timestamp. */
  webhookSignsNotificationUrl: boolean;
  /** Stripe tolerates 300s replay window; Square has no timestamp at all. */
  webhookHasReplayWindow: boolean;
  /** Milliseconds we may spend before acking. Square 10s, Stripe ~30s. */
  webhookAckBudgetMs: number;
  /** Can a missed event be re-delivered on demand? Square: no manual resend. */
  supportsEventReplay: boolean;

  // ---- platform / account model ----
  /** Stripe: application_fee_amount. Square: app_fee_money. We use NEITHER. */
  supportsApplicationFee: boolean;
  /** Days until the per-merchant OAuth access token expires. Stripe: never. */
  tokenExpiresDays: number | null;
  /** Countries where the processor can actually take a payment. */
  supportedCountries: readonly string[] | null;
}

/**
 * Stripe. Values reflect what we actually rely on, not Stripe's theoretical max.
 * `supportedCountries: null` means "not a constraint we gate on".
 */
export const STRIPE_CAPABILITIES: ProviderCapabilities = Object.freeze({
  supportsStoredCredential: true,
  canChargeOffSession: true,

  supportsHostedCheckout: true,
  supportsPaymentLinkExpiry: true,
  supportsCancelUrl: true,
  requiresLocationId: false,

  supportsManualCapture: true,
  supportsPartialCapture: true,
  supportsAuthorizationHold: true,

  supportsPartialRefund: true,
  maxPartialRefundsPerPayment: Number.MAX_SAFE_INTEGER,
  refundWindowDays: Number.MAX_SAFE_INTEGER,
  supportsUnlinkedRefund: false,
  refundsSettleAsynchronously: false,

  maxMetadataKeys: 50,
  maxMetadataValueChars: 500,
  maxReferenceIdChars: 200,
  maxIdempotencyKeyChars: 255,

  webhookSignsNotificationUrl: false,
  webhookHasReplayWindow: true,
  webhookAckBudgetMs: 30_000,
  supportsEventReplay: true,

  supportsApplicationFee: true,
  tokenExpiresDays: null,
  supportedCountries: null,
});

/**
 * Square. Every number here is from Square's published API reference.
 *
 * supportsStoredCredential=false is the load-bearing entry: it is what makes a
 * Square tenant a link-shaped-money tenant, and it does so without any file
 * outside this module knowing the word "Square".
 */
export const SQUARE_CAPABILITIES: ProviderCapabilities = Object.freeze({
  supportsStoredCredential: false,
  canChargeOffSession: false,

  supportsHostedCheckout: true,
  supportsPaymentLinkExpiry: false,
  supportsCancelUrl: false,
  requiresLocationId: true,

  supportsManualCapture: true,     // autocomplete:false — Payments API only, NOT payment links
  supportsPartialCapture: false,   // CompletePayment takes no amount parameter
  supportsAuthorizationHold: false,// out of scope by product decision

  supportsPartialRefund: true,
  maxPartialRefundsPerPayment: 20,
  refundWindowDays: 365,
  supportsUnlinkedRefund: true,
  refundsSettleAsynchronously: true,

  maxMetadataKeys: 10,
  maxMetadataValueChars: 255,
  maxReferenceIdChars: 40,
  maxIdempotencyKeyChars: 45,

  webhookSignsNotificationUrl: true,
  webhookHasReplayWindow: false,
  webhookAckBudgetMs: 10_000,
  supportsEventReplay: false,

  supportsApplicationFee: false,   // we never send app_fee_money — see square-oauth.ts scope list
  tokenExpiresDays: 30,
  supportedCountries: Object.freeze(["AU", "CA", "FR", "IE", "JP", "ES", "GB", "US"]),
});

const TABLE: Record<ProviderId, ProviderCapabilities> = {
  stripe: STRIPE_CAPABILITIES,
  square: SQUARE_CAPABILITIES,
};

export function capabilitiesFor(provider: ProviderId): ProviderCapabilities {
  return TABLE[provider] ?? STRIPE_CAPABILITIES;
}

/** True when the processor can take a payment for a tenant in this country. */
export function isCountrySupported(provider: ProviderId, country: string | null): boolean {
  const list = capabilitiesFor(provider).supportedCountries;
  if (!list) return true;            // no country constraint for this processor
  if (!country) return false;        // constrained processor + unknown country = refuse
  return list.includes(country.toUpperCase());
}
