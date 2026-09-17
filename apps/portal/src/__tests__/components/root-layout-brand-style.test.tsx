/**
 * First paint of the v2 brand colour, and the ONE tenant read behind it
 * (src/app/layout.tsx + src/lib/portal-tenant.ts + src/lib/v2-server.ts).
 *
 * use-dynamic-theme writes the brand vars after hydration, so without a server
 * copy a v2 tenant with a saved colour would paint indigo and then switch. The
 * root layout therefore puts the same vars on <body style> — for the v2 theme
 * only. Every other tenant must render exactly as before: no style attribute,
 * no theme class, and the v1 anti-flash script kept.
 *
 * WHAT CHANGED ON Sep 17 2026, and why the column list here is now fixed.
 * A tenant is on v2 when its slug is in `V2_AREAS` OR its row says
 * `portal_experience = 'v2'`. The second is what makes a self-serve signup land
 * on v2 — a tenant that does not exist yet cannot be in a list compiled at
 * build time. But the flag is IN the row, so `withBrand` (the old "only select
 * the colour columns for a v2-theme tenant" argument) became circular: you
 * cannot know whether to ask for the brand columns until you have read the
 * column that tells you, and reading twice is the thing being avoided.
 *
 * So the SELECT is fixed for every tenant and the brand PAINT stays behind the
 * resolved flag. What this file pins is that the widening cost one round trip,
 * not two, and that a v1 tenant's rendered output is unchanged.
 */
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const slug = { current: null as string | null };
const selects: string[] = [];
const row = { current: null as Record<string, string | null> | null };
const fail = { current: false };
/** When set, any select naming this column answers with this PostgREST error. */
const refuseColumn = { current: null as { column: string; code: string } | null };

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-tenant-slug' ? slug.current : null) }),
}));
vi.mock('@/lib/tenant-server', () => ({ tenantSlugFromHeaders: async () => slug.current }));
vi.mock('next/font/google', () => ({ Manrope: () => ({ variable: 'manrope-var' }) }));
vi.mock('@/app/providers', () => ({ Providers: ({ children }: { children: ReactNode }) => children }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        return {
          eq: () => ({
            single: async () => {
              if (fail.current) throw new Error('network down');
              const refuse = refuseColumn.current;
              if (refuse && columns.includes(refuse.column)) {
                return {
                  data: null,
                  error: {
                    code: refuse.code,
                    message: `column tenants.${refuse.column} does not exist`,
                  },
                };
              }
              return { data: row.current, error: null };
            },
          }),
        };
      },
    }),
  }),
}));

import RootLayout, { generateMetadata } from '@/app/layout';

type El = ReactElement<{ children?: ReactNode; style?: Record<string, string>; className?: string }>;

/** Depth-first search of a server-rendered element tree for a host element. */
function find(node: ReactNode, type: string): El | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as El;
  if (el.type === type) return el;
  return find(el.props?.children, type);
}

/** What `generateMetadata` and the brand paint have always needed, together. */
const PORTAL_COLUMNS =
  'app_name, company_name, meta_title, meta_description, favicon_url, og_image_url, primary_color, light_primary_color';
/** …plus the v2 switch. One SELECT, shared by metadata, the paint and the gates. */
const FULL_COLUMNS = `${PORTAL_COLUMNS}, portal_experience`;

/** Teal, so it is distinguishable from the v2 default purple. 175 77% 26%. */
const TEAL_VARS = {
  '--brand-h': '175',
  '--brand-s': '77%',
  '--brand-l': '26%',
  '--brand-fg-dark': '0 0% 3.9%',
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  selects.length = 0;
  fail.current = false;
  refuseColumn.current = null;
  row.current = null;
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe('root layout — v2 brand colour on first paint', () => {
  it('puts the brand vars on <body> for the v2 theme', async () => {
    slug.current = 'northwind';
    // #0F766E -> 175 77% 26%, near-black text on the dark-mode primary
    // (worked in __tests__/lib/v2-brand-vars.test.ts).
    row.current = { app_name: 'Northwind', primary_color: '#442DD7', light_primary_color: '#0F766E' };

    const html = await RootLayout({ children: null });
    const body = find(html, 'body')!;
    expect(body.props.className).toBe('v2-theme');
    expect(body.props.style).toEqual(TEAL_VARS);
    expect(selects).toContain(FULL_COLUMNS);
    // v2 takes its colour from <body>, not v1's cached :root CSS.
    expect(find(html, 'script')).toBeNull();
  });

  it('asks for the brand columns in the same shape metadata does, so the two share one read', async () => {
    slug.current = 'northwind';
    row.current = { app_name: 'Northwind', light_primary_color: '#0F766E' };
    await generateMetadata();
    await RootLayout({ children: null });
    expect(new Set(selects)).toEqual(new Set([FULL_COLUMNS]));
  });

  it('fails open to the stylesheet defaults when the read throws or there is no colour', async () => {
    slug.current = 'northwind';
    fail.current = true;
    let body = find(await RootLayout({ children: null }), 'body')!;
    expect(body.props.style).toBeUndefined();

    fail.current = false;
    row.current = { app_name: 'Northwind', primary_color: null, light_primary_color: null };
    body = find(await RootLayout({ children: null }), 'body')!;
    expect(body.props.style).toBeUndefined();
    expect(body.props.className).toBe('v2-theme');
  });

  it('v1 tenants: one shared read, no style, no theme class, the anti-flash script kept', async () => {
    slug.current = 'moore-luxe-rentals';
    row.current = {
      app_name: 'Moore Luxe',
      primary_color: '#0F766E',
      portal_experience: 'v1',
    };

    const html = await RootLayout({ children: null });
    const body = find(html, 'body')!;
    expect(body.props.style).toBeUndefined();
    expect(body.props.className).toBeUndefined();
    expect(find(html, 'script')).not.toBeNull();

    // The layout DOES read the row now — it has to, because the gate is in the
    // row — but metadata's read and this one are the same cached read, so the
    // request still makes exactly ONE round trip and it names one column list.
    await generateMetadata();
    expect(new Set(selects)).toEqual(new Set([FULL_COLUMNS]));
  });
});

/**
 * The column, executed end to end through the layout.
 *
 * These are the cases the slug list could not have: a tenant that is in no list
 * at all and is switched over entirely by its row.
 */
describe('root layout — portal_experience', () => {
  it("paints a tenant with portal_experience = 'v2' that is in no slug list", async () => {
    slug.current = 'wings';
    row.current = {
      app_name: 'Wings',
      primary_color: '#442DD7',
      light_primary_color: '#0F766E',
      portal_experience: 'v2',
    };

    const html = await RootLayout({ children: null });
    const body = find(html, 'body')!;
    expect(body.props.className).toBe('v2-theme');
    expect(body.props.style).toEqual(TEAL_VARS);
    // No v1 anti-flash script: that injects v1's :root tokens.
    expect(find(html, 'script')).toBeNull();
  });

  it.each([
    ['v1', 'v1'],
    ['V2 — case-exact', 'V2'],
    ['a future value this build has never heard of', 'v3'],
    ['empty', ''],
  ])('leaves a tenant on v1 when the column says %s', async (_label, value) => {
    slug.current = 'wings';
    row.current = { app_name: 'Wings', light_primary_color: '#0F766E', portal_experience: value };

    const html = await RootLayout({ children: null });
    const body = find(html, 'body')!;
    expect(body.props.className).toBeUndefined();
    expect(body.props.style).toBeUndefined();
    expect(find(html, 'script')).not.toBeNull();
  });

  it('leaves a tenant on v1 when the column is NULL, absent, or the row does not exist', async () => {
    slug.current = 'wings';

    for (const r of [
      { app_name: 'Wings', portal_experience: null },
      { app_name: 'Wings' },
      null,
    ] as (Record<string, string | null> | null)[]) {
      row.current = r;
      const body = find(await RootLayout({ children: null }), 'body')!;
      expect(body.props.className).toBeUndefined();
      expect(body.props.style).toBeUndefined();
    }
  });

  it('keeps every tenant their metadata when the column is not readable yet', async () => {
    // THE DEPLOY-ORDER CASE. `anon` holds COLUMN-level SELECT grants on
    // `tenants`, so a column it cannot read does not come back null — Postgres
    // refuses the ENTIRE row. A deploy that lands before the SQL would
    // otherwise cost every tenant their <title>, favicon and OG image on every
    // page. The read drops the column and retries the list it used to send.
    slug.current = 'moore-luxe-rentals';
    refuseColumn.current = { column: 'portal_experience', code: '42703' };
    row.current = { app_name: 'Moore Luxe', meta_title: 'Moore Luxe — Portal' };

    const meta = await generateMetadata();
    expect(meta.title).toBe('Moore Luxe — Portal');
    expect(selects).toEqual([FULL_COLUMNS, PORTAL_COLUMNS]);

    // …and the tenant resolves to v1, because the flag came back undefined.
    const body = find(await RootLayout({ children: null }), 'body')!;
    expect(body.props.className).toBeUndefined();
  });

  it('retries on a missing GRANT too, not just a missing column', async () => {
    slug.current = 'moore-luxe-rentals';
    refuseColumn.current = { column: 'portal_experience', code: '42501' };
    row.current = { app_name: 'Moore Luxe', meta_title: 'Moore Luxe — Portal' };

    const meta = await generateMetadata();
    expect(meta.title).toBe('Moore Luxe — Portal');
    expect(selects).toEqual([FULL_COLUMNS, PORTAL_COLUMNS]);
  });
});
