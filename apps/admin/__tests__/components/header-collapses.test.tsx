/**
 * The top bar takes no room when it has nothing to say.
 *
 * Reported Sep 25 2026 as dead space at the top of every page, with the empty
 * band scribbled out in red. It was the header: `h-14`, so 56px, and on a
 * top-level page on a desktop it rendered a hidden menu button, no breadcrumb
 * trail, and a `flex-1` spacer. Fifty-six pixels of nothing, pushing every
 * page title down the screen.
 *
 * Two things have to stay true for that not to come back, and they pull in
 * opposite directions — which is why this is a test rather than a comment:
 *
 *   1. A phone still needs the row, because the menu button in it is the only
 *      way to reach the navigation there.
 *   2. A DETAIL page still needs it at every width, because the first crumb is
 *      the only way back to the list that is not the browser's own Back.
 *
 * So the row collapses on exactly one axis — wide viewport, no trail — and
 * this mounts it on both kinds of route to prove which class it lands on.
 *
 * jsdom does not apply media queries, so `md:hidden` is asserted as a class
 * rather than as a computed display. The computed side was measured in Chrome
 * against /admin/preview: 0px tall at 1440 wide, 56px at 390, with the content
 * heading moving from 80px down the page to 24px.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pathname = vi.hoisted(() => ({ current: '/admin/rentals' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { Header } from '@/components/admin/Header';
import { SidebarProvider } from '@/components/admin/SidebarContext';

const ROOT = resolve(__dirname, '../..');
const src = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

function mountAt(path: string) {
  pathname.current = path;
  render(
    <SidebarProvider>
      <Header />
    </SidebarProvider>,
  );
  return document.querySelector('header')!;
}

describe('the top bar does not hold empty space open', () => {
  afterEach(cleanup);

  it('collapses on a desktop when a top-level page gives it no trail', () => {
    const header = mountAt('/admin/rentals');
    // Rental Companies is one crumb — its own name, with no href, directly
    // above an <h1> that says the same thing. Nothing worth 56px.
    expect(header.className).toContain('md:hidden');
  });

  it('stays on a detail page, where the first crumb is the way back', () => {
    const header = mountAt('/admin/rentals/tenant-1');
    expect(header.className).not.toContain('md:hidden');
    // And it really is a link, not a label.
    expect(screen.getByRole('link', { name: /rental companies/i })).toBeTruthy();
  });

  it('keeps its height class so the trail has a row to sit in', () => {
    expect(mountAt('/admin/rentals/tenant-1').className).toContain('h-14');
  });

  it('always renders the menu button, gated by CSS rather than by JS', () => {
    // `useIsMobile` is false on the first client render and flips in an
    // effect. Gating the button on it dropped a 56px row in after hydration
    // and shoved the page down as it landed — so the button is always in the
    // DOM and `md:hidden` decides whether it shows.
    const header = mountAt('/admin/rentals');
    const menu = screen.getByRole('button', { name: /toggle menu/i });
    expect(header.contains(menu)).toBe(true);
    expect(menu.className).toContain('md:hidden');

    const source = src('components/admin/Header.tsx');
    expect(source).not.toMatch(/\{isMobile &&/);
  });
});

/*
 * One vertical rhythm, everywhere.
 *
 * The brief asked for this "across every single page and module", and the
 * pages that were out of step were out of step by 8px — `mb-8` under a
 * heading where every other page uses the 24px that `space-y-6` gives. Small
 * enough to never be noticed one page at a time, and the reason the app read
 * as loose at the top.
 */
describe('pages share one vertical rhythm', () => {
  const pages = [
    'app/admin/(protected)/dashboard/page.tsx',
    'app/admin/(protected)/contacts/page.tsx',
    'app/admin/(protected)/blacklist/page.tsx',
  ];

  it.each(pages)('%s spaces its header like the rest of the app', (page) => {
    // `mb-8` is the odd one out; the rest of the app is `space-y-6`/`mb-6`.
    expect(src(page)).not.toContain('mb-8');
  });

  it('puts search above the stat cards on blacklist, not below them', () => {
    const s = src('app/admin/(protected)/blacklist/page.tsx');
    const search = s.indexOf('<FilterSearch');
    const stats = s.indexOf('Total Blocked');
    expect(search).toBeGreaterThan(-1);
    expect(stats).toBeGreaterThan(-1);
    // Title → search → data, the same order as every other list.
    expect(search).toBeLessThan(stats);
  });
});
