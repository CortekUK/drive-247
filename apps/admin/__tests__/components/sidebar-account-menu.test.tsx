/**
 * Sign out lives inside the account row, not beside it.
 *
 * Asked for Sep 26 2026: put it in the Super Admin label the way the portal
 * does. It had been a permanent row of its own under a divider — so the one
 * control that ends the session sat in the open, directly below the navigation
 * and one stray click away from it.
 *
 * The portal's version (`user-menu-v2.tsx`) is a dropdown on the account row
 * holding Profile, Dark Mode, Feedback, Replay tour and Sign Out. This app has
 * none of the first four — there is no theme provider and no profile screen —
 * so it gets the same shape with only the item it actually has. Copying the
 * menu structure and filling it with entries that do nothing would look like
 * parity and behave like a dead end.
 *
 * Mounted rather than grepped: "the item is in the file" and "the item appears
 * when you press the row" are different claims, and only the second is the
 * one that was asked for.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

const logout = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    user: {
      id: 'u1',
      email: 'owner@cortek.io',
      name: 'Super Admin',
      is_super_admin: true,
      is_primary_super_admin: true,
    },
    logout,
  }),
}));

vi.mock('@/lib/use-support-messaging', () => ({
  useAdminSupport: () => ({ unreadCount: 0, tickets: [] }),
}));

import Sidebar from '@/components/admin/Sidebar';
import { SidebarProvider } from '@/components/admin/SidebarContext';
import {
  SidebarSectionsProvider,
  useRegisterSidebarSections,
} from '@/components/admin/sidebar-sections';

function mount() {
  return render(
    <SidebarProvider>
      <SidebarSectionsProvider>
        <Sidebar />
      </SidebarSectionsProvider>
    </SidebarProvider>,
  );
}

beforeEach(() => logout.mockClear());
afterEach(cleanup);

describe('the account row is the way out', () => {
  it('shows who is signed in, with their email', () => {
    mount();
    const trigger = screen.getAllByRole('button', { name: /account menu/i })[0];
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('Super Admin');
    // The portal shows the address on the row; this used to show only a badge.
    expect(trigger.textContent).toContain('owner@cortek.io');
  });

  it('does not leave sign out sitting in the open', () => {
    mount();
    // Nothing named "sign out" is reachable until the row is pressed.
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^sign out$/i })).toBeNull();
  });

  it('reveals sign out when the row is pressed', async () => {
    mount();
    await act(async () => {
      fireEvent.pointerDown(
        screen.getAllByRole('button', { name: /account menu/i })[0],
        { ctrlKey: false, button: 0 },
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy();
    });
  });

  it('actually signs out when it is chosen', async () => {
    mount();
    await act(async () => {
      fireEvent.pointerDown(
        screen.getAllByRole('button', { name: /account menu/i })[0],
        { ctrlKey: false, button: 0 },
      );
    });
    const item = await screen.findByRole('menuitem', { name: /sign out/i });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('repeats nothing from the row it opens', async () => {
    mount();
    await act(async () => {
      fireEvent.pointerDown(
        screen.getAllByRole('button', { name: /account menu/i })[0],
        { ctrlKey: false, button: 0 },
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy();
    });

    /*
     * The menu briefly carried its own user block — same avatar, same name,
     * same address — directly above the row you had just pressed to open it.
     * Removed Sep 26 2026.
     *
     * The name and email still appear ONCE, on the trigger. So this counts
     * rather than asserting absence: two of either would mean the block is
     * back.
     */
    const menu = screen.getByRole('menu');
    expect(menu.textContent).not.toContain('owner@cortek.io');
    expect(screen.getAllByText('owner@cortek.io')).toHaveLength(1);

    // The Primary Admin badge went with the block. It is a role marker, and
    // the Admins page is where roles are actually administered.
    expect(screen.queryByText('Primary Admin')).toBeNull();
  });
});

describe('the row stays reachable on every page', () => {
  it('sits below a scroller rather than inside one', async () => {
    // "It must show when I open the dashboard": the footer is the last flex
    // child of a `h-full` column whose nav area is the `flex-1` scroller, so a
    // long navigation list scrolls under it instead of pushing it off screen.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../../components/admin/Sidebar.tsx'),
      'utf8',
    );
    expect(src).toContain('flex flex-col h-full');
    expect(src).toContain('flex-1 overflow-y-auto');
    // The menu opens upward — it is the last thing in the rail, so a downward
    // one would open past the bottom of the window.
    expect(src).toContain('side="top"');
  });
});

/**
 * On a record the footer is that company's controls, and nothing else.
 *
 * Asked for Sep 26 2026: "the admin tab in which sign out option is available
 * — do not show that in this page." It also settles a line from the earlier
 * brief that had read as a contradiction — the account options belong to the
 * dashboard and the lists, not to an open record.
 *
 * Sign out is the ONLY one in this app. There is no second path, so it is
 * moved rather than removed, and the last test here is the one that matters:
 * it still exists everywhere a record is not open.
 */
describe('the footer swaps for the page it is on', () => {
  const ACTIONS = [
    { id: 'production', label: 'Mark as Production', tone: 'active' as const },
    { id: 'test', label: 'Mark as Test' },
    { id: 'status', label: 'Suspend company' },
    { id: 'force-logout', label: 'Force Logout All Users' },
    { id: 'delete', label: 'Delete company', tone: 'destructive' as const },
  ];

  function Register({ onAction }: { onAction: (id: string) => void }) {
    useRegisterSidebarSections(
      '/admin/rentals',
      [{ id: 'details', label: 'Details' }],
      'details',
      () => {},
      "Mahadi's Rentals",
      ACTIONS,
      onAction,
    );
    return null;
  }

  function mountOnRecord(onAction = vi.fn()) {
    render(
      <SidebarProvider>
        <SidebarSectionsProvider>
          <Register onAction={onAction} />
          <Sidebar />
        </SidebarSectionsProvider>
      </SidebarProvider>,
    );
    return onAction;
  }

  async function press(name: RegExp) {
    await act(async () => {
      fireEvent.pointerDown(screen.getAllByRole('button', { name })[0], {
        ctrlKey: false,
        button: 0,
      });
    });
  }

  it('shows Rental Settings on a record, not the account row', async () => {
    mountOnRecord();
    expect(screen.getAllByRole('button', { name: /rental settings/i })[0]).toBeTruthy();
    expect(screen.queryByRole('button', { name: /account menu/i })).toBeNull();
    // The signed-in person's address is not on the footer here at all.
    expect(screen.queryByText('owner@cortek.io')).toBeNull();
  });

  it('names the company whose settings they are', () => {
    mountOnRecord();
    const trigger = screen.getAllByRole('button', { name: /rental settings/i })[0];
    expect(trigger.textContent).toContain("Mahadi's Rentals");
  });

  it('opens straight onto the actions, with no second Rental Settings row', async () => {
    mountOnRecord();
    await press(/rental settings/i);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /mark as production/i })).toBeTruthy(),
    );
    for (const a of ACTIONS) {
      expect(screen.getByRole('menuitem', { name: a.label }), a.label).toBeTruthy();
    }
    // The trigger IS "Rental Settings", so nesting them behind a second row
    // of the same name would say it twice.
    expect(screen.queryByRole('menuitem', { name: /^rental settings$/i })).toBeNull();
  });

  it('offers no way to sign out from a record page', async () => {
    mountOnRecord();
    await press(/rental settings/i);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /delete company/i })).toBeTruthy(),
    );
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();
  });

  it('still dispatches the action chosen', async () => {
    const onAction = mountOnRecord();
    await press(/rental settings/i);
    const item = await screen.findByRole('menuitem', { name: 'Force Logout All Users' });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onAction).toHaveBeenCalledWith('force-logout');
  });

  it('gives sign out back the moment no record is open', async () => {
    // The load-bearing one. Sign out has no other home in this app, so if
    // this ever fails nobody can leave.
    render(
      <SidebarProvider>
        <SidebarSectionsProvider>
          <Sidebar />
        </SidebarSectionsProvider>
      </SidebarProvider>,
    );
    expect(screen.queryByRole('button', { name: /rental settings/i })).toBeNull();
    await press(/account menu/i);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy(),
    );
  });
});
