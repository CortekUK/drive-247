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

  /*
   * This used to be four tests about WHEN the row collapsed: hidden on a
   * top-level page, kept on a detail page so the first crumb could be the way
   * back, and the menu button gated by CSS rather than by the `isMobile` flag.
   *
   * Breadcrumbs were removed globally on Sep 26 2026, so there is no longer a
   * route where the row has anything to show. It is `md:hidden` outright, and
   * the phone keeps it for the menu button. The "detail page keeps its trail"
   * case is gone with the trail.
   */
  it('collapses on every desktop route, because it has nothing to carry', () => {
    for (const path of ['/admin/rentals', '/admin/rentals/tenant-1', '/admin/dashboard']) {
      cleanup();
      expect(mountAt(path).className, path).toContain('md:hidden');
    }
  });

  it('keeps the phone its menu button', () => {
    mountAt('/admin/rentals');
    expect(screen.getByRole('button', { name: /toggle menu/i })).toBeTruthy();
  });

  it('shows no breadcrumb on any route', () => {
    for (const path of ['/admin/rentals', '/admin/rentals/tenant-1']) {
      cleanup();
      const header = mountAt(path);
      expect(header.querySelector('nav'), path).toBeNull();
      expect(header.textContent?.trim(), path).toBe('');
    }
  });

  it('does not gate the row on a flag that flips after hydration', () => {
    // `useIsMobile` is false on the first client render. Gating a 56px row on
    // it dropped the button in after hydration and shoved the page down.
    expect(src('components/admin/Header.tsx')).not.toMatch(/\{isMobile &&/);
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
