import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The real v2 sidebar and the real profile menu, with only their DATA sources
 * mocked: where Support sits, where it goes, what its badge says, and that the
 * profile menu no longer carries it.
 */
const mocks = vi.hoisted(() => ({
  unread: { count: 2 as number | null },
  pathname: '/',
  manager: false,
  feedback: true,
  tour: true,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => createElement('a', { href, ...props }, children) }));
vi.mock('@/hooks/use-support-messaging', () => ({ useSupportUnreadMessages: () => mocks.unread }));
vi.mock('@/hooks/use-reminders', () => ({ useReminderStats: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-org-settings', () => ({ useOrgSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-rental-settings', () => ({ useRentalSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-fleet-health', () => ({ useFleetHealthStats: () => ({ needsAttention: 0 }), useFleetHealthEnabled: () => false }));
vi.mock('@/hooks/use-pending-bookings', () => ({ usePendingBookingsCount: () => ({ data: 0 }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1', slug: 'acme-hire', company_name: 'Acme Hire' }, tenantSlug: 'acme-hire', refetchTenant: vi.fn() }) }));
vi.mock('@/hooks/use-tenant-subscription', () => ({ useTenantSubscription: () => ({}) }));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ isManager: mocks.manager, canView: () => !mocks.manager, canViewSettings: () => !mocks.manager }),
}));
vi.mock('@/hooks/use-cms-pages', () => ({ useCMSPages: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/use-nav-preferences', () => ({ useNavPreferences: () => ({ preferences: { topLevelOrder: [], groupOrder: [], groupItemOrder: {}, hidden: [], pinned: [] } }) }));
// The lean gates now read the tenant's `portal_experience` through
// `usePortalExperience` (lib/lean-context.tsx), so the mock has to answer that
// too. A v2 tenant is also lean: onV2 and lean both true, as for northwind.
vi.mock('@/lib/v2-context', () => ({
  useV2: () => true,
  usePortalExperience: () => ({ onV2: true, lean: true }),
  usePortalOnV2: () => true,
}));
vi.mock('@/components/rentals-v2/rental-detail/use-rental-detail-v2', () => ({ useRentalDetailV2: () => ({}) }));
vi.mock('@/components/rentals-v2/rental-detail/use-extras-overview', () => ({ useExtrasOverview: () => ({ value: null, note: null }) }));
vi.mock('@/components/vehicles-v2/use-vehicle-record', () => ({ useVehicleRecord: () => ({}) }));
vi.mock('@/components/customers-v2/customer-detail/use-customer-detail-v2', () => ({ useCustomerRailHeader: () => ({ title: '', subtitle: '' }) }));
vi.mock('@/components/shared/layout/org-switcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/components/shared/layout/sidebar-promo', () => ({ SidebarPromo: () => null }));
vi.mock('@/components/shared/layout/dev-section', () => ({ DevSection: () => null }));
vi.mock('@/components/shared/layout/sidebar-customizer-dialog', () => ({ SidebarCustomizerDialog: () => null }));
vi.mock('@/components/trax/trax-rail', () => ({ TraxRail: () => null }));
vi.mock('@/components/support/support-rail', () => ({ SupportRail: () => createElement('div', { 'data-testid': 'support-rail' }) }));

// The profile menu's own data.
vi.mock('@/stores/auth-store', () => {
  const state = { appUser: { id: 'a1', name: 'Super Admin', email: 'owner@example.invalid', role: 'head_admin', is_super_admin: false }, signOut: vi.fn(), updatePassword: vi.fn() };
  const useAuthStore: any = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  useAuthStore.getState = () => state;
  useAuthStore.setState = vi.fn();
  return { useAuth: () => state, useAuthStore };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/stores/feedback-store', () => ({ useFeedbackStore: (selector: (s: unknown) => unknown) => selector({ open: vi.fn() }) }));
vi.mock('@/hooks/use-feedback-settings', () => ({ useFeedbackSettings: () => ({ formEnabled: mocks.feedback }) }));
vi.mock('@/hooks/use-first-rental-tour', () => ({ replayFirstRentalTour: vi.fn(), useFirstRentalTourEligible: () => mocks.tour }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/shared/layout/avatar-crop-dialog', () => ({ AvatarCropDialog: () => null }));
// Menu content rendered inline: this checks WHAT the menu offers, not Radix's opening.
vi.mock('@/components/ui-v2/dropdown-menu', () => {
  const pass = ({ children }: any) => createElement('div', null, children);
  return {
    DropdownMenu: pass, DropdownMenuTrigger: pass, DropdownMenuContent: pass,
    DropdownMenuSeparator: () => createElement('hr', { 'data-testid': 'menu-separator' }),
    DropdownMenuItem: ({ children, asChild, onSelect, onClick, ...props }: any) => createElement('div', { role: 'menuitem', ...props, onClick: onSelect ?? onClick }, children),
  };
});

import { AppSidebarV2 } from '@/components/shared/layout/app-sidebar-v2';
import { UserMenuV2 } from '@/components/shared/layout/user-menu-v2';
import { SidebarProvider } from '@/components/ui-v2/sidebar';

let root: Root | null = null;
function render(element: ReturnType<typeof createElement>) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(element));
}
const sidebar = () => render(createElement(SidebarProvider, null, createElement(AppSidebarV2)));
const link = (name: string) => [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.replace(/\d+\+?$/, '').trim() === name);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  mocks.unread = { count: 2 }; mocks.pathname = '/'; mocks.manager = false; mocks.feedback = true; mocks.tour = true;
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('Support and the main sidebar', () => {
  it('lays the rail out as Dashboard, Money & paperwork, then Account', () => {
    sidebar();
    const names = [...document.querySelectorAll('a')].map((a) => a.textContent?.replace(/\d+\+?$/, '').trim());
    const start = names.indexOf('Dashboard');
    expect(names.slice(start, start + 10)).toEqual([
      'Dashboard', 'Rentals', 'Customers', 'Vehicles', 'Availability',
      'Agreements', 'Finances', 'Insights',
      'Integrations', 'Billing',
    ]);
    const headings = [...document.querySelectorAll('p')].map((p) => p.textContent?.trim());
    expect(headings).toContain('Money & paperwork');
    expect(headings).toContain('Account');
  });

  // Ghulam, 23 Nov 2026: "no support tab". /support still opens by its URL
  // and from TRAX's Support control.
  it('has no Support row, for a head admin or a manager', () => {
    for (const manager of [false, true]) {
      act(() => root?.unmount()); document.body.replaceChildren();
      mocks.manager = manager;
      sidebar();
      expect(link('Support')).toBeUndefined();
      expect(document.querySelector('a[href="/support"]')).toBeNull();
    }
  });

  it('still shows the Support rail on the Support route itself', () => {
    mocks.pathname = '/support';
    sidebar();
    expect(document.querySelector('[data-testid="support-rail"]')).not.toBeNull();
  });
});

describe('the profile menu', () => {
  it('no longer offers Support, and keeps everything else', () => {
    render(createElement(UserMenuV2, { variant: 'row' }));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim());
    expect(items).not.toContain('Support');
    expect(document.querySelector('a[href="/support"]')).toBeNull();
    for (const kept of ['Profile', 'Dark Mode', 'Feedback', 'Replay tour', 'Sign Out']) expect(items.some((i) => i?.startsWith(kept))).toBe(true);
  });

  it('leaves no empty group behind when neither Feedback nor the tour applies', () => {
    mocks.feedback = false; mocks.tour = false;
    render(createElement(UserMenuV2, { variant: 'row' }));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim());
    expect(items.some((i) => i?.startsWith('Sign Out'))).toBe(true);
    // Separators only between groups that exist.
    const content = document.body.innerHTML;
    expect(content).not.toMatch(/<hr[^>]*>\s*<div class="p-1\.5"><\/div>/);
  });
});
