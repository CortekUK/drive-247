import { describe, it, expect } from 'vitest';
import {
  normalizeTiers,
  hasActiveTiers,
  getMaxDistanceKm,
  resolveDeliveryFee,
  getTierFeeRange,
  getEffectiveDeliveryRadius,
  type DeliveryTierConfig,
} from '@/lib/delivery-tiers';

// Open Bay's real production config (verified against prod 2026-06-18).
const OPEN_BAY: DeliveryTierConfig = {
  delivery_tiers_enabled: true,
  delivery_distance_tiers: [
    { fee: 0, up_to_km: 8 },
    { fee: 25, up_to_km: 24.1 },
    { fee: 40, up_to_km: 40.2 },
    { fee: 50, up_to_km: 64.4 },
    { fee: 210, up_to_km: null }, // open-ended top band
  ],
  area_delivery_fee: 75,
};

// Same bands but no open-ended top band (furthest bounded band is the ceiling).
const NO_OPEN_BAND: DeliveryTierConfig = {
  delivery_tiers_enabled: true,
  delivery_distance_tiers: [
    { fee: 50, up_to_km: 32 },
    { fee: 75, up_to_km: 64 },
    { fee: 90, up_to_km: 96 },
  ],
  area_delivery_fee: 75,
};

const FLAT_ONLY: DeliveryTierConfig = {
  delivery_tiers_enabled: false,
  delivery_distance_tiers: [],
  area_delivery_fee: 60,
};

describe('normalizeTiers', () => {
  it('passes through valid bands', () => {
    expect(normalizeTiers([{ up_to_km: 10, fee: 5 }])).toEqual([{ up_to_km: 10, fee: 5 }]);
  });

  it('parses a JSON string', () => {
    expect(normalizeTiers('[{"up_to_km":10,"fee":5}]')).toEqual([{ up_to_km: 10, fee: 5 }]);
  });

  it('returns [] for unparseable / non-array / null', () => {
    expect(normalizeTiers('not json')).toEqual([]);
    expect(normalizeTiers(null)).toEqual([]);
    expect(normalizeTiers(undefined)).toEqual([]);
    expect(normalizeTiers({})).toEqual([]);
  });

  it('drops bands with negative or non-finite fees', () => {
    expect(normalizeTiers([{ up_to_km: 10, fee: -5 }])).toEqual([]);
    expect(normalizeTiers([{ up_to_km: 10, fee: 'abc' }])).toEqual([]);
  });

  it('drops bands with non-positive bounded distance, keeps the open band', () => {
    expect(normalizeTiers([{ up_to_km: 0, fee: 5 }])).toEqual([]);
    expect(normalizeTiers([{ up_to_km: -3, fee: 5 }])).toEqual([]);
    expect(normalizeTiers([{ up_to_km: null, fee: 5 }])).toEqual([{ up_to_km: null, fee: 5 }]);
  });

  it('treats empty-string / undefined bound as the open band', () => {
    expect(normalizeTiers([{ up_to_km: '', fee: 5 }])).toEqual([{ up_to_km: null, fee: 5 }]);
  });
});

describe('hasActiveTiers', () => {
  it('true only when enabled AND has valid bands', () => {
    expect(hasActiveTiers(OPEN_BAY)).toBe(true);
    expect(hasActiveTiers({ ...OPEN_BAY, delivery_tiers_enabled: false })).toBe(false);
    expect(hasActiveTiers({ delivery_tiers_enabled: true, delivery_distance_tiers: [] })).toBe(false);
    expect(hasActiveTiers(FLAT_ONLY)).toBe(false);
  });
});

describe('getMaxDistanceKm', () => {
  it('returns null when unset, zero, negative, or non-finite', () => {
    expect(getMaxDistanceKm(OPEN_BAY)).toBeNull();
    expect(getMaxDistanceKm({ ...OPEN_BAY, delivery_max_distance_km: 0 })).toBeNull();
    expect(getMaxDistanceKm({ ...OPEN_BAY, delivery_max_distance_km: -5 })).toBeNull();
    expect(getMaxDistanceKm({ ...OPEN_BAY, delivery_max_distance_km: null })).toBeNull();
  });

  it('returns the positive cap', () => {
    expect(getMaxDistanceKm({ ...OPEN_BAY, delivery_max_distance_km: 96.6 })).toBe(96.6);
  });
});

describe('resolveDeliveryFee — flat (tiers off)', () => {
  it('returns the flat fee, never blocked', () => {
    expect(resolveDeliveryFee(5, FLAT_ONLY)).toMatchObject({ fee: 60, tiered: false, blocked: false });
    expect(resolveDeliveryFee(9999, FLAT_ONLY)).toMatchObject({ fee: 60, blocked: false });
  });

  it('defaults to 0 when no flat fee set', () => {
    expect(resolveDeliveryFee(5, { delivery_tiers_enabled: false }).fee).toBe(0);
  });

  it('still honors a hard cap even in flat mode', () => {
    const capped = { ...FLAT_ONLY, delivery_max_distance_km: 50 };
    expect(resolveDeliveryFee(40, capped).blocked).toBe(false);
    expect(resolveDeliveryFee(60, capped)).toMatchObject({ fee: 0, blocked: true });
  });
});

describe('resolveDeliveryFee — Open Bay bands (open-ended, no cap)', () => {
  it('picks the correct band by distance', () => {
    expect(resolveDeliveryFee(5, OPEN_BAY).fee).toBe(0); // <= 8
    expect(resolveDeliveryFee(8, OPEN_BAY).fee).toBe(0); // boundary inclusive
    expect(resolveDeliveryFee(20, OPEN_BAY).fee).toBe(25); // <= 24.1
    expect(resolveDeliveryFee(30, OPEN_BAY).fee).toBe(40); // <= 40.2
    expect(resolveDeliveryFee(50, OPEN_BAY).fee).toBe(50); // <= 64.4
    expect(resolveDeliveryFee(70, OPEN_BAY).fee).toBe(210); // open band
  });

  it('open band means nothing is ever blocked (the original complaint)', () => {
    expect(resolveDeliveryFee(500, OPEN_BAY)).toMatchObject({ fee: 210, blocked: false, outOfRange: false });
  });

  it('unknown distance surfaces the cheapest band as a "from" estimate, not blocked', () => {
    expect(resolveDeliveryFee(undefined, OPEN_BAY)).toMatchObject({ fee: 0, blocked: false });
    expect(resolveDeliveryFee(null, OPEN_BAY)).toMatchObject({ fee: 0, blocked: false });
  });
});

describe('resolveDeliveryFee — Open Bay bands WITH a 96.6km cap (Jim\'s request)', () => {
  const capped = { ...OPEN_BAY, delivery_max_distance_km: 96.6 };

  it('within the cap still prices via bands', () => {
    expect(resolveDeliveryFee(5, capped).fee).toBe(0);
    expect(resolveDeliveryFee(50, capped).fee).toBe(50);
    expect(resolveDeliveryFee(70, capped)).toMatchObject({ fee: 210, blocked: false }); // open band, within cap
    expect(resolveDeliveryFee(96.6, capped)).toMatchObject({ blocked: false }); // boundary inclusive
  });

  it('beyond the cap is BLOCKED regardless of the open band', () => {
    expect(resolveDeliveryFee(96.7, capped)).toMatchObject({ fee: 0, blocked: true, outOfRange: true });
    expect(resolveDeliveryFee(500, capped)).toMatchObject({ fee: 0, blocked: true });
  });

  it('unknown distance is never blocked (no address picked yet)', () => {
    expect(resolveDeliveryFee(undefined, capped).blocked).toBe(false);
  });
});

describe('resolveDeliveryFee — no open band (furthest band is the ceiling)', () => {
  it('prices within bands', () => {
    expect(resolveDeliveryFee(20, NO_OPEN_BAND).fee).toBe(50);
    expect(resolveDeliveryFee(96, NO_OPEN_BAND).fee).toBe(90);
  });

  it('beyond the furthest band is blocked/outOfRange', () => {
    expect(resolveDeliveryFee(120, NO_OPEN_BAND)).toMatchObject({ blocked: true, outOfRange: true });
  });
});

describe('getTierFeeRange', () => {
  it('returns min/max across bands', () => {
    expect(getTierFeeRange(OPEN_BAY)).toEqual({ min: 0, max: 210 });
  });
  it('null when tiers off', () => {
    expect(getTierFeeRange(FLAT_ONLY)).toBeNull();
  });
});

describe('getEffectiveDeliveryRadius — drives the address autocomplete filter', () => {
  it('tiers OFF → flat radius, no out-of-radius', () => {
    expect(getEffectiveDeliveryRadius(FLAT_ONLY, 40)).toEqual({ radiusKm: 40, allowOutOfRadius: false });
  });

  it('open band, no cap → unlimited (allowOutOfRadius true) — the unbounded case', () => {
    expect(getEffectiveDeliveryRadius(OPEN_BAY, 40)).toEqual({ radiusKm: 40, allowOutOfRadius: true });
  });

  it('hard cap set → filter to the cap, even with an open band', () => {
    const capped = { ...OPEN_BAY, delivery_max_distance_km: 96.6 };
    expect(getEffectiveDeliveryRadius(capped, 40)).toEqual({ radiusKm: 96.6, allowOutOfRadius: false });
  });

  it('no open band, no cap → filter to the furthest bounded band', () => {
    expect(getEffectiveDeliveryRadius(NO_OPEN_BAND, 40)).toEqual({ radiusKm: 96, allowOutOfRadius: false });
  });
});
