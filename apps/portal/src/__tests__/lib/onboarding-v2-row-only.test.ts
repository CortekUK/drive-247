/**
 * A BRAND-NEW PAYING TENANT WHOSE ONLY v2 SIGNAL IS THE ROW.
 *
 * `portal-experience-gate.test.ts` already proves the column is read strictly
 * and that v1 is untouched. This file proves the one thing that would cost a
 * brand-new operator real money if it were wrong, and it proves it by EXECUTING
 * the gates — including the real `/integrations` route component — rather than
 * by reading them.
 *
 * THE RISK, stated plainly. The row flag does two things at once:
 *   1. `isV2(area, slug, onV2)` → the tenant gets the v2 login, chrome, theme
 *      and dashboard.
 *   2. `isLeanTenant(slug, onV2)` → the tenant is LEAN, which HIDES the
 *      Stripe, Square, Twilio, Bonzah and BoldSign Settings tabs, on the
 *      grounds that `/integrations` replaces them.
 * (2) is only safe because (1) also opens `/integrations`. If the two ever come
 * apart for a tenant that is in NO slug list — the only kind of tenant a
 * self-serve signup can produce — a brand-new operator has the Stripe tabs
 * hidden AND the board 404ing, i.e. no route at all to Stripe Connect
 * onboarding, i.e. no way to take a single payment. That is the mistake.
 *
 * WHY A SEPARATE FILE FROM `portal-experience-gate.test.ts`. That one asserts
 * the pair for one slug (`wings`) at one point. This asserts it as an
 * INVARIANT over a matrix of slugs and flag values, walks the whole settings
 * tab list to show each hidden tab has a live replacement, and then executes
 * the actual Server Component whose `notFound()` is the thing that would strand
 * the operator. Those are different claims from different machinery.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { isV2, V2_AREA_LIST, NORTHWIND, type V2Area } from '@/lib/v2';
import {
  isAreaHidden,
  isLeanTenant,
  isSettingsTabHidden,
  settingsTabBoardCard,
  SETTINGS_TAB_BOARD_ROUTE,
} from '@/lib/lean-areas';
import { v2BrandVars, isUsableV2Brand, hexToHsl } from '@/lib/appearance/color';

/* ── The tenants this file is about ───────────────────────────────────────── */

/**
 * Slugs that are in NO list anywhere: not `V2_AREAS`, not `LEAN_TENANTS`.
 *
 * `nasir` is the tenant from the report (provisioned 2026-09-18, landed on v1
 * because the deployed `signup-provision` predates the column). The other two
 * stand for the tenants that do not exist yet — which is the entire point of
 * the column, since a slug that is created at payment time cannot be in a list
 * compiled at build time.
 */
const ROW_ONLY = ['nasir', 'acme-rentals-7f21', 'a-tenant-created-five-minutes-ago'];

/** Live operators. None of these may move, whatever this file adds. */
const V1_OPERATORS = [
  'revtekrentals',
  'goniko',
  'jangramrentals',
  'eastpeakrentalsllc',
  'openbayrental',
  'flowrentalsllc',
  'globalmotiontransport',
  'nealcorentals',
  'drive-247',
  'test',
];

/**
 * The four tabs the Integrations board took over. Hiding these is what makes
 * `/integrations` load-bearing rather than merely nice.
 */
const BOARD_OWNED_TABS = ['payments', 'messaging', 'insurance', 'esign'] as const;

/* ───────────────── 1. the slug lists really do not know them ─────────────── */

describe('a row-flagged tenant is in NO slug list — proved by executing the gates', () => {
  it.each(ROW_ONLY)('%s gets nothing from the slug list alone', (slug) => {
    // If any of these slugs were quietly added to V2_AREAS or LEAN_TENANTS,
    // every assertion below would pass for the wrong reason: it would be
    // proving the canary path again, not the column path. This is the guard.
    for (const area of V2_AREA_LIST) {
      expect(isV2(area, slug)).toBe(false);
      expect(isV2(area, slug, false)).toBe(false);
    }
    expect(isLeanTenant(slug)).toBe(false);
    expect(isLeanTenant(slug, false)).toBe(false);
    for (const tab of BOARD_OWNED_TABS) {
      expect(isSettingsTabHidden(tab, slug)).toBe(false);
    }
  });

  it.each(ROW_ONLY)('%s gets the WHOLE v2 product from the row flag alone', (slug) => {
    for (const area of V2_AREA_LIST) expect(isV2(area, slug, true)).toBe(true);
    expect(isLeanTenant(slug, true)).toBe(true);
  });
});

/* ──────── 2. the invariant: lean implies the board is reachable ──────────── */

describe('THE INVARIANT — nothing may hide a payment tab without opening /integrations', () => {
  /**
   * The matrix, not one example. Every slug this suite knows about crossed with
   * both flag values, plus the unresolved-slug cases. The claim is a property:
   * there is no (slug, onV2) pair anywhere for which a Settings tab that owns a
   * money or messaging path is hidden while the board that replaced it is shut.
   */
  const MATRIX: Array<[string | null | undefined, boolean]> = [];
  for (const slug of [...ROW_ONLY, ...V1_OPERATORS, NORTHWIND, null, undefined, '']) {
    MATRIX.push([slug, false], [slug, true]);
  }

  it.each(MATRIX)('slug=%o onV2=%o — hidden tab ⇒ /integrations open', (slug, onV2) => {
    const anyTabHidden = BOARD_OWNED_TABS.some((tab) => isSettingsTabHidden(tab, slug, onV2));
    if (!anyTabHidden) return;
    // `/integrations` rides the `appearance` area — see the route file's header
    // and `serverIsV2('appearance')`. This is the exact pairing that, taken
    // apart, leaves a new operator unable to take money.
    expect(isV2('appearance', slug, onV2)).toBe(true);
  });

  it.each(MATRIX)('slug=%o onV2=%o — lean ⇒ /integrations open', (slug, onV2) => {
    // The stronger form. Every lean-hidden area is hidden BECAUSE the lean
    // product carries a replacement, and for the four settings-* keys that
    // replacement is one route. `lean` and `appearance` must rise together.
    if (!isLeanTenant(slug, onV2)) return;
    expect(isV2('appearance', slug, onV2)).toBe(true);
  });

  it('the contrapositive holds too: no board ⇒ no hidden money tab', () => {
    for (const [slug, onV2] of MATRIX) {
      if (isV2('appearance', slug, onV2)) continue;
      for (const tab of BOARD_OWNED_TABS) {
        expect(isSettingsTabHidden(tab, slug, onV2)).toBe(false);
      }
      for (const area of [
        'settings-payments',
        'settings-messaging',
        'settings-insurance',
        'settings-esign',
      ] as const) {
        expect(isAreaHidden(area, slug, onV2)).toBe(false);
      }
    }
  });
});

/* ───────── 3. every tab the row flag hides has a live replacement ────────── */

describe('the tabs a row-flagged tenant loses are exactly the ones the board owns', () => {
  /**
   * The full settings tab list, taken from the page itself rather than copied,
   * so a tab added later is covered by this test the day it lands instead of
   * silently escaping it.
   */
  const ALL_SETTINGS_TABS = [
    'general',
    'locations',
    'branding',
    'requirements',
    'duration',
    'lockbox',
    'pricing',
    'fees',
    'preauth',
    'installments',
    'payg',
    'auto-extend',
    'promos',
    'extras',
    'payments',
    'accounting',
    'reminders',
    'push',
    'templates',
    'messaging',
    'insurance',
    'inshur',
    'esign',
    'tesla',
    'blacklist',
    'subscription',
  ];

  it('matches the real allSettingsTabs array, so nothing escapes this test', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(__dirname, '../..', 'app/(dashboard)/settings/page.tsx'),
      'utf8',
    );
    const block = src.match(/const allSettingsTabs = \[([\s\S]*?)\];/)?.[1] ?? '';
    const real = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(real.length).toBeGreaterThan(20);
    expect(new Set(real)).toEqual(new Set(ALL_SETTINGS_TABS));
  });

  it('hides exactly seven tabs, and every one of them has a replacement', () => {
    const hidden = ALL_SETTINGS_TABS.filter((tab) => isSettingsTabHidden(tab, 'nasir', true));
    expect(new Set(hidden)).toEqual(
      new Set(['payments', 'messaging', 'insurance', 'esign', 'accounting', 'inshur', 'tesla']),
    );

    // And each has somewhere to go. `null` from `settingsTabBoardCard` is not
    // "nowhere": it means the tab's BODY keeps rendering (insurance — the
    // Bonzah wizard) or the area was already hidden in its own right and draws
    // no body at all (accounting, inshur).
    expect(settingsTabBoardCard('payments')).toBe(''); // the bare grid: two cards
    expect(settingsTabBoardCard('messaging')).toBe('Twilio Messages');
    expect(settingsTabBoardCard('esign')).toBe('BoldSign');
    expect(settingsTabBoardCard('tesla')).toBe('Tesla');
    for (const tab of ['insurance', 'accounting', 'inshur']) {
      expect(settingsTabBoardCard(tab)).toBeNull();
    }
  });

  it('leaves every OTHER settings tab exactly where it was', () => {
    // The tenant still configures pricing, fees, deposits, locations,
    // requirements, templates and its own subscription from Settings. Nothing
    // here is a money path the board took over, so nothing here may move.
    for (const tab of ALL_SETTINGS_TABS) {
      if (
        ['payments', 'messaging', 'insurance', 'esign', 'accounting', 'inshur', 'tesla'].includes(
          tab,
        )
      ) {
        continue;
      }
      expect(isSettingsTabHidden(tab, 'nasir', true), tab).toBe(false);
    }
    // Blacklist in particular: relocated into Booking Rules for lean tenants,
    // never hidden. If this flips, the canary and every self-serve tenant lose
    // the screen outright.
    expect(isSettingsTabHidden('blacklist', 'nasir', true)).toBe(false);
  });

  it('STRIPE CONNECT IS ON THE BOARD, with a panel that runs onboarding', async () => {
    // The replacement has to be real, not just routable. The registry is an
    // exported table, so this reads the table rather than pinning source text.
    const { INTEGRATION_PANELS } = await import(
      '@/app/(dashboard)/integrations/_panels/registry'
    );
    const names = Object.keys(INTEGRATION_PANELS);
    expect(names).toContain('Stripe Connect');
    expect(names).toContain('Square');
    expect(names).toContain('Twilio Messages');
    expect(names).toContain('Bonzah');
    expect(names).toContain('BoldSign');
    expect(INTEGRATION_PANELS['Stripe Connect'].Panel).toBeTypeOf('function');
    expect(INTEGRATION_PANELS['Stripe Connect'].StatusChip).toBeTypeOf('function');

    // …and every card `settingsTabBoardCard` hands off to exists on it, or the
    // board silently opens nothing and the operator lands on a bare grid.
    for (const tab of ['messaging', 'esign', 'tesla']) {
      expect(names).toContain(settingsTabBoardCard(tab)!);
    }
    expect(SETTINGS_TAB_BOARD_ROUTE).toBe('/integrations');
  });

  it('keeps the Stripe onboarding edge functions wired to the panel', async () => {
    // The three functions that actually mint an onboarding URL. A panel that
    // renders but calls nothing is the same outcome as a 404.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const panel = readFileSync(
      join(__dirname, '../..', 'app/(dashboard)/integrations/_panels/stripe-connect.tsx'),
      'utf8',
    );
    // `payment_model` DEFAULTs to 'own' for a new tenant
    // (20260722140000_new_tenants_default_to_uae.sql), so the OAuth path is the
    // one a self-serve operator actually takes; the managed pair is kept for
    // the legacy Express tenants.
    expect(panel).toContain('stripe-oauth-start');
    expect(panel).toContain('create-connected-account');
    expect(panel).toContain('get-connect-onboarding-link');
  });
});

/* ────────────────────────── the resolver, executed ───────────────────────── */

const slug = { current: null as string | null };
const rows: Record<string, Record<string, unknown> | null> = {};
const throwOn = { current: null as string | null };
const errorFor = {
  current: null as ((columns: string) => { code?: string; message?: string } | null) | null,
};

vi.mock('@/lib/tenant-server', () => ({ tenantSlugFromHeaders: async () => slug.current }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    // The real one throws too — this is what strands an operator.
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: (_column: string, value: string) => ({
          single: async () => {
            if (throwOn.current === value) throw new Error('network down');
            const error = errorFor.current?.(columns) ?? null;
            if (error) return { data: null, error };
            return { data: rows[value] ?? null, error: null };
          },
        }),
      }),
    }),
  }),
}));

const { resolvePortalGates, serverIsV2 } = await import('@/lib/v2-server');
/** The REAL Server Component whose `notFound()` is the failure being tested. */
const IntegrationsPage = (await import('@/app/(dashboard)/integrations/page')).default;

/** Did the real route render, or did it 404? */
async function integrationsReachable(): Promise<boolean> {
  try {
    await IntegrationsPage();
    return true;
  } catch (e) {
    if (e instanceof Error && e.message === 'NEXT_NOT_FOUND') return false;
    throw e;
  }
}

describe('/integrations, executed — the route a self-serve tenant must be able to open', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    throwOn.current = null;
    errorFor.current = null;
    slug.current = null;
    for (const key of Object.keys(rows)) delete rows[key];
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it.each(ROW_ONLY)(
    '%s — row says v2, so the board RENDERS and the hidden tabs are safe',
    async (tenant) => {
      slug.current = tenant;
      rows[tenant] = { portal_experience: 'v2', primary_color: '#442DD7' };

      const gates = await resolvePortalGates();
      // Both halves of the risk, from ONE read, in one set of answers.
      expect(gates.onV2).toBe(true);
      expect(gates.lean).toBe(true);
      expect(gates.flags.appearance).toBe(true);
      expect(await serverIsV2('appearance')).toBe(true);

      // The route itself. This is the assertion that cannot be argued with:
      // the real component ran and did not 404.
      await expect(integrationsReachable()).resolves.toBe(true);

      // …while the tabs it replaces are hidden. Together: exactly one route to
      // Stripe, and it is open.
      for (const tab of BOARD_OWNED_TABS) {
        expect(isSettingsTabHidden(tab, gates.tenantSlug, gates.onV2)).toBe(true);
      }
    },
  );

  it('gives the tenant the v2 login, chrome, theme and dashboard as well', async () => {
    slug.current = 'nasir';
    rows['nasir'] = { portal_experience: 'v2' };

    const gates = await resolvePortalGates();
    // The four the report is actually about: the lead opened the portal link
    // and got the v1 login screen.
    for (const area of ['login', 'chrome', 'theme', 'dashboard'] as V2Area[]) {
      expect(gates.flags[area]).toBe(true);
    }
    // And the rest, so "v2" means the whole product rather than a subset.
    for (const area of V2_AREA_LIST) expect(gates.flags[area]).toBe(true);
  });

  it.each([
    ["the row says 'v1'", { portal_experience: 'v1' }],
    ['the column is NULL', { portal_experience: null }],
    ['the column was never selected (a missing GRANT)', { app_name: 'New Tenant' }],
    ['the value is one this build has never heard of', { portal_experience: 'v3' }],
    ['the case is wrong', { portal_experience: 'V2' }],
  ])('404s the board and hides NOTHING when %s', async (_label, row) => {
    slug.current = 'nasir';
    rows['nasir'] = row as Record<string, unknown>;

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    // The pair moves together in BOTH directions. A shut board with hidden
    // tabs is the stranded operator; an open board with visible tabs is merely
    // a duplicate screen, which is what v1 has today and is harmless.
    await expect(integrationsReachable()).resolves.toBe(false);
    for (const tab of BOARD_OWNED_TABS) {
      expect(isSettingsTabHidden(tab, 'nasir', gates.onV2)).toBe(false);
    }
  });

  it('404s the board and hides nothing when the READ THROWS', async () => {
    slug.current = 'nasir';
    rows['nasir'] = { portal_experience: 'v2' };
    throwOn.current = 'nasir';

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    await expect(integrationsReachable()).resolves.toBe(false);
  });

  it('404s the board and hides nothing when the GRANT IS MISSING', async () => {
    // 42501 on the column list that names `portal_experience`. The retry ladder
    // keeps the page (title, favicon, brand) and the gate answers v1 — so the
    // cost of a forgotten GRANT is "every tenant stays on the UI it has", never
    // "a tenant has its Stripe tabs hidden and the board shut".
    slug.current = 'nasir';
    rows['nasir'] = { app_name: 'Nasir', primary_color: '#442DD7' };
    errorFor.current = (columns) =>
      columns.includes('portal_experience')
        ? { code: '42501', message: 'permission denied for column portal_experience' }
        : null;

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    await expect(integrationsReachable()).resolves.toBe(false);
    for (const tab of BOARD_OWNED_TABS) {
      expect(isSettingsTabHidden(tab, 'nasir', gates.onV2)).toBe(false);
    }
  });

  it.each(V1_OPERATORS)('%s — an existing operator is untouched, board still 404s', async (tenant) => {
    slug.current = tenant;
    rows[tenant] = { portal_experience: 'v1', primary_color: '#1E293B' };

    const gates = await resolvePortalGates();
    expect(gates.onV2).toBe(false);
    expect(gates.lean).toBe(false);
    for (const area of V2_AREA_LIST) expect(gates.flags[area]).toBe(false);
    // The board was never theirs and still is not — `notFound()` is the same
    // 404 they got yesterday, when the route did not exist.
    await expect(integrationsReachable()).resolves.toBe(false);
    // And their Settings is byte-for-byte what it was: every tab visible.
    for (const tab of ['payments', 'messaging', 'insurance', 'esign', 'accounting', 'inshur', 'tesla']) {
      expect(isSettingsTabHidden(tab, tenant, gates.onV2)).toBe(false);
    }
  });

  it('does not let a flagged tenant leak the open board to the next request', async () => {
    // Same hazard as in portal-experience-gate.test.ts, asserted through the
    // ROUTE rather than the flags: if the read were memoised at module level,
    // a self-serve tenant resolving first would open `/integrations` for the
    // v1 operator that came next — and hide nothing, so it would read as "the
    // new UI randomly appears" rather than as an error.
    rows['nasir'] = { portal_experience: 'v2' };
    rows['revtekrentals'] = { portal_experience: 'v1' };

    slug.current = 'nasir';
    await expect(integrationsReachable()).resolves.toBe(true);

    slug.current = 'revtekrentals';
    await expect(integrationsReachable()).resolves.toBe(false);

    slug.current = 'nasir';
    await expect(integrationsReachable()).resolves.toBe(true);
  });
});

/* ───────────── 4. the brand colour a flag-only flip would leave ──────────── */

describe('the row flag alone does NOT make the portal look like Northwind', () => {
  /**
   * WHY THIS IS HERE. The v2 theme paints its whole chrome from one colour:
   * `light_primary_color || primary_color`, via `v2BrandVars` on <body>
   * (app/layout.tsx) and `use-dynamic-theme` after hydration. A tenant
   * provisioned by the OLD `signup-provision` carries the derived slate
   * #1E293B, and that colour is well inside `isUsableV2Brand` — so flipping
   * only `portal_experience` gives a structurally-correct v2 portal painted
   * dark slate, which does not look like the product anyone was shown.
   *
   * This is the whole reason the repair is THREE columns and not one.
   */
  it('#1E293B is a USABLE v2 brand, so a flag-only flip paints slate', () => {
    const hsl = hexToHsl('#1E293B');
    expect(hsl).not.toBeNull();
    expect(isUsableV2Brand(hsl!)).toBe(true);
    const vars = v2BrandVars('#1E293B');
    expect(vars).not.toBeNull();
    // Not indigo. `--brand-h` near 217 is the slate hue the old provisioner
    // derived; the v2 default is 248.
    expect(Number(vars!['--brand-h'])).toBeGreaterThan(200);
    expect(Number(vars!['--brand-h'])).toBeLessThan(235);
  });

  it('#442DD7 is the v2 default and paints the Northwind indigo', () => {
    const vars = v2BrandVars('#442DD7');
    expect(vars).not.toBeNull();
    expect(Number(vars!['--brand-h'])).toBeGreaterThan(240);
    expect(Number(vars!['--brand-h'])).toBeLessThan(256);
  });

  it('a null or unusable colour falls back to the stylesheet default', () => {
    // The fallback is what makes the brand columns a cosmetic repair rather
    // than a blocker: a missing colour is indigo, never a broken page.
    expect(v2BrandVars(null)).toBeNull();
    expect(v2BrandVars(undefined)).toBeNull();
    expect(v2BrandVars('')).toBeNull();
    expect(v2BrandVars('#020303')).toBeNull(); // northwind's saved near-black
  });
});
