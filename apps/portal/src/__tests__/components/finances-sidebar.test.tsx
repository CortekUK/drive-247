/**
 * The v2 sidebar with and without the Finances canary (design §1).
 *
 *  - canary: Payments, Invoices and Fines are ONE "Finances" row;
 *  - everyone else: exactly the three rows they had, same hrefs, same order;
 *  - a stored arrangement naming the old rows produces no ghost rows, cannot
 *    hide Finances, and hands Finances the place Payments had;
 *  - a manager sees Finances on ANY of the three grants, and nothing on none.
 *
 * The real v2 sidebar, with only its data sources mocked (the same rig as
 * sidebar-booking-site-row.test.tsx). Assertions are on hrefs — the shape —
 * not on copy.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finances: false,
  isManager: false,
  grants: [] as string[],
  prefs: {
    topLevelOrder: [] as string[],
    groupOrder: [] as string[],
    groupItemOrder: {} as Record<string, string[]>,
    hidden: [] as string[],
    pinned: [] as string[],
    moreOrder: [] as string[],
    shown: [] as string[],
  },
  pathname: '/',
}));

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
    tenant: { id: 't1', slug: mocks.finances ? 'northwind' : 'acme-hire', company_name: 'Acme Hire' },
    tenantSlug: mocks.finances ? 'northwind' : 'acme-hire',
    refetchTenant: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-tenant-branding', () => ({
  useTenantBranding: () => ({ branding: { app_name: 'Acme Hire' }, brandName: 'Acme Hire' }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/use-tenant-subscription', () => ({ useTenantSubscription: () => ({}) }));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    isManager: mocks.isManager,
    canView: (key: string) => !mocks.isManager || mocks.grants.includes(key),
    canViewSettings: () => true,
  }),
}));
vi.mock('@/hooks/use-cms-pages', () => ({ useCMSPages: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/use-nav-preferences', () => ({ useNavPreferences: () => ({ preferences: mocks.prefs }) }));
// Every v2 area on (this is the v2 sidebar), except `finances`, which each test sets.
vi.mock('@/lib/v2-context', () => ({
  useV2: (area: string) => (area === 'finances' ? mocks.finances : true),
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
vi.mock('@/stores/cms-outline-store', () => ({
  useCmsOutline: (selector: any) => selector({ sections: [], activeId: null, dirtyIds: [], pick: vi.fn() }),
}));

import { AppSidebarV2 } from '@/components/shared/layout/app-sidebar-v2';
import { SidebarProvider } from '@/components/ui-v2/sidebar';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

// Rendered through react-dom/client inside act(): tell React this is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function renderSidebar() {
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  act(() =>
    root!.render(
      createElement(TooltipProvider, null, createElement(SidebarProvider, { defaultOpen: true }, createElement(AppSidebarV2))),
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  mocks.finances = false;
  mocks.isManager = false;
  mocks.grants = [];
  mocks.pathname = '/';
  mocks.prefs = { topLevelOrder: [], groupOrder: [], groupItemOrder: {}, hidden: [], pinned: [], moreOrder: [], shown: [] };
});

const FINANCE_HREFS = ['/payments', '/invoices', '/fines', '/finances'];
/** The finance rows on the rail, by href, in order. */
const financeRows = () =>
  [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((a) => a.getAttribute('href')!)
    .filter((href) => FINANCE_HREFS.includes(href));
/** Every rail row's href, in order (to check relative placement). */
const railHrefs = () =>
  [...document.querySelectorAll<HTMLElement>('[data-tour^="nav-"] a[href]')].map((a) => a.getAttribute('href')!);

describe('everyone but the canary', () => {
  it('keeps exactly the three rows, in their order', () => {
    renderSidebar();
    expect(financeRows()).toEqual(['/payments', '/invoices', '/fines']);
  });

  it('keeps them whatever a manager holds — each row on its own grant, as before', () => {
    mocks.isManager = true;
    mocks.grants = ['fines'];
    renderSidebar();
    expect(financeRows()).toEqual(['/fines']);
  });
});

describe('the canary', () => {
  it('shows ONE Finances row and none of the three', () => {
    mocks.finances = true;
    renderSidebar();
    expect(financeRows()).toEqual(['/finances']);
  });

  it('puts Finances where Payments was', () => {
    mocks.finances = true;
    renderSidebar();
    const hrefs = railHrefs();
    // Payments sat between Availability and Support; Finances takes its place.
    expect(hrefs.indexOf('/finances')).toBe(hrefs.indexOf('/blocked-dates') + 1);
  });

  it('is not hidden, and grows no ghost rows, when stored preferences hide the old rows', () => {
    mocks.finances = true;
    mocks.prefs = { ...mocks.prefs, hidden: ['/payments', '/invoices', '/fines'] };
    renderSidebar();
    expect(financeRows()).toEqual(['/finances']);
  });

  it('takes the place the user gave Payments in a stored order', () => {
    mocks.finances = true;
    mocks.prefs = { ...mocks.prefs, moreOrder: ['/support', '/payments', '/agreements', '/invoices', '/fines'] };
    renderSidebar();
    const hrefs = railHrefs();
    expect(financeRows()).toEqual(['/finances']);
    expect(hrefs.indexOf('/support')).toBeLessThan(hrefs.indexOf('/finances'));
    expect(hrefs.indexOf('/finances')).toBeLessThan(hrefs.indexOf('/agreements'));
  });

  it.each(['payments', 'invoices', 'fines'])('shows Finances to a manager holding only %s', (grant) => {
    mocks.finances = true;
    mocks.isManager = true;
    mocks.grants = [grant];
    renderSidebar();
    expect(financeRows()).toEqual(['/finances']);
  });

  it('shows no Finances row to a manager holding none of the three', () => {
    mocks.finances = true;
    mocks.isManager = true;
    mocks.grants = ['rentals', 'customers'];
    renderSidebar();
    expect(financeRows()).toEqual([]);
  });

  it('keeps the Finances row lit on a payment or fine record', () => {
    mocks.finances = true;
    mocks.pathname = '/payments/5b0c9f2e-1111-2222-3333-444455556666';
    renderSidebar();
    expect(document.querySelector('a[href="/finances"]')!.getAttribute('data-active')).toBe('true');
  });

  it('does not light Finances on an unrelated page', () => {
    mocks.finances = true;
    mocks.pathname = '/rentals';
    renderSidebar();
    expect(document.querySelector('a[href="/finances"]')!.getAttribute('data-active')).toBe('false');
  });
});
