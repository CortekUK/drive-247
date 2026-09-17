/**
 * AnnouncementDialogHost: WHEN an announcement dialog opens, and when it gets out
 * of the way. (WHAT opens is the pure queue, pinned in lib/announcement-queue.)
 *
 * Driven under fake timers with every collaborator a mutable double:
 *   - it waits ANNOUNCEMENT_SETTLE_MS of quiet before opening, restarting the wait
 *     when something blocks or the route changes, and re-checks the DOM right
 *     before it opens;
 *   - it yields to any gate/tour/modal with NO event, and comes back after the quiet;
 *   - one dialog at a time; a hard blocker first and alone;
 *   - soft dialogs do not chain within one moment (load or route change), hard ones
 *     are not limited;
 *   - `shown` on open, `dismissed` / `dont_show_again` / `cta_clicked` from the
 *     dialog's own controls, nothing when it closes for any other reason;
 *   - a hard blocker closes itself on its own CTA route and swaps to a new first one;
 *   - the feature pick renders FeatureAnnouncementDialog with source="auto".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AnnouncementDialogHost } from '@/components/announcements/announcement-dialog-host';
import {
  ANNOUNCEMENT_SETTLE_MS,
  type AnnouncementEvent,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';

// ── Doubles ─────────────────────────────────────────────────────────────────

const events: Array<[string, AnnouncementEvent]> = [];
const recordEvent = vi.fn((a: PortalAnnouncement, e: AnnouncementEvent) => {
  events.push([a.id, e]);
});

let system: PortalAnnouncement[] = [];
let features: PortalAnnouncement[] = [];
let featuresEnabled = true;
vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({ status: 'ready', system, features, featuresEnabled, recordEvent }),
}));

let blocked = false;
let domBlocked = false;
const blockedOpts: Array<{ showGate: boolean; ownDialogOpen: boolean }> = [];
vi.mock('@/hooks/use-announcement-blocked', () => ({
  useAnnouncementBlocked: (o: { showGate: boolean; ownDialogOpen: boolean }) => {
    blockedOpts.push(o);
    return blocked || o.showGate;
  },
  readAnnouncementDomBlocked: () => domBlocked,
}));

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));

const signOut = vi.fn(async () => {});
vi.mock('@/stores/auth-store', () => ({ useAuth: () => ({ signOut }) }));

vi.mock('@/components/announcements/system-announcement-dialog', () => ({
  SystemAnnouncementDialog: (p: {
    announcement: PortalAnnouncement;
    open: boolean;
    onClose: () => void;
    onCta: (href: string) => void;
    onSignOut: () => void;
  }) => (
    <div data-testid="system-dialog" data-id={p.announcement.id} data-blocking={p.announcement.blocking} data-open={String(p.open)}>
      <button onClick={p.onClose}>close</button>
      <button onClick={() => p.onCta(p.announcement.cta_url ?? '/x')}>cta</button>
      <button onClick={p.onSignOut}>sign out</button>
    </div>
  ),
}));

vi.mock('@/components/announcements/feature-announcement-dialog', () => ({
  FeatureAnnouncementDialog: (p: {
    announcement: PortalAnnouncement | null;
    source: 'auto' | 'card';
    onClose: () => void;
    onDontShowAgain: () => void;
    onCta: (href: string) => void;
  }) =>
    p.announcement ? (
      <div data-testid="feature-dialog" data-id={p.announcement.id} data-source={p.source}>
        <button onClick={p.onClose}>got it</button>
        <button onClick={p.onDontShowAgain}>dont show again</button>
        <button onClick={() => p.onCta('/insights/expenses')}>feature cta</button>
      </div>
    ) : null,
}));

// ── Rows ────────────────────────────────────────────────────────────────────

function sys(id: string, over: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return {
    id,
    kind: 'system',
    title: id,
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
const hardSys = (id: string, over: Partial<PortalAnnouncement> = {}) => sys(id, { blocking: 'hard', tone: 'critical', ...over });
const feat = (id: string, over: Partial<PortalAnnouncement> = {}) =>
  sys(id, {
    kind: 'feature',
    summary: 'One line',
    body: null,
    display: null,
    tone: null,
    slides: [
      { heading: 'A', body: 'a', image_url: null },
      { heading: 'B', body: 'b', image_url: null },
    ],
    ...over,
  });

/** What the real hook does on a dismissal: the row stops being due. */
function hideOnClose() {
  recordEvent.mockImplementation((a, e) => {
    events.push([a.id, e]);
    if (e === 'dismissed' || e === 'dont_show_again' || (e === 'cta_clicked' && a.blocking !== 'hard')) {
      system = system.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
      features = features.map((r) =>
        r.id === a.id ? { ...r, is_due: false, dont_show_again_at: e === 'dont_show_again' ? 'now' : r.dont_show_again_at } : r,
      );
    }
  });
}

// ── Harness ─────────────────────────────────────────────────────────────────

let props = { showGate: false, isSubscriptionPage: false, pathname: '/' };
let view: ReturnType<typeof render>;

function mount(over: Partial<typeof props> = {}) {
  props = { ...props, ...over };
  view = render(<AnnouncementDialogHost {...props} />);
}
function update(over: Partial<typeof props> = {}) {
  props = { ...props, ...over };
  view.rerender(<AnnouncementDialogHost {...props} />);
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const systemDialog = () => screen.queryByTestId('system-dialog');
const featureDialog = () => screen.queryByTestId('feature-dialog');
const openId = () => systemDialog()?.getAttribute('data-id') ?? featureDialog()?.getAttribute('data-id') ?? null;
const shownIds = () => events.filter(([, e]) => e === 'shown').map(([id]) => id);
const nonShown = () => events.filter(([, e]) => e !== 'shown');

beforeEach(() => {
  vi.useFakeTimers();
  system = [];
  features = [];
  featuresEnabled = true;
  blocked = false;
  domBlocked = false;
  blockedOpts.length = 0;
  events.length = 0;
  recordEvent.mockReset();
  recordEvent.mockImplementation((a, e) => {
    events.push([a.id, e]);
  });
  push.mockClear();
  replace.mockClear();
  signOut.mockClear();
  props = { showGate: false, isSubscriptionPage: false, pathname: '/' };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('settle', () => {
  it('opens only after the quiet period, and records `shown` once', () => {
    system = [sys('soft')];
    mount();
    expect(openId()).toBeNull();
    advance(ANNOUNCEMENT_SETTLE_MS - 1);
    expect(openId()).toBeNull();
    advance(1);
    expect(openId()).toBe('soft');
    expect(shownIds()).toEqual(['soft']);
  });

  it('opens nothing when there is nothing to open', () => {
    mount();
    advance(10_000);
    expect(openId()).toBeNull();
    expect(events).toEqual([]);
  });

  it('opens rows that arrive after mount (the read settles later)', () => {
    mount();
    advance(3000);
    system = [sys('late')];
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('late');
  });

  it('restarts the quiet period when something blocks mid-wait', () => {
    system = [sys('soft')];
    mount();
    advance(1000);
    blocked = true;
    update();
    advance(1000);
    blocked = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS - 1);
    expect(openId()).toBeNull();
    advance(1);
    expect(openId()).toBe('soft');
  });

  it('restarts the quiet period on a route change', () => {
    system = [sys('soft')];
    mount();
    advance(1000);
    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS - 1);
    expect(openId()).toBeNull();
    advance(1);
    expect(openId()).toBe('soft');
  });

  it('re-checks the DOM right before opening', () => {
    system = [sys('soft')];
    mount();
    domBlocked = true;
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBeNull();
    // The observer catches up: blocked, then clear again.
    domBlocked = false;
    blocked = true;
    update();
    blocked = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
  });
});

describe('blocked', () => {
  it('opens nothing while the paywall is up, and passes it to the blocker hook', () => {
    system = [hardSys('hard'), sys('soft')];
    mount({ showGate: true });
    advance(10_000);
    expect(openId()).toBeNull();
    expect(blockedOpts.every((o) => o.showGate === true)).toBe(true);
  });

  it('tells the blocker hook when its own dialog is open', () => {
    system = [sys('soft')];
    mount();
    expect(blockedOpts[blockedOpts.length - 1].ownDialogOpen).toBe(false);
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(blockedOpts[blockedOpts.length - 1].ownDialogOpen).toBe(true);
  });

  it('an open soft dialog yields with NO event and comes back after the quiet period', () => {
    system = [sys('soft')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');

    blocked = true;
    update();
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([]);

    advance(10_000);
    expect(openId()).toBeNull();
    blocked = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
    expect(nonShown()).toEqual([]);
  });

  it('an open hard blocker yields to the paywall and returns when it clears', () => {
    system = [hardSys('hard')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
    update({ showGate: true });
    expect(openId()).toBeNull();
    update({ showGate: false });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
    expect(nonShown()).toEqual([]);
  });
});

describe('one at a time, in priority order', () => {
  it('hard + soft + feature all due: only the hard one, and nothing after it', () => {
    system = [hardSys('hard'), sys('soft')];
    features = [feat('feature')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
    expect(systemDialog()!.getAttribute('data-blocking')).toBe('hard');
    expect(featureDialog()).toBeNull();
    expect(screen.getAllByTestId('system-dialog')).toHaveLength(1);
    advance(60_000);
    expect(shownIds()).toEqual(['hard']);
  });

  it('two hard blockers: the first; when it clears, the next takes its place at once', () => {
    system = [hardSys('hardA'), hardSys('hardB')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hardA');
    // Tenant fixed A (left its smart filter): B now ranks first, so the blocker swaps
    // without ever handing the screen back.
    system = [hardSys('hardB')];
    update();
    expect(openId()).toBe('hardB');
    expect(shownIds()).toEqual(['hardA', 'hardB']);
    expect(nonShown()).toEqual([]);
    // B clears too: nothing left.
    system = [];
    update();
    expect(openId()).toBeNull();
    advance(10_000);
    expect(openId()).toBeNull();
  });

  it('an open hard blocker swaps to a different hard row that now ranks first', () => {
    system = [hardSys('hardB')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hardB');
    system = [hardSys('hardA'), hardSys('hardB')];
    update();
    expect(openId()).toBe('hardA');
    expect(shownIds()).toEqual(['hardB', 'hardA']);
  });

  it('an open soft dialog yields to a hard blocker that arrives mid-session', () => {
    system = [sys('soft')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
    system = [hardSys('hard'), sys('soft')];
    update();
    expect(openId()).toBeNull();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
    expect(nonShown()).toEqual([]);
  });
});

describe('moments', () => {
  it('after a soft dialog is closed, the next soft one waits for a route change', () => {
    hideOnClose();
    system = [sys('softA'), sys('softB')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('softA');
    fireEvent.click(screen.getByText('close'));
    update();
    expect(events).toContainEqual(['softA', 'dismissed']);
    expect(openId()).toBeNull();
    advance(60_000);
    expect(openId()).toBeNull();

    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('softB');
  });

  it('soft system first; the feature waits for the next moment AND for the dashboard', () => {
    hideOnClose();
    system = [sys('soft')];
    features = [feat('feature')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
    fireEvent.click(screen.getByText('close'));
    update();
    advance(60_000);
    expect(openId()).toBeNull();

    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS * 4);
    expect(openId()).toBeNull();

    update({ pathname: '/' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('feature');
  });

  it('hard blockers are not limited by the moment', () => {
    hideOnClose();
    system = [sys('soft')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    fireEvent.click(screen.getByText('close'));
    update();
    system = [hardSys('hard'), ...system];
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
  });

  it('a soft dialog that yielded to a blocker may come back in the same moment', () => {
    system = [sys('softA'), sys('softB')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    blocked = true;
    update();
    blocked = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('softA');
  });
});

describe('closing and events', () => {
  it('soft system: close records dismissed; the button records cta_clicked, closes and navigates', () => {
    hideOnClose();
    system = [sys('softA'), sys('softB', { cta_label: 'Open', cta_url: '/settings?tab=payments' })];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    fireEvent.click(screen.getByText('close'));
    update();
    expect(events).toEqual([
      ['softA', 'shown'],
      ['softA', 'dismissed'],
    ]);

    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('softB');
    fireEvent.click(screen.getByText('cta'));
    update();
    expect(events).toContainEqual(['softB', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/settings?tab=payments');
    expect(openId()).toBeNull();
  });

  it('a soft row that stops being due elsewhere closes with no event', () => {
    system = [sys('soft')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    system = [sys('soft', { is_due: false })];
    update();
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([]);
  });

  it('feature: renders the feature dialog with source="auto" and routes its three actions', () => {
    hideOnClose();
    features = [feat('f1'), feat('f2', { repeat_after_days: 3 }), feat('f3')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(featureDialog()!.getAttribute('data-id')).toBe('f1');
    expect(featureDialog()!.getAttribute('data-source')).toBe('auto');
    expect(systemDialog()).toBeNull();
    fireEvent.click(screen.getByText('got it'));
    update();
    expect(events).toContainEqual(['f1', 'dismissed']);

    update({ pathname: '/rentals' });
    update({ pathname: '/' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('f2');
    fireEvent.click(screen.getByText('dont show again'));
    update();
    expect(events).toContainEqual(['f2', 'dont_show_again']);
    expect(openId()).toBeNull();

    update({ pathname: '/vehicles' });
    update({ pathname: '/' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('f3');
    fireEvent.click(screen.getByText('feature cta'));
    update();
    expect(events).toContainEqual(['f3', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/insights/expenses');
    expect(openId()).toBeNull();
  });

  it('feature dialogs never open where features are disabled', () => {
    featuresEnabled = false;
    features = [feat('f1')];
    mount();
    advance(10_000);
    expect(openId()).toBeNull();
  });

  it('an auto-opened feature closes (no event) if the user leaves the dashboard under it', () => {
    features = [feat('f1')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('f1');
    update({ pathname: '/rentals' });
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([]);
  });
});

describe('hard blockers', () => {
  it('are not shown on the pages the paywall keeps reachable', () => {
    system = [hardSys('hard')];
    mount({ pathname: '/settings', isSubscriptionPage: true });
    advance(10_000);
    expect(openId()).toBeNull();
    update({ pathname: '/rentals', isSubscriptionPage: false });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
  });

  it('the button records cta_clicked and navigates; the dialog stays until the CTA route exempts it', () => {
    system = [hardSys('hard', { cta_label: 'Open vehicles', cta_url: '/vehicles' })];
    mount({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    fireEvent.click(screen.getByText('cta'));
    expect(events).toContainEqual(['hard', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/vehicles');
    expect(openId()).toBe('hard');

    update({ pathname: '/vehicles' });
    expect(openId()).toBeNull();
    expect(events.filter(([, e]) => e === 'dismissed')).toEqual([]);

    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
  });

  it('a hard close request is ignored (only Sign out leaves)', () => {
    system = [hardSys('hard')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    fireEvent.click(screen.getByText('close'));
    expect(openId()).toBe('hard');
    expect(nonShown()).toEqual([]);
  });

  it('Sign out signs out, then replaces to /login', async () => {
    system = [hardSys('hard')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    await act(async () => {
      fireEvent.click(screen.getByText('sign out'));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('while a hard blocker applies but is exempt here, no soft or feature dialog opens', () => {
    system = [hardSys('hard', { cta_label: 'Open', cta_url: '/' }), sys('soft')];
    features = [feat('feature')];
    mount({ pathname: '/' });
    advance(10_000);
    expect(openId()).toBeNull();
  });
});
