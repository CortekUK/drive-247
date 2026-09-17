/**
 * SystemAnnouncementBanner: the one full-width system banner slot.
 *
 * Pinned:
 *   - it renders NOTHING (no element, no spacer, no <html> attribute) while loading,
 *     after an error, with no rows, with only dialogs, or with only soft banners
 *     that are no longer due: every tenant without an active banner is untouched;
 *   - while it shows, it publishes `html[data-system-banner]` and
 *     `--system-banner-h` (what global.css offsets the fixed chrome by) and sizes
 *     its in-flow spacer to the same height; both go away with it;
 *   - one slot: the first row wins, a soft X records `dismissed` and the next due
 *     banner takes the slot, a hard banner has no X;
 *   - the button renders only for a valid in-portal path the user's role may open;
 *   - tone classes come from the contract map; the text is never truncated.
 *
 * The data hook is mocked: its own suite pins the read, and here the rows are
 * exactly what the banner is handed (already ordered, `is_due` already merged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SystemAnnouncementBanner } from '@/components/announcements/system-announcement-banner';
import { TONE_CLASSES, type AnnouncementEvent, type PortalAnnouncement } from '@/lib/announcements/contract';
import { readPortalSource } from '../helpers/edge-source';

// ── Doubles ─────────────────────────────────────────────────────────────────

const events: Array<[string, AnnouncementEvent]> = [];
let rows: PortalAnnouncement[] = [];
let status: 'loading' | 'error' | 'ready' = 'ready';
let permitted = (_path: string) => true;
const push = vi.fn();

const recordEvent = vi.fn((a: PortalAnnouncement, event: AnnouncementEvent) => {
  events.push([a.id, event]);
});

vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({ status, system: rows, features: [], featuresEnabled: false, recordEvent }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ canAccessRoute: (p: string) => permitted(p), isManager: false, isReadOnlyRole: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// A constructible ResizeObserver double that hands back its callback. (The shared
// setup's `vi.fn().mockImplementation(() => …)` is not constructible under Vitest 4.)
let observerCallback: (() => void) | null = null;
class FakeResizeObserver {
  constructor(cb: () => void) {
    observerCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const RealResizeObserver = global.ResizeObserver;

// jsdom lays nothing out; give the banner a real-looking height to publish.
const BANNER_HEIGHT = 44.4;
let rectSpy: ReturnType<typeof vi.spyOn>;

function banner(over: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return {
    id: 'b1',
    kind: 'system',
    title: 'Scheduled maintenance',
    summary: null,
    body: 'Payments are paused on Sunday from 02:00 to 03:00 UTC.',
    image_url: null,
    slides: [],
    cta_label: null,
    cta_url: null,
    display: 'banner',
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

const html = () => document.documentElement;
const region = () => document.querySelector('[data-system-banner-root]') as HTMLElement | null;
const spacer = () => document.querySelector('[data-system-banner-spacer]') as HTMLElement | null;

function expectNothing() {
  expect(region()).toBeNull();
  expect(spacer()).toBeNull();
  expect(html().hasAttribute('data-system-banner')).toBe(false);
  expect(html().style.getPropertyValue('--system-banner-h')).toBe('');
}

beforeEach(() => {
  rows = [];
  status = 'ready';
  permitted = () => true;
  events.length = 0;
  recordEvent.mockReset();
  recordEvent.mockImplementation((a, event) => {
    events.push([a.id, event]);
  });
  push.mockClear();
  observerCallback = null;
  global.ResizeObserver = FakeResizeObserver as never;
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const h = this.hasAttribute('data-system-banner-root') ? BANNER_HEIGHT : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  rectSpy.mockRestore();
  global.ResizeObserver = RealResizeObserver;
  html().removeAttribute('data-system-banner');
  html().style.removeProperty('--system-banner-h');
});

describe('renders nothing', () => {
  it.each([
    ['loading', 'loading' as const, [] as PortalAnnouncement[]],
    ['error', 'error' as const, []],
    ['no rows', 'ready' as const, []],
    ['only dialogs', 'ready' as const, [banner({ display: 'dialog' }), banner({ id: 'b2', display: 'dialog', blocking: 'hard' })]],
    ['only soft banners that are not due', 'ready' as const, [banner({ is_due: false }), banner({ id: 'b2', is_due: false })]],
  ])('%s', (_label, s, r) => {
    status = s;
    rows = r;
    render(<SystemAnnouncementBanner />);
    expectNothing();
    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe('one due banner', () => {
  it('renders a labelled full-width region with the title and full body', () => {
    rows = [banner()];
    render(<SystemAnnouncementBanner />);
    const root = screen.getByRole('region', { name: 'Announcement' });
    expect(root).toHaveTextContent('Scheduled maintenance');
    expect(root).toHaveTextContent('Payments are paused on Sunday from 02:00 to 03:00 UTC.');
    expect(root.className).toContain('fixed');
    expect(root.className).toContain('inset-x-0');
    expect(root.className).toContain('top-0');
  });

  it('publishes the attribute and height variable, sizes the spacer, and removes both on unmount', () => {
    rows = [banner()];
    const view = render(<SystemAnnouncementBanner />);
    expect(html().getAttribute('data-system-banner')).toBe('');
    expect(html().style.getPropertyValue('--system-banner-h')).toBe('45px');
    expect(spacer()!.style.height).toBe('45px');
    expect(spacer()!.getAttribute('aria-hidden')).toBe('true');
    // The spacer is in flow, BEFORE the fixed bar, so the app below starts under it.
    expect(spacer()!.nextElementSibling).toBe(region());

    view.unmount();
    expectNothing();
  });

  it('removes the attribute the moment the row goes away (deactivated, tenant left the filter)', () => {
    rows = [banner()];
    const view = render(<SystemAnnouncementBanner />);
    expect(html().hasAttribute('data-system-banner')).toBe(true);
    rows = [];
    view.rerender(<SystemAnnouncementBanner />);
    expectNothing();
  });

  it('records `shown` once for the banner it renders', () => {
    rows = [banner()];
    const view = render(<SystemAnnouncementBanner />);
    view.rerender(<SystemAnnouncementBanner />);
    expect(recordEvent.mock.calls.filter(([, e]) => e === 'shown').map(([a]) => a.id)).toEqual(['b1']);
  });
});

describe('the slot', () => {
  it('shows only the first banner; a soft X records dismissed and the next due banner takes the slot', () => {
    const first = banner({ id: 'first', title: 'First notice' });
    const second = banner({ id: 'second', title: 'Second notice' });
    const notDue = banner({ id: 'notDue', title: 'Old notice', is_due: false });
    rows = [first, notDue, second];
    // Mirror the real hook: a dismissal makes the row not due.
    recordEvent.mockImplementation((a, event) => {
      events.push([a.id, event]);
      if (event === 'dismissed') rows = rows.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
    });

    const view = render(<SystemAnnouncementBanner />);
    expect(screen.getAllByRole('region', { name: 'Announcement' })).toHaveLength(1);
    expect(region()).toHaveTextContent('First notice');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
    view.rerender(<SystemAnnouncementBanner />);
    expect(events).toContainEqual(['first', 'dismissed']);
    expect(region()).toHaveTextContent('Second notice');
    expect(html().hasAttribute('data-system-banner')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
    view.rerender(<SystemAnnouncementBanner />);
    expectNothing();
  });

  it('a hard banner has no X and outranks the soft one the server put after it', () => {
    rows = [banner({ id: 'hard', blocking: 'hard', title: 'Stripe is not connected', tone: 'critical' }), banner()];
    render(<SystemAnnouncementBanner />);
    expect(region()).toHaveTextContent('Stripe is not connected');
    expect(region()!.getAttribute('data-blocking')).toBe('hard');
    expect(screen.queryByRole('button', { name: 'Dismiss announcement' })).toBeNull();
  });
});

describe('the button', () => {
  it('renders for a valid in-portal path the role may open; click records cta_clicked and navigates', () => {
    const calls: string[] = [];
    permitted = (p) => {
      calls.push(p);
      return true;
    };
    rows = [banner({ cta_label: 'Connect Stripe', cta_url: '/settings?tab=payments#stripe' })];
    render(<SystemAnnouncementBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }));
    expect(calls).toContain('/settings');
    expect(events).toContainEqual(['b1', 'cta_clicked']);
    expect(push).toHaveBeenCalledWith('/settings?tab=payments#stripe');
  });

  it('is hidden for a path outside the portal', () => {
    rows = [banner({ cta_label: 'Pay now', cta_url: 'https://evil.example/pay' })];
    render(<SystemAnnouncementBanner />);
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull();
    expect(region()).not.toBeNull();
  });

  it('is hidden when the role may not open that page', () => {
    permitted = (p) => p !== '/settings';
    rows = [banner({ cta_label: 'Connect Stripe', cta_url: '/settings' })];
    render(<SystemAnnouncementBanner />);
    expect(screen.queryByRole('button', { name: 'Connect Stripe' })).toBeNull();
    // The soft X is still there: only the button is role-gated.
    expect(screen.getByRole('button', { name: 'Dismiss announcement' })).toBeInTheDocument();
  });

  it('a hard banner without a permitted button renders no action row at all', () => {
    permitted = () => false;
    rows = [banner({ blocking: 'hard', cta_label: 'Open', cta_url: '/vehicles' })];
    render(<SystemAnnouncementBanner />);
    expect(region()!.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('looks', () => {
  it.each(['info', 'success', 'warning', 'critical'] as const)('applies the %s tone classes from the contract', (tone) => {
    rows = [banner({ tone })];
    render(<SystemAnnouncementBanner />);
    const classes = region()!.className.split(/\s+/);
    for (const c of TONE_CLASSES[tone].banner.split(/\s+/)) expect(classes).toContain(c);
    expect(region()!.getAttribute('data-tone')).toBe(tone);
  });

  it('the critical tone is the solid red banner', () => {
    rows = [banner({ tone: 'critical' })];
    render(<SystemAnnouncementBanner />);
    expect(region()!.className).toContain('bg-red-600');
    expect(region()!.className).toContain('text-white');
  });

  it('never truncates: a 200-character body and a 30-character button render in full, line breaks as spaces', () => {
    const body = 'Line one.\n\nLine two. ' + 'x'.repeat(200 - 'Line one.\n\nLine two. '.length);
    rows = [banner({ body, cta_label: 'A'.repeat(30), cta_url: '/settings' })];
    render(<SystemAnnouncementBanner />);
    expect(region()).toHaveTextContent(body.replace(/\n+/g, ' '));
    expect(screen.getByRole('button', { name: 'A'.repeat(30) })).toBeInTheDocument();
    expect(region()!.innerHTML).not.toMatch(/truncate|line-clamp/);
  });

  it('renders the body as text, never as HTML', () => {
    rows = [banner({ body: '<img src=x onerror="alert(1)"> <b>bold</b>' })];
    render(<SystemAnnouncementBanner />);
    expect(region()!.querySelector('img, b')).toBeNull();
    expect(region()).toHaveTextContent('<img src=x onerror="alert(1)"> <b>bold</b>');
    expect(readPortalSource('components/announcements/system-announcement-banner.tsx')).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('resize', () => {
  it('re-publishes the height when the banner wraps to a new size', () => {
    rows = [banner()];
    render(<SystemAnnouncementBanner />);
    expect(html().style.getPropertyValue('--system-banner-h')).toBe('45px');
    rectSpy.mockImplementation(function (this: HTMLElement) {
      const h = this.hasAttribute('data-system-banner-root') ? 88 : 0;
      return { height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    act(() => observerCallback!());
    expect(html().style.getPropertyValue('--system-banner-h')).toBe('88px');
    expect(spacer()!.style.height).toBe('88px');
  });

  it('lines the icon up with the FIRST line once the text wraps, and centres it again on one line', () => {
    // Centred against five wrapped lines, the icon floated beside the third one (phone).
    const rect = (h: number) =>
      ({ height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const sizes = (root: number, text: number) =>
      rectSpy.mockImplementation(function (this: HTMLElement) {
        return rect(this.hasAttribute('data-system-banner-root') ? root : this.tagName === 'P' ? text : 0);
      });
    const iconClasses = () => (region()!.querySelector('[data-tone-icon]')!.getAttribute('class') ?? '').split(/\s+/);

    rows = [banner()];
    sizes(45, 20);
    render(<SystemAnnouncementBanner />);
    expect(iconClasses()).not.toContain('self-start');

    sizes(171, 100);
    act(() => observerCallback!());
    expect(iconClasses()).toEqual(expect.arrayContaining(['self-start', 'mt-0.5']));

    sizes(45, 20);
    act(() => observerCallback!());
    expect(iconClasses()).not.toContain('self-start');
  });

  it('survives an environment whose ResizeObserver throws', () => {
    global.ResizeObserver = function () {
      throw new Error('not a constructor');
    } as never;
    rows = [banner()];
    render(<SystemAnnouncementBanner />);
    expect(region()).not.toBeNull();
    expect(html().style.getPropertyValue('--system-banner-h')).toBe('45px');
  });
});
