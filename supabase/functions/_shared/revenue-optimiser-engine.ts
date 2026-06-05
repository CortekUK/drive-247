/**
 * Revenue Optimiser — core algorithm (Spec §11).
 *
 * Pure deterministic pricing model. GPT is NEVER allowed to pick a price.
 * Used by:
 *   - revenue-optimiser-backtest (Phase 0)  — replays historical bookings
 *   - revenue-optimiser-generate (Phase 2)  — daily recommendation cron
 *
 * Each function is pure and side-effect free.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingObservation {
  price: number;        // price per period at the time of booking
  bookings: number;     // count at this price (1 per row for raw data; aggregated for fit)
  enquiries?: number;   // optional, for conversion-rate fitting
}

export interface VehicleStats {
  bookings_30d: number;
  bookings_90d: number;
  revenue_30d: number;
  revenue_90d: number;
  booked_days_30d: number;
  utilization_30d: number; // 0..100
  idle_days: number | null;
  active_enquiries_14d: number;
  enquiry_conversion_90d: number | null;  // 0..100
  upcoming_booking_days_90d: number;
}

export interface FleetAverages {
  utilization_30d_avg: number;
  bookings_velocity_avg: number; // bookings/day across fleet
}

export interface SafetyRails {
  current_price: number;
  max_swing_percent: number;        // e.g. 15
  cost_floor: number | null;        // per-tier
  weekend_max_increase_percent?: number;
}

export interface ElasticityResult {
  elasticity: number;          // slope b in log(Q)=a+b*log(P); typically negative
  r_squared: number;           // 0..1
  optimalPrice: number;        // argmax P*Q over fitted curve
  fittedCurve: Array<{ price: number; predicted_qty: number }>;
  usedFallback: boolean;       // true if category-level model was used
}

export interface RecommendedPrice {
  price: number;
  range_low: number;
  range_high: number;
  clamped: boolean;            // true if safety rails kicked in
  clampReason?: string;
}

export interface ConfidenceResult {
  score: number;               // 0..100
  label: "low" | "medium" | "high";
}

export interface Reason {
  code: string;                // matches Appendix B taxonomy
  label: string;
  value: string | number;
  weight: number;              // 0..1, used for ranking
}

// ─────────────────────────────────────────────────────────────────────────────
// §11.2 — Price elasticity via log-log regression
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fit log(Q) = a + b·log(P) to observed price/quantity pairs.
 *
 * Returns elasticity ε = b. With ε = -1 a 10% price rise drops bookings 10%.
 * Falls back to a flat estimate (ε = -0.8) if we have too few data points —
 * the consumer should still check `r_squared` and/or `usedFallback` before
 * acting on a low-quality fit.
 */
export function fitElasticity(observations: BookingObservation[]): {
  elasticity: number;
  r_squared: number;
  a: number; // intercept (log space)
  b: number; // slope (log space)
} {
  // Need ≥2 distinct price points to fit a line at all.
  const distinctPrices = new Set(observations.map((o) => o.price));
  if (distinctPrices.size < 2 || observations.length < 4) {
    return { elasticity: -0.8, r_squared: 0, a: 0, b: -0.8 };
  }

  // Aggregate by price to reduce noise from single-booking points
  const byPrice = new Map<number, number>();
  for (const obs of observations) {
    if (obs.price <= 0 || obs.bookings <= 0) continue;
    byPrice.set(obs.price, (byPrice.get(obs.price) ?? 0) + obs.bookings);
  }

  const points = [...byPrice.entries()]
    .map(([p, q]) => [Math.log(p), Math.log(q)] as const)
    .filter(([lp, lq]) => Number.isFinite(lp) && Number.isFinite(lq));

  if (points.length < 2) return { elasticity: -0.8, r_squared: 0, a: 0, b: -0.8 };

  // Ordinary least squares
  const n = points.length;
  const meanX = points.reduce((s, [x]) => s + x, 0) / n;
  const meanY = points.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  }
  if (den === 0) return { elasticity: -0.8, r_squared: 0, a: 0, b: -0.8 };
  const b = num / den;
  const a = meanY - b * meanX;

  // R² (coefficient of determination)
  let ssRes = 0;
  let ssTot = 0;
  for (const [x, y] of points) {
    const yHat = a + b * x;
    ssRes += (y - yHat) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  const r_squared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { elasticity: b, r_squared, a, b };
}

/**
 * Predict Q(P) from a fitted log-log curve.
 * P here is the price; the fit gives log(Q) = a + b·log(P).
 */
function predictQuantity(price: number, a: number, b: number): number {
  if (price <= 0) return 0;
  return Math.exp(a + b * Math.log(price));
}

/**
 * Compute revenue-maximising price over a discrete grid bracketing the current price.
 */
export function findOptimalPrice(
  currentPrice: number,
  fit: { a: number; b: number },
  gridSteps = 21,
  searchSpread = 0.4,
): number {
  if (currentPrice <= 0) return currentPrice;
  const low = currentPrice * (1 - searchSpread);
  const high = currentPrice * (1 + searchSpread);
  const step = (high - low) / (gridSteps - 1);

  let bestPrice = currentPrice;
  let bestRevenue = currentPrice * predictQuantity(currentPrice, fit.a, fit.b);
  for (let i = 0; i < gridSteps; i++) {
    const p = low + step * i;
    if (p <= 0) continue;
    const rev = p * predictQuantity(p, fit.a, fit.b);
    if (rev > bestRevenue) {
      bestRevenue = rev;
      bestPrice = p;
    }
  }
  return bestPrice;
}

export function computeElasticity(
  observations: BookingObservation[],
  currentPrice: number,
): ElasticityResult {
  const fit = fitElasticity(observations);
  const usedFallback = fit.r_squared === 0;
  const optimalPrice = findOptimalPrice(currentPrice, fit);
  const fittedCurve = [
    currentPrice * 0.9,
    currentPrice * 0.95,
    currentPrice,
    currentPrice * 1.05,
    currentPrice * 1.1,
    currentPrice * 1.15,
  ].map((price) => ({ price: Math.round(price), predicted_qty: predictQuantity(price, fit.a, fit.b) }));

  return {
    elasticity: fit.elasticity,
    r_squared: fit.r_squared,
    optimalPrice,
    fittedCurve,
    usedFallback,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §11.3-5 — Demand / Supply / Timing scores (0..100)
// ─────────────────────────────────────────────────────────────────────────────

/** Min-max normalise a value to 0..100, clamped. */
function normalise(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** §11.3 Demand score — recent + forward-looking signals. */
export function computeDemandScore(
  v: VehicleStats,
  fleet: FleetAverages,
): number {
  const enquirySignal = normalise(v.active_enquiries_14d, 0, 10);
  // bookings_velocity_trend ≈ bookings_30d / (fleet avg per 30d)
  const velocity =
    fleet.bookings_velocity_avg > 0
      ? normalise((v.bookings_30d / 30) / fleet.bookings_velocity_avg, 0, 2)
      : 50;
  const utilSignal = normalise(v.utilization_30d, 0, 100);
  const idleInvSignal = v.idle_days == null ? 50 : normalise(7 - v.idle_days, -7, 7);

  return Math.round(
    0.30 * enquirySignal +
    0.25 * velocity +
    0.25 * utilSignal +
    0.20 * idleInvSignal
  );
}

/** §11.4 Supply score — how scarce this vehicle currently is (high = price can rise). */
export function computeSupplyScore(
  v: VehicleStats,
  similarAvailablePct: number, // 0..100
): number {
  const scarcity = normalise(100 - similarAvailablePct, 0, 100);
  const utilSignal = normalise(v.utilization_30d, 0, 100);
  const nextBookingProx = normalise(
    v.upcoming_booking_days_90d > 0 ? 90 - Math.min(90, v.upcoming_booking_days_90d) : 0,
    0, 90,
  );
  return Math.round(0.40 * scarcity + 0.30 * utilSignal + 0.30 * nextBookingProx);
}

/** §11.5 Timing score — weekend / holiday / lead-time bonuses. */
export function computeTimingScore(opts: {
  coversWeekend: boolean;
  coversHoliday: boolean;
  isLastMinute: boolean;
}): number {
  const base = 50;
  return Math.round(
    base +
    (opts.coversWeekend ? 12 : 0) +
    (opts.coversHoliday ? 18 : 0) +
    (opts.isLastMinute ? 10 : 0)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §11.6 — Final recommended price (with safety-rail clamps)
// ─────────────────────────────────────────────────────────────────────────────

export function computeRecommendedPrice(
  elasticity: ElasticityResult,
  demandScore: number,
  supplyScore: number,
  timingScore: number,
  rails: SafetyRails,
): RecommendedPrice {
  const demandMult = (demandScore - 50) / 500;   // ±10%
  const supplyMult = (supplyScore - 50) / 500;   // ±10%
  const timingMult = (timingScore - 50) / 1000;  // ±5%

  const raw = elasticity.optimalPrice * (1 + demandMult + supplyMult + timingMult);
  const swing = rails.max_swing_percent / 100;
  const min = rails.current_price * (1 - swing);
  const max = rails.current_price * (1 + swing);

  let clamped = false;
  let clampReason: string | undefined;
  let price = raw;

  if (price < min) {
    price = min;
    clamped = true;
    clampReason = "max_swing_down";
  } else if (price > max) {
    price = max;
    clamped = true;
    clampReason = "max_swing_up";
  }

  if (rails.cost_floor != null && price < rails.cost_floor) {
    price = rails.cost_floor;
    clamped = true;
    clampReason = "cost_floor";
  }

  return {
    price: Math.round(price),
    range_low: Math.round(price * 0.97),
    range_high: Math.round(price * 1.05),
    clamped,
    clampReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §11.7 — Confidence score (0..100)
// ─────────────────────────────────────────────────────────────────────────────

export function computeConfidenceScore(opts: {
  bookings_90d: number;
  elasticity_r_squared: number;
  conversion_variance: number;   // 0..1, normalised
  vehicle_age_days: number;
}): ConfidenceResult {
  const sampleSize = 40 * Math.min(1, opts.bookings_90d / 30);
  const fit = 30 * opts.elasticity_r_squared;
  const stability = 20 * (1 - opts.conversion_variance);
  const tenure = 10 * (opts.vehicle_age_days > 90 ? 1 : 0);

  const score = Math.round(Math.max(0, Math.min(100, sampleSize + fit + stability + tenure)));
  const label: ConfidenceResult["label"] = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  return { score, label };
}

// ─────────────────────────────────────────────────────────────────────────────
// Appendix B — Reasons taxonomy
// ─────────────────────────────────────────────────────────────────────────────

export function buildReasonsArray(
  v: VehicleStats,
  fleet: FleetAverages,
  similarAvailablePct: number,
  hits: { weekend?: boolean; holiday?: boolean },
): Reason[] {
  const reasons: Reason[] = [];
  const fleetAvgUtil = fleet.utilization_30d_avg;

  if (v.utilization_30d > fleetAvgUtil + 10) {
    reasons.push({ code: "high_utilization", label: `${Math.round(v.utilization_30d)}% booked (last 30d)`, value: v.utilization_30d, weight: 0.35 });
  } else if (v.utilization_30d < fleetAvgUtil - 10) {
    reasons.push({ code: "low_utilization", label: `${Math.round(v.utilization_30d)}% booked vs fleet avg ${Math.round(fleetAvgUtil)}%`, value: v.utilization_30d, weight: 0.25 });
  }
  if ((v.idle_days ?? 0) >= 5) {
    reasons.push({ code: "idle_streak", label: `Idle ${v.idle_days}d`, value: v.idle_days!, weight: 0.20 });
  }
  if (v.active_enquiries_14d >= 3) {
    reasons.push({ code: "active_demand", label: `${v.active_enquiries_14d} active enquiries`, value: v.active_enquiries_14d, weight: 0.30 });
  }
  if (hits.weekend) {
    reasons.push({ code: "weekend_pickup", label: "Period covers weekend", value: 1, weight: 0.15 });
  }
  if (hits.holiday) {
    reasons.push({ code: "holiday_period", label: "Holiday surcharge available", value: 1, weight: 0.20 });
  }
  if (v.enquiry_conversion_90d != null) {
    if (v.enquiry_conversion_90d >= 70) {
      reasons.push({ code: "conversion_strong", label: `${Math.round(v.enquiry_conversion_90d)}% conversion at current price`, value: v.enquiry_conversion_90d, weight: 0.20 });
    } else if (v.enquiry_conversion_90d <= 40) {
      reasons.push({ code: "conversion_weak", label: `Only ${Math.round(v.enquiry_conversion_90d)}% conversion at current price`, value: v.enquiry_conversion_90d, weight: 0.15 });
    }
  }
  if (similarAvailablePct < 25) {
    reasons.push({ code: "competitive_idle", label: "Similar cars all booked", value: similarAvailablePct, weight: 0.15 });
  } else if (similarAvailablePct > 75) {
    reasons.push({ code: "fleet_supply_high", label: "Fleet supply abundant", value: similarAvailablePct, weight: 0.10 });
  }

  return reasons.sort((a, b) => b.weight - a.weight);
}
