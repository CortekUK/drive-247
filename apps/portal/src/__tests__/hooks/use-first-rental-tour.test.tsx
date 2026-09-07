/**
 * The first-rental walkthrough's state machine, driven end to end.
 *
 * The lib tests prove each rule in isolation; these prove the HOOK composes
 * them the way the brief says it must:
 *
 *   - the three-way tenant gate, through the real hook: northwind gets the
 *     tour (asserted FIRST, and loudly), live tenants get nothing, a bogus
 *     host gets nothing;
 *   - crossing routes: the step is persisted, the router is asked, the anchor
 *     is waited for on arrival;
 *   - an anchor that never mounts is SKIPPED, not stalled on — and steps that
 *     share a route that already timed out wait less;
 *   - a reload on a step's own route resumes silently; landing on the dashboard
 *     with an interrupted run is OFFERED (Resume / Start over / Dismiss), never
 *     silently restarted, and never nagged past the cap;
 *   - wandering off, clicking the do-this anchor, and the paywall all PAUSE;
 *   - gated destinations are dropped before the tour starts;
 *   - replay from the menu starts over from the dashboard.
 *
 * HARNESS: `renderHook` under fake timers. Every collaborator hook is a
 * mutable double so a test can flip exactly one thing. jsdom gives every
 * element a zero-size box, so `getBoundingClientRect` is stubbed: anything IN
 * the document counts as visible, which is what the anchor filter is about.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  ANCHOR_POLL_MS,
  ANCHOR_WAIT_MS,
  ANCHOR_WAIT_SHORT_MS,
  useFirstRentalTour,
} from '@/hooks/use-first-rental-tour';
import {
  MAX_RESUME_PROMPTS,
  REPLAY_TOUR_EVENT,
  hasSeenTour,
  markTourSeen,
  readTourProgress,
  tourProgressKey,
  writeTourProgress,
} from '@/lib/first-rental-tour';

// ── Test doubles ───────────────────────────────────────────────────────────

let currentTenant: { id: string; slug: string } | null = null;
let currentPath = '/';
let pushed: string[] = [];
let v2Chrome = true;
let wizard = { shouldShow: false, isLoading: false };
let perms = {
  isManager: false,
  isLoading: false,
  canAccessRoute: (_p: string) => true,
  canEdit: (_t: string) => true,
  canViewSettings: (_v: string) => true,
};
let rentalGate = { blocked: false, isLoading: false };
const toastSpy = vi.fn();

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: currentTenant, tenantSlug: currentTenant?.slug ?? null }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({
    appUser: { id: 'app-user-1', is_active: true, role: 'head_admin' },
    loading: false,
  }),
}));
vi.mock('@/lib/v2-context', () => ({ useV2: () => v2Chrome }));
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useRouter: () => ({
    push: (route: string) => {
      pushed.push(route);
    },
  }),
}));
vi.mock('@/hooks/use-first-run-wizard', () => ({ useFirstRunWizard: () => wizard }));
vi.mock('@/hooks/use-manager-permissions', () => ({ useManagerPermissions: () => perms }));
vi.mock('@/hooks/use-rental-creation-gate', () => ({ useRentalCreationGate: () => rentalGate }));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

const NORTHWIND = { id: '8e6bc88f-0000-0000-0000-000000000000', slug: 'northwind' };
const USER = 'app-user-1';

/** Put an anchor on the page. Returns a remover. */
function mount(html: string): () => void {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);
  return () => holder.remove();
}

const SIDEBAR = '<div data-sidebar="sidebar"><div data-sidebar="content"><a href="/vehicles">Vehicles</a></div></div>';
const SETUP_GUIDE = '<button data-tour="setup-guide">Setup guide</button>';

function setup(suppressed = false) {
  return renderHook(({ s }: { s: boolean }) => useFirstRentalTour(s), {
    initialProps: { s: suppressed },
  });
}

/** Let the autostart delay elapse. */
const autostart = () => act(() => void vi.advanceTimersByTime(800));
/** Let the anchor poll run to its budget. */
const waitOut = (ms: number) => act(() => void vi.advanceTimersByTime(ms + ANCHOR_POLL_MS));
/** Arrive on a route, as Next would report it. */
function arrive(hook: ReturnType<typeof setup>, path: string) {
  currentPath = path;
  act(() => hook.rerender({ s: false }));
  // One poll tick so the anchor (if present) is found.
  act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = '';
  currentTenant = NORTHWIND;
  currentPath = '/';
  pushed = [];
  v2Chrome = true;
  wizard = { shouldShow: false, isLoading: false };
  perms = {
    isManager: false,
    isLoading: false,
    canAccessRoute: () => true,
    canEdit: () => true,
    canViewSettings: () => true,
  };
  rentalGate = { blocked: false, isLoading: false };
  toastSpy.mockReset();
  // Anything in the document is "on screen". See the header note.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 120, height: 32, top: 100, left: 100, right: 220, bottom: 132, x: 100, y: 100, toJSON() {} }) as DOMRect;
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── The three-way gate, through the hook ───────────────────────────────────

describe('walkthrough hook — tenant gate (slug-keyed)', () => {
  // The positive case FIRST. Every "nothing happens" assertion below is only
  // meaningful because this one shows the harness CAN produce the tour.
  it('northwind: the tour is FOUND — Welcome comes up on the dashboard', () => {
    const hook = setup();
    expect(hook.result.current.phase).toBe('idle');
    autostart();
    expect(hook.result.current.phase).toBe('showing');
    expect(hook.result.current.current?.step.id).toBe('welcome');
    expect(hook.result.current.steps.length).toBe(11);
    // Marked seen UP FRONT, so nothing can fire it twice.
    expect(hasSeenTour(USER)).toBe(true);
  });

  it.each(['goniko', 'revtek', 'jangram'])('live tenant %s: nothing, ever', (slug) => {
    currentTenant = { id: 'x', slug };
    const hook = setup();
    act(() => void vi.advanceTimersByTime(5_000));
    expect(hook.result.current.phase).toBe('idle');
    expect(hook.result.current.isEligible).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('a bogus host (no tenant row) fails safe', () => {
    currentTenant = null;
    const hook = setup();
    act(() => void vi.advanceTimersByTime(5_000));
    expect(hook.result.current.phase).toBe('idle');
    expect(localStorage.length).toBe(0);
  });

  it('a tenant UUID is never a slug — id-keyed gates are the bug this prevents', () => {
    currentTenant = { id: NORTHWIND.id, slug: NORTHWIND.id };
    const hook = setup();
    act(() => void vi.advanceTimersByTime(5_000));
    expect(hook.result.current.phase).toBe('idle');
  });
});

describe('walkthrough hook — the other gates', () => {
  it('waits for the first-run wizard to have SAID it will not open', () => {
    wizard = { shouldShow: false, isLoading: true };
    const hook = setup();
    autostart();
    expect(hook.result.current.phase).toBe('idle');
    wizard = { shouldShow: false, isLoading: false };
    act(() => hook.rerender({ s: false }));
    autostart();
    expect(hook.result.current.phase).toBe('showing');
  });

  it('never starts while the paywall is up, and pauses if it comes up mid-tour', () => {
    const hook = setup(true);
    autostart();
    expect(hook.result.current.phase).toBe('idle');

    act(() => hook.rerender({ s: false }));
    autostart();
    expect(hook.result.current.phase).toBe('showing');

    act(() => hook.rerender({ s: true }));
    expect(hook.result.current.phase).toBe('idle');
    expect(readTourProgress(USER)?.status).toBe('paused');
  });

  it('does not autostart off the dashboard, and not once seen', () => {
    currentPath = '/vehicles';
    const a = setup();
    autostart();
    expect(a.result.current.phase).toBe('idle');
    a.unmount();

    currentPath = '/';
    markTourSeen(USER);
    const b = setup();
    autostart();
    expect(b.result.current.phase).toBe('idle');
  });

  it('v1 chrome: nothing to point at, nothing shown', () => {
    v2Chrome = false;
    const hook = setup();
    autostart();
    expect(hook.result.current.phase).toBe('idle');
  });
});

// ── Crossing routes ────────────────────────────────────────────────────────

describe('walkthrough hook — crossing pages', () => {
  it('persists the step, asks the router, then waits for the anchor on arrival', () => {
    mount(SIDEBAR + SETUP_GUIDE);
    const hook = setup();
    autostart();
    expect(hook.result.current.current?.step.id).toBe('welcome');

    act(() => hook.result.current.next());
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.current?.step.id).toBe('sidebar');
    expect(hook.result.current.current?.element?.getAttribute('data-sidebar')).toBe('content');

    act(() => hook.result.current.next());
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.current?.step.id).toBe('setup-guide');

    // Vehicles lives on another page. Progress FIRST, then the push.
    act(() => hook.result.current.next());
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'vehicles', status: 'active' });
    expect(pushed).toEqual(['/vehicles']);
    expect(hook.result.current.phase).toBe('navigating');
    expect(hook.result.current.current).toBeNull();

    // The page mounts its header a beat after arrival.
    arrive(hook, '/vehicles');
    expect(hook.result.current.phase).toBe('waiting');
    mount('<div data-add-vehicle-trigger><button>Add Vehicle</button></div>');
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('showing');
    expect(hook.result.current.current?.step.id).toBe('vehicles');
  });

  it('SKIPS a step whose anchor never mounts, instead of stalling on it', () => {
    mount(SIDEBAR + SETUP_GUIDE);
    const hook = setup();
    autostart();
    act(() => hook.result.current.next()); // sidebar
    act(() => hook.result.current.next()); // setup guide
    act(() => hook.result.current.next()); // → /vehicles
    arrive(hook, '/vehicles');
    // No Add Vehicle button ever appears (a viewer-ish page, a slow query…).
    waitOut(ANCHOR_WAIT_MS);
    // Moved on to Customers without ever rendering a card for Vehicles.
    expect(readTourProgress(USER)?.stepId).toBe('customers');
    expect(pushed).toEqual(['/vehicles', '/customers']);
    expect(hook.result.current.phase).toBe('navigating');
  });

  it('steps sharing a route that already timed out wait LESS — three in-flow steps do not cost 18 seconds', () => {
    writeTourProgress(USER, { stepId: 'rental', status: 'active' });
    markTourSeen(USER);
    currentPath = '/rentals/new';
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('waiting');
    expect(hook.result.current.current).toBeNull();

    waitOut(ANCHOR_WAIT_MS);
    expect(readTourProgress(USER)?.stepId).toBe('insurance');
    waitOut(ANCHOR_WAIT_SHORT_MS);
    expect(readTourProgress(USER)?.stepId).toBe('agreement');
    waitOut(ANCHOR_WAIT_SHORT_MS);
    expect(readTourProgress(USER)?.stepId).toBe('money');
    expect(pushed).toEqual(['/payments']);
  });

  it('a settings step with a query pushes the full route even from /settings', () => {
    writeTourProgress(USER, { stepId: 'booking-site', status: 'active' });
    markTourSeen(USER);
    currentPath = '/settings';
    setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    // Same pathname, wrong tab: the page reads the tab from the URL.
    expect(pushed).toEqual(['/settings?tab=branding']);
  });

  it('re-resolves when the card reports its anchor gone, then skips', () => {
    mount(SIDEBAR);
    const hook = setup();
    autostart();
    act(() => hook.result.current.next());
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.current?.step.id).toBe('sidebar');

    document.body.innerHTML = '';
    act(() => hook.result.current.anchorLost());
    expect(hook.result.current.phase).toBe('waiting');
    waitOut(ANCHOR_WAIT_MS);
    // Setup guide is also gone from the page, so it is skipped too, and the
    // tour has moved on to Vehicles.
    waitOut(ANCHOR_WAIT_SHORT_MS);
    expect(readTourProgress(USER)?.stepId).toBe('vehicles');
  });
});

// ── Interruptions ──────────────────────────────────────────────────────────

describe('walkthrough hook — wandering off, and coming back', () => {
  it('a reload on the step’s own page resumes silently — no prompt, no push', () => {
    writeTourProgress(USER, { stepId: 'vehicles', status: 'active' });
    markTourSeen(USER);
    mount('<div data-tour="add-vehicle"></div>');
    currentPath = '/vehicles';
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('showing');
    expect(hook.result.current.current?.step.id).toBe('vehicles');
    expect(pushed).toEqual([]);
  });

  it('clicking away mid-step PAUSES — the tour does not follow', () => {
    mount(SIDEBAR);
    const hook = setup();
    autostart();
    act(() => hook.result.current.next());
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.current?.step.id).toBe('sidebar');

    arrive(hook, '/messages');
    expect(hook.result.current.phase).toBe('idle');
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'sidebar', status: 'paused' });
  });

  it('the do-this anchor click pauses, keeping their place', () => {
    writeTourProgress(USER, { stepId: 'customers', status: 'active' });
    markTourSeen(USER);
    mount('<button data-tour="add-customer"></button>');
    currentPath = '/customers';
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.current?.step.id).toBe('customers');

    act(() => hook.result.current.pause());
    expect(hook.result.current.phase).toBe('idle');
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'customers', status: 'paused' });
  });

  it('back on the dashboard, an interrupted run is OFFERED — not silently restarted', () => {
    writeTourProgress(USER, { stepId: 'vehicles', status: 'paused' });
    markTourSeen(USER);
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('prompt');
    expect(readTourProgress(USER)?.prompts).toBe(1);
    // No card, no navigation — just the offer.
    expect(pushed).toEqual([]);
    expect(hook.result.current.current).toBeNull();
  });

  it('Resume picks up at the saved step', () => {
    writeTourProgress(USER, { stepId: 'vehicles', status: 'paused' });
    markTourSeen(USER);
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    act(() => hook.result.current.resume());
    expect(pushed).toEqual(['/vehicles']);
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'vehicles', status: 'active' });
  });

  it('Start over begins again at Welcome', () => {
    writeTourProgress(USER, { stepId: 'money', status: 'paused' });
    markTourSeen(USER);
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    act(() => hook.result.current.startOver());
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('showing');
    expect(hook.result.current.current?.step.id).toBe('welcome');
    expect(pushed).toEqual([]);
  });

  it('Dismiss forgets the run for good', () => {
    writeTourProgress(USER, { stepId: 'money', status: 'paused' });
    markTourSeen(USER);
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    act(() => hook.result.current.dismissPrompt());
    expect(hook.result.current.phase).toBe('idle');
    expect(readTourProgress(USER)).toBeNull();
    expect(hasSeenTour(USER)).toBe(true);
    // And nothing comes back on the next paint.
    act(() => hook.rerender({ s: false }));
    act(() => void vi.advanceTimersByTime(5_000));
    expect(hook.result.current.phase).toBe('idle');
  });

  it('never nags: no offer off the dashboard, and none past the cap', () => {
    writeTourProgress(USER, { stepId: 'vehicles', status: 'paused' });
    markTourSeen(USER);
    currentPath = '/invoices';
    const a = setup();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(a.result.current.phase).toBe('idle');
    a.unmount();

    currentPath = '/';
    localStorage.setItem(
      tourProgressKey(USER),
      JSON.stringify({ ...readTourProgress(USER), prompts: MAX_RESUME_PROMPTS }),
    );
    const b = setup();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(b.result.current.phase).toBe('idle');
    // Asked enough. The record is dropped so it cannot come back.
    expect(readTourProgress(USER)).toBeNull();
  });

  it('a prompt left open goes away when they navigate, and does not re-prompt on the same visit', () => {
    writeTourProgress(USER, { stepId: 'vehicles', status: 'paused' });
    markTourSeen(USER);
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('prompt');
    arrive(hook, '/customers');
    expect(hook.result.current.phase).toBe('idle');
    arrive(hook, '/');
    expect(hook.result.current.phase).toBe('prompt');
    expect(readTourProgress(USER)?.prompts).toBe(2);
  });
});

// ── Finishing ──────────────────────────────────────────────────────────────

describe('walkthrough hook — ending', () => {
  it('Skip ends the run: progress cleared, seen stays marked', () => {
    const hook = setup();
    autostart();
    act(() => hook.result.current.end());
    expect(hook.result.current.phase).toBe('idle');
    expect(readTourProgress(USER)).toBeNull();
    expect(hasSeenTour(USER)).toBe(true);
    act(() => void vi.advanceTimersByTime(5_000));
    expect(hook.result.current.phase).toBe('idle');
  });

  it('the finale is anchorless, stays wherever you are, and can send you home', () => {
    writeTourProgress(USER, { stepId: 'done', status: 'active' });
    markTourSeen(USER);
    currentPath = '/settings';
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    expect(hook.result.current.phase).toBe('showing');
    expect(hook.result.current.current?.step.id).toBe('done');
    expect(hook.result.current.current?.element).toBeNull();
    expect(pushed).toEqual([]);

    act(() => hook.result.current.finishToDashboard());
    expect(hook.result.current.phase).toBe('idle');
    expect(pushed).toEqual(['/']);
    expect(readTourProgress(USER)).toBeNull();
  });

  it('Next on the last step finishes', () => {
    writeTourProgress(USER, { stepId: 'done', status: 'active' });
    markTourSeen(USER);
    const hook = setup();
    act(() => void vi.advanceTimersByTime(ANCHOR_POLL_MS));
    act(() => hook.result.current.next());
    expect(hook.result.current.phase).toBe('idle');
    expect(readTourProgress(USER)).toBeNull();
  });
});

// ── Gated destinations ─────────────────────────────────────────────────────

describe('walkthrough hook — gated steps are dropped before the tour starts', () => {
  it('a manager without Customers never gets sent there', () => {
    perms = { ...perms, isManager: true, canAccessRoute: (p) => p !== '/customers' };
    const hook = setup();
    autostart();
    expect(hook.result.current.steps.map((s) => s.id)).not.toContain('customers');
    expect(hook.result.current.steps.map((s) => s.id)).toContain('vehicles');
  });

  it('waits for a manager’s grants to load before deciding', () => {
    perms = { ...perms, isManager: true, isLoading: true };
    const hook = setup();
    autostart();
    expect(hook.result.current.phase).toBe('idle');
    perms = { ...perms, isLoading: false };
    act(() => hook.rerender({ s: false }));
    autostart();
    expect(hook.result.current.phase).toBe('showing');
  });

  it('reroutes the rental steps when Stripe is not connected', () => {
    rentalGate = { blocked: true, isLoading: false };
    const hook = setup();
    autostart();
    const ids = hook.result.current.steps.map((s) => s.id);
    expect(ids).not.toContain('insurance');
    expect(ids).not.toContain('agreement');
    expect(hook.result.current.steps.find((s) => s.id === 'rental')?.route).toBe('/rentals');
  });

  it('drops the sidebar step on a phone', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const hook = setup();
    autostart();
    expect(hook.result.current.steps.map((s) => s.id)).not.toContain('sidebar');
  });

  it('a user left with nothing to walk through gets nothing', () => {
    // A manager who can reach only the dashboard, on a phone: Welcome, the
    // setup guide and Done — one anchored step. Not a walkthrough.
    perms = { ...perms, isManager: true, canAccessRoute: (p) => p === '/', canEdit: () => false };
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    const hook = setup();
    autostart();
    expect(hook.result.current.phase).toBe('idle');
    // Not marked seen: a step list this thin was never offered.
    expect(hasSeenTour(USER)).toBe(false);
  });
});

// ── Replay ─────────────────────────────────────────────────────────────────

describe('walkthrough hook — replay from the menu', () => {
  it('starts over from Welcome, navigating home first if needed', () => {
    markTourSeen(USER);
    currentPath = '/payments';
    const hook = setup();
    act(() => void vi.advanceTimersByTime(2_000));
    expect(hook.result.current.phase).toBe('idle');

    act(() => void window.dispatchEvent(new Event(REPLAY_TOUR_EVENT)));
    expect(pushed).toEqual(['/']);
    expect(readTourProgress(USER)).toMatchObject({ stepId: 'welcome', status: 'active' });
    arrive(hook, '/');
    expect(hook.result.current.phase).toBe('showing');
    expect(hook.result.current.current?.step.id).toBe('welcome');
  });

  it('is ignored for a tenant that is not eligible', () => {
    currentTenant = { id: 'x', slug: 'goniko' };
    const hook = setup();
    act(() => void window.dispatchEvent(new Event(REPLAY_TOUR_EVENT)));
    act(() => void vi.advanceTimersByTime(2_000));
    expect(hook.result.current.phase).toBe('idle');
    expect(pushed).toEqual([]);
  });
});
