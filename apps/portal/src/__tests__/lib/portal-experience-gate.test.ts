/**
 * `tenants.portal_experience` — the second way a tenant gets v2.
 *
 * WHY THE COLUMN EXISTS. Every v2 area and every lean-hidden area was gated on
 * a hardcoded SLUG LIST (`V2_AREAS` / `LEAN_TENANTS`, both `['northwind']`).
 * That is the right shape for widening an EXISTING tenant one at a time — it
 * costs no column, no grant and no query, and it is reviewed and reverted like
 * any other change. It cannot serve a tenant that does not exist yet. A
 * self-serve signup through drive-247.com creates its tenant at transaction
 * time and its operator opens the portal minutes later, and "deploy a slug,
 * then ask them to reload" is not a signup flow. So the switch also lives on
 * the row, and the two are OR'd.
 *
 * WHAT THIS FILE PROVES, in the order it matters:
 *  1. a tenant whose row says 'v2' gets EVERY v2 area and the lean hidden areas
 *  2. northwind still gets them through the slug list, with no column at all
 *  3. a tenant whose row says 'v1' answers EXACTLY what it answered before —
 *     this is the ~56 live operators, and it is the assertion that carries the
 *     weight
 *  4. every unknown fails CLOSED to v1: no row, a read error, a value this
 *     build has never heard of, a column the anon key cannot read, a null slug
 *  5. no module-level state: two tenants resolved in sequence in one process do
 *     not see each other's answer. The server shares these modules across every
 *     request it handles, so a cached answer is not a stale answer — it is one
 *     tenant's UI served to another, which would read as "some tenants randomly
 *     got the new design".
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  isV2,
  isV2Experience,
  V2_AREA_LIST,
  NORTHWIND,
  type V2Area,
} from '@/lib/v2';
import {
  LEAN_HIDDEN_AREAS,
  isAreaHidden,
  isAreaHiddenForLean,
  isLeanTenant,
  isSettingsTabHidden,
  isSettingsTabHiddenForLean,
  isTestModeUiHidden,
  resolveBoldSignMode,
  type LeanHiddenArea,
} from '@/lib/lean-areas';

/**
 * Every v2 area, written out rather than derived, because the point of the
 * assertion is that a flagged tenant gets the WHOLE product and not a subset.
 * `V2_AREA_LIST` is checked against this list too, so an area added to
 * `V2_AREAS` and forgotten here fails rather than quietly going untested.
 */
const EVERY_AREA: V2Area[] = [
  'appearance',
  'theme',
  'dashboard',
  'chrome',
  'login',
  'rentals',
  'customers',
  'cms',
  'vehicles',
  'insights',
  'availability',
  'turo',
  'agreements',
];

/** Live operators. None of these may ever be moved by this change. */
const V1_OPERATORS = [
  'revtekrentals',
  'goniko',
  'jangramrentals',
  'eastpeakrentalsllc',
  'openbayrental',
  'flowrentalsllc',
  'globalmotiontransport',
  'drive-hustle',
  'nealcorentals',
  'moore-luxe-rentals',
  'drive-247',
  'test',
];

/** The self-serve tenant from the report: brand new, in no list anywhere. */
const FLAGGED = 'wings';

describe('the area list this file asserts against is the real one', () => {
  it('covers every member of V2_AREA_LIST, and nothing that is not one', () => {
    expect(new Set(V2_AREA_LIST)).toEqual(new Set(EVERY_AREA));
  });
});

describe('isV2Experience — the column value, read strictly', () => {
  it("is true for exactly 'v2'", () => {
    expect(isV2Experience('v2')).toBe(true);
  });

  it.each(['v1', 'V2', 'V1', 'v3', 'v2 ', ' v2', '', 'true', '2'])(
    'is false for %o',
    (value) => {
      expect(isV2Experience(value)).toBe(false);
    },
  );

  it('is false for null and undefined — a NULL column, or one that was never selected', () => {
    // `undefined` is what comes back when the GRANT is missing and the read
    // dropped the column to keep the rest of the row. It must mean v1, not
    // "unknown, so try the new thing".
    expect(isV2Experience(null)).toBe(false);
    expect(isV2Experience(undefined)).toBe(false);
  });
});

describe('a tenant whose row says v2 gets the whole v2 product', () => {
  it.each(EVERY_AREA)('is on v2 for %s', (area) => {
    expect(isV2(area, FLAGGED, true)).toBe(true);
  });

  it('is lean, so the lean product surface applies to it', () => {
    expect(isLeanTenant(FLAGGED, true)).toBe(true);
    expect(isTestModeUiHidden(FLAGGED, true)).toBe(true);
  });

  it.each(LEAN_HIDDEN_AREAS)('hides %s', (area) => {
    expect(isAreaHidden(area, FLAGGED, true)).toBe(true);
  });

  it('hides the five Settings tabs the Integrations board replaces', () => {
    for (const tab of ['payments', 'messaging', 'insurance', 'esign']) {
      expect(isSettingsTabHidden(tab, FLAGGED, true)).toBe(true);
    }
  });

  it('CAN STILL REACH /integrations, which is the tab gate’s other half', () => {
    // RISK 1. The four `settings-*` gates hide Stripe, Square, Twilio, Bonzah
    // and BoldSign from Settings *because* `/integrations` replaces them. That
    // route is gated on the `appearance` area. If the tab gate moved to the
    // column and the route gate did not, a brand-new tenant would lose every
    // route to Stripe onboarding — i.e. would be unable to take money at all.
    expect(isSettingsTabHidden('payments', FLAGGED, true)).toBe(true);
    expect(isV2('appearance', FLAGGED, true)).toBe(true);
  });

  it('signs BoldSign documents LIVE, not in the sandbox', () => {
    // The lean product has no test modes. A flagged tenant whose column still
    // says `test` must still sign live: sandbox documents are watermarked and
    // deleted after 14 days, so the alternative is an operator whose signed
    // agreements evaporate.
    expect(resolveBoldSignMode('test', FLAGGED, true)).toBe('live');
    expect(resolveBoldSignMode(null, FLAGGED, true)).toBe('live');
  });
});

describe('northwind still comes through the slug list, with no column', () => {
  it.each(EVERY_AREA)('is on v2 for %s with onV2 false', (area) => {
    expect(isV2(area, NORTHWIND)).toBe(true);
    expect(isV2(area, NORTHWIND, false)).toBe(true);
  });

  it('is still lean and still hides every lean area', () => {
    expect(isLeanTenant(NORTHWIND)).toBe(true);
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, NORTHWIND)).toBe(true);
    }
  });

  it("is unaffected by its column saying 'v1'", () => {
    // The two sources are OR'd, deliberately. The column cannot be used to
    // take v2 AWAY from the canary by accident — retiring an area is deleting
    // its entry from `V2_AREAS`, which is a reviewed change.
    for (const area of EVERY_AREA) expect(isV2(area, NORTHWIND, false)).toBe(true);
  });
});

describe('a v1 tenant answers exactly what it answered before', () => {
  it.each(V1_OPERATORS)('%s is on no v2 area', (slug) => {
    for (const area of EVERY_AREA) expect(isV2(area, slug)).toBe(false);
    for (const area of EVERY_AREA) expect(isV2(area, slug, false)).toBe(false);
  });

  it.each(V1_OPERATORS)('%s has nothing hidden', (slug) => {
    expect(isLeanTenant(slug)).toBe(false);
    expect(isTestModeUiHidden(slug)).toBe(false);
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, slug)).toBe(false);
    }
    for (const tab of ['payments', 'messaging', 'insurance', 'esign', 'accounting', 'inshur', 'tesla']) {
      expect(isSettingsTabHidden(tab, slug)).toBe(false);
    }
  });

  it.each(V1_OPERATORS)('%s keeps whatever BoldSign mode its column says', (slug) => {
    expect(resolveBoldSignMode('test', slug)).toBe('test');
    expect(resolveBoldSignMode('live', slug)).toBe('live');
    expect(resolveBoldSignMode(null, slug)).toBe('test');
  });

  it('is what the DEFAULT argument gives every caller that was not updated', () => {
    // The esign route handlers and the non-React helpers call these functions
    // with two arguments, as they always did. `onV2` defaults to false, so they
    // answer byte for byte what they answered before the column existed.
    for (const slug of V1_OPERATORS) {
      expect(isAreaHidden('reports', slug)).toBe(isAreaHidden('reports', slug, false));
      expect(isLeanTenant(slug)).toBe(isLeanTenant(slug, false));
    }
  });
});

describe('everything unknown fails closed to v1', () => {
  it.each([null, undefined, ''])('a slug of %o is on no v2 area and hides nothing', (slug) => {
    for (const area of EVERY_AREA) {
      expect(isV2(area, slug as string | null | undefined)).toBe(false);
      // …and it stays v1 even with the flag set. That combination cannot arise
      // (the flag only comes from a row read BY a slug), so requiring the slug
      // costs nothing and leaves one rule: no resolved tenant, no v2.
      expect(isV2(area, slug as string | null | undefined, true)).toBe(false);
    }
    expect(isLeanTenant(slug as string | null | undefined, true)).toBe(false);
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, slug as string | null | undefined, true)).toBe(false);
    }
  });

  it('an unregistered area is not hidden from anyone, flag or no flag', () => {
    // A gated-but-unregistered key is silently inert, which has shipped once
    // (`fleet-health`). Registering ahead of the call sites is the safe
    // direction: an unused key gates nothing.
    const notAnArea = 'not-a-real-area' as LeanHiddenArea;
    expect(isAreaHidden(notAnArea, FLAGGED, true)).toBe(false);
    expect(isAreaHiddenForLean(notAnArea, true)).toBe(false);
    expect(isSettingsTabHidden('not-a-tab', FLAGGED, true)).toBe(false);
    expect(isSettingsTabHiddenForLean('', true)).toBe(false);
  });

  it('keys on the slug, never on a tenant id, in either source', () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the wrong branch in
    // whichever environment it was not written against, with no error.
    for (const id of [
      '6e5c544f-b374-451f-a662-360a634bff15',
      '8e6bc88f-86d6-4468-8610-73f7c8a88f6e',
    ]) {
      expect(isV2('login', id)).toBe(false);
      expect(isLeanTenant(id)).toBe(false);
    }
  });
});

/* ───────────────────────── the resolver, executed ────────────────────────── */

const slug = { current: null as string | null };
const rows: Record<string, Record<string, unknown> | null> = {};
const selects: string[] = [];
const throwOn = { current: null as string | null };
/**
 * Inject a Postgres error for a given column list, so the retry ladder in
 * `readPortalTenant` can actually be walked. Returns null to let the read
 * succeed.
 */
const errorFor = {
  current: null as ((columns: string) => { code?: string; message?: string } | null) | null,
};

vi.mock('@/lib/tenant-server', () => ({ tenantSlugFromHeaders: async () => slug.current }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        return {
          eq: (_column: string, value: string) => ({
            single: async () => {
              if (throwOn.current === value) throw new Error('network down');
              const error = errorFor.current?.(columns) ?? null;
              if (error) return { data: null, error };
              return { data: rows[value] ?? null, error: null };
            },
          }),
        };
      },
    }),
  }),
}));

const { resolvePortalGates, serverIsV2 } = await import('@/lib/v2-server');
const { readPortalTenant, readPortalOnV2 } = await import('@/lib/portal-tenant');

describe('resolvePortalGates — one read, one set of answers, per request', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    selects.length = 0;
    throwOn.current = null;
    errorFor.current = null;
    slug.current = null;
    for (const key of Object.keys(rows)) delete rows[key];
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("gives a flagged tenant every area, lean, and the /integrations route", async () => {
    slug.current = FLAGGED;
    rows[FLAGGED] = { portal_experience: 'v2' };

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(true);
    expect(gates.lean).toBe(true);
    for (const area of EVERY_AREA) expect(gates.flags[area]).toBe(true);
    expect(await serverIsV2('appearance')).toBe(true);
    expect(await serverIsV2('insights')).toBe(true);
    expect(await serverIsV2('chrome')).toBe(true);
  });

  it('gives northwind the same answers with no column in the row at all', async () => {
    slug.current = NORTHWIND;
    rows[NORTHWIND] = { app_name: 'Northwind' };

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(true);
    for (const area of EVERY_AREA) expect(gates.flags[area]).toBe(true);
  });

  it('leaves a v1 tenant on v1 for every area and hides nothing', async () => {
    slug.current = 'revtekrentals';
    rows['revtekrentals'] = { portal_experience: 'v1' };

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    for (const area of EVERY_AREA) expect(gates.flags[area]).toBe(false);
    expect(await serverIsV2('appearance')).toBe(false);
  });

  it.each([
    ['a row that does not exist', undefined],
    ['a NULL column', { portal_experience: null }],
    ['a column that was never selected', { app_name: 'Wings' }],
    ['an unknown value', { portal_experience: 'v3' }],
    ['the wrong case', { portal_experience: 'V2' }],
  ])('leaves a tenant on v1 given %s', async (_label, row) => {
    slug.current = FLAGGED;
    if (row !== undefined) rows[FLAGGED] = row as Record<string, unknown>;

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    for (const area of EVERY_AREA) expect(gates.flags[area]).toBe(false);
  });

  it('leaves a tenant on v1 when the read throws, and does not rethrow', async () => {
    slug.current = FLAGGED;
    rows[FLAGGED] = { portal_experience: 'v2' };
    throwOn.current = FLAGGED;

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    expect(gates.flags.theme).toBe(false);
  });

  it('makes no query at all for a null slug, and answers v1', async () => {
    slug.current = null;

    const gates = await resolvePortalGates();
    expect(gates.tenantSlug).toBeNull();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    for (const area of EVERY_AREA) expect(gates.flags[area]).toBe(false);
    expect(selects).toEqual([]);
  });

  it('answers v1 when Supabase is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    slug.current = FLAGGED;
    rows[FLAGGED] = { portal_experience: 'v2' };

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.flags.theme).toBe(false);
  });

  it('DOES NOT LEAK one tenant’s answer to the next request', async () => {
    // THE ONE THAT MATTERS. These modules are shared across every request the
    // server process handles. A module-level cache — a `let`, a Map keyed by
    // slug, a memoised promise — would let whichever tenant happened to be
    // first decide whether the next one saw v1 or v2, and it would show up as
    // "some tenants randomly get the new UI" rather than as an error. The read
    // is a React `cache()`, which is scoped to the request, so resolving two
    // tenants in sequence must give two independent answers — in BOTH orders,
    // because a cache that only ever answers "the first one" would pass a
    // one-directional test.
    rows[FLAGGED] = { portal_experience: 'v2' };
    rows['revtekrentals'] = { portal_experience: 'v1' };

    slug.current = FLAGGED;
    expect((await resolvePortalGates()).onV2).toBe(true);

    slug.current = 'revtekrentals';
    const second = await resolvePortalGates();
    expect(second.tenantSlug).toBe('revtekrentals');
    expect(second.onV2).toBe(false);
    expect(second.lean).toBe(false);
    expect(second.flags.theme).toBe(false);
    expect(await serverIsV2('appearance')).toBe(false);

    slug.current = FLAGGED;
    const third = await resolvePortalGates();
    expect(third.tenantSlug).toBe(FLAGGED);
    expect(third.onV2).toBe(true);
    expect(third.flags.theme).toBe(true);
  });
});

/**
 * THE RETRY LADDER in `readPortalTenant`.
 *
 * `anon` holds COLUMN-level SELECT grants on `public.tenants`, and this read
 * runs with the anon key before any session exists. Postgres refuses the WHOLE
 * ROW for a column `anon` cannot read — it does not come back null — so a
 * deploy that is ahead of the SQL the lead applies by hand would otherwise cost
 * every tenant its <title>, favicon and OG image on every page.
 *
 * Each rung must send a STRICTLY SMALLER column list than the one that just
 * failed. A rung that re-sends the offending column is not a safety net, it is
 * the same query again — and that is precisely the bug this block was written
 * to pin: the unreadable-column test fires on ANY 42501/42703, because
 * PostgREST does not reliably name the offending column, so a privilege error
 * on `primary_color` takes the retry branch too. With only two rungs the retry
 * re-sent both brand columns, got the same error and returned null.
 */
describe('readPortalTenant — the retry ladder shrinks on every rung', () => {
  /** What a v1 tenant's request sent before any of the v2 work. */
  const PRE_CHANGE =
    'app_name, company_name, meta_title, meta_description, favicon_url, og_image_url';

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    selects.length = 0;
    throwOn.current = null;
    errorFor.current = null;
    slug.current = null;
    for (const key of Object.keys(rows)) delete rows[key];
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('asks for portal_experience and the brand colours on ONE round trip', async () => {
    rows['ladder-one'] = { portal_experience: 'v2', primary_color: '#442DD7' };

    const row = await readPortalTenant('ladder-one');
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('portal_experience');
    expect(selects[0]).toContain('primary_color');
    expect(selects[0]).toContain('light_primary_color');
    expect(selects[0]).toContain('favicon_url');
    expect(row?.portal_experience).toBe('v2');
  });

  it.each([
    ['42703, the migration not applied', '42703', 'column tenants.portal_experience does not exist'],
    ['42501, the GRANT forgotten', '42501', 'permission denied for column portal_experience'],
  ])('rung 2 drops portal_experience and keeps the page on %s', async (label, code, message) => {
    const tenant = `ladder-rung2-${code}`;
    rows[tenant] = { app_name: 'Rung Two', primary_color: '#442DD7' };
    errorFor.current = (columns) =>
      columns.includes('portal_experience') ? { code, message } : null;

    const row = await readPortalTenant(tenant);
    // Two calls, the second a strict subset of the first.
    expect(selects, label).toHaveLength(2);
    expect(selects[1]).not.toContain('portal_experience');
    expect(selects[1]).toContain('primary_color');
    // The tenant keeps its metadata AND its brand; the gate answers v1 because
    // the column simply is not in the row.
    expect(row?.app_name).toBe('Rung Two');
    expect(row?.primary_color).toBe('#442DD7');
    expect(row?.portal_experience ?? null).toBeNull();
  });

  it('rung 3 drops the BRAND columns and still returns the row', async () => {
    // THE ONE THE TWO-RUNG LADDER GOT WRONG. The error is about a brand column,
    // not `portal_experience`, and rung 2 cannot tell — so it re-sent the
    // offending columns, got the same error, and returned null. Every tenant
    // then loses its <title>, favicon and OG image: the exact outcome the
    // ladder exists to prevent.
    rows['ladder-rung3'] = { app_name: 'Rung Three', meta_title: 'Kept' };
    errorFor.current = (columns) =>
      columns.includes('light_primary_color')
        ? { code: '42501', message: 'permission denied for column light_primary_color' }
        : null;

    const row = await readPortalTenant('ladder-rung3');
    expect(selects).toHaveLength(3);
    expect(selects[2]).toBe(PRE_CHANGE);
    expect(row).not.toBeNull();
    expect(row?.app_name).toBe('Rung Three');
    expect(row?.meta_title).toBe('Kept');
    // No brand colour to paint — the stylesheet default covers that — and the
    // gate stays on v1.
    expect(row?.primary_color ?? null).toBeNull();
  });

  it('every rung is a strict subset of the rung before it', async () => {
    // The property, not the three specific lists: a rung that re-sends a column
    // the previous attempt was refused cannot be a safety net.
    rows['ladder-subset'] = { app_name: 'Subset' };
    errorFor.current = (columns) =>
      columns === PRE_CHANGE ? null : { code: '42501', message: 'permission denied' };

    await readPortalTenant('ladder-subset');
    const asSets = selects.map((c) => new Set(c.split(',').map((x) => x.trim())));
    expect(asSets.length).toBeGreaterThan(1);
    for (let i = 1; i < asSets.length; i += 1) {
      for (const col of asSets[i]) {
        expect(asSets[i - 1].has(col), `rung ${i + 1} added ${col}`).toBe(true);
      }
      expect(asSets[i].size, `rung ${i + 1} did not shrink`).toBeLessThan(asSets[i - 1].size);
    }
    expect(selects[selects.length - 1]).toBe(PRE_CHANGE);
  });

  it('stops at three rungs and answers null when even metadata is refused', async () => {
    // A real outage, not a grant gap. It must cost two extra round trips at
    // most, and it must not loop.
    errorFor.current = () => ({ code: '42501', message: 'permission denied' });

    const row = await readPortalTenant('ladder-dead');
    expect(selects).toHaveLength(3);
    expect(row).toBeNull();
    expect(await readPortalOnV2('ladder-dead')).toBe(false);
  });

  it('does NOT retry a missing row — an unknown slug is a real answer', async () => {
    // PGRST116 doubling the queries for every 404 host is the thing the code
    // list deliberately leaves out.
    errorFor.current = () => ({ code: 'PGRST116', message: 'no rows returned' });

    const row = await readPortalTenant('no-such-tenant');
    expect(selects).toHaveLength(1);
    expect(row).toBeNull();
  });

  it('leaves a flagged tenant on v2 through the whole ladder being unnecessary', async () => {
    slug.current = FLAGGED;
    rows[FLAGGED] = { portal_experience: 'v2', primary_color: '#442DD7' };

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(true);
    expect(gates.lean).toBe(true);
    expect(selects).toHaveLength(1);
  });
});
