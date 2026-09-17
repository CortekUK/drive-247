/**
 * First paint of the v2 brand colour (src/app/layout.tsx).
 *
 * use-dynamic-theme writes the brand vars after hydration, so without a server
 * copy a v2 tenant with a saved colour would paint indigo and then switch. The
 * root layout therefore puts the same vars on <body style> — for the v2 theme
 * only. Every other tenant must render exactly as before: no style attribute,
 * no brand columns in the metadata query, and the v1 anti-flash script kept.
 */
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const slug = { current: null as string | null };
const selects: string[] = [];
const row = { current: null as Record<string, string | null> | null };
const fail = { current: false };

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

const METADATA_COLUMNS = 'app_name, company_name, meta_title, meta_description, favicon_url, og_image_url';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  selects.length = 0;
  fail.current = false;
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
    expect(body.props.style).toEqual({
      '--brand-h': '175',
      '--brand-s': '77%',
      '--brand-l': '26%',
      '--brand-fg-dark': '0 0% 3.9%',
    });
    expect(selects).toContain(`${METADATA_COLUMNS}, primary_color, light_primary_color`);
    // v2 takes its colour from <body>, not v1's cached :root CSS.
    expect(find(html, 'script')).toBeNull();
  });

  it('asks for the brand columns in the same shape metadata does, so the two share one read', async () => {
    slug.current = 'northwind';
    row.current = { app_name: 'Northwind', light_primary_color: '#0F766E' };
    await generateMetadata();
    await RootLayout({ children: null });
    expect(new Set(selects)).toEqual(new Set([`${METADATA_COLUMNS}, primary_color, light_primary_color`]));
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

  it('v1 tenants: no query from the layout, no style, the anti-flash script kept', async () => {
    slug.current = 'moore-luxe-rentals';
    row.current = { app_name: 'Moore Luxe', primary_color: '#0F766E' };

    const html = await RootLayout({ children: null });
    const body = find(html, 'body')!;
    expect(body.props.style).toBeUndefined();
    expect(body.props.className).toBeUndefined();
    expect(selects).toEqual([]);
    expect(find(html, 'script')).not.toBeNull();

    // Metadata still reads exactly the columns it always did.
    await generateMetadata();
    expect(selects).toEqual([METADATA_COLUMNS]);
  });
});
