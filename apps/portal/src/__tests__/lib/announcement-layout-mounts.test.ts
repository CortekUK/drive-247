/**
 * Where the announcement system is mounted, and the CSS hooks it depends on.
 *
 * Nothing else reads `(dashboard)/layout.tsx`, so these source assertions are the
 * only guard on the wiring:
 *   - the data hook runs ABOVE every early return (the read starts while the gate
 *     skeleton is held, and hooks must not be conditional);
 *   - the banner is the first thing inside DynamicThemeProvider, OUTSIDE the sidebar
 *     wrapper, which is what lets a fixed bar span the sidebar column and top bar;
 *   - the dialog host is mounted after the last existing gate, with the paywall
 *     signal, the exempt-route flag and the pathname passed in;
 *   - the bounded-height routes are marked for the CSS.
 *
 * And for the CSS: the offset rules exist, sit outside every @layer, and name no
 * Tailwind class (a class name in a global selector is the circular-dependency trap
 * that takes every portal page down). The `data-slot` hooks they select are
 * rendered by BOTH sidebar primitives, which is checked by rendering them.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';

import * as SidebarV1 from '@/components/ui/sidebar';
import * as SidebarV2 from '@/components/ui-v2/sidebar';
import { codeOnly, readPortalSource } from '../helpers/edge-source';

const layout = codeOnly(readPortalSource('app/(dashboard)/layout.tsx'));
const globalCss = readPortalSource('global.css');

const at = (needle: string | RegExp) => {
  const i = typeof needle === 'string' ? layout.indexOf(needle) : layout.search(needle);
  expect(i, `layout.tsx should contain ${String(needle)}`).toBeGreaterThan(-1);
  return i;
};

describe('(dashboard)/layout.tsx mounts', () => {
  it('imports the hook, the banner and the host', () => {
    expect(layout).toContain('import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";');
    expect(layout).toContain(
      'import { SystemAnnouncementBanner } from "@/components/announcements/system-announcement-banner";',
    );
    expect(layout).toContain(
      'import { AnnouncementDialogHost } from "@/components/announcements/announcement-dialog-host";',
    );
  });

  it('calls the data hook right after useSessionGuard, before the first early return', () => {
    const hook = at('usePortalAnnouncements();');
    expect(hook).toBeGreaterThan(at('useSessionGuard();'));
    expect(hook).toBeLessThan(at(/\n\s*if \(loading\) \{\s*return <LoadingSkeleton \/>/));
    expect(hook).toBeLessThan(at('return <TenantSuspendedScreen />'));
    // Exactly once, and unconditionally (not inside a branch).
    expect(layout.split('usePortalAnnouncements()').length - 1).toBe(1);
  });

  it('renders the banner as the first child of DynamicThemeProvider, before <Provider', () => {
    const banner = at('<SystemAnnouncementBanner />');
    expect(layout).toMatch(/<DynamicThemeProvider>\s*<SystemAnnouncementBanner \/>/);
    expect(banner).toBeLessThan(at(/<Provider\b/));
    expect(layout.split('<SystemAnnouncementBanner').length - 1).toBe(1);
  });

  it('mounts the host after FirstRentalTour, inside the Provider, with the three props', () => {
    // `gateWouldBlock`, not `showGate`: the four onboarding prompts take the
    // ROUTE-INDEPENDENT paywall signal, so a hard-blocked tenant on
    // /subscription is not handed the first-run wizard instead of a pay link.
    // See subscription-gate-route-exemption.test.ts. The host still takes
    // `showGate` — it decides for itself, and its props are asserted below.
    const tour = at('<FirstRentalTour suppressed={promptsSuppressed} />');
    const host = at('<AnnouncementDialogHost');
    expect(host).toBeGreaterThan(tour);
    expect(host).toBeLessThan(at('</Provider>'));
    const tag = layout.slice(host, layout.indexOf('/>', host) + 2);
    expect(tag).toContain('showGate={showGate}');
    expect(tag).toContain('isSubscriptionPage={!!isSubscriptionPage}');
    expect(tag).toContain('pathname={pathname ?? "/"}');
    // Nothing but whitespace between the tour and the host.
    expect(layout.slice(tour, host)).toMatch(/^<FirstRentalTour suppressed=\{promptsSuppressed\} \/>\s*$/);
  });

  it('marks every viewport-bounded wrapper on the Provider wrapper', () => {
    const provider = at(/<Provider\b/);
    // `boundedShell` = the three workspaces under either chrome, plus EVERY v2
    // route since the fixed frame (Sep 23 2026). The CSS below shortens each of
    // them by the banner's height; a v2 `h-svh` wrapper without this attribute
    // would be pushed down by the banner's spacer and scroll the document by
    // exactly that much.
    const attr = at('data-bounded-height={boundedShell ? "" : undefined}');
    expect(attr).toBeGreaterThan(provider);
    expect(attr).toBeLessThan(at('<TraxWrap>'));
    expect(layout).toContain('const boundedShell = isBoundedHeight || v2FixedFrame;');
    expect(layout).toContain('boundedShell ? "h-svh overflow-hidden" : ""');
  });
});

describe('both sidebar primitives expose the data-slot hooks the CSS selects', () => {
  const renderShell = (lib: typeof SidebarV1 | typeof SidebarV2) => {
    const { container } = render(
      createElement(
        lib.SidebarProvider as never,
        { 'data-bounded-height': '' } as never,
        createElement(lib.Sidebar as never, { collapsible: 'icon' } as never, 'nav'),
        createElement(lib.SidebarInset as never, null, createElement('header', null, 'bar')),
      ),
    );
    return container;
  };

  it.each([
    ['v1 (components/ui/sidebar)', SidebarV1],
    ['v2 (components/ui-v2/sidebar)', SidebarV2],
  ] as const)('%s', (_label, lib) => {
    const container = renderShell(lib);
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    expect(wrapper).not.toBeNull();
    // Unknown props reach the wrapper div, so the layout's attribute lands where the CSS looks.
    expect(wrapper!.hasAttribute('data-bounded-height')).toBe(true);
    expect(container.querySelector('[data-slot="sidebar-container"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="sidebar-gap"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="sidebar-inset"] > header')).not.toBeNull();
    cleanup();
  });
});

describe('global.css offsets', () => {
  const start = globalCss.indexOf('System announcement banner offsets');
  const block = start === -1 ? '' : globalCss.slice(globalCss.lastIndexOf('/*', start));
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

  it('exists, at the end of the file', () => {
    expect(start).toBeGreaterThan(-1);
    expect(globalCss.trimEnd().endsWith('}')).toBe(true);
    expect(rules).not.toMatch(/@layer|@tailwind/);
    // One media query only: the Trax phone sheet. From md up the panel floats
    // bottom-anchored and must not get a `top`.
    expect(rules.match(/@media[^{]*/g)?.map((m) => m.trim())).toEqual(['@media (max-width: 767.98px)']);
  });

  it('sits outside every @layer / @media block (brace depth 0)', () => {
    const before = globalCss.slice(0, globalCss.lastIndexOf('/*', start)).replace(/\/\*[\s\S]*?\*\//g, '');
    const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
    expect(depth).toBe(0);
  });

  it('moves every viewport-pinned piece by the banner height', () => {
    const expected = [
      /html\[data-system-banner\] \[data-slot="sidebar-container"\] \{\s*top: var\(--system-banner-h, 0px\);\s*height: calc\(100svh - var\(--system-banner-h, 0px\)\);\s*\}/,
      /html\[data-system-banner\] \[data-slot="sidebar-wrapper"\],\s*html\[data-system-banner\] \[data-slot="sidebar-inset"\] \{\s*min-height: calc\(100svh - var\(--system-banner-h, 0px\)\);\s*\}/,
      /html\[data-system-banner\] \[data-slot="sidebar-gap"\] \{\s*height: calc\(100svh - var\(--system-banner-h, 0px\)\);\s*\}/,
      /html\[data-system-banner\] \[data-bounded-height\] \{\s*height: calc\(100svh - var\(--system-banner-h, 0px\)\);\s*\}/,
      /@media \(max-width: 767\.98px\) \{\s*html\[data-system-banner\] \[data-slot="trax-panel"\] \{\s*top: calc\(var\(--system-banner-h, 0px\) \+ 0\.75rem\);\s*\}\s*\}/,
    ];
    for (const re of expected) expect(rules).toMatch(re);
  });

  it('uses attribute selectors only: no class selector anywhere in the block', () => {
    const selectors = rules
      .replace(/@media \(max-width: 767\.98px\) \{/g, '')
      .split('}')
      .map((chunk) => chunk.split('{')[0].trim())
      .filter(Boolean);
    // Five since the fixed frame (Sep 23 2026) retired the `sidebar-inset >
    // header` offset, which only ever moved a `sticky` top bar. The floor is a
    // guard against the block being emptied, not a target.
    expect(selectors.length).toBeGreaterThanOrEqual(5);
    for (const selector of selectors) {
      expect(selector).not.toMatch(/\.[A-Za-z_\\-]/);
      expect(selector.startsWith('html[data-system-banner]')).toBe(true);
    }
    expect(rules).not.toMatch(/@apply/);
  });
});
