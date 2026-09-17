/**
 * STRICT PRIORITY, end to end (team lead + user, Sep 17 2026):
 *
 *   1. the subscription gate / migration blocker: nothing ever appears above them;
 *   2. SYSTEM announcement dialogs;
 *   3. tours and onboarding that open by themselves (here: the first-rental tour's
 *      resume prompt, "Pick up the walkthrough where you left off?");
 *   4. FEATURE dialogs.
 *
 * Mounted the way the dashboard layout mounts them, the tour BEFORE the host, with the
 * REAL pieces in between: the tour component and its hook, the announcement host, the
 * real blocker hook (MutationObserver and all), the real system dialog (Radix), and the
 * shared system priority signal. Only the data sources are doubles: the announcement
 * rows, the tenant, the user, the router, and the wizard / migration / rental-gate
 * queries.
 *
 * Pinned:
 *   - a system dialog due + the tour prompt due: the dialog first, the prompt never
 *     painted while it is up, the prompt after it closes, and nothing written for the
 *     tour as if it had been answered (no dismissal, no skip, the offer counted once);
 *   - a tour the operator STARTED is not interrupted: the dialog waits for it to end;
 *   - the subscription gate up: no system dialog at all, and the prompt waits too;
 *   - a feature dialog due as well: it comes after the system dialog AND after the tour.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { FirstRentalTour } from '@/components/onboarding/first-rental-tour';
import { AnnouncementDialogHost } from '@/components/announcements/announcement-dialog-host';
import { SYSTEM_DIALOG_PAGE_GUARD_MS } from '@/components/announcements/system-announcement-dialog';
import {
  ANNOUNCEMENT_SETTLE_MS,
  type AnnouncementEvent,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';
import {
  __resetSystemAnnouncementPriority,
  getSystemAnnouncementPriority,
} from '@/lib/announcements/system-priority';
import {
  REPLAY_TOUR_EVENT,
  hasSeenTour,
  markTourSeen,
  readTourProgress,
  writeTourProgress,
} from '@/lib/first-rental-tour';

// ── Doubles ─────────────────────────────────────────────────────────────────

const NORTHWIND = { id: '8e6bc88f-0000-0000-0000-000000000000', slug: 'northwind' };
const USER = 'app-user-1';

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: NORTHWIND, tenantSlug: NORTHWIND.slug }),
}));
const signOut = vi.fn(async () => {});
vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ appUser: { id: USER, is_active: true, role: 'head_admin' }, loading: false, signOut }),
}));
vi.mock('@/lib/v2-context', () => ({ useV2: () => true }));

let currentPath = '/';
const pushed: string[] = [];
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useRouter: () => ({
    push: (route: string) => {
      pushed.push(route);
    },
    replace: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-first-run-wizard', () => ({ useFirstRunWizard: () => ({ shouldShow: false, isLoading: false }) }));
vi.mock('@/hooks/use-migration-status', () => ({
  useMigrationStatus: () => ({ migrationPromptShowing: false, isLoading: false }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    isManager: false,
    isReadOnlyRole: false,
    isLoading: false,
    canAccessRoute: () => true,
    canEdit: () => true,
    canViewSettings: () => true,
  }),
}));
vi.mock('@/hooks/use-rental-creation-gate', () => ({ useRentalCreationGate: () => ({ blocked: false, isLoading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const events: Array<[string, AnnouncementEvent]> = [];
let system: PortalAnnouncement[] = [];
let features: PortalAnnouncement[] = [];
const recordEvent = vi.fn((a: PortalAnnouncement, e: AnnouncementEvent) => {
  events.push([a.id, e]);
  // What the real hook does: a soft close hides the row at once.
  if (e === 'dismissed' || e === 'dont_show_again' || (e === 'cta_clicked' && a.blocking !== 'hard')) {
    system = system.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
    features = features.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
  }
});
vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({ status: 'ready', system, features, featuresEnabled: true, recordEvent }),
}));

function notice(id: string, over: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return {
    id,
    kind: 'system',
    title: `Notice ${id}`,
    summary: null,
    body: 'Body',
    image_url: null,
    slides: [],
    cta_label: null,
    cta_url: null,
    display: 'dialog',
    blocking: 'soft',
    tone: 'info',
    repeat_after_days: null,
    sort_order: 10,
    revision: 1,
    last_shown_at: null,
    dismissed_at: null,
    dont_show_again_at: null,
    is_due: true,
    ...over,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

let showGate = false;
let view: ReturnType<typeof render>;

function Layout() {
  // The layout's order: the tour, then the host, last.
  return (
    <>
      <FirstRentalTour suppressed={showGate} />
      <AnnouncementDialogHost showGate={showGate} isSubscriptionPage={false} pathname={currentPath} />
    </>
  );
}
const mount = () => {
  view = render(<Layout />);
};
const update = () => view.rerender(<Layout />);
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** MutationObserver callbacks are microtasks. */
const flushObservers = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const prompt = () => document.querySelector('[data-tour-prompt]');
const tourCard = () => document.querySelector('[data-first-rental-tour]');
const systemDialog = () => document.querySelector<HTMLElement>('[data-system-announcement-dialog]');
const featureDialog = () => document.querySelector('[data-feature-announcement-dialog]');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '';
  __resetSystemAnnouncementPriority();
  currentPath = '/';
  pushed.length = 0;
  showGate = false;
  system = [];
  features = [];
  events.length = 0;
  recordEvent.mockClear();
  signOut.mockClear();
  // jsdom lays nothing out: anything in the document counts as on screen (the tour's anchor filter).
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 120, height: 32, top: 100, left: 100, right: 220, bottom: 132, x: 100, y: 100, toJSON() {} }) as DOMRect;
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetSystemAnnouncementPriority();
  document.body.removeAttribute('data-scroll-locked');
});

/** An interrupted walkthrough: back on the dashboard, the tour offers to resume. */
function interruptedTour() {
  writeTourProgress(USER, { stepId: 'vehicles', status: 'paused' });
  markTourSeen(USER);
}

describe('system announcements before onboarding', () => {
  it('the control: with no system dialog due, the resume prompt comes up by itself', async () => {
    interruptedTour();
    mount();
    advance(1000);
    await flushObservers();
    expect(prompt()).not.toBeNull();
    expect(getSystemAnnouncementPriority()).toBe('idle');
  });

  it('system dialog due + tour prompt due: the dialog first, the prompt after it closes, nothing written for the tour', async () => {
    interruptedTour();
    system = [notice('d1', { title: 'Scheduled maintenance' })];
    mount();
    // The prompt is never painted, not even for a frame before the dialog settles.
    expect(prompt()).toBeNull();
    expect(getSystemAnnouncementPriority()).toBe('pending');
    advance(ANNOUNCEMENT_SETTLE_MS - 1);
    await flushObservers();
    expect(prompt()).toBeNull();
    expect(systemDialog()).toBeNull();
    advance(1);
    await flushObservers();
    expect(systemDialog()).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Scheduled maintenance' })).toBeInTheDocument();
    expect(prompt()).toBeNull();
    expect(getSystemAnnouncementPriority()).toBe('open');
    // The prompt was not offered (so not counted) while the dialog was due.
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'vehicles', status: 'paused', prompts: 0 });

    advance(30_000);
    await flushObservers();
    expect(prompt()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    update();
    await flushObservers();
    expect(systemDialog()).toBeNull();
    expect(events.filter(([, e]) => e !== 'shown')).toEqual([['d1', 'dismissed']]);
    expect(getSystemAnnouncementPriority()).toBe('idle');

    advance(1000);
    await flushObservers();
    expect(prompt()).not.toBeNull();
    // Nothing was written for the tour as if it had been answered: not dismissed (that
    // clears the progress), not skipped, not resumed, and the offer counted once.
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'vehicles', status: 'paused', prompts: 1 });
    expect(hasSeenTour(USER)).toBe(true);
    expect(pushed).toEqual([]);
  });

  it('two system dialogs due: one pager, then the prompt once both are closed', async () => {
    interruptedTour();
    system = [notice('a', { title: 'Alpha' }), notice('b', { title: 'Bravo' })];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    await flushObservers();
    expect(document.querySelectorAll('[data-system-announcement-dialog]')).toHaveLength(1);
    expect(systemDialog()!.getAttribute('data-page-count')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    update();
    await flushObservers();
    expect(screen.getByRole('dialog', { name: 'Bravo' })).toBeInTheDocument();
    expect(prompt()).toBeNull();
    // Bravo has only just taken the page over, so its Got it waits out
    // SYSTEM_DIALOG_PAGE_GUARD_MS: the second click of a double click must not dismiss a
    // notice nobody read. Anyone reading Bravo gets there long after.
    advance(SYSTEM_DIALOG_PAGE_GUARD_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    update();
    await flushObservers();
    expect(systemDialog()).toBeNull();
    advance(1000);
    await flushObservers();
    expect(prompt()).not.toBeNull();
  });

  it('a prompt already up when a system dialog becomes due steps aside (no answer recorded) and comes back', async () => {
    interruptedTour();
    mount();
    advance(1000);
    await flushObservers();
    expect(prompt()).not.toBeNull();
    expect(prompt()!.hasAttribute('data-yields-to-system')).toBe(true);

    system = [notice('late', { title: 'Late notice' })];
    update();
    await flushObservers();
    expect(prompt()).toBeNull();
    advance(ANNOUNCEMENT_SETTLE_MS);
    await flushObservers();
    expect(screen.getByRole('dialog', { name: 'Late notice' })).toBeInTheDocument();
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'vehicles', status: 'paused', prompts: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    update();
    await flushObservers();
    advance(1000);
    await flushObservers();
    expect(prompt()).not.toBeNull();
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'vehicles', status: 'paused', prompts: 1 });
  });

  it('a tour the operator STARTED is not interrupted: the dialog waits for it to end', async () => {
    markTourSeen(USER);
    mount();
    advance(1000);
    act(() => void window.dispatchEvent(new Event(REPLAY_TOUR_EVENT)));
    advance(1000);
    await flushObservers();
    expect(tourCard()).not.toBeNull();
    expect(tourCard()!.hasAttribute('data-yields-to-system')).toBe(false);

    system = [notice('mid', { title: 'Mid-tour notice' })];
    update();
    await flushObservers();
    advance(ANNOUNCEMENT_SETTLE_MS * 10);
    await flushObservers();
    expect(systemDialog()).toBeNull();
    expect(tourCard()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /skip tour/i }));
    update();
    await flushObservers();
    expect(tourCard()).toBeNull();
    advance(ANNOUNCEMENT_SETTLE_MS);
    await flushObservers();
    expect(screen.getByRole('dialog', { name: 'Mid-tour notice' })).toBeInTheDocument();
  });

  it('the subscription gate up: no system dialog at all, and the prompt waits as well', async () => {
    interruptedTour();
    showGate = true;
    system = [notice('hard', { blocking: 'hard', tone: 'critical', title: 'Blocker' }), notice('soft', { title: 'Soft' })];
    mount();
    advance(60_000);
    await flushObservers();
    expect(systemDialog()).toBeNull();
    expect(prompt()).toBeNull();
    expect(events).toEqual([]);

    showGate = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    await flushObservers();
    expect(screen.getByRole('dialog', { name: 'Blocker' })).toBeInTheDocument();
    expect(prompt()).toBeNull();
  });

  it('feature dialogs still come last: after the system dialog AND after the tour', async () => {
    interruptedTour();
    system = [notice('sys', { title: 'System notice' })];
    features = [
      notice('feat', {
        kind: 'feature',
        display: null,
        tone: null,
        summary: 'One line',
        body: null,
        slides: [{ heading: 'A', body: 'a', image_url: null }],
      }),
    ];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    await flushObservers();
    expect(systemDialog()).not.toBeNull();
    expect(featureDialog()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    update();
    await flushObservers();
    advance(1000);
    await flushObservers();
    expect(prompt()).not.toBeNull();
    // The prompt is onboarding on screen: the feature waits for it.
    advance(ANNOUNCEMENT_SETTLE_MS * 10);
    await flushObservers();
    expect(featureDialog()).toBeNull();
  });
});
