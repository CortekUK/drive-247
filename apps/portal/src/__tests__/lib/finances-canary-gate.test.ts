/**
 * Finances — the canary gate, the redirects, and proof every other tenant is
 * untouched (docs/FINANCES_DESIGN.md §1).
 *
 * `finances` is the first SLUG-ONLY v2 area: northwind, and nobody else —
 * including the real v2 tenants whose row says `portal_experience = 'v2'`
 * (nasir, squad, every self-serve signup). They keep Payments, Invoices and
 * Fines until this has been reviewed on northwind.
 *
 * The three-case shape from V2_PLAN §10: the canary, real operators, and a
 * slug that does not exist — plus a fourth this area needs, the row-flagged
 * tenant, because it is the case every other area answers the other way.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isV2, NORTHWIND, SLUG_ONLY_AREAS, V2_AREA_LIST } from '@/lib/v2';
import { financesRedirectFor, LEGACY_FINANCE_HREFS } from '@/lib/finances-nav';
import { proxy } from '@/proxy';
import * as generated from '../../../../../supabase/functions/trax-support/support/portal-v2.generated.js';

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
];

/** Real v2 tenants on the ROW flag, not the slug list. */
const ROW_FLAGGED = ['nasir', 'squad', 'wings'];

describe('the finances area', () => {
  it('is in the area list the root layout resolves', () => {
    expect(V2_AREA_LIST).toContain('finances');
  });

  it('is on for the canary', () => {
    expect(isV2('finances', NORTHWIND)).toBe(true);
    expect(isV2('finances', NORTHWIND, true)).toBe(true);
    expect(isV2('finances', NORTHWIND, false)).toBe(true);
  });

  it.each(ROW_FLAGGED)('is NOT widened to %s by portal_experience = v2', (slug) => {
    expect(SLUG_ONLY_AREAS.has('finances')).toBe(true);
    expect(isV2('finances', slug, true), `${slug} would lose its Payments, Invoices and Fines tabs`).toBe(false);
  });

  it('leaves every other area row-widened exactly as before', () => {
    for (const area of V2_AREA_LIST) {
      if (SLUG_ONLY_AREAS.has(area)) continue;
      expect(isV2(area, 'wings', true), area).toBe(true);
    }
  });

  it.each(LIVE_OPERATORS)('refuses live operator %s', (slug) => {
    expect(isV2('finances', slug)).toBe(false);
    expect(isV2('finances', slug, false)).toBe(false);
  });

  it('refuses a slug that does not exist, and an unresolved tenant', () => {
    expect(isV2('finances', 'no-such-tenant-anywhere')).toBe(false);
    for (const slug of [null, undefined, '']) expect(isV2('finances', slug as string | null | undefined, true)).toBe(false);
  });

  it('is answered the same way by the copy TRAX support uses', () => {
    // supabase/functions/trax-support/support/portal-v2.generated.js is compiled
    // from lib/v2.ts by scripts/trax-knowledge.mjs --build.
    expect([...generated.V2_AREA_LIST].sort()).toEqual([...V2_AREA_LIST].sort());
    for (const slug of [NORTHWIND, ...LIVE_OPERATORS, ...ROW_FLAGGED]) {
      expect(generated.isV2('finances', slug, true), slug).toBe(isV2('finances', slug, true));
      expect(generated.isV2('finances', slug), slug).toBe(isV2('finances', slug));
    }
  });
});

describe('financesRedirectFor — the three list routes, and only them', () => {
  it('sends each old list to its view', () => {
    expect(financesRedirectFor('/payments')).toBe('/finances?view=received');
    expect(financesRedirectFor('/invoices')).toBe('/finances?view=billed');
    expect(financesRedirectFor('/fines')).toBe('/finances?view=fines');
    expect(financesRedirectFor('/fines/')).toBe('/finances?view=fines');
    expect(LEGACY_FINANCE_HREFS).toEqual(['/payments', '/invoices', '/fines']);
  });

  it.each([
    '/payments/5b0c9f2e-1111-2222-3333-444455556666',
    '/payments/analytics',
    '/fines/new',
    '/fines/analytics',
    '/fines/5b0c9f2e-1111-2222-3333-444455556666',
    '/finances',
    '/rentals',
    '/',
    '/paymentsx',
  ])('leaves %s alone', (path) => {
    expect(financesRedirectFor(path)).toBeNull();
  });

  it('carries a deep link across', () => {
    // The notifications centre links to /payments?status=pending.
    expect(financesRedirectFor('/payments', 'status=pending')).toBe('/finances?view=received&status=pending_review');
    expect(financesRedirectFor('/payments', 'verificationStatus=rejected&method=Cash')).toBe(
      '/finances?view=received&status=rejected&method=Cash',
    );
    expect(financesRedirectFor('/fines', 'status=Open&search=ABC123')).toBe('/finances?view=fines&q=ABC123&status=Open');
    expect(financesRedirectFor('/invoices', new URLSearchParams('invoice=abc'))).toBe('/finances?view=billed');
  });

  it("never carries Next's internal _rsc key, or an unknown status", () => {
    expect(financesRedirectFor('/payments', '_rsc=abc123&status=weird')).toBe('/finances?view=received');
  });
});

describe('proxy.ts — redirects for the canary, nothing for anyone else', () => {
  const run = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));

  it('redirects the canary from each old list', async () => {
    for (const [path, view] of [
      ['/payments', 'received'],
      ['/invoices', 'billed'],
      ['/fines', 'fines'],
    ]) {
      const res = await run('northwind.portal.drive-247.com', path);
      expect(res.status, path).toBe(307);
      const to = new URL(res.headers.get('location')!);
      expect(to.host).toBe('northwind.portal.drive-247.com');
      expect(to.pathname).toBe('/finances');
      expect(to.searchParams.get('view')).toBe(view);
    }
  });

  it("leaves the canary's detail pages alone", async () => {
    for (const path of ['/payments/abc', '/fines/new', '/fines/abc', '/payments/analytics']) {
      const res = await run('northwind.portal.drive-247.com', path);
      expect(res.headers.get('location'), path).toBeNull();
      expect(res.headers.get('x-middleware-next'), path).toBe('1');
    }
  });

  it.each([...LIVE_OPERATORS, ...ROW_FLAGGED])('does not redirect %s', async (slug) => {
    for (const path of ['/payments', '/invoices', '/fines']) {
      const res = await run(`${slug}.portal.drive-247.com`, path);
      expect(res.headers.get('location'), `${slug}${path}`).toBeNull();
      expect(res.headers.get('x-middleware-next')).toBe('1');
    }
  });

  it('does not redirect a host with no tenant', async () => {
    const res = await run('portal.drive-247.com', '/payments');
    expect(res.headers.get('location')).toBeNull();
  });
});
