/**
 * The developer page's FOUR gates, and its two buttons.
 *
 * The page carries a Supabase DELETE and clears operator-facing state, so "it
 * must never appear for a paying tenant, and it must never reach production"
 * are the only two things about it that actually matter. Four gates guard four
 * different failures:
 *
 *   1. BUILD    NODE_ENV — a production build folds the page away entirely
 *   2. ROUTE    the route file calls notFound() outside development, so even a
 *               typed URL has nothing there
 *   3. HOST     the browser must be on localhost
 *   4. TENANT   the northwind canary, by SLUG
 *
 * WHY EVERY REFUSAL IS ASSERTED AS THE RENDERED 404 PATH
 * ------------------------------------------------------
 * Status codes prove nothing: under the portal's `(dashboard)` layout,
 * `notFound()` returns HTTP 200 because the layout streams before the page
 * resolves. And "the page is absent" looks identical to "the render blew up"
 * from the outside. So every case renders a sentinel OUTSIDE a boundary that
 * catches exactly the `notFound()` sentinel, and asserts (a) the sentinel is
 * there — the tree mounted — and (b) the boundary rendered the 404 marker —
 * the page was REFUSED, not merely missing.
 *
 * The first case is the probe's own existence test: it asserts the page IS
 * found, with both buttons, under the one configuration that should produce
 * it. Without that, every "refused" assertion would pass just as happily
 * against a typo in the test id.
 *
 * HARNESS: `react-dom/client` + `act`, matching the other gate tests here
 * (`dev-section-gate.test.tsx`, `first-run-wizard-gate.test.tsx`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import DevPage from '@/app/(dashboard)/dev/page';
import { REPLAY_TOUR_EVENT, tourSeenKey } from '@/lib/first-rental-tour';

// ── Test doubles ───────────────────────────────────────────────────────────

let currentTenant: { id: string; slug: string } | null = null;
let tenantLoading = false;

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: currentTenant,
    loading: tenantLoading,
    tenantSlug: currentTenant?.slug ?? null,
  }),
}));

/** What `notFound()` throws here. The boundary below recognises only this. */
const NOT_FOUND = 'NEXT_NOT_FOUND (test sentinel)';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
}));

/** The fake first-run table: what the DELETE reports, and what is left. */
let deleteRows: unknown = [];
let remainingRow: unknown = null;
const supabaseCalls: string[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({
        eq: (_c: string, v: string) => ({
          select: async () => {
            supabaseCalls.push(`delete ${table} ${v}`);
            return { data: deleteRows, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => {
            supabaseCalls.push(`select ${table} ${v}`);
            return { data: remainingRow, error: null };
          },
        }),
      }),
    }),
  },
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── The not-found boundary ─────────────────────────────────────────────────

const NOT_FOUND_ID = 'not-found-page';
const CRASH_ID = 'crash';

/**
 * Stands in for Next's own not-found boundary. Renders the 404 marker for the
 * `notFound()` sentinel and a CRASH marker for anything else — so a page that
 * threw for the wrong reason can never pass as "correctly refused".
 */
class NotFoundBoundary extends React.Component<
  { children: React.ReactNode },
  { notFound: boolean; crash: string | null }
> {
  state = { notFound: false, crash: null };
  static getDerivedStateFromError(err: Error) {
    return err.message === NOT_FOUND
      ? { notFound: true, crash: null }
      : { notFound: false, crash: err.message };
  }
  render() {
    if (this.state.notFound) return <div data-testid={NOT_FOUND_ID}>404</div>;
    if (this.state.crash) return <div data-testid={CRASH_ID}>{this.state.crash}</div>;
    return this.props.children;
  }
}

// ── Host control ───────────────────────────────────────────────────────────

const realLocation = Object.getOwnPropertyDescriptor(window, 'location');
let assign: ReturnType<typeof vi.fn>;

/**
 * jsdom exposes `window.location` as a configurable accessor, so the whole
 * object can be swapped for a case and put back afterwards. The page reads
 * `hostname` and calls `assign` — both stubbed here.
 */
function setHostname(hostname: string) {
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, assign },
    configurable: true,
    writable: true,
  });
}

// ── Render harness ─────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

const SENTINEL = 'sentinel-outside-the-boundary';

/** Let effects run and their state updates paint. */
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render() {
  await act(async () => {
    root.render(
      <>
        {/* OUTSIDE the boundary: if this is missing the tree never mounted and
            no "refused" assertion below means anything. */}
        <div data-testid={SENTINEL} />
        <NotFoundBoundary>
          <DevPage />
        </NotFoundBoundary>
      </>,
    );
  });
  await settle();
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);
const sentinel = () => q(SENTINEL);
const page = () => q('dev-page');
const notFoundPage = () => q(NOT_FOUND_ID);
const crash = () => q(CRASH_ID);

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

/** Assert the page was REFUSED: tree mounted, 404 rendered, nothing crashed. */
function expectRefused() {
  expect(sentinel()).not.toBeNull();
  expect(crash()?.textContent ?? null).toBeNull();
  expect(page()).toBeNull();
  expect(notFoundPage()).not.toBeNull();
}

const NORTHWIND = { id: 'tenant-northwind', slug: 'northwind' };
const FIRST_TIME = 'Start as a first-time operator';
const QUICK_TOUR = 'Start the quick tour';

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  currentTenant = null;
  tenantLoading = false;
  deleteRows = [];
  remainingRow = null;
  supabaseCalls.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  setHostname('localhost');
  vi.stubEnv('NODE_ENV', 'development');
  // React reports every error a boundary catches. The sentinel is expected;
  // anything else still surfaces.
  consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.includes(NOT_FOUND) || text.includes('The above error occurred')) return;
    process.stderr.write(`${text}\n`);
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
  vi.unstubAllEnvs();
  if (realLocation) Object.defineProperty(window, 'location', realLocation);
});

// ── 1. The canary, on this machine, in a dev build ─────────────────────────

describe('Developer page — shows', () => {
  it('renders for northwind on localhost in a development build, with exactly the two buttons', async () => {
    currentTenant = NORTHWIND;
    await render();

    // The probe's own existence test. Every "refused" assertion in this file
    // is worthless unless this one passes.
    expect(sentinel()).not.toBeNull();
    expect(page()).not.toBeNull();
    expect(notFoundPage()).toBeNull();
    expect(crash()).toBeNull();

    expect(button(FIRST_TIME)).toBeDefined();
    expect(button(QUICK_TOUR)).toBeDefined();
    // Two abilities, by request. The count is scoped to the action cards
    // because the page also carries the empty-state preview switches (a later,
    // explicit request — `components/dev/empty-state-preview.tsx`), which are
    // buttons too and have their own suite.
    expect(container.querySelectorAll('[data-dev-action]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-dev-action] button')).toHaveLength(2);
  });

  it('renders on a tenant subdomain of localhost, which is how the portal is actually served in dev', async () => {
    // `npm run dev:portal` puts the canary on northwind.portal.localhost:4002.
    setHostname('northwind.portal.localhost');
    currentTenant = NORTHWIND;
    await render();

    expect(sentinel()).not.toBeNull();
    expect(page()).not.toBeNull();
  });
});

// ── 2. The tenant gate ─────────────────────────────────────────────────────

describe('Developer page — the tenant gate', () => {
  // Real, live operators. This is the case that would be an incident.
  it.each(['goniko', 'revtek', 'jangram', 'eastpeakrentalsllc', 'globalmotiontransport', 'test'])(
    'is refused for %s',
    async (slug) => {
      currentTenant = { id: `tenant-${slug}`, slug };
      await render();
      expectRefused();
    },
  );

  it('is keyed on the slug, so a northwind-shaped id under another slug is still refused', async () => {
    // northwind's production id, deliberately paired with someone else's slug.
    currentTenant = { id: '6e5c544f-0000-0000-0000-000000000000', slug: 'goniko' };
    await render();
    expectRefused();
  });

  it('is refused for a slug that is not a tenant at all, once the lookup has finished', async () => {
    for (const slug of ['not-a-real-tenant', 'northwind-2', 'Northwind', ' northwind', '']) {
      currentTenant = { id: 'x', slug };
      await render();
      expectRefused();
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it('is refused when the host spells the canary but no tenant row came back', async () => {
    // TenantContext derives a slug from the hostname before any lookup runs;
    // the gate reads the row that came back, which here is absent.
    setHostname('northwind.portal.localhost');
    currentTenant = null;
    tenantLoading = false;
    await render();
    expectRefused();
  });
});

// ── 3. The hostname gate ───────────────────────────────────────────────────

describe('Developer page — the hostname gate', () => {
  it.each([
    'northwind.portal.drive-247.com',
    'portal.drive-247.com',
    '192.168.1.42',
    'northwind.portal.localhost.evil.com',
  ])('is refused for the canary on %s', async (hostname) => {
    setHostname(hostname);
    currentTenant = NORTHWIND;
    await render();
    expectRefused();
  });
});

// ── 4. The build / route gate ──────────────────────────────────────────────

describe('Developer page — the build gate, at the route', () => {
  /**
   * This asserts the RUNTIME half of the build gate: with NODE_ENV set to
   * production the route file calls notFound() even for the canary on
   * localhost, i.e. every other condition satisfied. In a real production
   * bundle the guarantee is stronger than this test can show — the constant
   * folds and the page body is not in the bundle at all (proved separately
   * with esbuild; see the commit).
   */
  it('is refused in a production build, with every other condition met', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    currentTenant = NORTHWIND;
    await render();
    expectRefused();
  });

  it.each(['staging', 'test', ''])(
    'is refused for NODE_ENV=%j too — the guard is an allowlist, not a denylist',
    async (env) => {
      vi.stubEnv('NODE_ENV', env);
      currentTenant = NORTHWIND;
      await render();
      expectRefused();
    },
  );
});

// ── 5. Nothing resolved yet ────────────────────────────────────────────────

describe('Developer page — while the tenant is still resolving', () => {
  it('renders nothing, refuses nothing, and does not throw', async () => {
    currentTenant = null;
    tenantLoading = true;
    await render();

    expect(sentinel()).not.toBeNull();
    expect(page()).toBeNull();
    expect(notFoundPage()).toBeNull();
    expect(crash()).toBeNull();
  });
});

// ── 6. The two buttons ─────────────────────────────────────────────────────

describe('Developer page — "Start as a first-time operator"', () => {
  it('clears the first-run row, the tour flags and the checklist state, then reloads the dashboard', async () => {
    currentTenant = NORTHWIND;
    deleteRows = [{ id: 'row-1' }];

    localStorage.setItem(tourSeenKey('app-user-1'), 'seen');
    localStorage.setItem(tourSeenKey('app-user-2'), 'seen');
    localStorage.setItem('setup-guide-state-tenant-northwind', 'closed');
    localStorage.setItem('getting-started-dismissed-tenant-northwind', 'true');
    sessionStorage.setItem('setup-reminder-snoozed-tenant-northwind', 'true');
    // Unrelated state, to prove the reset is targeted.
    localStorage.setItem('rentals-calendar-insights', '0');
    localStorage.setItem('setup-guide-state-someone-else', 'closed');

    await render();
    await click(button(FIRST_TIME));

    // The database first, scoped to THIS tenant.
    expect(supabaseCalls).toEqual(['delete tenant_first_run tenant-northwind']);
    // Then every local "seen" flag…
    expect(localStorage.getItem(tourSeenKey('app-user-1'))).toBeNull();
    expect(localStorage.getItem(tourSeenKey('app-user-2'))).toBeNull();
    expect(localStorage.getItem('setup-guide-state-tenant-northwind')).toBeNull();
    expect(localStorage.getItem('getting-started-dismissed-tenant-northwind')).toBeNull();
    expect(sessionStorage.getItem('setup-reminder-snoozed-tenant-northwind')).toBeNull();
    // …and nothing else.
    expect(localStorage.getItem('rentals-calendar-insights')).toBe('0');
    expect(localStorage.getItem('setup-guide-state-someone-else')).toBe('closed');
    // Then a FULL load of the dashboard — where a brand-new operator lands.
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/');
    expect(container.querySelector('[data-dev-status="error"]')).toBeNull();
  });

  it('THE RLS CASE — says so loudly, touches nothing local, and does not navigate', async () => {
    currentTenant = NORTHWIND;
    // The DELETE "succeeds" with zero rows, and the row is still readable.
    deleteRows = [];
    remainingRow = { id: 'row-1' };

    localStorage.setItem(tourSeenKey('app-user-1'), 'seen');
    localStorage.setItem('setup-guide-state-tenant-northwind', 'closed');

    await render();
    await click(button(FIRST_TIME));

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toMatch(/row-level security/i);
    expect(alert!.textContent).toMatch(/nothing was reset/i);
    expect(container.querySelector('[data-dev-status="error"]')).not.toBeNull();

    // Nothing local was cleared — a half-reset would look like a wizard bug.
    expect(localStorage.getItem(tourSeenKey('app-user-1'))).toBe('seen');
    expect(localStorage.getItem('setup-guide-state-tenant-northwind')).toBe('closed');
    expect(assign).not.toHaveBeenCalled();
    // The read-back is what caught it.
    expect(supabaseCalls).toEqual([
      'delete tenant_first_run tenant-northwind',
      'select tenant_first_run tenant-northwind',
    ]);
  });
});

describe('Developer page — "Start the quick tour"', () => {
  it('fires the tour’s replay event in this tab, and resets nothing', async () => {
    currentTenant = NORTHWIND;
    localStorage.setItem(tourSeenKey('app-user-1'), 'seen');

    const replays: Event[] = [];
    const onReplay = (e: Event) => replays.push(e);
    window.addEventListener(REPLAY_TOUR_EVENT, onReplay);

    await render();
    await click(button(QUICK_TOUR));

    expect(replays).toHaveLength(1);
    // Replay is the tour's explicit path: it does not need the seen flag
    // cleared, and this button must not touch it or the database.
    expect(localStorage.getItem(tourSeenKey('app-user-1'))).toBe('seen');
    expect(supabaseCalls).toEqual([]);
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    window.removeEventListener(REPLAY_TOUR_EVENT, onReplay);
  });
});
