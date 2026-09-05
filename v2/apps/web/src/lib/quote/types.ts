/**
 * The shape of a booking quote.
 *
 * These types are deliberately STRUCTURAL rather than imports of the generated
 * Supabase row types. Two reasons:
 *
 *  1. `compute-quote.ts` must stay pure — no React, no Supabase, no `next/*` —
 *     so the same maths can run in a test, in an edge function, or on the
 *     server when Stripe Elements lands in a later phase.
 *  2. A structural interface still type-checks a real `Tenant` / vehicle row
 *     passed straight in from the app, because every field below is a widening
 *     of what the generated types declare (`Json` widens to `unknown`,
 *     `boolean` widens to `boolean | null`, and so on). So callers pass the row
 *     they already have and get compile-time column checking for free.
 *
 * Money convention: every number here is a MAJOR-unit amount (dollars, not
 * cents) held as a float, exactly as v1 does. Intermediate values are NOT
 * rounded — rounding early is how a quote and a charge drift apart. The single
 * integer-cents value, `grandTotalCents`, is produced once at the end and is
 * what a payment intent should be built from.
 */

import type {
  DayBreakdown,
  Holiday,
  PricedExtra,
  PricingTier,
  VehicleDailyPrice,
  VehicleOverride,
} from '@/lib/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tenant settings that decide money.
 *
 * A real `Tenant` from `@/contexts/TenantContext` satisfies this structurally,
 * so the hook passes it through untouched. Loose types (`unknown`, `string | null`)
 * mirror the database honestly — `weekend_days` really is arbitrary JSONB and
 * `service_fee_type` really is an unconstrained text column — and every one of
 * them is normalised inside `compute-quote.ts` rather than trusted.
 */
export interface QuoteTenantConfig {
  currency_code: string | null;

  // Tiering
  monthly_tier_days: number;

  // Dynamic pricing
  weekend_surcharge_percent: number | null;
  /** JSONB: array of JS day numbers (0 = Sunday … 6 = Saturday). */
  weekend_days: unknown;
  stack_surcharges: boolean;

  // Tax
  tax_enabled: boolean | null;
  tax_percentage: number | null;

  // Service fee
  service_fee_enabled: boolean | null;
  /** 'fixed_amount' (default) or 'percentage'. */
  service_fee_type: string | null;
  service_fee_value: number | null;
  /** Legacy column; only consulted when `service_fee_value` is null. */
  service_fee_amount: number | null;

  // Security deposit
  security_deposit_enabled: boolean | null;
  /** 'global' (default) or 'per_vehicle'. */
  deposit_mode: string | null;
  /** true = the deposit is really billed now; false = ring-fenced as a hold. */
  deposit_charge_enabled: boolean;
  global_deposit_amount: number | null;

  // Delivery
  delivery_tiers_enabled: boolean | null;
  /** JSONB: array of `{ up_to_km, fee }` bands. */
  delivery_distance_tiers: unknown;
  area_delivery_fee: number | null;
  delivery_max_distance_km: number | null;

  // Presentation
  hide_checkout_price_breakdown: boolean;
}

/**
 * The vehicle fields that decide money.
 *
 * Every one of these is on `vehiclePublicColumns()`, so a customer-facing query
 * built through the allowlist produces a row that satisfies this directly. VIN,
 * lockbox and purchase-price columns are absent here because they are absent
 * there — see the note at the top of `@/lib/domain/vehicle-identity`.
 */
export interface QuoteVehicle {
  id: string;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  security_deposit: number | null;
  daily_mileage: number | null;
  weekly_mileage: number | null;
  monthly_mileage: number | null;
  excess_mileage_rate: number | null;
  unlimited_mileage_available: boolean;
  unlimited_mileage_price_daily: number | string | null;
  unlimited_mileage_price_weekly: number | string | null;
  unlimited_mileage_price_monthly: number | string | null;
}

/** A rental extra, plus the name needed to render its line. */
export interface QuoteExtra extends PricedExtra {
  name?: string | null;
  max_quantity?: number | null;
}

export interface QuotePromo {
  id: string;
  code: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  /**
   * 'duration' codes are auto-applied by rental length and are a
   * fixed-pay-in-full perk only — selecting an installment plan withdraws them.
   * 'manual' codes survive an installment plan.
   */
  source?: 'manual' | 'duration';
  minDurationDays?: number;
}

/**
 * How one leg (pickup or return) is being collected/delivered.
 *
 * The three arms mirror the three location modes a tenant can enable:
 *   fixed    — the operator's own address; never carries a fee.
 *   location — one of the tenant's `pickup_locations`; that row's `delivery_fee`.
 *   area     — delivery to the customer's address; priced by distance bands
 *              through `resolveDeliveryFee`.
 *
 * `addressSelected` exists because an unresolved area address must contribute
 * ZERO, not the "from $X" cheapest-band estimate `resolveDeliveryFee` returns
 * for a null distance. That estimate is for badges; putting it in a total would
 * quote a delivery fee for an address the customer has not chosen yet.
 */
export type QuoteDeliverySelection =
  | { mode: 'none' }
  | { mode: 'fixed' }
  | { mode: 'location'; fee: number | null }
  | { mode: 'area'; addressSelected: boolean; distanceKm: number | null };

export interface QuoteInput {
  tenant: QuoteTenantConfig | null;
  vehicle: QuoteVehicle | null;
  /** YYYY-MM-DD. Parsed with `parseDateString`, never `new Date(str)`. */
  pickupDate: string | null;
  /** YYYY-MM-DD. */
  dropoffDate: string | null;

  extras: QuoteExtra[];
  /** extraId -> quantity. */
  selectedExtras: Record<string, number>;

  promo: QuotePromo | null;
  /** Withdraws a `source: 'duration'` promo — see `QuotePromo`. */
  installmentPlanSelected: boolean;

  pickupDelivery: QuoteDeliverySelection;
  returnDelivery: QuoteDeliverySelection;

  addUnlimitedMileage: boolean;
  /** Third-party cover already quoted for this booking (0 when none/failed). */
  insurancePremium: number;
  /**
   * False for enquiry-style tenants, who collect nothing up front. Only affects
   * `payableNow`; `grandTotal` still states what the booking is worth.
   */
  collectPaymentUpfront: boolean;

  // Dynamic-pricing inputs. Empty arrays are the correct, complete answer for a
  // tenant with no holidays configured — they are not a "not loaded" signal.
  holidays: Holiday[];
  vehicleOverrides: VehicleOverride[];
  dailyPrices: VehicleDailyPrice[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Outputs
// ─────────────────────────────────────────────────────────────────────────────

/** Consecutive days at the same rate and of the same type, folded into one line. */
export interface QuoteDayGroup {
  type: DayBreakdown['type'];
  /** "Weekday", "Weekend", the holiday's name, "Custom price", or "A + B" when stacked. */
  label: string;
  /** Effective per-day rate for this run. */
  rate: number;
  /** Number of consecutive days in this run. */
  days: number;
  /** `rate * days`. */
  amount: number;
  /** First and last calendar day of the run (YYYY-MM-DD), for a date-range label. */
  startDate: string;
  endDate: string;
}

/**
 * How the rental line should be presented.
 *
 * 'dynamic' — at least one day is not a regular day, so the customer is shown
 *             the per-run breakdown (`groups`) with amounts.
 * 'tier'    — a flat rental, shown as a single "rate × quantity" line. v1 shows
 *             that line WITHOUT an amount (the rental total is stated on its
 *             own row), which is why `amount` is null here.
 */
export interface QuoteRentalSummary {
  kind: 'dynamic' | 'tier';
  tier: PricingTier;
  /** Advertised rate for the tier: daily_rent, weekly_rent or monthly_rent. */
  unitRate: number;
  unitLabel: 'day' | 'week' | 'month';
  /** Days, weeks or months — fractional when the rental is not a whole number of units. */
  quantity: number;
  /** False when `quantity` is fractional; v1 then labels the line in days instead. */
  quantityIsWhole: boolean;
  rentalDays: number;
  /** Populated for both kinds; only rendered as line items when kind === 'dynamic'. */
  groups: QuoteDayGroup[];
}

export interface QuoteExtraLine {
  id: string;
  name: string | null;
  quantity: number;
  unitPrice: number;
  /** True when `billing_type === 'per_day'`, i.e. the unit price is billed per day. */
  perDay: boolean;
  /** Days actually billed: `rentalDays` for per-day extras, 1 otherwise. */
  billedDays: number;
  amount: number;
}

/** The mileage the customer actually gets on this booking. */
export interface QuoteMileage {
  /** The tier the PRICING engine settled on — not a second, independent guess. */
  tier: PricingTier;
  /** True when no cap applies: an inherently unlimited vehicle, an unset tier allowance, or a purchased upgrade. */
  unlimited: boolean;
  /** Allowance per tier unit (per day / per week / per month). Null when unlimited. */
  perUnitAllowance: number | null;
  /** Pro-rata allowance for the whole rental, rounded to a whole unit. Null when unlimited. */
  totalAllowance: number | null;
  /** Charged per excess unit of distance beyond `totalAllowance`. */
  excessRate: number | null;
}

export interface QuoteUnlimitedMileage {
  /** Should the opt-in be offered at all? */
  available: boolean;
  tier: PricingTier;
  /** Flat price of the upgrade for this tier (0 when unavailable). */
  price: number;
  /** Did the customer take it? */
  selected: boolean;
  /** What actually goes on the bill: `price` when selected AND available, else 0. */
  amount: number;
}

export interface QuoteDelivery {
  fee: number;
  /** True when the chosen address is beyond the operator's hard delivery cap. */
  blocked: boolean;
  /** True when a distance band, rather than the flat fee, produced this number. */
  tiered: boolean;
}

export interface QuoteResult {
  /**
   * False when the quote could not be computed (no tenant, no vehicle, or no
   * dates yet). Every amount is then 0 — a zeroed quote is never a real price,
   * so the UI must gate its bill on this rather than on `grandTotal > 0`.
   */
  ready: boolean;
  currencyCode: string | null;

  // ── Duration & rental base ────────────────────────────────────────────────
  rentalDays: number;
  pricingTier: PricingTier;
  dayBreakdown: DayBreakdown[];
  rentalSummary: QuoteRentalSummary;
  /** Tenant asked for the per-day breakdown to be withheld at checkout. */
  hideBreakdown: boolean;

  // ── 1. Vehicle total, and 2. the promo that reduces it ────────────────────
  vehicleTotal: number;
  promoDiscount: number;
  /** Set when a promo exists but contributed nothing, so the UI can explain why. */
  promoBlockedReason: 'installment-plan' | null;
  /** `vehicleTotal - promoDiscount`. The base for tax and % service fee. */
  discountedVehicleTotal: number;

  // ── 3. Delivery ───────────────────────────────────────────────────────────
  pickupDelivery: QuoteDelivery;
  returnDelivery: QuoteDelivery;
  deliveryFees: number;
  /** Either leg is beyond the delivery cap — the booking must not proceed. */
  deliveryBlocked: boolean;

  // ── 4. Extras ─────────────────────────────────────────────────────────────
  extraLines: QuoteExtraLine[];
  extrasTotal: number;

  // ── 5. Tax ────────────────────────────────────────────────────────────────
  taxAmount: number;
  taxPercentage: number;

  // ── 6. Service fee ────────────────────────────────────────────────────────
  serviceFee: number;
  serviceFeeType: 'fixed_amount' | 'percentage';
  serviceFeeValue: number;

  // ── 7. Unlimited-mileage upgrade ──────────────────────────────────────────
  unlimitedMileage: QuoteUnlimitedMileage;

  // ── Insurance (priced elsewhere, added untaxed and undiscounted) ──────────
  insurancePremium: number;

  // ── 8. Security deposit ───────────────────────────────────────────────────
  /** The deposit figure itself, however it is collected. */
  securityDeposit: number;
  depositIsCharged: boolean;
  /** In the grand total only when `depositIsCharged`. */
  chargedSecurityDeposit: number;
  /** Ring-fenced on the card instead of billed; report it, never add it. */
  depositHeldAmount: number;

  // ── 9. Totals ─────────────────────────────────────────────────────────────
  grandTotal: number;
  /** `grandTotal` in integer minor units. Build the payment intent from THIS. */
  grandTotalCents: number;
  /** What is collected now: `grandTotal`, or 0 for an enquiry-style tenant. */
  payableNow: number;

  // ── Mileage allowance shown beside the price ──────────────────────────────
  mileage: QuoteMileage;
}
