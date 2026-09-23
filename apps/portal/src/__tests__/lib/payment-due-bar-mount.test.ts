/**
 * WHERE the phone dunning bar is mounted, and why it may not sit between the
 * header and <main>.
 *
 * `main` carries, for v2 chrome only:
 *
 *     md:[header+&]:pt-0  md:[header+&>*:first-child]:-mt-3.5
 *
 * which is the rule that puts a page's title row on the same line as the
 * Portal/Website switch in the sidebar (measured at 92px — see the long note
 * above `<main>` in `(dashboard)/layout.tsx`). The 14px pull-up sits on main's
 * FIRST CHILD rather than on main since the v2 fixed frame (Sep 23 2026): main
 * is the scroll container now, a scrollport is the padding box, and pulling
 * main itself up would start that scrollport above the top bar's bottom edge
 * and let rows scroll into the strip behind it. Both halves are deliberately
 * ADJACENT sibling rules: when a maintenance or deposit banner is showing
 * between the top bar and main, main keeps its normal spacing instead of
 * sliding under the banner.
 *
 * ADJACENCY IS STRUCTURAL. `header + main` stops matching the moment any element
 * exists between the two — `display: none` does not exempt it. `PaymentDueBar`
 * is `md:hidden`, so at desktop widths it is a zero-height invisible anchor, and
 * mounting it below the header silently cancelled the alignment for the whole
 * grace window at every width >= 768px, with no banner on screen to justify it.
 *
 * Measured in headless Chrome on the real layout at 1280px (light and dark), a
 * tenant three days into dunning:
 *
 *     bar below the header   main -> padding-top 16px, margin-top 0px
 *     bar above the header   main -> padding-top 0px,  margin-top -14px
 *
 * i.e. every page's content sat 30px low, only while the tenant was in dunning.
 * A healthy tenant was unaffected, which is exactly what makes it the kind of
 * thing nobody would find by clicking around.
 *
 * So: the bar renders ABOVE the header row, as the first child of `<Inset>`.
 * That keeps `header + main` intact in every billing state, and the bar is still
 * in flow (never `fixed`), still full-bleed, and still the top thing on a phone.
 *
 * Source-order assertions, because `(dashboard)/layout.tsx` has no other test
 * that renders it — the same approach `announcement-layout-mounts.test.ts` takes
 * for the announcement surfaces.
 */

import { describe, it, expect } from 'vitest';

import { codeOnly, readPortalSource } from '../helpers/edge-source';

const RAW = readPortalSource('app/(dashboard)/layout.tsx');
const SRC = codeOnly(RAW);

const at = (needle: string | RegExp) => {
  const i = typeof needle === 'string' ? SRC.indexOf(needle) : SRC.search(needle);
  expect(i, `layout.tsx should contain ${String(needle)}`).toBeGreaterThan(-1);
  return i;
};

describe('PaymentDueBar is mounted where it cannot break the v2 alignment', () => {
  it('is mounted exactly once, in the layout', () => {
    expect(SRC).toContain(
      'import { PaymentDueBar } from "@/components/subscription/payment-due-bar";',
    );
    expect(SRC.split('<PaymentDueBar ').length - 1).toBe(1);
  });

  it('the alignment rule it must not break is still there, and still ADJACENT', () => {
    // If this ever becomes a general-sibling rule (`[header~&]`) the constraint
    // below stops being load-bearing — but so does the deliberate
    // "keep today's spacing when a banner is in between" behaviour. Either way
    // this test should be revisited rather than deleted.
    expect(SRC).toContain('md:[header+&]:pt-0');
    expect(SRC).toContain('md:[header+&>*:first-child]:-mt-3.5');
    // Never back on `main` itself: that is the form that puts the scrollport
    // 14px above the bar and re-opens the seam the fixed frame closed.
    expect(SRC).not.toContain('md:[header+&]:-mt-3.5');
  });

  it('renders ABOVE the v2 top bar', () => {
    expect(at('<PaymentDueBar ')).toBeLessThan(at('<TopBarV2 showNavTrigger='));
  });

  it('renders ABOVE the v1 header', () => {
    expect(at('<PaymentDueBar ')).toBeLessThan(at('<header className="flex h-16 shrink-0'));
  });

  it('is the FIRST child of <Inset>, so nothing can drift in above it', () => {
    // Anything mounted between the opening <Inset> tag and the bar would end up
    // between the header and main again the day it grows a wrapper element.
    const inset = at(/<Inset\b/);
    const bar = at('<PaymentDueBar ');
    // Everything between the <Inset ...> opening tag and the bar, with JSX
    // comments stripped: no other element may live there.
    const between = SRC.slice(inset, bar)
      .replace(/^<Inset\b[^>]*>/, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(between.trim()).toBe('');
  });

  it('still sits above the two legacy banners and above <main>', () => {
    const bar = at('<PaymentDueBar ');
    expect(bar).toBeLessThan(at('<MaintenanceBanner />'));
    expect(bar).toBeLessThan(at('<AppBannerStack scope="app" />'));
    expect(bar).toBeLessThan(at(/<main\b/));
  });

  it('is inside <Inset>, not above it — it must scroll with the page, not float', () => {
    // Above <Inset> it would span the sidebar column too, which is
    // SystemAnnouncementBanner's job (fixed, with its own --system-banner-h
    // offsets that global.css applies to the chrome).
    expect(at('<PaymentDueBar ')).toBeGreaterThan(at(/<Inset\b/));
    expect(at('<PaymentDueBar ')).toBeLessThan(at('</Inset>'));
  });

  /**
   * `allWidths` must be true for EXACTLY the two routes whose chrome mounts no
   * sidebar — and therefore no billing chip. Anywhere else it would put the bar
   * and the chip on screen together.
   */
  it('opts in exactly the two sidebar-less routes, and no others', () => {
    const tag = SRC.slice(at('<PaymentDueBar '), at('<PaymentDueBar ') + 200);
    expect(tag).toContain('allWidths={isMessagesWorkspace || isTraxWorkspace}');
  });
});
