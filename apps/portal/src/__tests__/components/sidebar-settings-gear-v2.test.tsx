import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Where Settings lives in the v2 sidebar (team lead, Sep 21 2026: move the gear
 * from the org row at the top down to the profile row in the footer).
 *
 * The real v2 sidebar, the real org row and the real profile menu, with only
 * their DATA sources mocked — the same harness as sidebar-support-badge.test.tsx,
 * except that `OrgSwitcher` is real here (the point is that it no longer links)
 * and the manager mock can say "a manager WITH the Settings grant", which that
 * file's single flag cannot.
 */
const mocks = vi.hoisted(() => ({
  pathname: '/',
  isManager: false,
  canView: true,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => createElement('a', { href, ...props }, children) }));
vi.mock('@/hooks/use-support-messaging', () => ({ useSupportUnreadMessages: () => ({ count: 0 }) }));
vi.mock('@/hooks/use-reminders', () => ({ useReminderStats: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-org-settings', () => ({ useOrgSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-rental-settings', () => ({ useRentalSettings: () => ({ settings: {} }) }));
vi.mock('@/hooks/use-fleet-health', () => ({ useFleetHealthStats: () => ({ needsAttention: 0 }), useFleetHealthEnabled: () => false }));
vi.mock('@/hooks/use-pending-bookings', () => ({ usePendingBookingsCount: () => ({ data: 0 }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1', slug: 'northwind', company_name: 'Northwind' }, tenantSlug: 'northwind', refetchTenant: vi.fn() }) }));
vi.mock('@/hooks/use-tenant-subscription', () => ({ useTenantSubscription: () => ({}) }));
vi.mock('@/hooks/use-tenant-branding', () => ({
  useTenantBranding: () => ({ branding: { app_name: 'Northwind Rentals' }, brandName: 'Northwind Rentals' }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    isManager: mocks.isManager,
    canView: () => mocks.canView,
    canViewSettings: () => mocks.canView,
  }),
}));
vi.mock('@/hooks/use-cms-pages', () => ({ useCMSPages: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/use-nav-preferences', () => ({ useNavPreferences: () => ({ preferences: { topLevelOrder: [], groupOrder: [], groupItemOrder: {}, hidden: [], pinned: [] } }) }));
vi.mock('@/lib/v2-context', () => ({
  useV2: () => true,
  usePortalExperience: () => ({ onV2: true, lean: true }),
  usePortalOnV2: () => true,
}));
vi.mock('@/components/rentals-v2/rental-detail/use-rental-detail-v2', () => ({ useRentalDetailV2: () => ({}) }));
vi.mock('@/components/vehicles-v2/use-vehicle-record', () => ({ useVehicleRecord: () => ({}) }));
vi.mock('@/components/customers-v2/customer-detail/use-customer-detail-v2', () => ({ useCustomerRailHeader: () => ({ title: '', subtitle: '' }) }));
vi.mock('@/components/shared/layout/sidebar-promo', () => ({ SidebarPromo: () => null }));
vi.mock('@/components/shared/layout/dev-section', () => ({ DevSection: () => null }));
vi.mock('@/components/shared/layout/sidebar-customizer-dialog', () => ({ SidebarCustomizerDialog: () => null }));
vi.mock('@/components/trax/trax-rail', () => ({ TraxRail: () => null }));
vi.mock('@/components/support/support-rail', () => ({ SupportRail: () => createElement('div', { 'data-testid': 'support-rail' }) }));

vi.mock('@/stores/auth-store', () => {
  const state = { appUser: { id: 'a1', name: 'Northwind Owner', email: 'owner@example.invalid', role: 'head_admin', is_super_admin: false }, signOut: vi.fn(), updatePassword: vi.fn() };
  const useAuthStore: any = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  useAuthStore.getState = () => state;
  useAuthStore.setState = vi.fn();
  return { useAuth: () => state, useAuthStore };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/stores/feedback-store', () => ({ useFeedbackStore: (selector: (s: unknown) => unknown) => selector({ open: vi.fn() }) }));
vi.mock('@/hooks/use-feedback-settings', () => ({ useFeedbackSettings: () => ({ formEnabled: true }) }));
vi.mock('@/hooks/use-first-rental-tour', () => ({ replayFirstRentalTour: vi.fn(), useFirstRentalTourEligible: () => false }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/components/shared/layout/avatar-crop-dialog', () => ({ AvatarCropDialog: () => null }));
// Menu content rendered inline: this checks WHERE the controls are, not Radix's opening.
vi.mock('@/components/ui-v2/dropdown-menu', () => {
  const pass = ({ children }: any) => createElement('div', null, children);
  return {
    DropdownMenu: pass, DropdownMenuTrigger: pass, DropdownMenuContent: pass,
    DropdownMenuSeparator: () => createElement('hr'),
    DropdownMenuItem: ({ children, asChild, onSelect, onClick, ...props }: any) => createElement('div', { role: 'menuitem', ...props, onClick: onSelect ?? onClick }, children),
  };
});

import { AppSidebarV2 } from '@/components/shared/layout/app-sidebar-v2';
import { UserMenuV2 } from '@/components/shared/layout/user-menu-v2';
import { SidebarProvider } from '@/components/ui-v2/sidebar';
import { TooltipProvider } from '@/components/ui-v2/tooltip';

let root: Root | null = null;
function render(element: ReturnType<typeof createElement>) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(element));
}
// Inside a TooltipProvider, as app/providers.tsx mounts every page: the
// collapsed rail's rows carry tooltips, which need one above them.
const sidebarIn = (open: boolean) =>
  render(createElement(TooltipProvider, null, createElement(SidebarProvider, { defaultOpen: open }, createElement(AppSidebarV2))));
const expanded = () => sidebarIn(true);
const collapsed = () => sidebarIn(false);
const gears = () => [...document.querySelectorAll<HTMLAnchorElement>('a[aria-label="Settings"]')];
const orgRow = () => document.querySelector<HTMLElement>('[data-slot="org-row"]')!;
/**
 * Every href the org row carries, ITS OWN included: collapsed, the row's root
 * is itself the booking-site link, which `querySelectorAll` would not see.
 */
const orgHrefs = () =>
  [orgRow(), ...orgRow().querySelectorAll('a')].map((el) => el.getAttribute('href')).filter(Boolean);
/** A row's controls, left to right: the name block, then each control by its label. */
const slots = (row: Element) =>
  [...row.children].map((el) => el.getAttribute('aria-label') ?? (el.textContent?.includes('Northwind Owner') ? 'name' : el.tagName));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
  mocks.pathname = '/'; mocks.isManager = false; mocks.canView = true;
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('Settings is the gear in the profile row, not the org row (Sep 21 2026)', () => {
  it('expanded: the row reads name | Settings, Customise, account menu — one group at its right end', () => {
    expanded();
    const [gear] = gears();
    expect(gear.getAttribute('href')).toBe('/settings');
    expect(slots(gear.parentElement!)).toEqual(['name', 'Settings', 'Customise sidebar', 'Open account menu']);
    // A link, and never inside a button: nested in the menu trigger, the
    // trigger would swallow the click and the markup would be invalid.
    expect(gear.closest('button')).toBeNull();
  });

  it('the org row at the top never leads to Settings, so there is one way in and not two', () => {
    expanded();
    expect(orgRow().textContent).toContain('Northwind Rentals');
    // The org row is the booking site and its Branding pencil now (see
    // sidebar-booking-site-row.test.tsx) — never Settings, and never a menu.
    expect(orgHrefs()).not.toContain('/settings');
    expect(orgRow().querySelector('button')).toBeNull();
    expect(document.querySelectorAll('a[href="/settings"]')).toHaveLength(1);
    expect(document.querySelector('a[href="/settings"]')).toBe(gears()[0]);
  });

  it('collapsed: the gear is stacked above the avatar, so Settings is still one click away', () => {
    collapsed();
    const [gear] = gears();
    expect(gear.getAttribute('href')).toBe('/settings');
    // First in the stack, the account button after it: the avatar stays at the
    // very bottom in both states, so collapsing the sidebar moves nothing.
    const stack = gear.parentElement!;
    expect(stack.children).toHaveLength(2);
    expect(stack.firstElementChild).toBe(gear);
    expect(stack.lastElementChild!.querySelector('button')).not.toBeNull();
    // The collapsed org mark opens the booking site, not Settings.
    expect(orgHrefs()).not.toContain('/settings');
    expect(document.querySelectorAll('a[href="/settings"]')).toHaveLength(1);
  });

  // v1's footer Settings rule, `!isManager || canView('settings')`, carried
  // across verbatim from the org row — including that a non-manager's canView
  // never decides it.
  it.each([
    ['a manager without the Settings grant gets no gear', true, false, 0],
    ['a manager with the Settings grant gets the gear', true, true, 1],
    ['anyone who is not a manager gets the gear', false, true, 1],
    ['a non-manager gets the gear even where canView says no', false, false, 1],
  ] as const)('%s', (_who, isManager, canView, count) => {
    mocks.isManager = isManager; mocks.canView = canView;
    expanded();
    expect(gears()).toHaveLength(count);
    act(() => root?.unmount()); document.body.replaceChildren();
    collapsed();
    expect(gears()).toHaveLength(count);
    // And the org row never leads to Settings, so a refused manager has no side door.
    expect(orgHrefs()).not.toContain('/settings');
  });

  it('the Support rail mounts the same row without the gear, exactly as before', () => {
    // support-rail.tsx renders `<UserMenuV2 variant="row" />` with no
    // `settings` prop. Its footer must not change: Support is not this work.
    render(createElement(UserMenuV2, { variant: 'row' }));
    expect(gears()).toHaveLength(0);
    const caret = document.querySelector('button[aria-label="Open account menu"]')!;
    expect(slots(caret.parentElement!)).toEqual(['name', 'Customise sidebar', 'Open account menu']);
  });
});
