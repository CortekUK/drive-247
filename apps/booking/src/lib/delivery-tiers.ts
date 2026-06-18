/**
 * Tiered delivery pricing — shared resolver.
 *
 * "Area" delivery measures the haversine distance from the operator's center
 * point (area_center_lat/lon) to the customer's geocoded address. With tiers
 * disabled, a single flat `area_delivery_fee` applies (unchanged behaviour).
 * With tiers enabled, the fee is picked from distance bands.
 *
 * Bands are stored canonically in KILOMETRES (matching pickup_area_radius_km):
 *   [ { up_to_km: 32.19, fee: 50 },
 *     { up_to_km: 64.37, fee: 75 },
 *     { up_to_km: null,  fee: 90 } ]   // up_to_km = null => open-ended top band
 *
 * `delivery_max_distance_km` is an optional HARD CAP: addresses beyond it are
 * not deliverable at all (resolves `blocked: true`), regardless of bands. This
 * is what gives the open-ended "Anywhere further" band a ceiling.
 *
 * Keep this file dependency-free so booking + portal can each keep their own copy.
 */

export interface DeliveryTier {
  /** Inclusive upper bound in km. `null` = open-ended catch-all (matches any distance). */
  up_to_km: number | null;
  /** Fee charged when this band matches. */
  fee: number;
}

export interface DeliveryTierConfig {
  delivery_tiers_enabled?: boolean | null;
  /** JSONB column — may arrive as a parsed array, or null. */
  delivery_distance_tiers?: unknown;
  /** Flat fallback fee used when tiers are off. */
  area_delivery_fee?: number | null;
  /** Optional hard cap (km). Distances beyond this are not deliverable. NULL = no limit. */
  delivery_max_distance_km?: number | null;
}

export interface ResolvedDeliveryFee {
  fee: number;
  /** True when the address is beyond all bands and there is no open-ended band. */
  outOfRange: boolean;
  /** True when the address is beyond the configured hard cap — delivery not offered. */
  blocked: boolean;
  /** True when a tiered band (not the flat fee) produced this result. */
  tiered: boolean;
  /** The matched band, when tiered. */
  matchedTier?: DeliveryTier;
}

/** Coerce the JSONB value into a clean, validated tier array. */
export function normalizeTiers(raw: unknown): DeliveryTier[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((t): DeliveryTier | null => {
      if (!t || typeof t !== 'object') return null;
      const obj = t as Record<string, unknown>;
      const fee = Number(obj.fee);
      if (!Number.isFinite(fee) || fee < 0) return null;
      const rawBound = obj.up_to_km;
      const up_to_km =
        rawBound === null || rawBound === undefined || rawBound === ''
          ? null
          : Number(rawBound);
      if (up_to_km !== null && (!Number.isFinite(up_to_km) || up_to_km <= 0)) return null;
      return { up_to_km, fee };
    })
    .filter((t): t is DeliveryTier => t !== null);
}

/** Sort bounded bands ascending; the open-ended (null) band always sits last. */
function sortTiers(tiers: DeliveryTier[]): DeliveryTier[] {
  return [...tiers].sort((a, b) => {
    const av = a.up_to_km ?? Number.POSITIVE_INFINITY;
    const bv = b.up_to_km ?? Number.POSITIVE_INFINITY;
    return av - bv;
  });
}

/** True when tiered pricing is active and at least one valid band exists. */
export function hasActiveTiers(cfg: DeliveryTierConfig): boolean {
  return !!cfg.delivery_tiers_enabled && normalizeTiers(cfg.delivery_distance_tiers).length > 0;
}

/** Normalised hard-cap distance in km, or null when no valid cap is set. */
export function getMaxDistanceKm(cfg: DeliveryTierConfig): number | null {
  const max = cfg.delivery_max_distance_km;
  if (max === null || max === undefined) return null;
  const n = Number(max);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve the delivery fee for a given distance (km).
 * - distance beyond the hard cap → `blocked: true` (not deliverable).
 * - tiers off / none configured → flat `area_delivery_fee`.
 * - distance unknown (null/undefined) → cheapest band as a "from" estimate.
 * - tiers on → first band where distance <= up_to_km, else the open-ended band,
 *   else (beyond all bounded bands, no open band) the top fee flagged outOfRange.
 */
export function resolveDeliveryFee(
  distanceKm: number | null | undefined,
  cfg: DeliveryTierConfig
): ResolvedDeliveryFee {
  const tiers = sortTiers(normalizeTiers(cfg.delivery_distance_tiers));
  const tieredActive = !!cfg.delivery_tiers_enabled && tiers.length > 0;
  const knownDistance =
    distanceKm !== null && distanceKm !== undefined && Number.isFinite(distanceKm);

  // Hard cap takes precedence over everything once we know the distance.
  const maxKm = getMaxDistanceKm(cfg);
  if (maxKm !== null && knownDistance && (distanceKm as number) > maxKm) {
    return { fee: 0, outOfRange: true, blocked: true, tiered: tieredActive };
  }

  if (!tieredActive) {
    return { fee: cfg.area_delivery_fee ?? 0, outOfRange: false, blocked: false, tiered: false };
  }

  if (!knownDistance) {
    // No address picked yet — surface the lowest band so the UI can show "from $X".
    const cheapest = tiers.reduce((min, t) => (t.fee < min.fee ? t : min), tiers[0]);
    return { fee: cheapest.fee, outOfRange: false, blocked: false, tiered: true, matchedTier: cheapest };
  }

  for (const tier of tiers) {
    if (tier.up_to_km === null) {
      return { fee: tier.fee, outOfRange: false, blocked: false, tiered: true, matchedTier: tier };
    }
    if ((distanceKm as number) <= tier.up_to_km) {
      return { fee: tier.fee, outOfRange: false, blocked: false, tiered: true, matchedTier: tier };
    }
  }

  // Beyond every bounded band and no open-ended band configured: not deliverable.
  const top = tiers[tiers.length - 1];
  return { fee: top.fee, outOfRange: true, blocked: true, tiered: true, matchedTier: top };
}

/** Min/max fee across configured bands — for "from $X" badges before an address is chosen. */
export function getTierFeeRange(cfg: DeliveryTierConfig): { min: number; max: number } | null {
  const tiers = normalizeTiers(cfg.delivery_distance_tiers);
  if (!cfg.delivery_tiers_enabled || tiers.length === 0) return null;
  const fees = tiers.map((t) => t.fee);
  return { min: Math.min(...fees), max: Math.max(...fees) };
}

/**
 * Distance filtering for the address autocomplete in area mode.
 *
 * Returns the effective radius (km) used to filter address suggestions, and
 * whether out-of-radius addresses should still be shown. The contract is "only
 * surface addresses the operator will actually deliver to":
 *
 * - tiers OFF            → flat behaviour: filter to `fallbackRadiusKm`.
 * - hard cap set         → filter to the cap (enforced even with an open band).
 * - open-ended band, no cap → no limit (show any distance).
 * - no open band, no cap → filter to the furthest bounded band (it IS the limit).
 */
export function getEffectiveDeliveryRadius(
  cfg: DeliveryTierConfig,
  fallbackRadiusKm: number
): { radiusKm: number; allowOutOfRadius: boolean } {
  if (!hasActiveTiers(cfg)) {
    return { radiusKm: fallbackRadiusKm, allowOutOfRadius: false };
  }

  const maxKm = getMaxDistanceKm(cfg);
  if (maxKm !== null) {
    return { radiusKm: maxKm, allowOutOfRadius: false };
  }

  const tiers = sortTiers(normalizeTiers(cfg.delivery_distance_tiers));
  const hasOpenBand = tiers.some((t) => t.up_to_km === null);
  if (hasOpenBand) {
    return { radiusKm: fallbackRadiusKm, allowOutOfRadius: true };
  }

  // No open band, no cap → the furthest bounded band is the effective ceiling.
  const furthest = tiers.reduce((max, t) => Math.max(max, t.up_to_km ?? 0), 0);
  return { radiusKm: furthest > 0 ? furthest : fallbackRadiusKm, allowOutOfRadius: false };
}
