/**
 * Team page (/users) on v2: the page-level wiring behind the plain list.
 *
 * users-team-lane-v2.test.tsx renders the list on its own and checks that each
 * menu item calls its handler. This file renders the whole page on v2 and
 * checks that each handler the page passes still does what v1's inline menu
 * did: open the same dialog for the same person, or call the same edge
 * function with the same body. It also covers the page's load error and the
 * Add User pill, which the list test cannot reach.
 *
 * Expected values are worked out by hand from the page source:
 *  - generatePassword() is 4 fixed-class characters plus 12 more, so 16 long.
 *  - Deactivate on an active row sends isActive: !true = false.
 *  - Change Role from manager to admin: the mutation gets { userId, newRole }
 *    only (permissions are spread in for 'manager' alone), and the body is
 *    { userId, newRole, ...{} }, so { userId: 'u-man', newRole: 'admin' }.
 *  - Edit Permissions reads db.perms back as { tab_key, access_level } pairs
 *    and Save sends them unchanged: [{ tab_key: 'vehicles', access_level: 'editor' }].
 *  - Creating a viewer sends no permissions key (the form strips it and the
 *    body spreads it in for 'manager' only), and tenant_id is the context's 't1'.
 *  - describeLoadError({ message: 'boom' }) matches no network, timeout,
 *    permission or JWT wording and has no code, so it is the generic line.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppUser } from '@/stores/auth-store';

const HEAD_ADMIN: AppUser = {
  id: 'u-head',
  auth_user_id: 'auth-head',
  tenant_id: 't1',
  email: 'ada@example.com',
  name: 'Ada Head',
  role: 'head_admin',
  is_active: true,
  must_change_password: false,
  created_at: '2026-09-10T10:00:00Z',
  updated_at: '2026-09-10T10:00:00Z',
};
const MANAGER: AppUser = {
  ...HEAD_ADMIN,
  id: 'u-man',
  auth_user_id: 'auth-man',
  email: 'max@example.com',
  name: 'Max Manager',
  role: 'manager',
  created_at: '2026-09-12T10:00:00Z',
};

const db = vi.hoisted(() => ({
  users: [] as unknown[],
  usersError: null as unknown,
  perms: [] as unknown[],
  eqCalls: [] as Array<[string, string, unknown]>,
  invoke: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
}));

vi.mock('@/stores/auth-store', () => ({ useAuth: () => ({ appUser: HEAD_ADMIN }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1' } }) }));
vi.mock('@/hooks/use-audit-log', () => ({ useAuditLog: () => ({ logAction: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => {
  const table = (name: string) => {
    const builder: any = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => {
        db.eqCalls.push([name, column, value]);
        return builder;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (name === 'app_users') {
          return resolve(db.usersError ? { data: null, error: db.usersError } : { data: db.users, error: null });
        }
        if (name === 'manager_permissions') return resolve({ data: db.perms, error: null });
        return resolve({ data: [], error: null });
      },
    };
    return builder;
  };
  return {
    supabase: {
      from: (name: string) => table(name),
      functions: { invoke: (...args: unknown[]) => (db.invoke as any)(...args) },
    },
    supabaseUntyped: {},
  };
});

import UsersManagement from '@/app/(dashboard)/users/page';
import { V2Provider } from '@/lib/v2-context';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <V2Provider flags={{ chrome: true }}>
        <UsersManagement />
      </V2Provider>
    </QueryClientProvider>,
  );
}

/** Opens a row's menu (the table copy, not the stacked copy) and clicks one item by its label. */
async function chooseFromRowMenu(container: HTMLElement, person: string, label: string) {
  await waitFor(() =>
    expect(container.querySelector(`table button[aria-label="Actions for ${person}"]`)).not.toBeNull(),
  );
  const trigger = container.querySelector(`table button[aria-label="Actions for ${person}"]`)!;
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
  });
  const items = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]')) as HTMLElement[];
  const item = items.find((i) => i.textContent === label);
  expect(item, `menu item ${label}`).toBeDefined();
  await act(async () => {
    item!.click();
  });
}

const dialogTitled = (title: string, role: 'dialog' | 'alertdialog' = 'dialog') =>
  Array.from(document.body.querySelectorAll(`[role="${role}"]`)).find(
    (d) => d.querySelector('h2')?.textContent === title,
  ) as HTMLElement | undefined;

/**
 * Picks one option in a Radix Select the way a tap does: a click on the
 * trigger opens it (a non-mouse pointer opens on click) and a click on the
 * option selects it.
 */
async function pickOption(trigger: HTMLElement, label: string) {
  await act(async () => {
    fireEvent.click(trigger);
  });
  const option = await waitFor(() => {
    const found = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent === label,
    );
    expect(found, `option ${label}`).toBeDefined();
    return found as HTMLElement;
  });
  await act(async () => {
    fireEvent.click(option);
  });
  await waitFor(() => expect(document.body.querySelector('[role="listbox"]')).toBeNull());
}

beforeEach(() => {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  // jsdom has no scrollIntoView; an opening Radix Select scrolls its first option into view.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  db.users = [MANAGER, HEAD_ADMIN];
  db.usersError = null;
  db.perms = [{ tab_key: 'vehicles', access_level: 'editor' }];
  db.eqCalls = [];
  db.invoke = vi.fn(async () => ({ data: { success: true }, error: null }));
});
afterEach(cleanup);

/**
 * Each test renders the whole page and walks Radix menus and dialogs: about
 * 1-3s alone, and the first one (cold imports) went past vitest's default 5s
 * when this file ran beside fourteen others.
 */
const PAGE_TEST = { timeout: 20_000 };

describe('/users on v2: each row action still does what v1 did', PAGE_TEST, () => {
  it('Reset Password opens the Reset Password dialog for that person, with a generated 16-character password', async () => {
    const { container } = renderPage();
    await chooseFromRowMenu(container, 'Max Manager', 'Reset Password');
    const dialog = await waitFor(() => {
      const d = dialogTitled('Reset Password');
      expect(d).toBeDefined();
      return d!;
    });
    expect(dialog.textContent).toContain('Reset password for Max Manager (max@example.com)');
    expect((within(dialog).getByLabelText('New Password') as HTMLInputElement).value).toHaveLength(16);
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it('Change Role opens Change User Role for that person', async () => {
    const { container } = renderPage();
    await chooseFromRowMenu(container, 'Max Manager', 'Change Role');
    const dialog = await waitFor(() => {
      const d = dialogTitled('Change User Role');
      expect(d).toBeDefined();
      return d!;
    });
    expect(dialog.textContent).toContain('Change role for Max Manager (max@example.com)');
  });

  it("Edit Permissions reads that manager's saved permissions, then opens Edit Manager Permissions", async () => {
    const { container } = renderPage();
    await chooseFromRowMenu(container, 'Max Manager', 'Edit Permissions');
    const dialog = await waitFor(() => {
      const d = dialogTitled('Edit Manager Permissions');
      expect(d).toBeDefined();
      return d!;
    });
    expect(db.eqCalls).toContainEqual(['manager_permissions', 'app_user_id', 'u-man']);
    expect(dialog.textContent).toContain('Update tab access for Max Manager (max@example.com)');
  });

  it('Deactivate calls admin-deactivate-user at once, with no dialog, exactly as v1', async () => {
    const { container } = renderPage();
    await chooseFromRowMenu(container, 'Max Manager', 'Deactivate');
    await waitFor(() => expect(db.invoke).toHaveBeenCalledTimes(1));
    expect(db.invoke).toHaveBeenCalledWith('admin-deactivate-user', { body: { userId: 'u-man', isActive: false } });
    expect(document.body.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
  });

  it('Change Role, then Admin and Update Role, calls admin-update-role with that person and the new role', async () => {
    const { container } = renderPage();
    await chooseFromRowMenu(container, 'Max Manager', 'Change Role');
    const dialog = await waitFor(() => {
      const d = dialogTitled('Change User Role');
      expect(d).toBeDefined();
      return d!;
    });
    await pickOption(within(dialog).getByRole('combobox'), 'Admin - Full access except user management');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Update Role' }));
    });
    await waitFor(() => expect(db.invoke).toHaveBeenCalledTimes(1));
    expect(db.invoke).toHaveBeenCalledWith('admin-update-role', { body: { userId: 'u-man', newRole: 'admin' } });
    // On success the dialog closes, as on v1.
    await waitFor(() => expect(dialogTitled('Change User Role')).toBeUndefined());
  });

  it("Edit Permissions, then Save Permissions, sends that manager's permissions to update-manager-permissions", async () => {
    const { container } = renderPage();
    await chooseFromRowMenu(container, 'Max Manager', 'Edit Permissions');
    const dialog = await waitFor(() => {
      const d = dialogTitled('Edit Manager Permissions');
      expect(d).toBeDefined();
      return d!;
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Permissions' }));
    });
    await waitFor(() => expect(db.invoke).toHaveBeenCalledTimes(1));
    expect(db.invoke).toHaveBeenCalledWith('update-manager-permissions', {
      body: { userId: 'u-man', permissions: [{ tab_key: 'vehicles', access_level: 'editor' }] },
    });
    await waitFor(() => expect(dialogTitled('Edit Manager Permissions')).toBeUndefined());
  });

  it("the signed-in head admin's own row offers only Reset Password", async () => {
    const { container } = renderPage();
    await waitFor(() =>
      expect(container.querySelector('table button[aria-label="Actions for Ada Head"]')).not.toBeNull(),
    );
    act(() => {
      container
        .querySelector('table button[aria-label="Actions for Ada Head"]')!
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    });
    const labels = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]')).map(
      (i) => i.textContent,
    );
    expect(labels).toEqual(['Reset Password']);
  });
});

describe('/users on v2: the header pill, creating a user and the load error', PAGE_TEST, () => {
  it('Add User opens Add New User, with no icon in its title', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const dialog = await waitFor(() => {
      const d = dialogTitled('Add New User');
      expect(d).toBeDefined();
      return d!;
    });
    expect(dialog.querySelector('h2 svg')).toBeNull();
  });

  it('creating a user calls admin-create-user, then shows the credentials once in User Created Successfully', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const dialog = await waitFor(() => {
      const d = dialogTitled('Add New User');
      expect(d).toBeDefined();
      return d!;
    });
    fireEvent.change(within(dialog).getByLabelText(/Full Name/), { target: { value: 'Nia New' } });
    fireEvent.change(within(dialog).getByLabelText(/Email Address/), { target: { value: 'nia@example.com' } });
    await pickOption(within(dialog).getByRole('combobox'), 'Viewer - Read-only access');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create User' }));
    });

    const credentials = await waitFor(() => {
      const d = dialogTitled('User Created Successfully', 'alertdialog');
      expect(d).toBeDefined();
      return d!;
    });

    // First the account, then the welcome email, with the same password.
    expect(db.invoke).toHaveBeenCalledTimes(2);
    const [createName, createArgs] = db.invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(createName).toBe('admin-create-user');
    expect(createArgs.body).toEqual({
      email: 'nia@example.com',
      name: 'Nia New',
      role: 'viewer',
      temporaryPassword: expect.any(String),
      tenant_id: 't1',
    });
    const password = createArgs.body.temporaryPassword as string;
    expect(password).toHaveLength(16);
    expect(db.invoke.mock.calls[1]).toEqual([
      'send-user-welcome-email',
      { body: { email: 'nia@example.com', name: 'Nia New', temporaryPassword: password, tenant_id: 't1' } },
    ]);

    // The modal shows the same email and password that were sent, and the
    // Add dialog has closed behind it.
    expect(credentials.textContent).toContain('Nia New has been created.');
    expect((within(credentials).getByLabelText('Email') as HTMLInputElement).value).toBe('nia@example.com');
    expect((within(credentials).getByLabelText('Temporary Password') as HTMLInputElement).value).toBe(password);
    await waitFor(() => expect(dialogTitled('Add New User')).toBeUndefined());
  });

  it('a failed load says so in plain words, and Try again loads the team', async () => {
    db.usersError = { message: 'boom' };
    const { container } = renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load your team");
    expect(alert.textContent).toContain('Something went wrong on our side. Nothing was changed.');
    expect(alert.textContent).not.toContain('boom');
    expect(container.querySelector('table')).toBeNull();

    db.usersError = null;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * Team is a SETTINGS page, so it uses the settings page column.
 *
 * It kept v1's `container mx-auto p-4 sm:p-6` after the v2 lane was built: a
 * max-width that grows with the breakpoint (1536px at 2xl) against the flat
 * 1160px every other v2 settings page uses, so on a wide screen the table ran
 * half as wide again as the pages either side of it — one row of four columns
 * reading as mostly empty space — and the title sat off the `md:pt-[26px]`
 * baseline that lines every Settings heading up with the sidebar switch.
 *
 * Read from the source rather than the DOM because the column is chosen on
 * `v2Chrome`, and the point is that the two branches differ: v1 must keep its
 * container.
 */
describe('/users on v2: the page column', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/(dashboard)/users/page.tsx'),
    'utf8',
  );

  it('uses the 1160px settings column on v2, with the shared top offset', () => {
    expect(source).toContain('w-full max-w-[1160px] space-y-8 pb-6 md:pt-[26px]');
    // The beside-Trax hook is interpolated like every other settings column.
    // It is an empty string today (settings-kit.tsx) — Settings no longer
    // reflows for the panel — but the seam stays wired.
    expect(source).toContain('SETTINGS_COLUMN_BESIDE_TRAX');
  });

  it('leaves v1 on its own container', () => {
    expect(source).toContain('container mx-auto p-4 sm:p-6 space-y-6');
  });

  it('gives the access-denied screen the same column, so the title does not jump', () => {
    expect(source).toContain('w-full max-w-[1160px] pb-6 md:pt-[26px] space-y-1');
  });
});
