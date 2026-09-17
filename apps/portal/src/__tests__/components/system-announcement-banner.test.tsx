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
 *   - ONE banner: exactly the bar it always was (no dots, nothing moves);
 *   - TWO OR MORE (user, Sep 17 2026: "slide automatically", "sliding effect ... dot",
 *     and "no no donot show like this" about a pause / < / 1 of 2 / > pill):
 *       - it slides to the next banner every SYSTEM_BANNER_ROTATE_MS and loops;
 *       - a dots indicator, one button per banner, the showing one a wider pill with
 *         `aria-current`; a click jumps there and restarts the interval; Left / Right on
 *         a dot moves; a touch swipe moves;
 *       - NO pause button, NO previous / next arrows, NO "n / N" counter;
 *       - it waits while hovered, while keyboard focus is inside, while the tab is
 *         hidden and while a modal covers it, and never moves by itself under reduced
 *         motion;
 *       - hard first then soft, all reachable; a hard banner has no X; X closes the
 *         banner showing and the next remaining one slides in;
 *       - the slide is a transform + opacity animation on the stacked elements, the
 *         right way round, a crossfade under reduced motion, and the bar's height never
 *         changes while it slides;
 *       - `shown` once per banner, only when it is the one showing, uncovered, in a
 *         visible tab;
 *       - X and the button of a banner that has only just slid in do nothing for
 *         SYSTEM_BANNER_ACTIVATION_GUARD_MS (a double click on X must not close the
 *         banner arriving); a dot, a key or a swipe lifts that at once;
 *   - the button renders only for a valid in-portal path the user's role may open;
 *   - tone classes come from the contract map; the text is never truncated.
 *
 * The data hook is mocked: its own suite pins the read, and here the rows are
 * exactly what the banner is handed (already ordered, `is_due` already merged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';

import {
  SYSTEM_BANNER_ACTIVATION_GUARD_MS,
  SYSTEM_BANNER_FADE_MS,
  SYSTEM_BANNER_ROTATE_MS,
  SYSTEM_BANNER_SLIDE_MS,
  SystemAnnouncementBanner,
} from '@/components/announcements/system-announcement-banner';
import { TONE_CLASSES, type AnnouncementEvent, type PortalAnnouncement } from '@/lib/announcements/contract';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
const textSlides = () => Array.from(document.querySelectorAll<HTMLElement>('[data-system-banner-slide]'));
const slideIds = () => textSlides().map((el) => el.getAttribute('data-system-banner-slide'));
const showing = () =>
  document.querySelector('[data-system-banner-slide][data-active]')?.getAttribute('data-system-banner-slide') ?? null;
const dotsGroup = () => document.querySelector<HTMLElement>('[data-system-banner-dots]');
const dots = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-system-banner-dot]'));
const dot = (n: number, of: number) => screen.getByRole('button', { name: `Show announcement ${n} of ${of}` });
const live = () => document.querySelector<HTMLElement>('[data-system-banner-live]');
const shownIds = () => events.filter(([, e]) => e === 'shown').map(([id]) => id);
const dismissButton = () => screen.getByRole('button', { name: 'Dismiss announcement' });

function expectNothing() {
  expect(region()).toBeNull();
  expect(spacer()).toBeNull();
  expect(html().hasAttribute('data-system-banner')).toBe(false);
  expect(html().style.getPropertyValue('--system-banner-h')).toBe('');
}

/** Mirror the real hook: a dismissal makes the row not due. */
function closable() {
  recordEvent.mockImplementation((a, event) => {
    events.push([a.id, event]);
    if (event === 'dismissed') rows = rows.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
  });
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
  vi.useRealTimers();
  rectSpy.mockRestore();
  global.ResizeObserver = RealResizeObserver;
  html().removeAttribute('data-system-banner');
  html().style.removeProperty('--system-banner-h');
  document.body.removeAttribute('data-scroll-locked');
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

  it('is the bar it always was: no dots, no live region, no carousel, nothing animated or waiting', () => {
    vi.useFakeTimers();
    const animate = vi.fn();
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      rows = [banner({ cta_label: 'Open settings', cta_url: '/settings' })];
      const view = render(<SystemAnnouncementBanner />);
      expect(dotsGroup()).toBeNull();
      expect(dots()).toHaveLength(0);
      expect(live()).toBeNull();
      expect(region()!.hasAttribute('aria-roledescription')).toBe(false);
      expect(region()!.hasAttribute('data-rotating')).toBe(false);
      expect(region()!.className).not.toMatch(/transition|duration|touch-pan/);
      for (const el of textSlides()) expect(el.className).not.toMatch(/transition|duration/);
      // The same one action group it always had: the button and the X side by side.
      const actions = document.querySelector('[data-system-banner-actions]')!;
      expect(actions.querySelector('[data-system-banner-slide-actions="b1"]')).not.toBeNull();
      expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
        'Open settings',
        'Dismiss announcement',
      ]);
      act(() => {
        vi.advanceTimersByTime(SYSTEM_BANNER_ROTATE_MS * 3);
      });
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('b1');
      expect(animate).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
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
    expect(shownIds()).toEqual(['b1']);
  });

  it('a soft X records dismissed; with nothing left the bar goes', () => {
    rows = [banner()];
    closable();
    const view = render(<SystemAnnouncementBanner />);
    fireEvent.click(dismissButton());
    view.rerender(<SystemAnnouncementBanner />);
    expect(events).toContainEqual(['b1', 'dismissed']);
    expectNothing();
  });

  it('a hard banner has no X', () => {
    rows = [banner({ id: 'hard', blocking: 'hard', title: 'Stripe is not connected', tone: 'critical' })];
    render(<SystemAnnouncementBanner />);
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
    expect(dismissButton()).toBeInTheDocument();
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

// ── The slider ──────────────────────────────────────────────────────────────

describe('the slider (two or more due banners)', () => {
  const REDUCED = '(prefers-reduced-motion: reduce)';
  const realMatchMedia = window.matchMedia;
  let visibility: DocumentVisibilityState = 'visible';

  /** The user's three: warning, info, critical. */
  const three = () => [
    banner({ id: 'a', title: 'Alpha notice', tone: 'warning' }),
    banner({ id: 'b', title: 'Bravo notice', tone: 'info', cta_label: 'Open settings', cta_url: '/settings' }),
    banner({ id: 'c', title: 'Charlie notice', tone: 'critical', cta_label: 'Open vehicles', cta_url: '/vehicles' }),
  ];

  function setReducedMotion(reduced: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query === REDUCED,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as never;
  }

  function setVisibility(state: DocumentVisibilityState) {
    visibility = state;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  /**
   * `n` whole intervals, one act each: the next interval is armed by an effect of the
   * render the previous one caused, which only commits when its act ends.
   */
  const intervals = (n: number) => {
    for (let i = 0; i < n; i += 1) advance(SYSTEM_BANNER_ROTATE_MS);
  };

  /** MutationObserver callbacks are microtasks. */
  const flushObservers = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    setReducedMotion(false);
  });

  afterEach(() => {
    window.matchMedia = realMatchMedia;
    // Back to jsdom's own getter on Document.prototype.
    delete (document as unknown as Record<string, unknown>).visibilityState;
    document.querySelectorAll('[data-test-modal]').forEach((el) => el.remove());
  });

  describe('markup', () => {
    it('stacks every banner in one grid cell; the ones not showing are invisible, aria-hidden and inert', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(slideIds()).toEqual(['a', 'b', 'c']);
      const parts = Array.from(document.querySelectorAll<HTMLElement>('[data-slide-of]'));
      // Text, button cell and X cell for each banner.
      expect(parts.map((el) => el.getAttribute('data-slide-of'))).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']);
      for (const el of parts) {
        const classes = el.className.split(/\s+/);
        expect(classes).toEqual(expect.arrayContaining(['col-start-1', 'row-start-1']));
        expect(el.parentElement!.className.split(/\s+/)).toContain('grid');
        if (el.getAttribute('data-slide-of') === 'a') {
          expect(classes).toEqual(expect.arrayContaining(['visible', 'opacity-100']));
          expect(el.hasAttribute('aria-hidden')).toBe(false);
          expect(el.hasAttribute('inert')).toBe(false);
        } else {
          expect(classes).toEqual(expect.arrayContaining(['invisible', 'opacity-0']));
          expect(el.getAttribute('aria-hidden')).toBe('true');
          expect(el.hasAttribute('inert')).toBe(true);
        }
      }
      expect(screen.queryByRole('button', { name: 'Open settings' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open vehicles' })).toBeNull();
    });

    it('a carousel region with one dot per banner: labelled buttons, the showing one current and wider', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(region()!.getAttribute('aria-roledescription')).toBe('carousel');
      expect(dots()).toHaveLength(3);
      expect(dots().map((d) => d.getAttribute('aria-label'))).toEqual([
        'Show announcement 1 of 3',
        'Show announcement 2 of 3',
        'Show announcement 3 of 3',
      ]);
      expect(dots().map((d) => d.getAttribute('aria-current'))).toEqual(['true', null, null]);
      const [first, second] = dots();
      // 24px tall hit areas; the showing one 32px wide around a 16px pill, the rest 24px around a 6px dot.
      expect(first.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-6', 'w-8', 'cursor-pointer']));
      expect(second.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-6', 'w-6']));
      expect(first.firstElementChild!.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-1.5', 'w-4', 'rounded-full']));
      expect(second.firstElementChild!.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-1.5', 'w-1.5', 'rounded-full']));
      expect(first.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
      // A visible keyboard focus ring.
      expect(first.className).toContain('focus-visible:ring-2');
    });

    it('NO pause or play button, NO previous / next arrows, NO "n / N" counter', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(screen.queryByRole('button', { name: /pause|play|previous|next/i })).toBeNull();
      expect(region()!.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
      expect(region()!.textContent).not.toMatch(/\b1 of 3\b/);
      expect(region()!.querySelector('[data-system-banner-controls], [data-system-banner-counter]')).toBeNull();
      expect(region()!.querySelector('svg.lucide-chevron-left, svg.lucide-chevron-right, svg.lucide-pause, svg.lucide-play')).toBeNull();
      // Everything reachable: the three dots, then the showing banner's X. Nothing else.
      expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
        'Show announcement 1 of 3',
        'Show announcement 2 of 3',
        'Show announcement 3 of 3',
        'Dismiss announcement',
      ]);
      expect(readPortalSource('components/announcements/system-announcement-banner.tsx')).not.toMatch(
        /\b(Pause|Play|ChevronLeft|ChevronRight)\b/,
      );
    });

    it('the dots sit at the end of the bar, right before the X; the buttons before them', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      const tail = document.querySelector('[data-system-banner-tail]')!;
      const order = Array.from(tail.children)
        .map((el) =>
          el.hasAttribute('data-system-banner-ctas')
            ? 'buttons'
            : el.hasAttribute('data-system-banner-dots')
              ? 'dots'
              : el.hasAttribute('data-system-banner-dismisses')
                ? 'x'
                : el.hasAttribute('data-system-banner-live')
                  ? 'live'
                  : '?',
        );
      expect(order).toEqual(['buttons', 'dots', 'x', 'live']);
      expect(tail.className.split(/\s+/)).toEqual(expect.arrayContaining(['ml-auto', 'flex-wrap', 'max-w-full', 'items-center']));
      expect(dotsGroup()!.className.split(/\s+/)).toEqual(expect.arrayContaining(['items-center', 'self-center']));
    });

    it('with no X in the list (hard banners only) the dots come before the buttons', () => {
      rows = [
        banner({ id: 'h1', blocking: 'hard', tone: 'critical', cta_label: 'Update card', cta_url: '/subscription' }),
        banner({ id: 'h2', blocking: 'hard', tone: 'warning' }),
      ];
      render(<SystemAnnouncementBanner />);
      const tail = document.querySelector('[data-system-banner-tail]')!;
      const kids = Array.from(tail.children);
      expect(kids[0].hasAttribute('data-system-banner-dots')).toBe(true);
      expect(kids[1].hasAttribute('data-system-banner-ctas')).toBe(true);
      expect(tail.querySelector('[data-system-banner-dismisses]')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Dismiss announcement' })).toBeNull();
    });

    it('the dots take the colours of the banner showing, light and dark', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      const active = () => dots().find((d) => d.getAttribute('aria-current'))!.firstElementChild!.className;
      const idle = () => dots().find((d) => !d.getAttribute('aria-current'))!.firstElementChild!.className;
      expect(active()).toContain('bg-amber-800');
      expect(active()).toContain('dark:bg-amber-200');
      expect(idle()).toContain('bg-amber-900/40');
      fireEvent.click(dot(3, 3));
      expect(active()).toContain('bg-white');
      expect(idle()).toContain('bg-white/50');
      fireEvent.click(dot(2, 3));
      expect(active()).toContain('bg-sky-800');
      expect(idle()).toContain('dark:bg-sky-100/40');
    });

    it('the bar fades between tones and a horizontal touch drag is the bar’s own', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(region()!.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['transition-colors', 'duration-300', 'motion-reduce:transition-none', 'touch-pan-y']),
      );
    });

    it('two banners are a slider too', () => {
      rows = three().slice(0, 2);
      render(<SystemAnnouncementBanner />);
      expect(dots()).toHaveLength(2);
      expect(dot(2, 2)).toBeInTheDocument();
    });
  });

  describe('sliding by itself', () => {
    it(`3 due banners: moves on every ${SYSTEM_BANNER_ROTATE_MS} ms and loops from the last to the first`, () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(showing()).toBe('a');
      expect(region()!.getAttribute('data-rotating')).toBe('true');
      advance(SYSTEM_BANNER_ROTATE_MS - 1);
      expect(showing()).toBe('a');
      advance(1);
      expect(showing()).toBe('b');
      expect(dots().map((d) => d.getAttribute('aria-current'))).toEqual([null, 'true', null]);
      expect(region()!.getAttribute('data-tone')).toBe('info');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('c');
      expect(region()!.getAttribute('data-tone')).toBe('critical');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('a');
      intervals(3);
      expect(showing()).toBe('a');
      intervals(4);
      expect(showing()).toBe('b');
    });

    it('says nothing to a screen reader while it moves by itself', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(live()!.getAttribute('aria-live')).toBe('polite');
      expect(live()!.getAttribute('aria-atomic')).toBe('true');
      expect(live()!.className).toContain('sr-only');
      intervals(2);
      expect(showing()).toBe('c');
      expect(live()!.textContent).toBe('');
    });

    it('waits while the pointer is over the bar, and gives a full interval once it leaves', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      advance(SYSTEM_BANNER_ROTATE_MS - 1000);
      fireEvent.pointerEnter(region()!, { pointerType: 'mouse' });
      expect(region()!.getAttribute('data-rotating')).toBe('false');
      advance(SYSTEM_BANNER_ROTATE_MS * 3);
      expect(showing()).toBe('a');
      fireEvent.pointerLeave(region()!, { pointerType: 'mouse' });
      advance(SYSTEM_BANNER_ROTATE_MS - 1);
      expect(showing()).toBe('a');
      advance(1);
      expect(showing()).toBe('b');
    });

    it('a touch does not count as hovering', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      fireEvent.pointerEnter(region()!, { pointerType: 'touch' });
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
    });

    it('waits while keyboard focus is inside the bar, and moves on again once it leaves', () => {
      vi.useFakeTimers();
      // jsdom has no focus-visible heuristics: treat script focus as keyboard focus.
      const realMatches = Element.prototype.matches;
      vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
        if (selector === ':focus-visible') return this === document.activeElement;
        return realMatches.call(this, selector);
      });
      rows = three();
      render(<SystemAnnouncementBanner />);
      act(() => dot(1, 3).focus());
      expect(region()!.getAttribute('data-rotating')).toBe('false');
      advance(SYSTEM_BANNER_ROTATE_MS * 3);
      expect(showing()).toBe('a');
      act(() => dot(1, 3).blur());
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
      vi.mocked(Element.prototype.matches).mockRestore();
    });

    it('a mouse click on a dot leaves focus there but does not hold the bar once the pointer is gone', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      // jsdom: `:focus-visible` never matches, as for a mouse click in a browser.
      act(() => dot(2, 3).focus());
      fireEvent.click(dot(2, 3));
      expect(showing()).toBe('b');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('c');
    });

    it('waits while the tab is hidden', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      setVisibility('hidden');
      advance(SYSTEM_BANNER_ROTATE_MS * 3);
      expect(showing()).toBe('a');
      setVisibility('visible');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
    });

    it('never moves by itself under prefers-reduced-motion; the dots still work', () => {
      setReducedMotion(true);
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(region()!.getAttribute('data-rotating')).toBe('false');
      advance(SYSTEM_BANNER_ROTATE_MS * 5);
      expect(showing()).toBe('a');
      fireEvent.click(dot(3, 3));
      expect(showing()).toBe('c');
      advance(SYSTEM_BANNER_ROTATE_MS * 5);
      expect(showing()).toBe('c');
      expect(live()).toHaveTextContent('Announcement 3 of 3');
    });

    it('moving on neither re-measures nor changes --system-banner-h: no layout jump', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      const before = html().style.getPropertyValue('--system-banner-h');
      const spacerBefore = spacer()!.style.height;
      const measured = rectSpy.mock.calls.length;
      const stack = document.querySelector('[data-system-banner-texts]');
      expect(showing()).toBe('a');
      for (let i = 0; i < 4; i += 1) {
        advance(SYSTEM_BANNER_ROTATE_MS);
        expect(html().style.getPropertyValue('--system-banner-h')).toBe(before);
        expect(spacer()!.style.height).toBe(spacerBefore);
      }
      expect(showing()).toBe('b');
      // Never measured again, and the same stack element throughout.
      expect(rectSpy.mock.calls.length).toBe(measured);
      expect(document.querySelector('[data-system-banner-texts]')).toBe(stack);
      expect(slideIds()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('under a modal dialog or gate', () => {
    it('a real Radix dialog open over the bar: no moving on, no `shown`; both resume when it closes', async () => {
      vi.useFakeTimers();
      rows = [];
      const Page = ({ open }: { open: boolean }) => (
        <>
          <SystemAnnouncementBanner />
          <Dialog open={open}>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Your subscription has expired</DialogTitle>
            </DialogContent>
          </Dialog>
        </>
      );
      const view = render(<Page open />);
      await flushObservers();
      expect(document.body.getAttribute('data-scroll-locked')).toBe('1');
      rows = three();
      view.rerender(<Page open />);
      await flushObservers();
      expect(showing()).toBe('a');
      expect(region()!.getAttribute('data-rotating')).toBe('false');
      advance(SYSTEM_BANNER_ROTATE_MS * 3);
      expect(showing()).toBe('a');
      expect(shownIds()).toEqual([]);

      view.rerender(<Page open={false} />);
      await flushObservers();
      expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
      expect(shownIds()).toEqual(['a']);
      advance(SYSTEM_BANNER_ROTATE_MS - 1);
      expect(showing()).toBe('a');
      advance(1);
      expect(showing()).toBe('b');
      expect(shownIds()).toEqual(['a', 'b']);
    });

    it('a modal opening mid-rotation stops it where it is and records nothing more', async () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(shownIds()).toEqual(['a']);
      act(() => document.body.setAttribute('data-scroll-locked', '1'));
      await flushObservers();
      advance(SYSTEM_BANNER_ROTATE_MS * 4);
      expect(showing()).toBe('a');
      expect(shownIds()).toEqual(['a']);
      act(() => document.body.removeAttribute('data-scroll-locked'));
      await flushObservers();
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
    });

    it('an aria-modal screen that is not a Radix layer (the first-run wizard) counts too', async () => {
      vi.useFakeTimers();
      const wizard = document.createElement('div');
      wizard.setAttribute('role', 'dialog');
      wizard.setAttribute('aria-modal', 'true');
      wizard.setAttribute('data-test-modal', '');
      document.body.appendChild(wizard);
      rows = three();
      render(<SystemAnnouncementBanner />);
      advance(SYSTEM_BANNER_ROTATE_MS * 2);
      expect(showing()).toBe('a');
      expect(shownIds()).toEqual([]);
      act(() => wizard.remove());
      await flushObservers();
      expect(shownIds()).toEqual(['a']);
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
    });

    it('non-modal things do not count: a popover-like role="dialog" without aria-modal', async () => {
      vi.useFakeTimers();
      const popover = document.createElement('div');
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('data-test-modal', '');
      document.body.appendChild(popover);
      rows = three();
      render(<SystemAnnouncementBanner />);
      await flushObservers();
      expect(shownIds()).toEqual(['a']);
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
    });

    it('a single banner under a gate is recorded only once the gate is gone', async () => {
      document.body.setAttribute('data-scroll-locked', '1');
      rows = [banner()];
      render(<SystemAnnouncementBanner />);
      await flushObservers();
      expect(shownIds()).toEqual([]);
      act(() => document.body.removeAttribute('data-scroll-locked'));
      await flushObservers();
      expect(shownIds()).toEqual(['b1']);
    });
  });

  describe('the dots', () => {
    it('a click slides to that banner and restarts the interval', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      advance(SYSTEM_BANNER_ROTATE_MS - 1000);
      fireEvent.click(dot(3, 3));
      expect(showing()).toBe('c');
      expect(dots().map((d) => d.getAttribute('aria-current'))).toEqual([null, null, 'true']);
      advance(SYSTEM_BANNER_ROTATE_MS - 1);
      expect(showing()).toBe('c');
      advance(1);
      expect(showing()).toBe('a');
    });

    it('a click on the dot already showing restarts the interval too', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      advance(SYSTEM_BANNER_ROTATE_MS - 1000);
      fireEvent.click(dot(1, 3));
      advance(SYSTEM_BANNER_ROTATE_MS - 1);
      expect(showing()).toBe('a');
      advance(1);
      expect(showing()).toBe('b');
    });

    it('announces the position the user moved to', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(live()!.textContent).toBe('');
      fireEvent.click(dot(2, 3));
      expect(live()).toHaveTextContent('Announcement 2 of 3');
    });

    // Review round 5: a click on the showing dot left the "user moved" flag set, so the
    // NEXT slide (the automatic one, 6 s later) was announced.
    it('a click on the dot already showing moves nothing, so the slide that follows by itself stays silent', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(1, 3));
      expect(live()!.textContent).toBe('');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('b');
      expect(live()!.textContent).toBe('');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('c');
      expect(live()!.textContent).toBe('');
    });

    it('Left / Right on a dot move, wrap, and keep focus on the dot now showing', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      act(() => dot(1, 3).focus());
      fireEvent.keyDown(dot(1, 3), { key: 'ArrowRight' });
      expect(showing()).toBe('b');
      expect(document.activeElement).toBe(dot(2, 3));
      expect(live()).toHaveTextContent('Announcement 2 of 3');
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      expect(showing()).toBe('a');
      expect(document.activeElement).toBe(dot(1, 3));
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
      expect(showing()).toBe('c');
      expect(document.activeElement).toBe(dot(3, 3));
    });

    it('arrow keys with a modifier, or anywhere but a dot, do nothing', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      for (const mod of [{ altKey: true }, { metaKey: true }, { shiftKey: true }, { ctrlKey: true }]) {
        const e = createEvent.keyDown(dot(1, 3), { key: 'ArrowRight', ...mod });
        fireEvent(dot(1, 3), e);
        expect(e.defaultPrevented).toBe(false);
      }
      fireEvent.keyDown(dismissButton(), { key: 'ArrowRight' });
      fireEvent.keyDown(region()!, { key: 'ArrowRight' });
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(showing()).toBe('a');
    });
  });

  describe('swiping on a touch screen', () => {
    const swipe = (from: number, to: number, dy = 0, pointerType = 'touch') => {
      fireEvent.pointerDown(region()!, { pointerType, clientX: from, clientY: 20 });
      fireEvent.pointerUp(region()!, { pointerType, clientX: to, clientY: 20 + dy });
    };

    it('left goes to the next banner, right to the previous', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      swipe(300, 200);
      expect(showing()).toBe('b');
      expect(live()).toHaveTextContent('Announcement 2 of 3');
      swipe(100, 250);
      expect(showing()).toBe('a');
      swipe(100, 250);
      expect(showing()).toBe('c');
    });

    it('a short or mostly vertical drag, and a mouse drag, do not move', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      swipe(300, 270);
      swipe(300, 200, 150);
      swipe(300, 100, 0, 'mouse');
      expect(showing()).toBe('a');
    });
  });

  describe('the slide', () => {
    type Call = { of: string | null; text: boolean; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
    let calls: Call[] = [];
    const cancel = vi.fn();

    beforeEach(() => {
      calls = [];
      cancel.mockClear();
      (Element.prototype as unknown as { animate: unknown }).animate = function (
        this: Element,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        calls.push({
          of: this.getAttribute('data-slide-of'),
          text: this.hasAttribute('data-system-banner-slide'),
          keyframes,
          options,
        });
        return { cancel } as unknown as Animation;
      };
    });
    afterEach(() => {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
    });

    const from = (id: string) => calls.filter((c) => c.of === id);
    const first = (c: Call) => c.keyframes[0];
    const last = (c: Call) => c.keyframes[c.keyframes.length - 1];

    it('forward: the banner showing slides out to the left while the next slides in from the right', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(calls).toEqual([]);
      advance(SYSTEM_BANNER_ROTATE_MS);
      // Every part of both banners: the text, the button cell and the X cell.
      expect(from('a')).toHaveLength(3);
      expect(from('b')).toHaveLength(3);
      expect(from('c')).toHaveLength(0);
      for (const c of from('a')) {
        const travel = c.text ? 28 : 8;
        expect(first(c)).toMatchObject({ offset: 0, opacity: 1, transform: 'translateX(0px)', visibility: 'visible' });
        expect(last(c)).toMatchObject({ offset: 1, opacity: 0, transform: `translateX(-${travel}px)`, visibility: 'visible' });
        // Gone a little past halfway, so the two never sit on top of each other at full strength.
        expect(c.keyframes).toContainEqual({ offset: 0.6, opacity: 0 });
      }
      for (const c of from('b')) {
        const travel = c.text ? 28 : 8;
        expect(first(c)).toMatchObject({ offset: 0, opacity: 0, transform: `translateX(${travel}px)`, visibility: 'visible' });
        expect(last(c)).toMatchObject({ offset: 1, opacity: 1, transform: 'translateX(0px)', visibility: 'visible' });
        expect(c.options.duration).toBe(SYSTEM_BANNER_SLIDE_MS);
      }
      expect(from('a').filter((c) => c.text)).toHaveLength(1);
      // Looping from the last to the first still slides forward.
      intervals(1);
      calls = [];
      intervals(1);
      expect(showing()).toBe('a');
      expect(calls.filter((c) => c.of === 'c').every((c) => last(c).transform!.toString().startsWith('translateX(-'))).toBe(true);
      expect(calls.filter((c) => c.of === 'a').every((c) => !first(c).transform!.toString().startsWith('translateX(-'))).toBe(true);
    });

    it('the text moves inside a clipped window of its own, so it never runs over the dots or the buttons', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(document.querySelector('[data-system-banner-texts]')!.className.split(/\s+/)).toContain('overflow-hidden');
      cleanup();
      rows = [banner()];
      render(<SystemAnnouncementBanner />);
      expect(document.querySelector('[data-system-banner-texts]')!.className).not.toContain('overflow-hidden');
    });

    it('back (a dot before the one showing): the other way round', () => {
      rows = three();
      render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(3, 3));
      calls = [];
      fireEvent.click(dot(1, 3));
      expect(from('c').every((c) => last(c).transform === `translateX(${c.text ? 28 : 8}px)`)).toBe(true);
      expect(from('a').every((c) => first(c).transform === `translateX(-${c.text ? 28 : 8}px)`)).toBe(true);
      // A slide still running is cut short before the next one starts.
      expect(cancel).toHaveBeenCalled();
    });

    it('under reduced motion it is a plain crossfade', () => {
      setReducedMotion(true);
      rows = three();
      render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 3));
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        for (const k of c.keyframes) if (k.transform !== undefined) expect(k.transform).toBe('translateX(0px)');
        expect(c.options.duration).toBe(SYSTEM_BANNER_FADE_MS);
      }
    });

    it('X: the next remaining banner slides in where the closed one was', () => {
      closable();
      rows = three();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('b');
      expect(from('b').length).toBeGreaterThan(0);
      expect(from('b').every((c) => first(c).transform === `translateX(${c.text ? 28 : 8}px)`)).toBe(true);
    });

    it('without Web Animations it simply switches', () => {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
      rows = three();
      render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 3));
      expect(showing()).toBe('b');
    });
  });

  describe('hard and soft together', () => {
    const mixed = () => [
      banner({ id: 's1', title: 'Soft one', tone: 'info' }),
      banner({ id: 'h1', blocking: 'hard', tone: 'critical', title: 'Card payments are down' }),
      banner({ id: 's2', title: 'Soft two', tone: 'warning' }),
    ];

    it('hard first, then soft; the soft ones are reachable by themselves and by the dots', () => {
      vi.useFakeTimers();
      rows = mixed();
      render(<SystemAnnouncementBanner />);
      expect(slideIds()).toEqual(['h1', 's1', 's2']);
      expect(showing()).toBe('h1');
      // The hard banner has no X; its X cell is empty.
      expect(screen.queryByRole('button', { name: 'Dismiss announcement' })).toBeNull();
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('s1');
      expect(dismissButton()).toBeInTheDocument();
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('s2');
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('h1');
      fireEvent.click(dot(3, 3));
      expect(showing()).toBe('s2');
    });

    it('X on the soft banner showing records dismissed for IT and moves to the next remaining one, focus on its X', () => {
      closable();
      rows = [...mixed(), banner({ id: 's3', title: 'Soft three', tone: 'success' })];
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 4));
      expect(showing()).toBe('s1');
      const x = dismissButton();
      act(() => x.focus());
      fireEvent.click(x);
      view.rerender(<SystemAnnouncementBanner />);
      expect(events.filter(([, e]) => e === 'dismissed')).toEqual([['s1', 'dismissed']]);
      expect(slideIds()).toEqual(['h1', 's2', 's3']);
      expect(showing()).toBe('s2');
      expect(dots()).toHaveLength(3);
      expect(live()).toHaveTextContent('Announcement 2 of 3');
      expect(document.activeElement).toBe(dismissButton());
      expect(document.activeElement!.closest('[data-slide-of]')!.getAttribute('data-slide-of')).toBe('s2');
    });

    it('closing the last one in the list goes back to the first; with one left the dots go', () => {
      closable();
      rows = mixed();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(3, 3));
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('h1');
      expect(dots()).toHaveLength(2);
      fireEvent.click(dot(2, 2));
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('h1');
      expect(dots()).toHaveLength(0);
      expect(live()).toBeNull();
    });

    it('the user\'s own move is never held back: a dot, then that banner\'s X at once', () => {
      closable();
      rows = mixed();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 3));
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(events.filter(([, e]) => e === 'dismissed')).toEqual([['s1', 'dismissed']]);
    });

    it('a hard banner arriving mid-session takes the slot', () => {
      rows = three();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 3));
      rows = [banner({ id: 'hard', blocking: 'hard', tone: 'critical', title: 'Blocker' }), ...three()];
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('hard');
      expect(dots()).toHaveLength(4);
    });
  });

  // Review round 5: X and the button sit in one cell for every banner, so the second
  // click of a double click on X (or a tap just as the bar slides by itself) landed on
  // the NEXT banner's X and dismissed a banner nobody had seen.
  describe('a click that lands on the banner that just slid in', () => {
    const soft3 = () => [
      banner({ id: 's1', title: 'Soft one' }),
      banner({ id: 's2', title: 'Soft two, unread' }),
      banner({ id: 's3', title: 'Soft three' }),
    ];
    const dismissed = () => events.filter(([, e]) => e === 'dismissed');

    it('X twice in a row: the second click does nothing to the banner that replaced it; a moment later X works', () => {
      vi.useFakeTimers();
      closable();
      rows = soft3();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('s2');
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(dismissed()).toEqual([['s1', 'dismissed']]);
      expect(showing()).toBe('s2');
      advance(SYSTEM_BANNER_ACTIVATION_GUARD_MS);
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(dismissed()).toEqual([
        ['s1', 'dismissed'],
        ['s2', 'dismissed'],
      ]);
      expect(showing()).toBe('s3');
    });

    it('the button twice in a row: no cta_clicked and no navigation for the banner that replaced it', () => {
      vi.useFakeTimers();
      // What the real hook does: a soft button click hides the row too.
      recordEvent.mockImplementation((a, event) => {
        events.push([a.id, event]);
        if (event === 'cta_clicked') rows = rows.map((r) => (r.id === a.id ? { ...r, is_due: false } : r));
      });
      rows = [
        banner({ id: 'b1', cta_label: 'Open settings', cta_url: '/settings' }),
        banner({ id: 'b2', cta_label: 'Open vehicles', cta_url: '/vehicles' }),
        banner({ id: 'b3' }),
      ];
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('b2');
      fireEvent.click(screen.getByRole('button', { name: 'Open vehicles' }));
      view.rerender(<SystemAnnouncementBanner />);
      expect(events.filter(([, e]) => e === 'cta_clicked')).toEqual([['b1', 'cta_clicked']]);
      expect(push.mock.calls).toEqual([['/settings']]);
      advance(SYSTEM_BANNER_ACTIVATION_GUARD_MS);
      fireEvent.click(screen.getByRole('button', { name: 'Open vehicles' }));
      expect(push.mock.calls).toEqual([['/settings'], ['/vehicles']]);
    });

    it('a tap on X just as the bar slides by itself does not close the banner arriving', () => {
      vi.useFakeTimers();
      closable();
      rows = soft3();
      const view = render(<SystemAnnouncementBanner />);
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(showing()).toBe('s2');
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(dismissed()).toEqual([]);
      advance(SYSTEM_BANNER_ACTIVATION_GUARD_MS);
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(dismissed()).toEqual([['s2', 'dismissed']]);
    });

    it('a dot, a key or a swipe right after is the user\'s own move: it lifts the wait at once', () => {
      vi.useFakeTimers();
      closable();
      rows = soft3();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('s2');
      fireEvent.click(dot(2, 2));
      expect(showing()).toBe('s3');
      fireEvent.click(dismissButton());
      view.rerender(<SystemAnnouncementBanner />);
      expect(dismissed()).toEqual([
        ['s1', 'dismissed'],
        ['s3', 'dismissed'],
      ]);
    });
  });

  describe('where it starts', () => {
    const fresh = () => [
      banner({ id: 'x', title: 'X-ray' }),
      banner({ id: 'y', title: 'Yankee' }),
      banner({ id: 'z', title: 'Zulu' }),
    ];

    it('a poll that adds or re-orders rows keeps the banner showing', () => {
      rows = three();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 3));
      rows = [banner({ id: 'new', title: 'New notice' }), ...three()];
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('b');
      expect(dots().map((d) => d.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
    });

    it('after the bar empties, the next list starts from its FIRST banner', () => {
      rows = three();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(3, 3));
      rows = [];
      view.rerender(<SystemAnnouncementBanner />);
      expectNothing();
      rows = three();
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('a');
    });

    it('a poll that replaces EVERY banner at once starts from the first', () => {
      rows = three();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(3, 3));
      rows = fresh();
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('x');
    });

    it('when the one showing leaves and others stay, the banner now at its place takes the slot', () => {
      rows = three();
      const view = render(<SystemAnnouncementBanner />);
      fireEvent.click(dot(2, 3));
      rows = [three()[0], three()[2], banner({ id: 'n', title: 'New' })];
      view.rerender(<SystemAnnouncementBanner />);
      expect(showing()).toBe('c');
    });
  });

  describe('impressions', () => {
    it('`shown` for a banner only once it is the one showing, and once per banner', () => {
      vi.useFakeTimers();
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(shownIds()).toEqual(['a']);
      advance(SYSTEM_BANNER_ROTATE_MS);
      expect(shownIds()).toEqual(['a', 'b']);
      intervals(5);
      expect(shownIds()).toEqual(['a', 'b', 'c']);
    });

    it('a new revision ("show it again") is a new impression', () => {
      rows = [banner({ id: 'a', revision: 1 }), banner({ id: 'b' })];
      const view = render(<SystemAnnouncementBanner />);
      rows = [banner({ id: 'a', revision: 2 }), banner({ id: 'b' })];
      view.rerender(<SystemAnnouncementBanner />);
      expect(shownIds()).toEqual(['a', 'a']);
    });

    it('nothing while the tab is hidden; the banner showing is recorded when it comes back', () => {
      visibility = 'hidden';
      rows = three();
      render(<SystemAnnouncementBanner />);
      expect(shownIds()).toEqual([]);
      setVisibility('visible');
      expect(shownIds()).toEqual(['a']);
    });
  });
});
