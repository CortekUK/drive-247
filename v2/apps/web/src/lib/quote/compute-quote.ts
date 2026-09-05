/**
 * THE MONEY CONTRACT.
 *
 * One pure function that turns a tenant's settings, a vehicle, a pair of dates
 * and the customer's choices into every number the booking sidebar shows and
 * the checkout charges. Nothing else in v2 may add up a booking total.
 *
 * ── Where this came from ────────────────────────────────────────────────────
 * The order and, more importantly, the BASE each component is computed on are
 * ported line-for-line from v1's
 *   apps/booking/src/components/BookingCheckoutStep.tsx  (lines 170–321)
 * which is the implementation that actually bills customers today.
 *
 * v1 contains a SECOND, disagreeing implementation in
 *   apps/booking/src/app/booking/checkout/page.tsx  (lines 243–297)
 * It taxes a different base, ignores `service_fee_type` and hardcodes extras to
 * zero. Do not reconcile this file against that one — it is the wrong copy.
 *
 * ── The order, and why each base is what it is ──────────────────────────────
 *   1. base rental price      calculateRentalPriceBreakdown over the date span
 *   2. promo discount         reduces the VEHICLE total only; never extras,
 *                             delivery, fees or the deposit
 *   3. delivery fees          pickup + return, resolved per leg
 *   4. extras                 per_day extras bill unit price × rental days
 *   5. tax                    on the DISCOUNTED VEHICLE total — not on the
 *                             grand total, and not on extras or delivery
 *   6. service fee            fixed, or a percentage of that same discounted
 *                             vehicle total
 *   7. unlimited mileage      flat upgrade priced by the booking's tier
 *   8. security deposit       inside the total only when the tenant CHARGES
 *                             deposits; otherwise reported as an uncharged hold
 *   9. grand total            the sum of the above
 *
 * Amounts are major units (dollars) and intermediate values are NOT rounded,
 * matching v1 exactly. `grandTotalCents` is the one rounded figure.
 *
 * No React. No Supabase. No `next/*`. Inputs in, numbers out.
 */

import {
  calcExtrasTotal,
  calculateRentalPriceBreakdown,
  extraLineTotal,
  getTierMileage,
  getUnlimitedMileagePrices,
  isUnlimitedMileage,
  resolveDeliveryFee,
} from '@/lib/domain';
import type {
  DayBreakdown,
  DeliveryTierConfig,
  PricingTier,
  TenantWeekendConfig,
} from '@/lib/domain';

import type {
  QuoteDayGroup,
  QuoteDelivery,
  QuoteDeliverySelection,
  QuoteExtraLine,
  QuoteInput,
  QuoteMileage,
  QuoteRentalSummary,
  QuoteResult,
  QuoteTenantConfig,
  QuoteUnlimitedMileage,
  QuoteVehicle,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Normalisers — everything from PostgREST is treated as untrusted
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Postgres `numeric` columns arrive over PostgREST as JSON strings. A bare `+`
 * on one of those concatenates instead of adding, which turns a total into
 * nonsense silently. Every money value crosses this function first.
 */
function num(raw: number | string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `weekend_days` is JSONB, so it can be anything.
 *
 * The fallback `[6, 0]` (Sat/Sun) applies only when the value is NOT an array —
 * i.e. never configured. An explicitly empty array means "this tenant has no
 * weekend days", and must stay empty; defaulting it would invent a surcharge
 * the operator switched off.
 */
function normalizeWeekendDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [6, 0];
  return raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

/**
 * Build the engine's weekend config, or null when no weekend surcharge applies.
 *
 * `stack_surcharges` rides along inside this object rather than being passed as
 * the engine's separate `stackSurcharges` argument, because that is exactly
 * what v1 does. The consequence is real and deliberate: a tenant with stacking
 * on but a zero weekend surcharge gets a null config, and overlapping holidays
 * then resolve by priority rather than stacking. Changing that here would make
 * v2 quote a price v1's portal does not agree with.
 */
function buildWeekendConfig(tenant: QuoteTenantConfig): TenantWeekendConfig | null {
  const percent = num(tenant.weekend_surcharge_percent);
  if (percent <= 0) return null;
  return {
    weekend_surcharge_percent: percent,
    weekend_days: normalizeWeekendDays(tenant.weekend_days),
    stack_surcharges: tenant.stack_surcharges === true,
  };
}

function deliveryTierConfig(tenant: QuoteTenantConfig): DeliveryTierConfig {
  return {
    delivery_tiers_enabled: tenant.delivery_tiers_enabled,
    delivery_distance_tiers: tenant.delivery_distance_tiers,
    area_delivery_fee: tenant.area_delivery_fee,
    delivery_max_distance_km: tenant.delivery_max_distance_km,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Components of the bill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fee for one leg of the journey.
 *
 * An `area` leg with no address chosen yet contributes zero. `resolveDeliveryFee`
 * answers a null distance with the cheapest band so a badge can say "from $50";
 * that is an estimate for display, and putting it in a total would quote the
 * customer for an address they have not picked.
 */
function resolveLeg(
  selection: QuoteDeliverySelection,
  tenant: QuoteTenantConfig,
): QuoteDelivery {
  switch (selection.mode) {
    case 'none':
    case 'fixed':
      // The operator's own address is never a delivery.
      return { fee: 0, blocked: false, tiered: false };
    case 'location':
      return { fee: num(selection.fee), blocked: false, tiered: false };
    case 'area': {
      if (!selection.addressSelected) {
        return { fee: 0, blocked: false, tiered: false };
      }
      const resolved = resolveDeliveryFee(selection.distanceKm, deliveryTierConfig(tenant));
      // A blocked address is not deliverable at any price, so it must not carry
      // a fee into the total — the UI blocks the booking on `deliveryBlocked`.
      return {
        fee: resolved.blocked ? 0 : resolved.fee,
        blocked: resolved.blocked,
        tiered: resolved.tiered,
      };
    }
  }
}

/**
 * Promo discount, applied to the vehicle total ONLY.
 *
 * A fixed-amount code is capped at the vehicle total so a large code can never
 * push the rental negative and start eating the tax or the deposit.
 */
function computePromoDiscount(
  input: Pick<QuoteInput, 'promo' | 'installmentPlanSelected'>,
  vehicleTotal: number,
): { discount: number; blockedReason: 'installment-plan' | null } {
  const { promo } = input;
  if (!promo) return { discount: 0, blockedReason: null };

  // Duration discounts are a fixed-pay-in-full perk. Choosing an installment
  // plan withdraws them; manual codes survive.
  if (promo.source === 'duration' && input.installmentPlanSelected) {
    return { discount: 0, blockedReason: 'installment-plan' };
  }

  const value = num(promo.value);
  if (promo.type === 'fixed_amount') {
    return { discount: Math.min(value, vehicleTotal), blockedReason: null };
  }
  if (promo.type === 'percentage') {
    return { discount: (vehicleTotal * value) / 100, blockedReason: null };
  }
  return { discount: 0, blockedReason: null };
}

/** Tax, on the discounted vehicle total. Never on extras, delivery or fees. */
function computeTax(tenant: QuoteTenantConfig, discountedVehicleTotal: number): {
  amount: number;
  percentage: number;
} {
  const percentage = num(tenant.tax_percentage);
  if (tenant.tax_enabled !== true || percentage <= 0) {
    return { amount: 0, percentage: 0 };
  }
  return { amount: (discountedVehicleTotal * percentage) / 100, percentage };
}

/**
 * Service fee — fixed amount, or a percentage of the discounted vehicle total.
 *
 * `service_fee_value` is the current column; `service_fee_amount` is the legacy
 * one and is consulted only when the new one is null, which is what keeps
 * tenants who never re-saved their settings billing the same fee as before.
 */
function computeServiceFee(tenant: QuoteTenantConfig, discountedVehicleTotal: number): {
  amount: number;
  type: 'fixed_amount' | 'percentage';
  value: number;
} {
  const type: 'fixed_amount' | 'percentage' =
    tenant.service_fee_type === 'percentage' ? 'percentage' : 'fixed_amount';
  const value = num(tenant.service_fee_value ?? tenant.service_fee_amount);

  if (tenant.service_fee_enabled !== true) {
    return { amount: 0, type, value };
  }
  if (type === 'percentage') {
    return { amount: (discountedVehicleTotal * value) / 100, type, value };
  }
  return { amount: value, type, value };
}

/**
 * The deposit figure, whether or not it is billed.
 *
 * Order matters: the master switch wins over everything, and the per-vehicle
 * amount is consulted ONLY on the hold path. Charged deposits are a single
 * global amount by design — per-vehicle charged deposits were dropped
 * deliberately, so that column must not be read on the charged path.
 */
function computeSecurityDeposit(tenant: QuoteTenantConfig, vehicle: QuoteVehicle): number {
  if (tenant.security_deposit_enabled === false) return 0;
  if (tenant.deposit_charge_enabled !== true && tenant.deposit_mode === 'per_vehicle') {
    return num(vehicle.security_deposit);
  }
  return num(tenant.global_deposit_amount);
}

/**
 * The unlimited-mileage upgrade, keyed to the tier the PRICING ENGINE settled on.
 *
 * v1 calls `getUnlimitedMileageOption(vehicle, days, mtd)`, which re-derives the
 * tier from the day count alone. That derivation does not know whether the tier
 * has a rate: a 10-day booking on a vehicle with no `weekly_rent` is BILLED
 * daily by the engine but would be quoted the WEEKLY upgrade price. Composing
 * the primitives here against `pricingTier` keeps the upgrade priced on the same
 * tier the rental itself was priced on.
 */
function computeUnlimitedMileage(
  vehicle: QuoteVehicle,
  tier: PricingTier,
  selected: boolean,
): QuoteUnlimitedMileage {
  // A vehicle with no tier limits at all is already unlimited; charging for the
  // upgrade would be selling something the customer already has.
  if (isUnlimitedMileage(vehicle) || vehicle.unlimited_mileage_available !== true) {
    return { available: false, tier, price: 0, selected, amount: 0 };
  }
  const price = getUnlimitedMileagePrices(vehicle)[tier];
  if (price === null || price <= 0) {
    return { available: false, tier, price: 0, selected, amount: 0 };
  }
  return { available: true, tier, price, selected, amount: selected ? price : 0 };
}

/**
 * Mileage allowance for the booking, pro-rated by day.
 *
 * Same trap as the upgrade above: the tier comes from the engine, not from a
 * second day-count comparison, so a weekly-billed rental can never be quoted a
 * monthly allowance. A null tier allowance means that tier is uncapped.
 */
function computeMileage(
  vehicle: QuoteVehicle,
  tier: PricingTier,
  rentalDays: number,
  monthlyTierDays: number,
  upgradePurchased: boolean,
): QuoteMileage {
  const excessRate = vehicle.excess_mileage_rate ?? null;

  if (upgradePurchased) {
    return { tier, unlimited: true, perUnitAllowance: null, totalAllowance: null, excessRate };
  }

  const perUnit = getTierMileage(vehicle, tier);
  if (perUnit === null) {
    return { tier, unlimited: true, perUnitAllowance: null, totalAllowance: null, excessRate };
  }

  const total =
    tier === 'daily'
      ? Math.round(rentalDays * perUnit)
      : tier === 'weekly'
        ? Math.round((perUnit / 7) * rentalDays)
        : Math.round((perUnit / monthlyTierDays) * rentalDays);

  return { tier, unlimited: false, perUnitAllowance: perUnit, totalAllowance: total, excessRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentation of the rental line
// ─────────────────────────────────────────────────────────────────────────────

function dayGroupLabel(day: DayBreakdown): string {
  // A stacked day carries every surcharge that applied; naming only one of them
  // would understate why the day costs what it costs.
  if (day.appliedSurcharges && day.appliedSurcharges.length > 1) {
    return day.appliedSurcharges.map((s) => s.label).join(' + ');
  }
  if (day.type === 'manual') return 'Custom price';
  if (day.type === 'holiday') return day.holidayName || 'Holiday';
  if (day.type === 'weekend') return 'Weekend';
  return 'Weekday';
}

/**
 * Fold consecutive days sharing a rate AND a type into one line.
 *
 * Both halves of that condition matter: a weekend day and a holiday day can
 * carry the same surcharge percentage and therefore the same rate, but they are
 * different things to the customer and must not merge into one run.
 */
function groupDays(dayBreakdown: DayBreakdown[]): QuoteDayGroup[] {
  const groups: QuoteDayGroup[] = [];
  for (const day of dayBreakdown) {
    const last = groups[groups.length - 1];
    if (last && last.rate === day.effectiveRate && last.type === day.type) {
      last.days += 1;
      last.amount = last.rate * last.days;
      last.endDate = day.date;
      continue;
    }
    groups.push({
      type: day.type,
      label: dayGroupLabel(day),
      rate: day.effectiveRate,
      days: 1,
      amount: day.effectiveRate,
      startDate: day.date,
      endDate: day.date,
    });
  }
  return groups;
}

function buildRentalSummary(
  vehicle: QuoteVehicle,
  tier: PricingTier,
  rentalDays: number,
  monthlyTierDays: number,
  dayBreakdown: DayBreakdown[],
): QuoteRentalSummary {
  const groups = groupDays(dayBreakdown);
  // "Dynamic" means at least one day departs from the plain tier rate. A rental
  // where every day is regular is shown as a single rate × quantity line, even
  // though the engine still produced a per-day breakdown for it.
  const kind: 'dynamic' | 'tier' =
    dayBreakdown.length > 0 && dayBreakdown.some((d) => d.type !== 'regular') ? 'dynamic' : 'tier';

  const unitRate =
    tier === 'monthly'
      ? num(vehicle.monthly_rent)
      : tier === 'weekly'
        ? num(vehicle.weekly_rent)
        : num(vehicle.daily_rent);
  const unitLabel = tier === 'monthly' ? 'month' : tier === 'weekly' ? 'week' : 'day';
  const divisor = tier === 'monthly' ? monthlyTierDays : tier === 'weekly' ? 7 : 1;
  const quantity = divisor > 0 ? rentalDays / divisor : rentalDays;

  return {
    kind,
    tier,
    unitRate,
    unitLabel,
    quantity,
    quantityIsWhole: Number.isInteger(quantity),
    rentalDays,
    groups,
  };
}

function buildExtraLines(
  input: Pick<QuoteInput, 'extras' | 'selectedExtras'>,
  rentalDays: number,
): QuoteExtraLine[] {
  // Iterate the extras array, not the selection map: it arrives in the
  // operator's `sort_order`, so the lines render in the order they were offered.
  const lines: QuoteExtraLine[] = [];
  for (const extra of input.extras) {
    const quantity = Number(input.selectedExtras[extra.id]) || 0;
    if (quantity <= 0) continue;
    const perDay = extra.billing_type === 'per_day';
    lines.push({
      id: extra.id,
      name: extra.name ?? null,
      quantity,
      unitPrice: num(extra.price),
      perDay,
      billedDays: perDay ? Math.max(1, Math.floor(rentalDays) || 1) : 1,
      amount: extraLineTotal(extra.price, quantity, extra.billing_type, rentalDays),
    });
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export const EMPTY_QUOTE: QuoteResult = {
  ready: false,
  currencyCode: null,
  rentalDays: 0,
  pricingTier: 'daily',
  dayBreakdown: [],
  rentalSummary: {
    kind: 'tier',
    tier: 'daily',
    unitRate: 0,
    unitLabel: 'day',
    quantity: 0,
    quantityIsWhole: true,
    rentalDays: 0,
    groups: [],
  },
  hideBreakdown: false,
  vehicleTotal: 0,
  promoDiscount: 0,
  promoBlockedReason: null,
  discountedVehicleTotal: 0,
  pickupDelivery: { fee: 0, blocked: false, tiered: false },
  returnDelivery: { fee: 0, blocked: false, tiered: false },
  deliveryFees: 0,
  deliveryBlocked: false,
  extraLines: [],
  extrasTotal: 0,
  taxAmount: 0,
  taxPercentage: 0,
  serviceFee: 0,
  serviceFeeType: 'fixed_amount',
  serviceFeeValue: 0,
  unlimitedMileage: { available: false, tier: 'daily', price: 0, selected: false, amount: 0 },
  insurancePremium: 0,
  securityDeposit: 0,
  depositIsCharged: false,
  chargedSecurityDeposit: 0,
  depositHeldAmount: 0,
  grandTotal: 0,
  grandTotalCents: 0,
  payableNow: 0,
  mileage: {
    tier: 'daily',
    unlimited: false,
    perUnitAllowance: null,
    totalAllowance: null,
    excessRate: null,
  },
};

/** Every field of `QuoteInput` except the four that have no sensible default. */
export const QUOTE_INPUT_DEFAULTS = {
  extras: [],
  selectedExtras: {},
  promo: null,
  installmentPlanSelected: false,
  pickupDelivery: { mode: 'none' },
  returnDelivery: { mode: 'none' },
  addUnlimitedMileage: false,
  insurancePremium: 0,
  collectPaymentUpfront: true,
  holidays: [],
  vehicleOverrides: [],
  dailyPrices: [],
} as const satisfies Omit<QuoteInput, 'tenant' | 'vehicle' | 'pickupDate' | 'dropoffDate'>;

/**
 * Price a booking.
 *
 * Returns `EMPTY_QUOTE` (with `ready: false`) whenever the inputs cannot
 * produce a real price. That is a distinct state from "the price is zero", and
 * callers must branch on `ready` rather than inspecting `grandTotal`.
 */
export function computeQuote(input: QuoteInput): QuoteResult {
  const { tenant, vehicle, pickupDate, dropoffDate } = input;
  if (!tenant || !vehicle || !pickupDate || !dropoffDate) return EMPTY_QUOTE;

  const monthlyTierDays = tenant.monthly_tier_days > 0 ? tenant.monthly_tier_days : 30;

  // ── 1. Base rental price ──────────────────────────────────────────────────
  // The engine owns date parsing (parseDateString, calendar-day span over UTC
  // midnights) and tier selection. Its `rentalDays` is THE day count for this
  // quote — extras, mileage and the tier label all derive from it rather than
  // running a second, subtly different subtraction.
  const priced = calculateRentalPriceBreakdown(
    pickupDate,
    dropoffDate,
    {
      daily_rent: num(vehicle.daily_rent),
      weekly_rent: num(vehicle.weekly_rent),
      monthly_rent: num(vehicle.monthly_rent),
    },
    buildWeekendConfig(tenant),
    input.holidays,
    input.vehicleOverrides,
    vehicle.id,
    monthlyTierDays,
    false, // skipSurcharges — customer-facing quotes always honour surcharges
    false, // stackSurcharges — resolved from the weekend config, as v1 does
    input.dailyPrices,
  );

  const rentalDays = priced.rentalDays;
  const pricingTier = priced.pricingTier;
  const vehicleTotal = priced.rentalPrice;

  // ── 2. Promo (vehicle total only) ─────────────────────────────────────────
  const { discount: promoDiscount, blockedReason: promoBlockedReason } = computePromoDiscount(
    input,
    vehicleTotal,
  );
  const discountedVehicleTotal = vehicleTotal - promoDiscount;

  // ── 3. Delivery ───────────────────────────────────────────────────────────
  const pickupDelivery = resolveLeg(input.pickupDelivery, tenant);
  const returnDelivery = resolveLeg(input.returnDelivery, tenant);
  const deliveryFees = pickupDelivery.fee + returnDelivery.fee;

  // ── 4. Extras ─────────────────────────────────────────────────────────────
  const extraLines = buildExtraLines(input, rentalDays);
  const extrasTotal = calcExtrasTotal(input.selectedExtras, input.extras, rentalDays);

  // ── 5. Tax (discounted vehicle total) ─────────────────────────────────────
  const tax = computeTax(tenant, discountedVehicleTotal);

  // ── 6. Service fee (fixed, or % of the discounted vehicle total) ──────────
  const service = computeServiceFee(tenant, discountedVehicleTotal);

  // ── 7. Unlimited-mileage upgrade ──────────────────────────────────────────
  const unlimitedMileage = computeUnlimitedMileage(vehicle, pricingTier, input.addUnlimitedMileage);

  // ── 8. Security deposit ───────────────────────────────────────────────────
  const securityDeposit = computeSecurityDeposit(tenant, vehicle);
  const depositIsCharged = tenant.deposit_charge_enabled === true;
  const chargedSecurityDeposit = depositIsCharged ? securityDeposit : 0;
  const depositHeldAmount = depositIsCharged ? 0 : securityDeposit;

  const insurancePremium = num(input.insurancePremium);

  // ── 9. Grand total ────────────────────────────────────────────────────────
  const grandTotal =
    discountedVehicleTotal +
    deliveryFees +
    extrasTotal +
    tax.amount +
    service.amount +
    insurancePremium +
    unlimitedMileage.amount +
    chargedSecurityDeposit;

  return {
    ready: true,
    currencyCode: tenant.currency_code,

    rentalDays,
    pricingTier,
    dayBreakdown: priced.dayBreakdown,
    rentalSummary: buildRentalSummary(
      vehicle,
      pricingTier,
      rentalDays,
      monthlyTierDays,
      priced.dayBreakdown,
    ),
    hideBreakdown: tenant.hide_checkout_price_breakdown === true,

    vehicleTotal,
    promoDiscount,
    promoBlockedReason,
    discountedVehicleTotal,

    pickupDelivery,
    returnDelivery,
    deliveryFees,
    deliveryBlocked: pickupDelivery.blocked || returnDelivery.blocked,

    extraLines,
    extrasTotal,

    taxAmount: tax.amount,
    taxPercentage: tax.percentage,

    serviceFee: service.amount,
    serviceFeeType: service.type,
    serviceFeeValue: service.value,

    unlimitedMileage,
    insurancePremium,

    securityDeposit,
    depositIsCharged,
    chargedSecurityDeposit,
    depositHeldAmount,

    grandTotal,
    grandTotalCents: Math.round(grandTotal * 100),
    payableNow: input.collectPaymentUpfront ? grandTotal : 0,

    mileage: computeMileage(
      vehicle,
      pricingTier,
      rentalDays,
      monthlyTierDays,
      unlimitedMileage.amount > 0,
    ),
  };
}
