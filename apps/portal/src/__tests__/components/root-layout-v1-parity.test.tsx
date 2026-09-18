/**
 * A v1 tenant's root document, byte for byte.
 *
 * The v2 switch moved onto the tenant row (`tenants.portal_experience`), which
 * means the root layout now reads that row for EVERY tenant instead of only for
 * a v2-theme one. The promise that had to survive that is narrow and absolute:
 * a tenant on v1 renders exactly what it rendered before — same <html> class,
 * same <head>, the v1 localStorage anti-flash script still first, no theme
 * class on <body>, no brand style attribute.
 *
 * So this renders the whole document to static markup and pins it. A snapshot
 * would do the same job less usefully: the string below was CAPTURED FROM THE
 * PRE-CHANGE IMPLEMENTATION (commit 998a5763, before `portal_experience`
 * existed) by running this same render against it, so the assertion is a
 * comparison with the old behaviour and not with itself.
 *
 * If this fails, do not update the string. It means a v1 tenant's first paint
 * changed, and ~56 live operators are on v1.
 */
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const slug = { current: null as string | null };
const row = { current: null as Record<string, string | null> | null };

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-tenant-slug' ? slug.current : null) }),
}));
vi.mock('@/lib/tenant-server', () => ({ tenantSlugFromHeaders: async () => slug.current }));
vi.mock('next/font/google', () => ({ Manrope: () => ({ variable: 'manrope-var' }) }));
vi.mock('@/app/providers', () => ({ Providers: () => null }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: row.current, error: null }) }),
      }),
    }),
  }),
}));

import RootLayout from '@/app/layout';

/**
 * The v1 document as commit 998a5763 rendered it.
 *
 * `Providers` is stubbed to null so this is the shell the layout itself owns,
 * which is the only part the gate change could have touched.
 */
const V1_DOCUMENT =
  '<html lang="en"><head><meta charSet="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>' +
  '<link rel="preconnect" href="https://fonts.googleapis.com"/>' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>' +
  '<script>\n(function() {\n  try {\n    var cached = localStorage.getItem(\'portal-tenant-branding-css\');\n' +
  '    if (cached) {\n      var style = document.createElement(\'style\');\n      style.id = \'cached-branding\';\n' +
  '      style.textContent = cached;\n      document.head.appendChild(style);\n    }\n  } catch(e) {}\n})();\n</script>' +
  '</head><body></body></html>';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  row.current = null;
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const render = async () =>
  renderToStaticMarkup((await RootLayout({ children: null })) as ReactElement);

describe("a v1 tenant's document is unchanged", () => {
  it("renders the pre-change shell when the column says 'v1'", async () => {
    slug.current = 'revtekrentals';
    row.current = {
      app_name: 'RevTek',
      primary_color: '#0F766E',
      light_primary_color: '#0F766E',
      portal_experience: 'v1',
    };
    expect(await render()).toBe(V1_DOCUMENT);
  });

  it('renders the pre-change shell when the column is NULL or absent', async () => {
    slug.current = 'goniko';
    for (const r of [
      { app_name: 'Goniko', primary_color: '#0F766E', portal_experience: null },
      { app_name: 'Goniko', primary_color: '#0F766E' },
    ]) {
      row.current = r;
      expect(await render()).toBe(V1_DOCUMENT);
    }
  });

  it('renders the pre-change shell when the row or the tenant does not exist', async () => {
    slug.current = 'no-such-tenant-anywhere';
    row.current = null;
    expect(await render()).toBe(V1_DOCUMENT);

    slug.current = null;
    expect(await render()).toBe(V1_DOCUMENT);
  });

  it('keeps a saved brand colour OFF a v1 tenant, however real the colour is', async () => {
    // The v1 theme takes its colour from the cached localStorage CSS, not from
    // <body>. Painting the brand vars here would change every v1 tenant's first
    // paint — which is what the flag is for.
    slug.current = 'globalmotiontransport';
    row.current = {
      app_name: 'GMT',
      primary_color: '#442DD7',
      light_primary_color: '#442DD7',
      portal_experience: 'v1',
    };
    const html = await render();
    expect(html).toBe(V1_DOCUMENT);
    expect(html).not.toContain('--brand-h');
    expect(html).not.toContain('v2-theme');
  });
});

describe("a v2 tenant's document differs in exactly the intended ways", () => {
  it('a flagged tenant gets the theme class, the font and the brand vars', async () => {
    slug.current = 'wings';
    row.current = {
      app_name: 'Wings',
      primary_color: '#442DD7',
      light_primary_color: '#442DD7',
      portal_experience: 'v2',
    };
    const html = await render();

    // …and only those ways: same head links, no anti-flash script.
    expect(html).toContain('<html lang="en" class="manrope-var">');
    expect(html).toContain('class="v2-theme"');
    expect(html).toContain('--brand-h:248');
    expect(html).toContain('--brand-s:68%');
    expect(html).toContain('--brand-l:51%');
    expect(html).not.toContain('portal-tenant-branding-css');
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Inter');
  });

  it('northwind gets the same document with no column at all', async () => {
    slug.current = 'northwind';
    row.current = { app_name: 'Northwind', primary_color: '#442DD7', light_primary_color: '#442DD7' };
    const withList = await render();

    slug.current = 'wings';
    row.current = {
      app_name: 'Wings',
      primary_color: '#442DD7',
      light_primary_color: '#442DD7',
      portal_experience: 'v2',
    };
    expect(await render()).toBe(withList);
  });
});
