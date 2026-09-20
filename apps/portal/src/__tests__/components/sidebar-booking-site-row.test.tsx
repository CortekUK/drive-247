/**
 * The booking-site row in the v2 sidebar.
 *
 * Asked for like this (team lead, Sep 20 2026): "the external-link icon is
 * always visible; on hover a small pencil appears immediately next to it, with
 * its own hover state, and clicking the pencil goes to the Branding page;
 * clicking anywhere else on the row opens the tenant's booking site."
 *
 * Three things here can break without anyone noticing until it is in front of
 * an operator, so each has a case:
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
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/', slug: 'acme-hire' as string | null }));

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
vi.mock('@/hooks/use-tenant-subscription', () => ({ useTenantSubscription: () => ({}) }));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ isManager: false, canView: () => true, canViewSettings: () => true }),
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
vi.mock('@/components/shared/layout/org-switcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/components/shared/layout/sidebar-promo', () => ({ SidebarPromo: () => null }));
vi.mock('@/components/shared/layout/user-menu-v2', () => ({ UserMenuV2: () => null }));
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
import { SidebarProvider } from '@/components/ui-v2/sidebar';

let root: Root | null = null;
function sidebar() {
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(SidebarProvider, null, createElement(AppSidebarV2))));
}

const siteLink = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) =>
    a.textContent?.trim().startsWith('Booking site'),
  );
const pencil = () =>
  document.querySelector<HTMLAnchorElement>('a[aria-label="Edit your booking site\'s branding"]');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  mocks.pathname = '/';
  mocks.slug = 'acme-hire';
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the booking-site row', () => {
  it('opens the tenant\'s own site in a new tab, safely', () => {
    sidebar();
    const link = siteLink()!;
    expect(link).toBeTruthy();
    // jsdom serves the tests from localhost, which is exactly the case
    // `bookingOriginFor` exists for: a local portal must not open production.
    expect(link.getAttribute('href')).toBe('http://localhost:3000');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('always shows the external-link icon, hover or no hover', () => {
    sidebar();
    const icons = [...siteLink()!.querySelectorAll('svg')].map((s) => s.getAttribute('class') ?? '');
    expect(icons.some((c) => c.includes('lucide-external-link'))).toBe(true);
    // It is inside the link itself, so nothing can hide it on a hover rule.
    expect(icons.every((c) => !c.includes('opacity-0'))).toBe(true);
  });

  it('puts the pencil beside it, going to Branding, and never inside the site link', () => {
    sidebar();
    const edit = pencil()!;
    expect(edit).toBeTruthy();
    expect(edit.getAttribute('href')).toBe('/settings/appearance');
    // Siblings, not nested: an <a> inside an <a> swallows this click.
    expect(siteLink()!.contains(edit)).toBe(false);
    expect(edit.previousElementSibling).toBe(siteLink());
  });

  it('reveals the pencil on hover and on keyboard focus, with its own hover state', () => {
    sidebar();
    const edit = pencil()!;
    expect(edit.className).toContain('opacity-0');
    expect(edit.className).toContain('group-hover/site:opacity-100');
    // Hidden from the eye must not mean hidden from the keyboard.
    expect(edit.className).toContain('focus-visible:opacity-100');
    // Its own hover, distinct from the row's.
    expect(edit.className).toContain('hover:bg-primary/10');
    expect(edit.className).toContain('hover:text-primary');
    expect(siteLink()!.parentElement?.className).toContain('group/site');
  });

  it('is not rendered at all until the tenant row resolves', () => {
    mocks.slug = null;
    sidebar();
    expect(siteLink()).toBeUndefined();
    expect(pencil()).toBeNull();
  });
});
