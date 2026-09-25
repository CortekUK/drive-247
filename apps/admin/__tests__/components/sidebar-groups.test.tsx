/**
 * The sidebar opens the group you are in, and leaves the rest shut.
 *
 * Asked for Sep 25 2026: "only that specific section should expand… other
 * unselected sections should remain collapsed so the sidebar is not cluttered
 * with open sub-menus everywhere". All five groups used to start expanded,
 * which put every item on screen at once — and once a page began publishing
 * its own sub-rows underneath an item, that was open menus everywhere.
 *
 * MOUNTED, not grepped. The render loop that took `/admin/promo-codes` down
 * this week passed a typecheck, returned 200 from the dev server and was
 * invisible to every source check, because nothing ever rendered the thing.
 * This renders the real `Sidebar` against a real route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/admin/promo-codes';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

/* A super admin, so every group is built. No network: the support hook only
   feeds an unread badge. */
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u1', email: 'a@b.c', is_super_admin: true, name: 'Tester' }, logout: vi.fn() }),
}));
vi.mock('@/lib/use-support-messaging', () => ({
  useAdminSupport: () => ({ call: vi.fn(), scope: '', uploadAttachment: vi.fn(), unreadCount: 0, unavailable: false }),
}));

import Sidebar from '@/components/admin/Sidebar';
import { SidebarProvider } from '@/components/admin/SidebarContext';
import { SidebarSectionsProvider } from '@/components/admin/sidebar-sections';

function mount() {
  return render(
    <SidebarProvider>
      <SidebarSectionsProvider>
        <Sidebar />
      </SidebarSectionsProvider>
    </SidebarProvider>,
  );
}

describe('the sidebar expands only the group you are in', () => {
  beforeEach(() => {
    pathname = '/admin/promo-codes';
  });

  it('renders at all', () => {
    mount();
    // Every group caption is always there; only the items fold away. The
    // captions read as SALES on screen but the DOM text is `Sales` — the
    // uppercase is CSS, which is how Northwind's "MORE" is done too.
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('Management')).toBeTruthy();
  });

  it('shows the items of the active group', () => {
    mount();
    expect(screen.getByRole('link', { name: /Promo Codes/ })).toBeTruthy();
  });

  it('hides the items of every other group', () => {
    mount();
    // `Signup Plans` lives under MANAGEMENT, which is not the group holding
    // the current route.
    expect(screen.queryByRole('link', { name: /Signup Plans/ })).toBeNull();
  });

  it('follows the route, not a hardcoded group', () => {
    pathname = '/admin/signup-plans';
    mount();
    expect(screen.getByRole('link', { name: /Signup Plans/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Promo Codes/ })).toBeNull();
  });

  it('opens the group for a nested route, not just an exact one', () => {
    // A record page is `/admin/rentals/<id>`; its group must still open, or
    // opening a record collapses the navigation around it.
    pathname = '/admin/rentals/abc-123';
    mount();
    expect(screen.getByRole('link', { name: /Rental Companies/ })).toBeTruthy();
  });
});
