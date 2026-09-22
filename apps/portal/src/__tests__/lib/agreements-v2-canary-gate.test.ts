/**
 * Agreements v2 — ONLY the v2 rollout may see it.
 *
 * Cloned from turo-canary-gate.test.ts. The stakes are higher here than for
 * most areas: the Agreements tab is a v1 page every tenant uses today, and a v2
 * send from it is a LIVE BoldSign document (the canary is lean, so it signs in
 * live mode whatever its column says) that is legally binding and spends
 * credits. A gate that answered true for a v1 operator would change what their
 * staff see on a screen they rely on, and put a send button in front of them
 * that nobody has proved against their data.
 *
 * The three-case shape is from V2_PLAN §10 ("Verifying a gate"): the canary,
 * real operators, and a slug that does not exist. Without the third, a gate that
 * refuses everyone because the lookup returned nothing passes the first two.
 */
import { describe, expect, it } from 'vitest';
import { isV2, NORTHWIND, V2_AREA_LIST } from '@/lib/v2';
import * as generated from '../../../../../supabase/functions/trax-support/support/portal-v2.generated.js';

/** A sample of real operators, none of which may ever resolve true here. */
const LIVE_OPERATORS = [
  'revtekrentals',
  'goniko',
  'jangramrentals',
  'eastpeakrentalsllc',
  'openbayrental',
  'flowrentalsllc',
  'drive-hustle',
  'globalmotiontransport',
  'nealcorentals',
  'moore-luxe-rentals',
  'clutch-motors',
  'rbvs',
];

describe('Agreements v2 — the canary gate, executed', () => {
  it('is carried in the derived area list the root layout iterates', () => {
    // V2_AREA_LIST is Object.keys(V2_AREAS). If 'agreements' were missing from
    // it, the server would never resolve the flag and useV2('agreements')
    // would answer false for the canary too, silently.
    expect(V2_AREA_LIST).toContain('agreements');
  });

  it('resolves TRUE for the canary and nothing else', () => {
    expect(isV2('agreements', NORTHWIND)).toBe(true);
  });

  it.each(LIVE_OPERATORS)('refuses live operator %s', (slug) => {
    expect(
      isV2('agreements', slug),
      `${slug} would see the v2 Agreements tab and be able to send live agreements from it.`,
    ).toBe(false);
  });

  it('refuses a slug that does not exist at all', () => {
    expect(isV2('agreements', 'no-such-tenant-anywhere')).toBe(false);
  });

  it.each([null, undefined, ''])('fails to v1 on an unresolved tenant (%s)', (slug) => {
    expect(isV2('agreements', slug as string | null | undefined)).toBe(false);
    // …even with the row flag set: no resolved tenant, no v2.
    expect(isV2('agreements', slug as string | null | undefined, true)).toBe(false);
  });

  it('gives a tenant whose row says portal_experience = v2 the area, like every other area', () => {
    expect(isV2('agreements', 'wings', true)).toBe(true);
    expect(isV2('agreements', 'wings', false)).toBe(false);
  });

  it('does not change the answer of any area that existed before it', () => {
    // Adding an area is additive: every other area still answers the canary
    // true and a live operator false.
    for (const area of V2_AREA_LIST) {
      expect(isV2(area, NORTHWIND)).toBe(true);
      expect(isV2(area, 'revtekrentals')).toBe(false);
    }
  });
});

describe('Agreements v2 — the generated copy TRAX support uses agrees', () => {
  // supabase/functions/trax-support/support/portal-v2.generated.js is compiled
  // from lib/v2.ts by scripts/trax-knowledge.mjs. If it lagged, TRAX would
  // answer help questions for the canary as if Agreements v2 did not exist.
  it('lists the same areas', () => {
    expect([...generated.V2_AREA_LIST].sort()).toEqual([...V2_AREA_LIST].sort());
  });

  it.each([NORTHWIND, ...LIVE_OPERATORS, 'no-such-tenant-anywhere'])('answers agreements the same for %s', (slug) => {
    expect(generated.isV2('agreements', slug)).toBe(isV2('agreements', slug));
    expect(generated.isV2('agreements', slug, true)).toBe(isV2('agreements', slug, true));
  });
});
