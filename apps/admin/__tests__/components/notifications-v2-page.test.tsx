/**
 * The rendered admin Notifications page (/admin/notifications).
 *
 * Everything below the page is mocked at the module boundary: the auth store
 * (who is signed in), the settings hook (what is stored, and whether the SQL
 * has been applied) and the test-send hook. Nothing here touches Supabase.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  SYSTEM_DIRECTION_GROUPS,
  SYSTEM_NOTIFICATIONS_COPY as COPY,
  categoryGroups,
  itemChannels,
} from '@/components/admin/notifications-v2/system-notifications-model';
import { SYSTEM_NOTIFICATION_CATALOG, type SystemNotificationItem } from '@/lib/notifications-v2/catalog';
import type { PlatformNotificationSettingRow } from '@/lib/notifications-v2/types';

/* ------------------------------- the mocks -------------------------------- */

interface FakeUser {
  id: string;
  email: string;
  name: string;
  is_primary_super_admin: boolean;
  is_super_admin?: boolean;
  is_sales_agent?: boolean;
}

const SUPER_ADMIN: FakeUser = {
  id: 'u1',
  email: 'ops@drive-247.com',
  name: 'Ops',
  is_primary_super_admin: true,
  is_super_admin: true,
};

const SALES_ONLY: FakeUser = {
  id: 'u2',
  email: 'sales@drive-247.com',
  name: 'Sales',
  is_primary_super_admin: false,
  is_super_admin: false,
  is_sales_agent: true,
};

const authState = { user: SUPER_ADMIN as FakeUser | null };

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => authState,
}));

/** The SettingsDiff the page hands the hook: declared so the call can be read back. */
interface SavedWrite {
  upserts: PlatformNotificationSettingRow[];
  deletes: { notification_key: string; channel: string }[];
}

const saveRows = vi.fn(async (_write: SavedWrite): Promise<void> => {});
const refresh = vi.fn(async (): Promise<void> => {});

const settingsState = {
  rows: [] as PlatformNotificationSettingRow[],
  isLoading: false,
  isSaving: false,
  error: null as Error | null,
  tableMissing: false,
  refresh,
  saveRows,
  resetRows: vi.fn(async () => {}),
};

vi.mock('@/hooks/use-platform-notification-settings', () => ({
  usePlatformNotificationSettings: () => settingsState,
}));

const sendTest = vi.fn(async () => ({ success: true, message: 'Sent.' }));
vi.mock('@/hooks/use-platform-notification-test', () => ({
  usePlatformNotificationTest: () => ({ sendTest, isSending: false, lastResult: null }),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// Imported after the mocks are registered.
const { SystemNotificationsPage } = await import(
  '@/components/admin/notifications-v2/system-notifications-page'
);

/* ------------------------------- helpers ---------------------------------- */

function renderPage() {
  return render(
    <TooltipProvider>
      <SystemNotificationsPage />
    </TooltipProvider>,
  );
}

/** The first item that is editable here and offers this channel. */
function firstEditable(channel: 'email' | 'push' | 'in_app'): SystemNotificationItem {
  const found = SYSTEM_NOTIFICATION_CATALOG.find((i) => !i.managedElsewhere && !!i.channels[channel]);
  if (!found) throw new Error(`no editable item offers ${channel}`);
  return found;
}

const rowOf = (key: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-notification-item="${key}"]`);
  if (!row) throw new Error(`row ${key} is not on the page`);
  return row;
};

/**
 * Radix Tabs activate on mousedown, not click — `fireEvent.click` alone leaves
 * the tab where it was and the assertion then fails for the wrong reason.
 */
const clickTab = (tab: HTMLElement): void => {
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
};

beforeEach(() => {
  authState.user = SUPER_ADMIN;
  settingsState.rows = [];
  settingsState.isLoading = false;
  settingsState.isSaving = false;
  settingsState.error = null;
  settingsState.tableMissing = false;
  saveRows.mockClear();
  refresh.mockClear();
  sendTest.mockClear();
});

afterEach(cleanup);

/* ------------------------------ the groups -------------------------------- */

describe('the three direction groups', () => {
  it('renders all three, in the lead’s order, from the catalogue', () => {
    renderPage();
    const sections = Array.from(document.querySelectorAll('[data-notification-direction]'));
    expect(sections.map((s) => s.getAttribute('data-notification-direction'))).toEqual([
      'super_admin_to_admin',
      'admin_to_super_admin',
      'super_admin_to_everyone',
    ]);
    for (const group of SYSTEM_DIRECTION_GROUPS) {
      expect(screen.getByRole('heading', { name: group.title })).toBeInTheDocument();
    }
  });

  it('puts every catalogue item in its own group, with its categories', () => {
    renderPage();
    for (const group of SYSTEM_DIRECTION_GROUPS) {
      const section = document.querySelector<HTMLElement>(
        `[data-notification-direction="${group.direction}"]`,
      )!;
      for (const { category, items } of categoryGroups(group.direction)) {
        const categoryEl = within(section).getByRole('heading', { name: category.label });
        expect(categoryEl).toBeInTheDocument();
        for (const item of items) {
          expect(within(section).getByRole('button', { name: item.name })).toBeInTheDocument();
        }
      }
    }
    // Nothing is left out.
    expect(document.querySelectorAll('[data-notification-item]')).toHaveLength(
      SYSTEM_NOTIFICATION_CATALOG.length,
    );
  });

  it('chips each row with the direction in the lead’s words', () => {
    renderPage();
    for (const group of SYSTEM_DIRECTION_GROUPS) {
      const section = document.querySelector<HTMLElement>(
        `[data-notification-direction="${group.direction}"]`,
      )!;
      const chips = Array.from(section.querySelectorAll('[data-direction-chip]'));
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) expect(chip.textContent).toBe(group.chip);
    }
  });

  it('gives each row a tooltip, a "when · where · who" line and three channel cells', () => {
    renderPage();
    const item = firstEditable('email');
    const row = rowOf(item.key);
    expect(within(row).getByRole('button', { name: `About ${item.name}` })).toBeInTheDocument();
    expect(row.textContent).toContain(item.recipient);
    expect(within(row).getAllByText(/^When /)).not.toHaveLength(0);
    expect(row.querySelectorAll('[data-channel-cell]')).toHaveLength(3);
  });

  it('shows a dash where a channel does not apply, and a marker where nothing sends today', () => {
    renderPage();
    expect(document.querySelectorAll('[data-channel-na]').length).toBeGreaterThan(0);
    const notSent = document.querySelectorAll('[data-channel-not-sent]');
    expect(notSent.length).toBeGreaterThan(0);
    expect(notSent[0].textContent).toContain(COPY.notSentYet);
  });
});

/* ------------------------------- dirty state ------------------------------ */

describe('turning a switch', () => {
  it('marks the page dirty and offers one Save', () => {
    renderPage();
    expect(document.querySelector('[data-save-bar]')).toBeNull();

    const item = firstEditable('email');
    const row = rowOf(item.key);
    fireEvent.click(within(row).getByRole('switch', { name: `Email for ${item.name}` }));

    const bar = document.querySelector('[data-save-bar]');
    expect(bar).toBeTruthy();
    expect(within(bar as HTMLElement).getByRole('button', { name: COPY.save })).toBeEnabled();
    expect(rowOf(item.key).querySelector('[data-unsaved-marker]')?.textContent).toBe(COPY.unsaved);
  });

  it('turning a channel ON opens that channel’s tab, as on the lead’s whiteboard', () => {
    renderPage();
    const item = firstEditable('email');
    const row = rowOf(item.key);
    const wasOn = item.channels.email!.defaultEnabled;
    const toggle = within(row).getByRole('switch', { name: `Email for ${item.name}` });

    if (wasOn) fireEvent.click(toggle); // turn it off first
    fireEvent.click(toggle); // ...and on

    const panel = rowOf(item.key).querySelector('[data-notification-panel]');
    expect(panel).toBeTruthy();
    expect(panel!.querySelector('[data-channel-panel="email"]')).toBeTruthy();
  });

  it('Discard puts the page back and takes the bar away', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('switch', { name: `Email for ${item.name}` }));
    expect(document.querySelector('[data-save-bar]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: COPY.discard }));
    expect(document.querySelector('[data-save-bar]')).toBeNull();
    expect(saveRows).not.toHaveBeenCalled();
  });

  it('Save hands the hook exactly the row the switch changed', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('switch', { name: `Email for ${item.name}` }));
    fireEvent.click(screen.getByRole('button', { name: COPY.save }));

    expect(saveRows).toHaveBeenCalledTimes(1);
    const diff = saveRows.mock.calls[0][0];
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({
      notification_key: item.key,
      channel: 'email',
      enabled: !item.channels.email!.defaultEnabled,
    });
  });
});

/* -------------------------------- the panel ------------------------------- */

describe('opening an item', () => {
  it('shows one tab per channel it offers, and no others', () => {
    renderPage();
    const item = SYSTEM_NOTIFICATION_CATALOG.find(
      (i) => !i.managedElsewhere && itemChannels(i).length > 1,
    )!;
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));

    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    expect(panel).toBeTruthy();
    const tabs = Array.from(panel.querySelectorAll('[data-channel-tab]')).map((t) =>
      t.getAttribute('data-channel-tab'),
    );
    expect(tabs).toEqual(itemChannels(item));
  });

  it('opens the email tab with the template on the left, the preview on the right and Send test', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));

    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    expect(panel.querySelector('[data-channel-fields]')).toBeTruthy();
    expect(panel.querySelector('[data-channel-preview]')).toBeTruthy();
    expect(panel.querySelector('[data-body-editor]')).toBeTruthy();
    expect(panel.querySelector('[data-send-test="email"]')).toBeTruthy();
    // The subject field carries the catalogue's default wording.
    expect(within(panel).getByDisplayValue(item.channels.email!.defaultTemplate.subject)).toBeInTheDocument();
  });

  it('opens a push item with the phone preview and the display options', () => {
    renderPage();
    const item = firstEditable('push');
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));
    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    clickTab(within(panel).getByRole('tab', { name: /Push/ }));

    expect(panel.querySelector('[data-push-preview]')).toBeTruthy();
    expect(panel.querySelector('[data-push-options]')).toBeTruthy();
  });

  it('opens an in-app item with the bell preview and no test send', () => {
    renderPage();
    const item = firstEditable('in_app');
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));
    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    clickTab(within(panel).getByRole('tab', { name: /In-app/ }));

    expect(panel.querySelector('[data-inapp-preview]')).toBeTruthy();
    expect(panel.querySelector('[data-inapp-no-test]')?.textContent).toBe(COPY.inAppNoTest);
    expect(panel.querySelector('[data-send-test="in_app"]')).toBeNull();
  });

  it('closes again, and only one panel is ever open', () => {
    renderPage();
    const [a, b] = SYSTEM_NOTIFICATION_CATALOG.filter((i) => !i.managedElsewhere).slice(0, 2);
    fireEvent.click(within(rowOf(a.key)).getByRole('button', { name: a.name }));
    fireEvent.click(within(rowOf(b.key)).getByRole('button', { name: b.name }));
    expect(document.querySelectorAll('[data-notification-panel]')).toHaveLength(1);
    expect(rowOf(b.key).querySelector('[data-notification-panel]')).toBeTruthy();

    fireEvent.click(within(rowOf(b.key)).getByRole('button', { name: b.name }));
    expect(document.querySelectorAll('[data-notification-panel]')).toHaveLength(0);
  });

  it('an announcements item links to the screen that already writes it, instead of an editor', () => {
    renderPage();
    const managed = SYSTEM_NOTIFICATION_CATALOG.find((i) => !!i.managedElsewhere)!;
    fireEvent.click(within(rowOf(managed.key)).getByRole('button', { name: managed.name }));

    const row = rowOf(managed.key);
    expect(row.querySelector('[data-notification-panel]')).toBeNull();
    const panel = row.querySelector('[data-managed-elsewhere]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('data-managed-elsewhere')).toBe(managed.managedElsewhere!.href);
    expect(within(panel).getByRole('link')).toHaveAttribute('href', managed.managedElsewhere!.href);
  });

  it('a managed item’s switches are not editable here', () => {
    renderPage();
    const managed = SYSTEM_NOTIFICATION_CATALOG.find((i) => !!i.managedElsewhere)!;
    for (const toggle of within(rowOf(managed.key)).queryAllByRole('switch')) {
      expect(toggle).toBeDisabled();
    }
  });
});

/* ------------------------------ storage off ------------------------------- */

describe('when the storage SQL has not been applied', () => {
  beforeEach(() => {
    settingsState.tableMissing = true;
  });

  it('says so, and says what still works', () => {
    renderPage();
    const notice = document.querySelector('[data-notifications-notice="storage-off"]');
    expect(notice).toBeTruthy();
    expect(notice!.textContent).toContain(COPY.storageOff);
    expect(notice!.textContent).toContain('notifications_v2_platform.sql');
  });

  it('still lets an admin try a change and preview it', () => {
    renderPage();
    const item = firstEditable('email');
    // The change: the switch moves, and the page records it as unsaved.
    fireEvent.click(within(rowOf(item.key)).getByRole('switch', { name: `Email for ${item.name}` }));
    expect(rowOf(item.key).querySelector('[data-unsaved-marker]')).toBeTruthy();
    // The preview: the panel opens and renders, storage or no storage.
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));
    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('[data-channel-preview]')).toBeTruthy();
    expect(panel.querySelector('[data-send-test="email"]')).not.toBeDisabled();
  });

  it('disables Save and gives the reason, and warns the change will not be kept', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('switch', { name: `Email for ${item.name}` }));

    const bar = document.querySelector('[data-save-bar]') as HTMLElement;
    expect(within(bar).getByRole('button', { name: COPY.save })).toBeDisabled();
    expect(bar.querySelector('[data-save-blocked-reason]')?.textContent).toBe(COPY.storageOff);
    expect(document.querySelector('[data-notifications-unsavable]')?.textContent?.trim()).toBe(
      COPY.storageOffEdits,
    );
  });

  it('never calls the hook’s save', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('switch', { name: `Email for ${item.name}` }));
    fireEvent.click(screen.getByRole('button', { name: COPY.save }));
    expect(saveRows).not.toHaveBeenCalled();
  });
});

/* ------------------------------ permissions ------------------------------- */

describe('an account that is not a super admin', () => {
  beforeEach(() => {
    authState.user = SALES_ONLY;
  });

  it('can read the whole page', () => {
    renderPage();
    expect(document.querySelectorAll('[data-notification-item]')).toHaveLength(
      SYSTEM_NOTIFICATION_CATALOG.length,
    );
    for (const group of SYSTEM_DIRECTION_GROUPS) {
      expect(screen.getByRole('heading', { name: group.title })).toBeInTheDocument();
    }
  });

  it('is told why it cannot change anything', () => {
    renderPage();
    const note = document.querySelector('[data-permission-note]');
    expect(note).toBeTruthy();
    expect(note!.textContent).toContain(COPY.noAccessTitle);
    expect(note!.textContent).toContain(COPY.noAccessBody);
  });

  it('has every switch disabled', () => {
    renderPage();
    const toggles = screen.getAllByRole('switch');
    expect(toggles.length).toBeGreaterThan(0);
    for (const toggle of toggles) expect(toggle).toBeDisabled();
  });

  it('can still open an item and read its template and preview', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));
    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    expect(panel.querySelector('[data-channel-preview]')).toBeTruthy();
    expect(within(panel).getByDisplayValue(item.channels.email!.defaultTemplate.subject)).toHaveAttribute(
      'readonly',
    );
  });

  it('cannot send a test, and is told why', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));
    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    expect(panel.querySelector('[data-send-test="email"]')).toBeDisabled();
    expect(panel.querySelector('[data-test-blocked]')?.textContent).toBe(COPY.noTestForViewer);
  });

  it('has no Reset to default button', () => {
    renderPage();
    const item = firstEditable('email');
    fireEvent.click(within(rowOf(item.key)).getByRole('button', { name: item.name }));
    const panel = rowOf(item.key).querySelector('[data-notification-panel]') as HTMLElement;
    expect(panel.querySelector('[data-reset-channel]')).toBeNull();
  });
});

/* ------------------------------ read states ------------------------------- */

describe('loading and read failures', () => {
  it('shows a skeleton before the first read finishes, and no defaults', () => {
    settingsState.isLoading = true;
    renderPage();
    expect(document.querySelector('[data-notifications-loading]')).toBeTruthy();
    expect(document.querySelectorAll('[data-notification-item]')).toHaveLength(0);
  });

  it('shows the read error with a retry, rather than painting defaults over it', () => {
    settingsState.error = new Error('Network is down.');
    settingsState.rows = [];
    renderPage();
    const error = document.querySelector('[data-notifications-load-error]') as HTMLElement;
    expect(error).toBeTruthy();
    expect(error.textContent).toContain('Network is down.');
    expect(document.querySelectorAll('[data-notification-item]')).toHaveLength(0);

    fireEvent.click(within(error).getByRole('button', { name: COPY.retry }));
    expect(refresh).toHaveBeenCalled();
  });
});

/* --------------------------- stored rows show up -------------------------- */

describe('what is stored', () => {
  it('shows a stored switch and marks the template as edited', () => {
    const item = firstEditable('email');
    settingsState.rows = [
      {
        notification_key: item.key,
        channel: 'email',
        enabled: !item.channels.email!.defaultEnabled,
        subject: 'A subject someone typed',
        title: null,
        body: null,
        push_options: {},
      },
    ];
    renderPage();
    const row = rowOf(item.key);
    const toggle = within(row).getByRole('switch', { name: `Email for ${item.name}` });
    expect(toggle).toHaveAttribute('aria-checked', String(!item.channels.email!.defaultEnabled));
    expect(row.querySelector('[data-edited-badge]')?.textContent).toBe(COPY.edited);
    // Stored is not unsaved.
    expect(row.querySelector('[data-unsaved-marker]')).toBeNull();
  });
});
