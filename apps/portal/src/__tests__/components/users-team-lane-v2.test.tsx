/**
 * Team page (/users) on v2, from the team lead's Settings walkthrough (Sep 2026):
 *
 *  - "The header should be like the one on Vehicles. We don't use icons like
 *    these." -> h1 "Team" with no icon, one line under it, one labelled pill.
 *  - "'Search by name and email', we don't need it." -> no search on v2.
 *  - "Don't show it like a card. Not the table-inside-a-card format. Simple,
 *    just show a simple list." -> the list sits on the page with no card.
 *
 * Every other tenant keeps the v1 page: the second half of each page test
 * renders the same page with the v2 flag off and checks v1's own markers
 * (the icon title, the search box, the Team Members card) are all still there.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { AppUser } from '@/stores/auth-store';

/* ---------------------------------------------------------------- mocks -- */

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
  must_change_password: true,
  created_at: '2026-09-12T10:00:00Z',
};
const INACTIVE_VIEWER: AppUser = {
  ...HEAD_ADMIN,
  id: 'u-view',
  // No login account: the "Can't sign in" flag.
  auth_user_id: null as unknown as string,
  email: 'vic@example.com',
  name: null,
  role: 'viewer',
  is_active: false,
  created_at: '2026-09-11T10:00:00Z',
};

let signedIn: AppUser = HEAD_ADMIN;
let rows: AppUser[] = [];

vi.mock('@/stores/auth-store', () => ({ useAuth: () => ({ appUser: signedIn }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1' } }) }));
vi.mock('@/hooks/use-audit-log', () => ({ useAuditLog: () => ({ logAction: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => {
  // from().select().order().eq() and then awaited: every step returns the
  // same thenable builder.
  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  return {
    supabase: { from: () => builder, functions: { invoke: vi.fn() } },
    supabaseUntyped: {},
  };
});

import UsersManagement from '@/app/(dashboard)/users/page';
import { AddUserDialog } from '@/components/users/add-user-dialog';
import { CredentialsModal } from '@/components/users/credentials-modal';
import { CANT_SIGN_IN_HINT, TEAM_LIST_COPY, UsersTableV2 } from '@/components/admin-v2/users-table-v2';
import { HEADER_PRIMARY_V2 } from '@/components/shared/header-icon-button-v2';
import { SETTINGS_PAGE_TITLE, SettingsPageHeader } from '@/components/settings-v2/settings-kit';
import { V2Provider } from '@/lib/v2-context';

afterEach(cleanup);

/* -------------------------------------------------------------- helpers -- */

const noop = () => {};
const roleLabel = (role: string) =>
  ({ head_admin: 'Head Admin', admin: 'Admin', manager: 'Manager', ops: 'Operations', viewer: 'Viewer' })[role] ?? role;

function renderList(props: Partial<Parameters<typeof UsersTableV2>[0]> = {}) {
  const handlers = {
    onResetPassword: vi.fn(),
    onChangeRole: vi.fn(),
    onEditPermissions: vi.fn(),
    onToggleActive: vi.fn(),
  };
  const view = render(
    <UsersTableV2
      users={[MANAGER, INACTIVE_VIEWER, HEAD_ADMIN]}
      currentUserId={HEAD_ADMIN.id}
      roleLabel={roleLabel}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, handlers };
}

/** Radix menus measure with a constructible ResizeObserver, which the shared setup mock is not. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Opens a Radix menu the way a mouse does, and returns its item labels. */
function openMenu(trigger: Element) {
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  act(() => {
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
  });
  const items = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]')) as HTMLElement[];
  return { items, labels: items.map((i) => i.textContent) };
}

function renderPage(v2: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <V2Provider flags={{ chrome: v2 }}>{children}</V2Provider>
    </QueryClientProvider>
  );
  return render(wrap(<UsersManagement />));
}

/* ------------------------------------------------------------ the list -- */

describe('UsersTableV2: a simple list, straight on the page', () => {
  it('has no card around it and no second surface inside one', () => {
    const { container } = renderList();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    expect(container.querySelector('[data-slot="card-content"]')).toBeNull();
    // No inner scroll box either: the list is as tall as the team.
    expect(container.innerHTML).not.toContain('max-h-[520px]');
  });

  it('shows four visible, centred headings with no sort control', () => {
    const { container } = renderList();
    const heads = Array.from(container.querySelectorAll('thead th'));
    expect(heads.map((h) => h.textContent)).toEqual(['Name', 'Role', 'Status', 'Actions']);
    for (const h of heads) {
      expect(h.classList).toContain('text-center');
      expect(h.querySelector('button, svg, .sr-only')).toBeNull();
      expect(h.getAttribute('aria-sort')).toBeNull();
    }
  });

  it('keeps the page order (newest first comes from the query) and puts the email under the name', () => {
    const { container } = renderList();
    const bodyRows = Array.from(container.querySelectorAll('tbody tr'));
    expect(bodyRows).toHaveLength(3);
    const firstCells = bodyRows.map((r) => r.querySelector('td')!);
    // Name then email, in one cell. A missing name reads N/A, as on v1.
    expect(firstCells.map((c) => Array.from(c.children).map((s) => s.textContent))).toEqual([
      ['Max Manager', 'max@example.com'],
      ['N/A', 'vic@example.com'],
      ['Ada Head', 'ada@example.com'],
    ]);
    for (const c of firstCells) expect(c.classList).toContain('text-center');
  });

  it('role is plain text and status is coloured text, never a pill', () => {
    const { container } = renderList();
    const [manager, viewer] = Array.from(container.querySelectorAll('tbody tr'));
    const cells = (row: Element) => Array.from(row.querySelectorAll('td'));

    expect(cells(manager)[1].textContent).toBe('Manager');
    const active = within(cells(manager)[2] as HTMLElement).getByText('Active');
    expect(active.className).toContain('text-emerald-600');
    expect(active.className).not.toMatch(/\bbg-|rounded/);

    const inactive = within(cells(viewer)[2] as HTMLElement).getByText('Inactive');
    expect(inactive.className).toContain('text-red-500');
    expect(inactive.className).not.toMatch(/\bbg-|rounded/);
  });

  it("flags a row with no login account and a temporary password, as text lines under the status", () => {
    const { container } = renderList();
    const [manager, viewer, head] = Array.from(container.querySelectorAll('tbody tr')).map(
      (r) => r.querySelectorAll('td')[2] as HTMLElement,
    );
    expect(within(manager).getByText('Temporary password')).toBeTruthy();
    expect(within(manager).queryByText("Can't sign in")).toBeNull();

    const flag = within(viewer).getByText("Can't sign in");
    expect(flag.getAttribute('title')).toBe(CANT_SIGN_IN_HINT);
    // The list kit's danger tone, the same red as "Inactive" above it.
    expect(flag.className).toContain('text-red-500');
    expect(flag.className).toContain('dark:text-red-400');
    expect(flag.className).not.toMatch(/\bbg-|rounded/);

    expect(head.textContent).toBe('Active');
  });

  it('draws no icons: the only svg on each row is the ⋯ menu trigger', () => {
    const { container } = renderList();
    const table = container.querySelector('table')!;
    const triggers = Array.from(table.querySelectorAll('button[aria-label^="Actions for"]'));
    expect(triggers).toHaveLength(3);
    expect(table.querySelectorAll('svg')).toHaveLength(3);
    for (const t of triggers) expect(t.querySelectorAll('svg')).toHaveLength(1);
    // The phone rows, likewise.
    const list = container.querySelector('ul[aria-label="Team"]')!;
    expect(list.querySelectorAll('svg')).toHaveLength(3);
  });

  it('the menu trigger is a block centred under the Actions heading', () => {
    const { container } = renderList();
    const trigger = container.querySelector('table button[aria-label="Actions for Max Manager"]')!;
    expect(trigger.classList).toContain('mx-auto');
    expect(trigger.classList).toContain('flex');
    expect(trigger.closest('td')!.classList).toContain('text-center');
  });

  it('a manager row offers every action; the handlers get that row', () => {
    const { container, handlers } = renderList();
    const trigger = container.querySelector('table button[aria-label="Actions for Max Manager"]')!;
    const { items, labels } = openMenu(trigger);
    expect(labels).toEqual(['Reset Password', 'Change Role', 'Edit Permissions', 'Deactivate']);
    // Text only: no icon in any item, and the content is sized to its labels.
    for (const item of items) expect(item.querySelector('svg')).toBeNull();
    expect(document.body.querySelector('[data-slot="dropdown-menu-content"]')!.classList).toContain('w-auto');

    act(() => items[2].click());
    expect(handlers.onEditPermissions).toHaveBeenCalledWith(MANAGER);
  });

  it('an inactive viewer offers Activate and no Edit Permissions', () => {
    const { container, handlers } = renderList();
    // A row with no name is named by its email.
    const trigger = container.querySelector('table button[aria-label="Actions for vic@example.com"]')!;
    const { items, labels } = openMenu(trigger);
    expect(labels).toEqual(['Reset Password', 'Change Role', 'Activate']);
    act(() => items[2].click());
    expect(handlers.onToggleActive).toHaveBeenCalledWith(INACTIVE_VIEWER);
  });

  it('your own head admin row offers only Reset Password (no Change Role, no Deactivate)', () => {
    const { container, handlers } = renderList();
    const trigger = container.querySelector('table button[aria-label="Actions for Ada Head"]')!;
    const { items, labels } = openMenu(trigger);
    expect(labels).toEqual(['Reset Password']);
    act(() => items[0].click());
    expect(handlers.onResetPassword).toHaveBeenCalledWith(HEAD_ADMIN);
  });

  it('a head admin who is not you still has no Change Role, but can be deactivated', () => {
    const { container } = renderList({ currentUserId: 'someone-else' });
    const trigger = container.querySelector('table button[aria-label="Actions for Ada Head"]')!;
    expect(openMenu(trigger).labels).toEqual(['Reset Password', 'Deactivate']);
  });
});

describe('UsersTableV2: loading, empty and error', () => {
  it('loading: a busy status with a spoken label, and no table yet', () => {
    const { container } = renderList({ users: undefined, loading: true });
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain(TEAM_LIST_COPY.loading);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('empty: one plain line, no table, no icon', () => {
    const { container } = renderList({ users: [] });
    expect(TEAM_LIST_COPY.empty).toBe(
      'No one has been added yet. Select "Add User" to give someone access to your portal.',
    );
    expect(screen.getByText(TEAM_LIST_COPY.empty)).toBeTruthy();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('error with nothing loaded: says so in plain words, and Try again calls the retry', () => {
    const onRetry = vi.fn();
    const { container, rerender } = renderList({ users: undefined, error: new Error('boom'), onRetry });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load your team");
    // describeLoadError's generic line: no raw error text reaches the screen.
    expect(alert.textContent).toContain('Something went wrong on our side. Nothing was changed.');
    expect(alert.textContent).not.toContain('boom');
    expect(container.querySelector('svg')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(
      <UsersTableV2
        users={undefined}
        error={new Error('boom')}
        onRetry={onRetry}
        retrying
        currentUserId={HEAD_ADMIN.id}
        roleLabel={roleLabel}
        onResetPassword={noop}
        onChangeRole={noop}
        onEditPermissions={noop}
        onToggleActive={noop}
      />,
    );
    const busy = within(screen.getByRole('alert')).getByRole('button');
    expect(busy.textContent).toBe('Trying…');
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed refresh over rows already loaded keeps showing the rows', () => {
    const { container } = renderList({ error: new Error('boom') });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});

/* ------------------------------------------------------------ the page -- */

describe('/users page: v2 header, no search, no card; v1 unchanged', () => {
  beforeEach(() => {
    signedIn = HEAD_ADMIN;
    rows = [MANAGER, INACTIVE_VIEWER, HEAD_ADMIN];
  });

  it('v2: titled Team with no icon, one line under it, and one "Add User" pill (Add Vehicle / Add Customer case)', async () => {
    const { container } = renderPage(true);
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe('Team');
    expect(h1.querySelector('svg')).toBeNull();
    // The SETTINGS page title, not the list-page one: Team opens from the
    // Settings index, and the list-page heading grows to text-3xl from `sm`,
    // which left it a step larger than every Settings heading beside it.
    expect(h1.className).toBe(SETTINGS_PAGE_TITLE);
    expect(h1.className).not.toContain('sm:text-3xl');
    expect(h1.nextElementSibling!.textContent).toBe(
      'Add people to your portal and choose what each person can see and change.',
    );

    const headerButtons = Array.from(h1.closest('div')!.parentElement!.querySelectorAll('button'));
    expect(headerButtons.map((b) => b.textContent)).toEqual(['Add User']);
    for (const cls of HEADER_PRIMARY_V2.split(' ')) expect(headerButtons[0].classList).toContain(cls);

    expect(screen.queryByText('Manage Users')).toBeNull();
    expect(screen.queryByText('Team Members')).toBeNull();
  });

  // Team is the one Settings page whose header carries an action, so it draws
  // its own header instead of `SettingsPageHeader`. It must still READ as that
  // header: same gap under the title, same 14px description with the same
  // measure cap. Hand-rolled, the description grew to 16px from `sm` and had no
  // cap, so it sat a size larger than every other v2 settings page.
  it('v2: the header box and its description match the kit\'s SettingsPageHeader', () => {
    const reference = render(
      <SettingsPageHeader title="Team" description="Add people to your portal and choose what each person can see and change." />,
    );
    const refHeader = reference.container.firstElementChild as HTMLElement;
    const refDescription = refHeader.querySelector('p')!;
    reference.unmount();

    const { container } = renderPage(true);
    const h1 = container.querySelector('h1')!;
    const box = h1.parentElement as HTMLElement;
    const description = h1.nextElementSibling as HTMLElement;
    // The same vertical rhythm as the kit's header, and the same description.
    for (const cls of refHeader.className.split(/\s+/)) expect(box.className.split(/\s+/), cls).toContain(cls);
    expect(description.className.split(/\s+/).sort()).toEqual(refDescription.className.split(/\s+/).sort());
  });

  it('v2: no search box, no card, and the people are listed', async () => {
    const { container } = renderPage(true);
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(3));
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-slot="card"]')).toBeNull();
    // v1's Card is `rounded-lg border bg-card`; nothing on the v2 page is.
    expect(container.querySelector('.rounded-lg.border.bg-card')).toBeNull();
    expect(screen.getAllByText('Max Manager').length).toBeGreaterThan(0);
  });

  it('v1: the icon title, the search box and the Team Members card are all still there', async () => {
    const { container } = renderPage(false);
    const h1 = container.querySelector('h1')!;
    expect(h1.textContent).toBe('Manage Users');
    expect(h1.querySelector('svg')).not.toBeNull();
    expect(h1.className).toBe('text-2xl sm:text-3xl font-bold flex items-center gap-2');
    expect(screen.getByPlaceholderText('Search by name or email...')).toBeTruthy();
    expect(screen.getByText('Team Members')).toBeTruthy();
    expect(container.querySelector('.rounded-lg.border.bg-card')).not.toBeNull();
    await waitFor(() => expect(screen.getByText('max@example.com')).toBeTruthy());
    // v1's own columns, including the Created date the v2 list leaves out.
    expect(Array.from(container.querySelectorAll('thead th')).map((h) => h.textContent)).toEqual([
      'Name',
      'Email',
      'Role',
      'Status',
      'Created',
      'Actions',
    ]);
    const addButton = screen.getByRole('button', { name: 'Add User' });
    expect(addButton.classList).toContain('w-full');
    expect(addButton.classList).not.toContain('rounded-full');
  });

  it('v2: a signed-in admin who is not the head admin is refused in plain text', () => {
    signedIn = { ...HEAD_ADMIN, role: 'admin' };
    const { container } = renderPage(true);
    expect(container.querySelector('h1')!.textContent).toBe('Team');
    expect(container.textContent).toContain('Only head admins can add people or change their access.');
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('v1: the same refusal is v1\'s alert, word for word', () => {
    signedIn = { ...HEAD_ADMIN, role: 'admin' };
    const { container } = renderPage(false);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(
      'Access denied. Only head administrators can manage users.',
    );
  });
});

/* --------------------------------------------------------- the dialogs -- */

describe('Team dialogs: v2 drops the decorative icons, v1 keeps them', () => {
  const heading = () => document.body.querySelector('[role="dialog"] h2, [role="alertdialog"] h2')!;

  it('Add New User: no icon in the v2 title and a plain-words line under it; v1 keeps its UserPlus and its line', () => {
    const description = () => document.body.querySelector('[role="dialog"] h2 + p')!;
    render(<AddUserDialog open onOpenChange={noop} onSubmit={noop} v2 />);
    expect(heading().textContent).toBe('Add New User');
    expect(heading().querySelector('svg')).toBeNull();
    expect(description().textContent).toBe(
      'Add someone to your portal. They will get an email with their sign-in details.',
    );
    cleanup();

    render(<AddUserDialog open onOpenChange={noop} onSubmit={noop} />);
    expect(heading().querySelector('svg')).not.toBeNull();
    expect(heading().className).toContain('flex items-center gap-2');
    expect(description().textContent).toBe(
      'Create a new user account for this tenant. They will receive an email with login credentials.',
    );
  });

  it('credentials: no tick in the v2 title and no warning triangle, but both copy buttons keep their icon', () => {
    const credentials = { name: 'Max', email: 'max@example.com', password: 'Temp-Pass-1!' };
    render(<CredentialsModal open onOpenChange={noop} credentials={credentials} v2 />);
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    expect(heading().textContent).toBe('User Created Successfully');
    expect(heading().querySelector('svg')).toBeNull();
    // The only icons left are the two copy controls.
    const svgs = Array.from(dialog.querySelectorAll('svg'));
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) expect(svg.closest('button')).not.toBeNull();
    // The warning is still said, in words.
    expect(dialog.textContent).toContain('The password is shown only once and cannot be recovered.');
    cleanup();

    render(<CredentialsModal open onOpenChange={noop} credentials={credentials} />);
    const v1 = document.body.querySelector('[role="alertdialog"]')!;
    expect(heading().querySelector('svg')).not.toBeNull();
    expect(v1.querySelectorAll('svg')).toHaveLength(4);
  });
});
