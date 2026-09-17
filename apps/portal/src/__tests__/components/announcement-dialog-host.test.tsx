/**
 * AnnouncementDialogHost: WHEN an announcement dialog opens, and when it gets out
 * of the way. (WHAT opens is the pure queue, pinned in lib/announcement-queue.)
 *
 * Driven under fake timers with every collaborator a mutable double:
 *   - it waits ANNOUNCEMENT_SETTLE_MS of quiet before opening, restarting the wait
 *     when something blocks or the route changes, and re-checks the DOM right
 *     before it opens;
 *   - it yields to any gate or modal with NO event, and comes back after the quiet;
 *   - SYSTEM dialogs (Sep 17 2026): 2 or more due are ONE modal with a pager, hard
 *     pages first; a soft page's close dismisses that item and the next remaining one
 *     takes the page; a hard page cannot be closed but can be paged past; the modal
 *     closes only when nothing remains; one item has no pager;
 *   - strict priority: the subscription gate / migration blocker keep every system
 *     dialog away; onboarding is told (the system priority signal) to wait while one is
 *     due or open; feature dialogs come last and still wait for a moment;
 *   - `shown` per page as it is displayed, `dismissed` / `dont_show_again` /
 *     `cta_clicked` from the dialog's own controls, nothing when it closes for any
 *     other reason;
 *   - a hard blocker closes itself on its own CTA route.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ANNOUNCEMENT_READ_WAIT_MS, AnnouncementDialogHost } from '@/components/announcements/announcement-dialog-host';
import {
  ANNOUNCEMENT_SETTLE_MS,
  type AnnouncementEvent,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';
import {
  __resetSystemAnnouncementPriority,
  getSystemAnnouncementPriority,
} from '@/lib/announcements/system-priority';

// ── Doubles ─────────────────────────────────────────────────────────────────

const events: Array<[string, AnnouncementEvent]> = [];
const recordEvent = vi.fn((a: PortalAnnouncement, e: AnnouncementEvent) => {
  events.push([a.id, e]);
});

let status: 'loading' | 'error' | 'ready' = 'ready';
let system: PortalAnnouncement[] = [];
let features: PortalAnnouncement[] = [];
let featuresEnabled = true;
vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({ status, system, features, featuresEnabled, recordEvent }),
}));

/** Something that outranks every announcement dialog (a gate, a modal, a tour in use). */
let blocked = false;
/** Onboarding on screen that only FEATURE dialogs wait for. */
let onboarding = false;
let domBlocked: { system: boolean; feature: boolean } = { system: false, feature: false };
const domScopes: string[] = [];
const blockedOpts: Array<{ showGate: boolean; ownDialogOpen: boolean }> = [];
vi.mock('@/hooks/use-announcement-blocked', () => ({
  useAnnouncementBlocked: (o: { showGate: boolean; ownDialogOpen: boolean }) => {
    blockedOpts.push(o);
    const sys = blocked || o.showGate;
    return { system: sys, feature: sys || onboarding };
  },
  readAnnouncementDomBlocked: (_own: boolean, scope: 'system' | 'feature' = 'feature') => {
    domScopes.push(scope);
    return domBlocked[scope];
  },
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
    pager?: {
      items: PortalAnnouncement[];
      index: number;
      turn: 1 | -1;
      onPrevious: () => void;
      onNext: () => void;
    } | null;
  }) => (
    <div
      data-testid="system-dialog"
      data-id={p.announcement.id}
      data-blocking={p.announcement.blocking}
      data-open={String(p.open)}
      data-pages={p.pager ? p.pager.items.map((a) => a.id).join(',') : ''}
      data-index={p.pager ? String(p.pager.index) : ''}
      data-turn={p.pager ? String(p.pager.turn) : ''}
    >
      <button onClick={p.onClose}>close</button>
      <button onClick={() => p.onCta(p.announcement.cta_url ?? '/x')}>cta</button>
      <button onClick={p.onSignOut}>sign out</button>
      {p.pager && (
        <>
          <button onClick={p.pager.onPrevious}>previous page</button>
          <button onClick={p.pager.onNext}>next page</button>
        </>
      )}
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
/** A click on the dialog's own control, then the re-render the data hook would cause. */
function click(name: string) {
  fireEvent.click(screen.getByText(name));
  update();
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const systemDialog = () => screen.queryByTestId('system-dialog');
const featureDialog = () => screen.queryByTestId('feature-dialog');
const openId = () => systemDialog()?.getAttribute('data-id') ?? featureDialog()?.getAttribute('data-id') ?? null;
const pages = () => systemDialog()?.getAttribute('data-pages') ?? null;
const pageIndex = () => systemDialog()?.getAttribute('data-index') ?? null;
const shownIds = () => events.filter(([, e]) => e === 'shown').map(([id]) => id);
const nonShown = () => events.filter(([, e]) => e !== 'shown');
const priority = () => getSystemAnnouncementPriority();

beforeEach(() => {
  vi.useFakeTimers();
  __resetSystemAnnouncementPriority();
  status = 'ready';
  system = [];
  features = [];
  featuresEnabled = true;
  blocked = false;
  onboarding = false;
  domBlocked = { system: false, feature: false };
  domScopes.length = 0;
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
  __resetSystemAnnouncementPriority();
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

  it('re-checks the DOM right before opening, in the scope of what it is about to open', () => {
    system = [sys('soft')];
    mount();
    domBlocked = { system: true, feature: true };
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBeNull();
    expect(domScopes).toEqual(['system']);
    // The observer catches up: blocked, then clear again.
    domBlocked = { system: false, feature: false };
    blocked = true;
    update();
    blocked = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
  });
});

describe('the system pager (2 or more system dialogs due)', () => {
  it('3 due: ONE modal on page 1, hard first then soft in drag order, `shown` for the page displayed only', () => {
    system = [sys('s1'), hardSys('h1'), sys('s2')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(screen.getAllByTestId('system-dialog')).toHaveLength(1);
    expect(pages()).toBe('h1,s1,s2');
    expect(openId()).toBe('h1');
    expect(pageIndex()).toBe('0');
    expect(shownIds()).toEqual(['h1']);
  });

  it('pages both ways and loops; `shown` for each page as it is displayed, once', () => {
    system = [sys('a'), sys('b'), sys('c')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('next page');
    expect(openId()).toBe('b');
    expect(systemDialog()!.getAttribute('data-turn')).toBe('1');
    click('next page');
    click('next page');
    expect(openId()).toBe('a');
    click('previous page');
    expect(openId()).toBe('c');
    expect(systemDialog()!.getAttribute('data-turn')).toBe('-1');
    click('previous page');
    expect(openId()).toBe('b');
    expect(shownIds()).toEqual(['a', 'b', 'c']);
    expect(nonShown()).toEqual([]);
    // Never pages by itself.
    advance(60_000);
    expect(openId()).toBe('b');
  });

  it('a soft page close dismisses THAT item and the next remaining one takes the page; closes when none remain', () => {
    hideOnClose();
    system = [sys('a'), sys('b'), sys('c')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('next page');
    expect(openId()).toBe('b');
    click('close');
    expect(nonShown()).toEqual([['b', 'dismissed']]);
    expect(openId()).toBe('c');
    expect(pages()).toBe('a,c');
    expect(pageIndex()).toBe('1');
    expect(systemDialog()!.getAttribute('data-turn')).toBe('1');
    // The last page closed: back to the first.
    click('close');
    expect(openId()).toBe('a');
    // One left: no pager.
    expect(pages()).toBe('');
    click('close');
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([
      ['b', 'dismissed'],
      ['c', 'dismissed'],
      ['a', 'dismissed'],
    ]);
    advance(60_000);
    expect(openId()).toBeNull();
  });

  it('a hard page cannot be closed, but can be paged past; its soft pages can be dismissed; it stays while hard remains', () => {
    hideOnClose();
    system = [hardSys('h'), sys('s1'), sys('s2')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('h');
    click('close');
    expect(openId()).toBe('h');
    expect(nonShown()).toEqual([]);
    click('next page');
    expect(openId()).toBe('s1');
    click('close');
    expect(openId()).toBe('s2');
    click('close');
    expect(openId()).toBe('h');
    expect(pages()).toBe('');
    click('close');
    expect(openId()).toBe('h');
    expect(nonShown()).toEqual([
      ['s1', 'dismissed'],
      ['s2', 'dismissed'],
    ]);
  });

  it('one system dialog: the single dialog as it always was (no pager)', () => {
    system = [sys('only')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('only');
    expect(pages()).toBe('');
    expect(screen.queryByText('next page')).toBeNull();
  });

  it('a poll that adds a soft item while it is open keeps the page showing; a new hard one takes the page', () => {
    system = [sys('a'), sys('b')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('next page');
    expect(openId()).toBe('b');
    system = [sys('new'), sys('a'), sys('b')];
    update();
    expect(openId()).toBe('b');
    expect(pages()).toBe('new,a,b');
    system = [hardSys('h'), sys('new'), sys('a'), sys('b')];
    update();
    expect(openId()).toBe('h');
    expect(nonShown()).toEqual([]);
  });

  it('a hard item that clears while open: the pager goes on without it, with no event', () => {
    system = [hardSys('hA'), hardSys('hB')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hA');
    system = [hardSys('hB')];
    update();
    expect(openId()).toBe('hB');
    expect(shownIds()).toEqual(['hA', 'hB']);
    system = [];
    update();
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([]);
  });

  it('a soft button records cta_clicked and navigates; the next remaining item takes the page', () => {
    hideOnClose();
    system = [sys('a', { cta_label: 'Open', cta_url: '/settings?tab=payments' }), sys('b')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('cta');
    expect(events).toContainEqual(['a', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/settings?tab=payments');
    expect(openId()).toBe('b');
    click('close');
    expect(openId()).toBeNull();
  });

  it('the user\'s case: two soft dialogs due, one already dismissed ("Once"): a pager of the two due ones', () => {
    system = [sys('d1', { is_due: false }), sys('d2'), sys('d3')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(pages()).toBe('d2,d3');
  });
});

describe('blocked', () => {
  it('subscription gate up: no system dialog at all, hard or soft, however long; passed to the blocker hook', () => {
    system = [hardSys('hard'), sys('soft')];
    mount({ showGate: true });
    advance(60_000);
    expect(openId()).toBeNull();
    expect(events).toEqual([]);
    expect(blockedOpts.every((o) => o.showGate === true)).toBe(true);
    update({ showGate: false });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
  });

  it('a gate or modal appearing over an open pager: it yields with NO event, and comes back on page 1', () => {
    system = [sys('a'), sys('b')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('next page');
    blocked = true;
    update();
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([]);
    advance(10_000);
    expect(openId()).toBeNull();
    blocked = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('a');
    expect(nonShown()).toEqual([]);
  });

  it('tells the blocker hook when its own dialog is open', () => {
    system = [sys('soft')];
    mount();
    expect(blockedOpts[blockedOpts.length - 1].ownDialogOpen).toBe(false);
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(blockedOpts[blockedOpts.length - 1].ownDialogOpen).toBe(true);
  });

  it('onboarding on screen that is not in use does NOT hold a system dialog back', () => {
    onboarding = true;
    system = [sys('soft')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
  });
});

describe('the system priority signal (what onboarding reads)', () => {
  it("'idle' with nothing due; 'pending' while one is due and waiting; 'open' while on screen; 'idle' after", () => {
    hideOnClose();
    mount();
    expect(priority()).toBe('idle');
    system = [sys('a'), sys('b')];
    update();
    expect(priority()).toBe('pending');
    expect(document.documentElement.getAttribute('data-system-announcement')).toBe('pending');
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(priority()).toBe('open');
    click('close');
    expect(priority()).toBe('open');
    click('close');
    expect(openId()).toBeNull();
    expect(priority()).toBe('idle');
    expect(document.documentElement.hasAttribute('data-system-announcement')).toBe(false);
  });

  it("'pending' while the paywall holds it back: onboarding waits too", () => {
    system = [sys('soft')];
    mount({ showGate: true });
    advance(60_000);
    expect(priority()).toBe('pending');
  });

  it("'pending' for as long as a hard dialog applies, even on a page where it is itself hidden", () => {
    system = [hardSys('hard', { cta_label: 'Open', cta_url: '/vehicles' })];
    mount({ pathname: '/vehicles' });
    advance(60_000);
    expect(openId()).toBeNull();
    expect(priority()).toBe('pending');
  });

  it("'pending' while the FIRST read is still out, for at most ANNOUNCEMENT_READ_WAIT_MS", () => {
    status = 'loading';
    mount();
    expect(priority()).toBe('pending');
    advance(ANNOUNCEMENT_READ_WAIT_MS - 1);
    expect(priority()).toBe('pending');
    advance(1);
    expect(priority()).toBe('idle');
  });

  it("the read coming back with nothing due releases onboarding at once; an error does too", () => {
    status = 'loading';
    mount();
    expect(priority()).toBe('pending');
    status = 'ready';
    update();
    expect(priority()).toBe('idle');
    status = 'error';
    update();
    expect(priority()).toBe('idle');
  });

  it("back to 'idle' when the host unmounts", () => {
    system = [sys('soft')];
    mount();
    expect(priority()).toBe('pending');
    view.unmount();
    expect(priority()).toBe('idle');
  });
});

describe('features come last', () => {
  it('system and feature both due: the system pager only; the feature waits for the next moment AND the dashboard', () => {
    hideOnClose();
    system = [sys('soft')];
    features = [feat('feature')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
    expect(featureDialog()).toBeNull();
    click('close');
    advance(60_000);
    expect(openId()).toBeNull();

    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS * 4);
    expect(openId()).toBeNull();

    update({ pathname: '/' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('feature');
  });

  it('a feature waits for onboarding on screen, even when nothing else blocks', () => {
    onboarding = true;
    features = [feat('feature')];
    mount();
    advance(60_000);
    expect(openId()).toBeNull();
    onboarding = false;
    update();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('feature');
  });

  it('an open feature yields (no event) to a system dialog that becomes due', () => {
    features = [feat('feature')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('feature');
    system = [sys('soft')];
    update();
    expect(featureDialog()).toBeNull();
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('soft');
    expect(nonShown()).toEqual([]);
  });

  it('an open feature yields to onboarding that comes up', () => {
    features = [feat('feature')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    onboarding = true;
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
    click('got it');
    expect(events).toContainEqual(['f1', 'dismissed']);

    update({ pathname: '/rentals' });
    update({ pathname: '/' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('f2');
    click('dont show again');
    expect(events).toContainEqual(['f2', 'dont_show_again']);
    expect(openId()).toBeNull();

    update({ pathname: '/vehicles' });
    update({ pathname: '/' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('f3');
    click('feature cta');
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

describe('closing and events', () => {
  it('a soft row that stops being due elsewhere closes with no event', () => {
    system = [sys('soft')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    system = [sys('soft', { is_due: false })];
    update();
    expect(openId()).toBeNull();
    expect(nonShown()).toEqual([]);
  });

  it('single soft: close records dismissed; the button records cta_clicked, closes and navigates', () => {
    hideOnClose();
    system = [sys('softA')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('close');
    expect(events).toEqual([
      ['softA', 'shown'],
      ['softA', 'dismissed'],
    ]);
    expect(openId()).toBeNull();

    system = [...system, sys('softB', { cta_label: 'Open', cta_url: '/settings?tab=payments' })];
    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('softB');
    click('cta');
    expect(events).toContainEqual(['softB', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/settings?tab=payments');
    expect(openId()).toBeNull();
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
    system = [hardSys('hard', { cta_label: 'Open vehicles', cta_url: '/vehicles' }), sys('soft')];
    mount({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    click('cta');
    expect(events).toContainEqual(['hard', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/vehicles');
    expect(openId()).toBe('hard');

    // On its own page the hard item is exempt, and it still holds the soft one back.
    update({ pathname: '/vehicles' });
    expect(openId()).toBeNull();
    expect(events.filter(([, e]) => e === 'dismissed')).toEqual([]);

    update({ pathname: '/rentals' });
    advance(ANNOUNCEMENT_SETTLE_MS);
    expect(openId()).toBe('hard');
    expect(pages()).toBe('hard,soft');
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

  it('while a hard blocker applies but is exempt here, no soft or feature dialog opens either', () => {
    system = [hardSys('hard', { cta_label: 'Open', cta_url: '/' }), sys('soft')];
    features = [feat('feature')];
    mount({ pathname: '/' });
    advance(10_000);
    expect(openId()).toBeNull();
  });
});
