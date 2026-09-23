/**
 * The way to the tenant's booking site from the v2 sidebar — now the ORG ROW.
 *
 * Sep 21 2026: this behaviour moved. It was first built as a separate
 * "Booking site" row in the nav (globe, "Booking site", arrow, hover pencil).
 * The user asked for no separate row and no "Booking site" title: the same
 * behaviour now lives on the top org row — the tenant's mark and name — so the
 * tenant's own name says whose site it is. See `OrgSwitcher` in
 * components/shared/layout/org-switcher.tsx. The file keeps its name; every
 * behaviour it pinned on the old row is pinned here on the org row.
 *
 * Asked for like this (team lead, Sep 20 2026): "the external-link icon is
 * always visible; on hover a small pencil appears immediately next to it, with
 * its own hover state, and clicking the pencil goes to the Branding page;
 * clicking anywhere else on the row opens the tenant's booking site."
 *
 * Things here can break without anyone noticing until it is in front of an
 * operator, so each has a case:
 *
 *  - the pencil must be a SIBLING of the site link, not a child of it. Nested
 *    anchors are invalid markup and the outer one swallows the click, which is
 *    the entire job of the pencil.
 *  - the pencil is hidden with `opacity-0`, which hides it from the eye and
 *    NOT from the keyboard — so it needs `focus-visible:opacity-100` or it is
 *    a control a tab user can focus and cannot see.
 *  - the URL comes from `bookingOriginFor`. The naive
 *    `https://${slug}.drive-247.com` opened a PRODUCTION tab from a local
 *    portal, which is the bug that helper exists to prevent.
 *  - the old row must not come back beside the new one: one way to the site,
 *    under the tenant's name, and never a "Booking site" title.
 *  - both links close the phone sheet (`closeMobileOnNav`), or on a phone the
 *    sheet is still covering the portal when the operator comes back to it.
 *  - until the tenant row resolves there is no slug, so the org row is plain
 *    identity: no link at all, rather than a link to a guessed URL.
 *
 * The real v2 sidebar and the real OrgSwitcher, with only their data sources
 * mocked.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/', slug: 'acme-hire' as string | null, mobile: false, isManager: false, canView: true }));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => createElement('a', { href, ...props }, children),
}));
vi.mock('@/hooks/use-support-messaging', () => ({ useSupportUnreadMessages: () => ({ count: 0 }) }));
vi.mock('@/hooks/use-reminders', () => ({ useReminderStats: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-org-settings', () => ({ useOrgSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-rental-settings', () => ({ useRentalSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-fleet-health', () => ({
  useFleetHealthStats: () => ({ needsAttention: 0 }),
  useFleetHealthEnabled: () => false,
}));
vi.mock('@/hooks/use-pending-bookings', () => ({ usePendingBookingsCount: () => ({ data: 0 }) }));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: mocks.slug ? { id: 't1', slug: mocks.slug, company_name: 'Acme Hire' } : null,
    tenantSlug: mocks.slug,
    refetchTenant: vi.fn(),
  }),
}));
// The org row's name and mark come from the tenant's branding.
vi.mock('@/hooks/use-tenant-branding', () => ({
  useTenantBranding: () => ({ branding: { app_name: 'Acme Hire' }, brandName: 'Acme Hire' }),
}));
// Phone or desktop, per test: the sidebar renders as a sheet on a phone.
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('@/hooks/use-tenant-subscription', () => ({ useTenantSubscription: () => ({}) }));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ isManager: mocks.isManager, canView: () => mocks.canView, canViewSettings: () => mocks.canView }),
}));
vi.mock('@/hooks/use-cms-pages', () => ({ useCMSPages: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/use-nav-preferences', () => ({
  useNavPreferences: () => ({
    preferences: { topLevelOrder: [], groupOrder: [], groupItemOrder: {}, hidden: [], pinned: [], moreOrder: [], shown: [] },
  }),
}));
vi.mock('@/lib/v2-context', () => ({
  useV2: () => true,
  usePortalExperience: () => ({ onV2: true, lean: true }),
  usePortalOnV2: () => true,
}));
vi.mock('@/components/rentals-v2/rental-detail/use-rental-detail-v2', () => ({ useRentalDetailV2: () => ({}) }));
vi.mock('@/components/vehicles-v2/use-vehicle-record', () => ({ useVehicleRecord: () => ({}) }));
vi.mock('@/components/customers-v2/customer-detail/use-customer-detail-v2', () => ({
  useCustomerRailHeader: () => ({ title: '', subtitle: '' }),
}));
vi.mock('@/components/shared/layout/sidebar-promo', () => ({ SidebarPromo: () => null }));
vi.mock('@/components/shared/layout/user-menu-v2', () => ({ UserMenuV2: () => null, SettingsLinkV2: () => null }));
vi.mock('@/components/shared/layout/sidebar-customizer-dialog', () => ({ SidebarCustomizerDialog: () => null }));
vi.mock('@/components/trax/trax-rail', () => ({ TraxRail: () => null }));
vi.mock('@/components/support/support-rail', () => ({ SupportRail: () => null }));
vi.mock('@/stores/auth-store', () => {
  const state = { appUser: { id: 'a1', name: 'Owner', email: 'o@example.invalid', role: 'head_admin', is_super_admin: false } };
  const useAuthStore: any = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  useAuthStore.getState = () => state;
  useAuthStore.setState = vi.fn();
  return { useAuth: () => state, useAuthStore };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/stores/cms-outline-store', () => ({ useCmsOutline: (selector: any) => selector({ sections: [], activeId: null, dirtyIds: [], pick: vi.fn() }) }));

import { AppSidebarV2 } from '@/components/shared/layout/app-sidebar-v2';
import { SidebarProvider, useSidebar } from '@/components/ui-v2/sidebar';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

/**
 * jsdom serves the tests from http://localhost:3000, which is exactly the case
 * `bookingOriginFor` exists for: a local portal must open the local booking
 * app, never `https://acme-hire.drive-247.com`.
 */
const LOCAL_BOOKING_ORIGIN = 'http://localhost:3000';

let root: Root | null = null;
/** The sidebar's own state, read from inside its provider. */
let sidebarState: ReturnType<typeof useSidebar> | null = null;
function SidebarStateProbe() {
  sidebarState = useSidebar();
  return null;
}

// Inside a TooltipProvider, as app/providers.tsx mounts every page: the
// collapsed rail's rows carry tooltips, which need one above them.
function sidebar(open: boolean) {
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  act(() =>
    root!.render(
      createElement(
        TooltipProvider,
        null,
        createElement(SidebarProvider, { defaultOpen: open }, createElement(AppSidebarV2), createElement(SidebarStateProbe)),
      ),
    ),
  );
}
const expanded = () => sidebar(true);
const collapsed = () => sidebar(false);
function unmount() {
  act(() => root?.unmount());
  root = null;
  sidebarState = null;
  document.body.replaceChildren();
}

const PENCIL = 'a[aria-label="Edit your booking site\'s branding"]';
const orgRow = () => document.querySelector<HTMLElement>('[data-slot="org-row"]');
const pencil = () => document.querySelector<HTMLAnchorElement>(PENCIL);
/** The booking-site link: collapsed, the row itself; expanded, the row's link that is not the pencil. */
const siteLink = () => {
  const row = orgRow();
  if (!row) return null;
  if (row instanceof HTMLAnchorElement) return row;
  return [...row.querySelectorAll<HTMLAnchorElement>('a')].find((a) => !a.matches(PENCIL)) ?? null;
};
const relTokens = (a: Element) => (a.getAttribute('rel') ?? '').split(/\s+/);
/** Class tokens that take an element off the screen, whatever the pointer does. */
const HIDING = ['opacity-0', 'hidden', 'invisible', 'sr-only'];

// A real click on a link would ask jsdom to navigate, which it cannot do.
// Cancelled at the document, after React's own handler has already run.
const noNavigation = (e: Event) => e.preventDefault();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  document.addEventListener('click', noNavigation);
  mocks.pathname = '/';
  mocks.slug = 'acme-hire';
  mocks.mobile = false;
  mocks.isManager = false;
  mocks.canView = true;
});
afterEach(() => {
  unmount();
  document.removeEventListener('click', noNavigation);
  vi.unstubAllGlobals();
});

describe('the booking-site link, on the org row (Sep 21 2026)', () => {
  it("opens the tenant's own site in a new tab, safely", () => {
    expanded();
    const link = siteLink()!;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(LOCAL_BOOKING_ORIGIN);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(relTokens(link)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });

  it('always shows the external-link icon, hover or no hover', () => {
    expanded();
    const row = orgRow()!;
    const arrow = siteLink()!.querySelector('svg.lucide-external-link');
    expect(arrow).not.toBeNull();
    // Inside the link itself, and nothing between it and the row hides it: no
    // hiding class on the icon or any wrapper, so no hover rule can be what
    // brings it back.
    for (let el: Element | null = arrow; el && el !== row.parentElement; el = el.parentElement) {
      expect([...el.classList].filter((t) => HIDING.includes(t))).toEqual([]);
    }
    // And no hover-only styling on the icon: it looks the same either way.
    expect([...arrow!.classList].filter((t) => t.includes('hover'))).toEqual([]);
  });

  it('puts the pencil beside the site link, going to Branding, and never inside it', () => {
    expanded();
    const link = siteLink()!;
    const edit = pencil()!;
    expect(edit).toBeTruthy();
    expect(edit.getAttribute('href')).toBe('/settings/appearance');
    // Siblings, not nested: an <a> inside an <a> swallows this click.
    expect(link.contains(edit)).toBe(false);
    expect(edit.previousElementSibling).toBe(link);
    expect(edit.parentElement).toBe(orgRow());
    expect(orgRow()!.querySelector('a a')).toBeNull();
  });

  // The pencil follows the Settings gear's rule, `!isManager ||
  // canView('settings')` — what Branding's own route check resolves to — so
  // nobody is shown a pencil that bounces them to the dashboard. The site link
  // needs no grant: anyone may open their own public booking site.
  it.each([
    ['a manager without the Settings grant gets no pencil', true, false, false],
    ['a manager with the Settings grant gets the pencil', true, true, true],
    ['anyone who is not a manager gets the pencil', false, true, true],
    ['a non-manager gets the pencil even where canView says no', false, false, true],
  ] as const)('%s', (_who, isManager, canView, shown) => {
    mocks.isManager = isManager;
    mocks.canView = canView;
    expanded();
    expect(pencil() !== null).toBe(shown);
    const link = siteLink()!;
    expect(link.getAttribute('href')).toBe(LOCAL_BOOKING_ORIGIN);
    expect(link.querySelector('svg')).not.toBeNull();
    // Without the pencil, nothing on the row leads to Branding at all.
    if (!shown) expect(orgRow()!.querySelector('a[href="/settings/appearance"]')).toBeNull();
  });

  it('reveals the pencil on hover and on keyboard focus, with its own hover state', () => {
    expanded();
    const edit = pencil()!;
    expect(edit.classList.contains('opacity-0')).toBe(true);
    expect(edit.classList.contains('group-hover/site:opacity-100')).toBe(true);
    // Hidden from the eye must not mean hidden from the keyboard.
    expect(edit.classList.contains('focus-visible:opacity-100')).toBe(true);
    // Its own hover, distinct from the row's.
    expect(edit.classList.contains('hover:bg-primary/10')).toBe(true);
    expect(edit.classList.contains('hover:text-primary')).toBe(true);
    // The hover group is the org row, which holds both links: hovering anywhere
    // on the row, the site link included, reveals the pencil.
    expect(orgRow()!.classList.contains('group/site')).toBe(true);
    expect(siteLink()!.parentElement).toBe(orgRow());
  });

  /**
   * Team lead, Sep 23 2026, on the sidebar's org row: the hover pencil "should
   * sit at the very END of the row, properly aligned, rather than looking
   * slightly off".
   *
   * It carried `mr-1`, which held its 28px hover pill 4px short of the row's
   * right edge — 10px from the sidebar's edge, against the 6px the header's
   * `p-1.5` gives everything else, which is what read as not quite lined up.
   * Flush, it is the same trailing control as the Settings gear, the customiser
   * and the caret on the profile row in the footer: 28px, `rounded-lg`, and
   * ending exactly on their row's edge.
   */
  it('puts the pencil on the row\'s right edge, like every other trailing control', () => {
    expanded();
    const edit = pencil()!;
    const cls = [...edit.classList];
    // Nothing may hold it short of the edge.
    expect(cls.filter((c) => /^m[rxs]?-/.test(c))).toEqual([]);
    expect(cls).not.toContain('mr-1');
    // It is the LAST thing in the row, and the row itself adds no end padding.
    expect(edit.nextElementSibling).toBeNull();
    expect(orgRow()!.lastElementChild).toBe(edit);
    expect([...orgRow()!.classList].filter((c) => /^p[rxe]?-/.test(c))).toEqual([]);
    // Same box and same corner as the footer row's trailing controls. v2 markup
    // never uses `rounded-md`.
    expect(cls).toEqual(expect.arrayContaining(['h-7', 'w-7', 'shrink-0', 'rounded-lg']));
    expect(cls).not.toContain('rounded-md');
    expect(cls).not.toContain('rounded-sm');
  });

  it('collapsed: the mark alone is the booking-site link, with no pencil', () => {
    collapsed();
    const row = orgRow()!;
    expect(row.tagName).toBe('A');
    expect(row.getAttribute('href')).toBe(LOCAL_BOOKING_ORIGIN);
    expect(row.getAttribute('target')).toBe('_blank');
    expect(relTokens(row)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    // The mark and nothing else: no name, no arrow, and no pencil — the rail
    // has no room for them.
    expect(row.children).toHaveLength(1);
    expect(row.textContent).not.toContain('Acme Hire');
    expect(row.querySelector('svg')).toBeNull();
    expect(pencil()).toBeNull();
    expect(document.querySelector('a[href="/settings/appearance"]')).toBeNull();
    // With no name on screen, the accessible name is what says where it goes.
    expect(row.getAttribute('aria-label')).toMatch(/Acme Hire/);
    expect(row.getAttribute('aria-label')).toMatch(/new tab/i);
  });

  it('has no separate "Booking site" row any more: the org row is the only way to the site', () => {
    for (const mount of [expanded, collapsed]) {
      mount();
      const toSite = [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === LOCAL_BOOKING_ORIGIN);
      expect(toSite).toHaveLength(1);
      expect(toSite[0]).toBe(siteLink());
      expect(document.querySelectorAll('a[target="_blank"]')).toHaveLength(1);
      // No "Booking site" title anywhere — not as text (the collapsed row's
      // label was sr-only text), not as a label or a tooltip's title.
      expect(document.body.textContent).not.toMatch(/booking site/i);
      expect(document.querySelector('[aria-label="Booking site"], [title="Booking site"]')).toBeNull();
      // Branding is reached from the org row's pencil, never from a second row.
      const toBranding = [...document.querySelectorAll('a[href="/settings/appearance"]')];
      expect(toBranding).toEqual(mount === expanded ? [pencil()] : []);
      unmount();
    }
  });

  it("shows the tenant's name on the row, not the words \"Booking site\"", () => {
    expanded();
    const link = siteLink()!;
    const name = [...link.querySelectorAll('span')].map((s) => s.textContent);
    expect(name).toContain('Acme Hire');
    expect(link.textContent).not.toMatch(/booking site/i);
    // The name alone says nothing about where the link goes, so the accessible
    // name says it — and that it leaves the portal.
    expect(link.getAttribute('aria-label')).toMatch(/Acme Hire/);
    expect(link.getAttribute('aria-label')).toMatch(/booking site/i);
    expect(link.getAttribute('aria-label')).toMatch(/new tab/i);
  });

  it.each([
    ['the site link', siteLink],
    ['the Branding pencil', pencil],
  ] as const)('on a phone, following %s closes the sidebar sheet', (_which, find) => {
    mocks.mobile = true;
    expanded();
    act(() => sidebarState!.setOpenMobile(true));
    expect(sidebarState!.openMobile).toBe(true);
    const link = find()!;
    expect(link).toBeTruthy();
    // The row really is inside the phone sheet, not a desktop copy of it.
    expect(link.closest('[data-mobile="true"]')).not.toBeNull();
    act(() => link.click());
    expect(sidebarState!.openMobile).toBe(false);
  });

  it('has no links at all until the tenant slug resolves', () => {
    mocks.slug = null;
    for (const mount of [expanded, collapsed]) {
      mount();
      const row = orgRow()!;
      // The row is there — the tenant's mark is identity — but it goes nowhere.
      expect(row).toBeTruthy();
      expect(row.matches('a')).toBe(false);
      expect(row.querySelector('a, button')).toBeNull();
      expect(pencil()).toBeNull();
      expect(document.querySelector('a[target="_blank"]')).toBeNull();
      unmount();
    }
  });
});
