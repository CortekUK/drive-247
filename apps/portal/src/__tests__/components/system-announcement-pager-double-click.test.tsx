/**
 * A DOUBLE CLICK on the system dialog's pager, the host and the REAL dialog together
 * (review round 5).
 *
 * Every page's footer is laid out in ONE grid cell, so the button of the page that takes
 * over sits exactly where the button just pressed was. The first click of a double click
 * dismisses the page and the next page appears in the same moment, so the second click
 * used to land on the new page: it signed the operator out, pressed a hard page's button
 * (recording `cta_clicked` and navigating), or dismissed a soft notice nobody had read —
 * which, for a "Once" notice, means it never comes back and the stats say it was seen.
 *
 * Pinned here: for a moment after the page changes by itself, nothing in the footer (and
 * no X, Escape or outside click) does anything; a moment later everything works again;
 * and the operator's own paging is never held back.
 *
 * Only the data sources are doubles (rows, router, auth, permissions, the blockers): the
 * host, the dialog, its pager and Radix are real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AnnouncementDialogHost } from '@/components/announcements/announcement-dialog-host';
import { SYSTEM_DIALOG_PAGE_GUARD_MS } from '@/components/announcements/system-announcement-dialog';
import {
  ANNOUNCEMENT_SETTLE_MS,
  type AnnouncementEvent,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';
import { __resetSystemAnnouncementPriority } from '@/lib/announcements/system-priority';

// ── Doubles ─────────────────────────────────────────────────────────────────

const events: Array<[string, AnnouncementEvent]> = [];
let system: PortalAnnouncement[] = [];
const recordEvent = vi.fn((a: PortalAnnouncement, event: AnnouncementEvent) => {
  events.push([a.id, event]);
  // What the real hook does: a dismissal (and a soft button click) hides the row at once.
  if (event === 'dismissed' || (event === 'cta_clicked' && a.blocking !== 'hard')) {
    system = system.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
  }
});
vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({ status: 'ready', system, features: [], featuresEnabled: false, recordEvent }),
}));
vi.mock('@/hooks/use-announcement-blocked', () => ({
  useAnnouncementBlocked: () => ({ system: false, feature: false }),
  readAnnouncementDomBlocked: () => false,
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ isManager: false, isReadOnlyRole: false, canAccessRoute: () => true }),
}));
const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));
const signOut = vi.fn(async () => {});
vi.mock('@/stores/auth-store', () => ({ useAuth: () => ({ signOut }) }));

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

let view: ReturnType<typeof render>;
const Host = () => <AnnouncementDialogHost showGate={false} isSubscriptionPage={false} pathname="/rentals" />;
const mount = () => {
  view = render(<Host />);
};
/** The re-render the data hook causes: in the browser it happens inside the first click. */
const update = () => view.rerender(<Host />);
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const panel = () => document.querySelector<HTMLElement>('[data-system-announcement-dialog]');
const button = (name: string) => screen.queryByRole('button', { name });
const nonShown = () => events.filter(([, e]) => e !== 'shown');

beforeEach(() => {
  vi.useFakeTimers();
  __resetSystemAnnouncementPriority();
  system = [];
  events.length = 0;
  recordEvent.mockClear();
  push.mockClear();
  replace.mockClear();
  signOut.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetSystemAnnouncementPriority();
  document.body.removeAttribute('data-scroll-locked');
});

describe('a double click on a paged system dialog', () => {
  it('the hard page that takes over is not signed out of and its button is not pressed', () => {
    system = [
      notice('d-hard', {
        blocking: 'hard',
        tone: 'critical',
        title: 'Your Stripe account needs attention',
        cta_label: 'Open payments',
        cta_url: '/settings?tab=payments',
      }),
      notice('d-soft1', { tone: 'warning', title: 'Maintenance on Sunday' }),
      notice('d-soft2', { title: 'Unread second soft' }),
    ];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    // Page back to the LAST page, as the review probe did.
    fireEvent.click(button('Previous announcement')!);
    update();
    expect(panel()!.getAttribute('data-page-index')).toBe('2');
    expect(screen.getByRole('dialog', { name: 'Unread second soft' })).toBeInTheDocument();

    // The first click of the double click: it dismisses this page, and the hard page
    // wraps into its place with Sign out and its button in the same spot.
    fireEvent.click(button('Got it')!);
    update();
    expect(panel()!.getAttribute('data-blocking')).toBe('hard');
    expect(panel()!.getAttribute('data-page-index')).toBe('0');

    // The second click, wherever it lands.
    fireEvent.click(button('Sign out')!);
    fireEvent.click(button('Open payments')!);
    expect(signOut).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(nonShown()).toEqual([['d-soft2', 'dismissed']]);

    // A moment later the page's own buttons work again.
    advance(SYSTEM_DIALOG_PAGE_GUARD_MS);
    fireEvent.click(button('Open payments')!);
    expect(push).toHaveBeenCalledWith('/settings?tab=payments');
    expect(nonShown()).toEqual([
      ['d-soft2', 'dismissed'],
      ['d-hard', 'cta_clicked'],
    ]);
  });

  it('a soft page that takes over is not dismissed unread, and its `shown` stands alone', () => {
    system = [notice('s1'), notice('s2', { title: 'Unread' }), notice('s3')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    fireEvent.click(button('Got it')!);
    update();
    expect(screen.getByRole('dialog', { name: 'Unread' })).toBeInTheDocument();
    fireEvent.click(button('Got it')!);
    update();
    expect(nonShown()).toEqual([['s1', 'dismissed']]);
    expect(screen.getByRole('dialog', { name: 'Unread' })).toBeInTheDocument();
    // Escape and an outside click are held back the same way.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(button('Close')!);
    update();
    expect(nonShown()).toEqual([['s1', 'dismissed']]);

    advance(SYSTEM_DIALOG_PAGE_GUARD_MS);
    fireEvent.click(button('Got it')!);
    update();
    expect(nonShown()).toEqual([
      ['s1', 'dismissed'],
      ['s2', 'dismissed'],
    ]);
    expect(screen.getByRole('dialog', { name: 'Notice s3' })).toBeInTheDocument();
    expect(events.filter(([, e]) => e === 'shown').map(([id]) => id)).toEqual(['s1', 's2', 's3']);
  });

  it('the operator paging on with Next and closing that page at once is never held back', () => {
    system = [notice('s1'), notice('s2')];
    mount();
    advance(ANNOUNCEMENT_SETTLE_MS);
    fireEvent.click(button('Next announcement')!);
    update();
    expect(screen.getByRole('dialog', { name: 'Notice s2' })).toBeInTheDocument();
    fireEvent.click(button('Got it')!);
    update();
    expect(nonShown()).toEqual([['s2', 'dismissed']]);
  });
});
