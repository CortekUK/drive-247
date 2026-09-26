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
 * Company controls sit behind one row, not loose in the account menu.
 *
 * They were listed flat at first, under the record's name as a heading. Four
 * of them — two that change what a live company IS, and one that deletes it —
 * sat directly above Sign out, in a menu whose subject is the signed-in
 * person rather than the record. Asked the same day to group them behind a
 * single "Rental Settings" row.
 */
describe('company controls are grouped behind Rental Settings', () => {
  const ACTIONS = [
    { id: 'production', label: 'Mark as Production', tone: 'active' as const },
    { id: 'test', label: 'Mark as Test' },
    { id: 'status', label: 'Suspend company' },
    { id: 'delete', label: 'Delete company', tone: 'destructive' as const },
  ];

  function Harness({ onAction }: { onAction: (id: string) => void }) {
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

  function mountWithRecord(onAction = vi.fn()) {
    render(
      <SidebarProvider>
        <SidebarSectionsProvider>
          <Harness onAction={onAction} />
          <Sidebar />
        </SidebarSectionsProvider>
      </SidebarProvider>,
    );
    return onAction;
  }

  async function openAccountMenu() {
    await act(async () => {
      fireEvent.pointerDown(
        screen.getAllByRole('button', { name: /account menu/i })[0],
        { ctrlKey: false, button: 0 },
      );
    });
  }

  it('shows one row, not the four actions', async () => {
    mountWithRecord();
    await openAccountMenu();

    await waitFor(() => expect(screen.getByText('Rental Settings')).toBeTruthy());
    // None of them is loose in the top level of the menu.
    for (const a of ACTIONS) {
      expect(screen.queryByRole('menuitem', { name: a.label })).toBeNull();
    }
    // Sign out is still right there, one press away.
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy();
  });

  it('reveals them when that row is opened, under the company name', async () => {
    mountWithRecord();
    await openAccountMenu();

    const trigger = await screen.findByText('Rental Settings');
    await act(async () => {
      fireEvent.pointerDown(trigger, { ctrlKey: false, button: 0 });
      fireEvent.click(trigger);
    });

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /mark as production/i })).toBeTruthy();
    });
    for (const a of ACTIONS) {
      expect(screen.getByRole('menuitem', { name: a.label }), a.label).toBeTruthy();
    }
    // Which company they belong to — a heading inside, noise outside.
    //
    // Scoped to the submenu on purpose: the name also titles the rail itself,
    // so a bare `getByText` finds two and throws. Two is CORRECT here — the
    // rail says whose page this is, the submenu says whose settings these are.
    const submenu = screen
      .getByRole('menuitem', { name: /mark as production/i })
      .closest('[role="menu"]');
    expect(submenu).not.toBeNull();
    expect(submenu!.textContent).toContain("Mahadi's Rentals");
  });

  it('still dispatches the action that was chosen', async () => {
    const onAction = mountWithRecord();
    await openAccountMenu();

    const trigger = await screen.findByText('Rental Settings');
    await act(async () => {
      fireEvent.pointerDown(trigger, { ctrlKey: false, button: 0 });
      fireEvent.click(trigger);
    });

    const suspend = await screen.findByRole('menuitem', { name: 'Suspend company' });
    await act(async () => {
      fireEvent.click(suspend);
    });
    expect(onAction).toHaveBeenCalledWith('status');
  });

  it('offers no Rental Settings row when no record is open', async () => {
    // The dashboard and every list register no actions.
    render(
      <SidebarProvider>
        <SidebarSectionsProvider>
          <Sidebar />
        </SidebarSectionsProvider>
      </SidebarProvider>,
    );
    await openAccountMenu();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeTruthy());
    expect(screen.queryByText('Rental Settings')).toBeNull();
  });
});
