/**
 * THE V2 FIXED FRAME (Sep 23 2026).
 *
 * Team lead, with a screenshot of the portal's top-left: "the sidebar heading
 * is fixed and scrolling begins after it. Make the main view's top bar fixed
 * the same way, so it doesn't look odd, and scrolling starts below it. That
 * also solves the line problem we keep seeing."
 *
 * So, for v2 chrome only:
 *
 *   <Provider h-svh overflow-hidden data-bounded-height>   the shell, one viewport
 *     <Sidebar>                                            fixed header, scrolling menu
 *     <Inset>                                              a full-height column
 *       <PaymentDueBar/>  <TopBarV2/>  <banners/>          non-scrolling rows
 *       <main data-scrollport overflow-y-auto min-h-0>     THE ONLY SCROLL CONTAINER
 *
 * Nothing passes under the top bar any more, which is what ended the "line":
 * the seam was the edge of the blurred veil the bar painted to hide the rows
 * sliding beneath it (see top-bar-v2-layout.test.tsx).
 *
 * `(dashboard)/layout.tsx` has no test that renders it — it is a client
 * component wrapping a dozen providers — so the frame is pinned at the source,
 * the same way `announcement-layout-mounts.test.ts` and
 * `payment-due-bar-mount.test.ts` pin what they own. The arithmetic it rests on
 * is exercised for real in `scrollport.test.ts` and `list-table-v2.test.tsx`.
 */
import { describe, it, expect } from 'vitest';

import { codeOnly, readPortalSource } from '../helpers/edge-source';

const layout = codeOnly(readPortalSource('app/(dashboard)/layout.tsx'));
const topBar = codeOnly(readPortalSource('components/shared/layout/top-bar-v2.tsx'));
const globalCss = readPortalSource('global.css');

/** The `<main ...>` opening tag, attributes and class expression included. */
const mainTag = (() => {
  const i = layout.indexOf('<main');
  expect(i, 'layout.tsx should render a <main>').toBeGreaterThan(-1);
  return layout.slice(i, layout.indexOf('>\n', i));
})();

describe('the shell is bounded to one viewport and does not scroll', () => {
  it('bounds the wrapper for every v2 route, not just the three workspaces', () => {
    expect(layout).toContain('const v2FixedFrame = v2Chrome;');
    expect(layout).toContain('const boundedShell = isBoundedHeight || v2FixedFrame;');
    expect(layout).toContain('boundedShell ? "h-svh overflow-hidden" : ""');
    // `svh`, the unit the bounded workspaces already used: `100vh` on a phone
    // is the viewport WITHOUT the address bar, so the frame would hang its last
    // rows below the fold until the bar hid itself.
    expect(layout).not.toContain('h-[100vh]');
    expect(layout).not.toContain('h-dvh');
  });

  it('keeps the system banner arithmetic: a bounded wrapper loses the banner height', () => {
    // The banner is `position: fixed` with an in-flow spacer. Without this the
    // spacer pushes an `h-svh` wrapper down by the banner's height and the
    // document scrolls by exactly that much — which is how Messages found it,
    // and is now true of every v2 route.
    expect(layout).toContain('data-bounded-height={boundedShell ? "" : undefined}');
    expect(globalCss).toMatch(
      /html\[data-system-banner\] \[data-bounded-height\] \{\s*height: calc\(100svh - var\(--system-banner-h, 0px\)\);\s*\}/,
    );
    // And the rule that moved the bar down while it was sticky is gone: the bar
    // is a row inside a wrapper that already starts below the banner.
    expect(globalCss).not.toContain('[data-slot="sidebar-inset"] > header');
  });
});

describe('<main> is the only scroll container', () => {
  it('scrolls, with the floor that makes that possible', () => {
    // `min-h-0`: a flex item's `min-height: auto` floors it at its CONTENT
    // height, and that floor beats `flex-1`, so without it main grows past the
    // bounded shell and the frame clips long pages instead of scrolling them.
    expect(mainTag).toContain('min-h-0 min-w-0 overflow-y-auto overflow-x-hidden');
  });

  it('is marked as the scrollport the measurers ask, for v2 only', () => {
    expect(mainTag).toContain('data-scrollport={v2FixedFrame ? "" : undefined}');
  });

  it('is focusable, so the keys that scrolled the window still scroll the page', () => {
    // A scrollable element only answers Page Down / Space / Home / End when
    // focus is inside it. `tabIndex={-1}` lets a click anywhere in the content
    // land focus on it, and the layout's effect puts focus there on arrival.
    expect(mainTag).toContain('tabIndex={v2FixedFrame && !isBoundedHeight ? -1 : undefined}');
    expect(mainTag).toContain('outline-none');
    expect(layout).toContain('node.focus({ preventScroll: true });');
    // A ref CALLBACK, not only a route effect: four early returns mean `main`
    // mounts a beat after `pathname` last changed on a cold load, so an effect
    // keyed on the route would never fire for it.
    expect(mainTag).toContain('ref={attachMain}');
    expect(layout).toContain('const attachMain = useCallback(');
    // Never steals focus from a page that claimed it for itself: child effects
    // and `autoFocus` both run first.
    expect(layout).toContain(
      'if (active && active !== document.body && active !== document.documentElement) return;',
    );
  });

  it('puts the 14px switch-row pull-up on main\'s FIRST CHILD, never on main', () => {
    // A scrollport IS the padding box. Pulling main itself up 14px would start
    // the scrollport 14px above the bar's bottom edge, and scrolled rows would
    // show in that strip — the seam again, 14px of it. On the first child the
    // scrollport still begins at the bar's bottom and the borrowed 14px sits
    // above the scroll origin, unreachable and clipped; that region is the
    // page's own 24px top padding, so nothing of a page is lost.
    expect(mainTag).toContain('md:[header+&]:pt-0');
    expect(mainTag).toContain('md:[header+&>*:first-child]:-mt-3.5');
    expect(mainTag).not.toContain('md:[header+&]:-mt-3.5');
  });

  it('does not nest a second scroller inside the three bounded workspaces', () => {
    // Messages / Trax / Support keep `overflow-hidden` on their own main and go
    // on scrolling inside their panels; only the non-bounded branch scrolls.
    const bounded = layout.slice(layout.indexOf('isBoundedHeight\n'), layout.indexOf('{children}'));
    expect(bounded).toContain('flex min-h-0 flex-1 flex-col overflow-hidden p-0');
    expect(bounded.split('overflow-y-auto').length - 1).toBe(1);
  });
});

describe('v1 is untouched: the window still scrolls the document', () => {
  it('keeps every v1 class string exactly as it was', () => {
    // The v1 arms of the three ternaries, character for character.
    expect(mainTag).toContain('`flex min-h-0 flex-1 flex-col overflow-hidden p-0${v2Chrome ? " min-w-0" : ""}`');
    expect(mainTag).toContain('" pt-0"');
    expect(layout).toContain('[v2Chrome ? "min-w-0" : "overflow-x-hidden", v2Theme ? "bg-transparent" : ""]');
    // v1's own header row, unchanged.
    expect(layout).toContain('<header className="flex h-16 shrink-0 items-center gap-1 sm:gap-2 border-b px-2 sm:px-4">');
  });

  it('adds no attribute to a v1 page: every new prop is `undefined` off the gate', () => {
    // `undefined` renders nothing, so v1's DOM is byte-identical.
    for (const attr of ['tabIndex=', 'data-scrollport=']) {
      const i = mainTag.indexOf(attr);
      expect(i, attr).toBeGreaterThan(-1);
      expect(mainTag.slice(i, mainTag.indexOf('}', i) + 1)).toContain(': undefined');
    }
  });

  it('leaves a v1 wrapper unbounded unless it is one of the three workspaces', () => {
    // `boundedShell` collapses to `isBoundedHeight` when v2FixedFrame is false.
    expect(layout).toContain('const boundedShell = isBoundedHeight || v2FixedFrame;');
  });
});

describe('the top bar is a row in that frame, like the sidebar header', () => {
  it('is a shrink-0 sibling above <main>, and not sticky or fixed', () => {
    expect(layout).toContain('{v2Chrome && !isTraxWorkspace && <TopBarV2 showNavTrigger={!isMessagesWorkspace} />}');
    expect(topBar).toContain('"flex h-16 shrink-0 items-center gap-2 bg-transparent px-3 sm:px-4"');
    expect(topBar).not.toContain('sticky');
    expect(topBar).not.toContain('top-bar-veil');
    expect(topBar).not.toContain('window.scrollY');
  });
});

describe('what already worked, and must keep working', () => {
  /**
   * A scroll event on an ELEMENT does not bubble — but it does reach window
   * listeners registered in the CAPTURE phase. These three re-place something
   * while the page moves (the tour spotlight, the slash-menu under the caret),
   * and they were already written with `true` because the sidebar scrolls
   * inside itself. That is exactly why they survived the frame untouched: drop
   * the `true` and they go deaf the moment the window stops scrolling.
   */
  it.each([
    ['components/onboarding/first-rental-tour.tsx'],
    ['components/settings-v2/notifications-v2/template-editor.tsx'],
  ])('%s listens for scroll in the capture phase', (rel) => {
    const src = codeOnly(readPortalSource(rel));
    expect(src).toMatch(/addEventListener\((['"])scroll\1,\s*\w+,\s*true\)/);
    expect(src).not.toMatch(/addEventListener\((['"])scroll\1,\s*\w+\)/);
  });

  it('the settings kit jumps with scrollIntoView, which follows whichever box scrolls', () => {
    const kit = codeOnly(readPortalSource('components/settings-v2/settings-kit.tsx'));
    expect(kit).toContain('target.scrollIntoView?.({ block: "start" });');
    expect(kit).toContain('target.scrollIntoView?.({ behavior: settingsScrollBehavior(), block: "center" });');
    // Never `window.scrollTo`, which under the frame scrolls a window that cannot.
    expect(kit).not.toContain('window.scrollTo');
    expect(kit).not.toContain('window.scrollY');
    // The save bar sticks to the BOTTOM of the scrollport, which in the frame is
    // the viewport's bottom — where it already sat.
    expect(kit).toContain('sticky bottom-4');
  });
});

describe('everything that measured the window now measures the scrollport', () => {
  const uses = (rel: string) => codeOnly(readPortalSource(rel));

  it.each([
    ['components/shared/list-table-v2.tsx'],
    ['components/rentals-v2/rental-onboarding-shell.tsx'],
    ['components/rentals/calendar/calendar-view.tsx'],
  ])('%s asks lib/scrollport, never window.scrollY', (rel) => {
    const src = uses(rel);
    expect(src).toContain('scrollportFill');
    expect(src).toContain('from "@/lib/scrollport"');
    // `rect.top + window.scrollY` is the expression that breaks silently: once
    // the window stops scrolling, scrollY is permanently 0 and the "document
    // coordinate" slides with the page.
    expect(src).not.toContain('window.scrollY');
    expect(src).not.toContain('window.pageYOffset');
    expect(src).not.toContain('window.innerHeight');
  });
});
