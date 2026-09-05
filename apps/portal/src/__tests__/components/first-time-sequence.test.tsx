/**
 * The FIRST-TIME SEQUENCE, end to end: wizard → tour, and the /dev reset that
 * puts it back.
 *
 * "Start as a first-time operator" is only worth anything if what follows is
 * genuinely what a brand-new operator meets: the wizard first, the tour
 * strictly after it, never both at once. This test mounts the REAL wizard
 * component and the REAL tour state machine (`useFirstRentalTour`, through a
 * probe that renders its `active` flag) against one in-memory `tenant_first_run`
 * table, and walks the sequence twice:
 *
 *   1. fresh tenant → wizard up, tour holds back → skip → wizard down → tour
 *      fires on its own, and records itself as seen;
 *   2. "hard reload" (fresh QueryClient, fresh mount, same storage) with NO
 *      reset → neither returns. The control: this is what the button is
 *      undoing;
 *   3. the exact reset the /dev page performs — `resetFirstRunRow` on the same
 *      table, `clearTourSeenFlags` on the same storage — then a hard reload →
 *      wizard up, tour holds back, skip, tour fires again.
 *
 * The tour's visual layer (`FirstRentalTour`) is not rendered: it is a portal
 * of motion cards that needs a real layout engine, and the decision under test
 * — whether the tour STARTS — is made entirely in the hook. Its anchors are
 * real DOM nodes here with a stubbed non-zero rect, because the hook refuses
 * to start on fewer than two visible anchors.
 *
 * Real timers, on purpose: the hook's autostart is a 900ms poll and React
 * Query's notifications ride on setTimeout, and faking both is how a test
 * like this hangs. Each wait is short and bounded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FirstRunWizard } from '@/components/onboarding/first-run-wizard';
import { useFirstRentalTour } from '@/hooks/use-first-rental-tour';
import { hasSeenTour } from '@/lib/first-rental-tour';
import { clearTourSeenFlags, resetFirstRunRow, type FirstRunClient } from '@/lib/dev-actions';

// ── Test doubles ───────────────────────────────────────────────────────────

const TENANT = { id: 'staging-northwind-id', slug: 'northwind' };
const APP_USER_ID = 'app-user-1';

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: TENANT, loading: false, tenantSlug: TENANT.slug }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ appUser: { id: APP_USER_ID, is_active: true }, loading: false }),
}));

// The canary is on the v2 chrome, and the tour only autostarts on `/`.
vi.mock('@/lib/v2-context', () => ({ useV2: () => true }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

/**
 * tenant_id → the persisted first-run row. One table for every actor here —
 * the wizard's read and upsert, and the /dev reset's delete and read-back.
 * Built inside `vi.hoisted` because the mock factory below is hoisted above
 * every other statement in this file and has to be able to see it.
 */
const { stored, fakeSupabase } = vi.hoisted(() => {
  const stored = new Map<string, Record<string, unknown>>();
  const fakeSupabase = {
    from: (_table: string) => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => ({ data: stored.get(v) ?? null, error: null }),
        }),
      }),
      upsert: async (payload: Record<string, unknown>) => {
        stored.set(String(payload.tenant_id), { id: 'row-1', ...payload });
        return { error: null };
      },
      delete: () => ({
        eq: (_c: string, v: string) => ({
          select: async () => {
            const had = stored.delete(v);
            return { data: had ? [{ id: 'row-1' }] : [], error: null };
          },
        }),
      }),
    }),
  };
  return { stored, fakeSupabase };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: fakeSupabase }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── The tour probe ─────────────────────────────────────────────────────────

/** Renders the tour hook's decision, and nothing visual. */
function TourProbe() {
  const tour = useFirstRentalTour(false);
  return tour.active ? <div data-tour-active="">{tour.stops.length}</div> : null;
}

// ── Harness ────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let anchors: HTMLElement;
let rectSpy: ReturnType<typeof vi.spyOn>;

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

async function settle() {
  for (let i = 0; i < 3; i += 1) await wait(0);
}

function mount() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
}

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <FirstRunWizard />
        <TourProbe />
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** A full page load: new QueryClient, new root. Storage and the table survive. */
async function hardReload() {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
  mount();
  await render();
}

const wizardIsUp = () => !!container.querySelector('[data-first-run-wizard]');
const tourIsActive = () => !!container.querySelector('[data-tour-active]');

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

/** Longer than the hook's first attempt (900ms), shorter than its give-up. */
const TOUR_WINDOW_MS = 1_300;

beforeEach(() => {
  stored.clear();
  localStorage.clear();

  // The three anchors the tour points at, as they sit in the v2 sidebar.
  anchors = document.createElement('div');
  anchors.setAttribute('data-sidebar', 'sidebar');
  anchors.innerHTML =
    '<a data-tour="nav-vehicles" href="/vehicles">Vehicles</a>' +
    '<a data-tour="nav-customers" href="/customers">Customers</a>' +
    '<a data-tour="nav-rentals" href="/rentals">Rentals</a>';
  document.body.appendChild(anchors);
  // jsdom lays nothing out, so every rect is 0×0 and `isVisible` would drop
  // every stop. Give the anchors a size.
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 120, height: 24, top: 10, left: 10, right: 130, bottom: 34, x: 10, y: 10,
    toJSON() {},
  } as DOMRect);

  mount();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchors.remove();
  rectSpy.mockRestore();
  queryClient.clear();
});

// ── The sequence ───────────────────────────────────────────────────────────

describe('first-time sequence — wizard, then tour, then the /dev reset', () => {
  it('runs wizard → tour once, stays gone on reload, and comes back exactly the same after the reset', async () => {
    // ── 1. A brand-new operator ──────────────────────────────────────────
    await render();
    expect(wizardIsUp(), 'fresh tenant: the wizard shows').toBe(true);
    expect(tourIsActive(), 'the tour must not share the screen with the wizard').toBe(false);

    // Give the tour every chance to start early. It must hold back: the
    // wizard is up, so `wizardPending` keeps the autostart gate closed.
    await wait(TOUR_WINDOW_MS);
    expect(wizardIsUp()).toBe(true);
    expect(tourIsActive(), 'the tour held back while the wizard was up').toBe(false);
    expect(hasSeenTour(APP_USER_ID), 'and did not burn its one run').toBe(false);

    // Finish the wizard (skipping is the same act as completing, for the row).
    await click(button('Skip for now'));
    expect(stored.get(TENANT.id), 'the row now exists').toBeTruthy();
    expect(wizardIsUp(), 'the wizard let go on its own').toBe(false);

    // The tour's gate re-evaluates — unseen, on `/`, canary, wizard settled —
    // and fires after its anchor poll.
    await wait(TOUR_WINDOW_MS);
    expect(tourIsActive(), 'the tour fired after the wizard').toBe(true);
    expect(container.querySelector('[data-tour-active]')!.textContent).toBe('3');
    expect(hasSeenTour(APP_USER_ID), 'and recorded itself as seen, up front').toBe(true);

    // ── 2. The control: a reload with NO reset ───────────────────────────
    await hardReload();
    expect(wizardIsUp(), 'the wizard does not return on its own').toBe(false);
    await wait(TOUR_WINDOW_MS);
    expect(tourIsActive(), 'nor does the tour').toBe(false);

    // ── 3. The /dev page's reset, then a reload ──────────────────────────
    // Exactly what "Start as a first-time operator" does, in order: the row,
    // then the tour's flags, then a full load of the dashboard.
    const reset = await resetFirstRunRow(fakeSupabase as unknown as FirstRunClient, TENANT.id);
    expect(reset).toEqual({ ok: true, deleted: 1 });
    expect(clearTourSeenFlags()).toBe(1);
    expect(hasSeenTour(APP_USER_ID)).toBe(false);

    await hardReload();
    expect(wizardIsUp(), 'after the reset: the wizard is back').toBe(true);
    expect(tourIsActive()).toBe(false);
    await wait(TOUR_WINDOW_MS);
    expect(tourIsActive(), 'and the tour still waits for it').toBe(false);

    await click(button('Skip for now'));
    expect(wizardIsUp()).toBe(false);
    await wait(TOUR_WINDOW_MS);
    expect(tourIsActive(), 'then fires again, in the same order as the first time').toBe(true);
  }, 20_000);

  it('the wizard alone being re-armed is not enough — the tour needs its own flag cleared', async () => {
    // Half a reset is the failure mode the page exists to avoid: a cleared
    // row with the tour still marked seen gives wizard → nothing.
    await render();
    await click(button('Skip for now'));
    await wait(TOUR_WINDOW_MS);
    expect(tourIsActive()).toBe(true);

    await resetFirstRunRow(fakeSupabase as unknown as FirstRunClient, TENANT.id);
    // …but NOT clearTourSeenFlags().
    await hardReload();
    expect(wizardIsUp()).toBe(true);
    await click(button('Skip for now'));
    await wait(TOUR_WINDOW_MS);
    expect(tourIsActive(), 'tour stays dark: its seen flag was never cleared').toBe(false);
  }, 20_000);
});
