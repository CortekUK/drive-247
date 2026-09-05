/**
 * The sidebar Developer block's TWO gates.
 *
 * The block is a local-only affordance for re-running the first-run onboarding
 * experience. It carries a Supabase DELETE and clears operator-facing state, so
 * "it must never appear for a paying tenant, and it must never reach
 * production" are the only two things about it that actually matter.
 *
 * WHY EVERY CASE RENDERS A SENTINEL
 * ---------------------------------
 * "The block is absent" and "the render blew up and produced nothing" look
 * identical from the outside, and so do "the block is absent" and "the query
 * selector is wrong". Every case below mounts a sentinel NEXT TO the block and
 * asserts the sentinel is there first — proving the tree mounted and the block
 * specifically was filtered, rather than the whole render having failed and
 * trivially "hidden" everything.
 *
 * The first case is also the probe's own existence test: it asserts the block
 * IS found under the one configuration that should produce it. Without that,
 * every "absent" assertion below would pass just as happily against a typo in
 * the test id.
 *
 *   1. dev build + localhost + northwind          → SHOWS
 *   2. dev build + localhost + goniko/revtek/…    → hidden  (the outage case)
 *   3. dev build + a real host  + northwind       → hidden  (dev build served
 *                                                   somewhere that is not this
 *                                                   machine)
 *   4. PRODUCTION build + localhost + northwind   → hidden  (the build gate,
 *                                                   which in a real bundle is
 *                                                   not a branch at all: see
 *                                                   the note on case 4)
 *   5. tenant not resolved yet                    → hidden, and nothing throws
 *
 * HARNESS: `react-dom/client` + `act`, matching the other gate tests here
 * (`first-run-wizard-gate.test.tsx`, `integrations-board-cmd-gate.test.tsx`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DevSection } from '@/components/shared/layout/dev-section';

// ── Test doubles ───────────────────────────────────────────────────────────

let currentTenant: { id: string; slug: string } | null = null;

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: currentTenant,
    tenantSlug: currentTenant?.slug ?? null,
  }),
}));

// Imported only for its query-key helper. Stubbed so the real module's
// Supabase / auth-store / first-run-questions graph stays out of this test.
vi.mock('@/hooks/use-first-run-wizard', () => ({
  firstRunQueryKey: (tenantId: string | undefined) => ['tenant-first-run', tenantId],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: () => ({ select: async () => ({ data: [], error: null }) }),
      }),
    }),
  },
}));

// Tells React this file drives its own `act()` scopes, exactly as the other
// render-based gate tests here do. Without it every render logs
// "The current testing environment is not configured to support act(...)".
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── Host control ───────────────────────────────────────────────────────────

const realLocation = Object.getOwnPropertyDescriptor(window, 'location');

/**
 * jsdom exposes `window.location` as a configurable accessor, so the whole
 * object can be swapped for the duration of a case and put back afterwards.
 * Only `hostname` is read by the component.
 */
function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname },
    configurable: true,
    writable: true,
  });
}

// ── Render harness ─────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

const SENTINEL = 'sentinel-sidebar-footer';

async function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        {/* Stands in for the rest of SidebarFooter. If this is missing, the
            tree never mounted and no "absent" assertion below means anything. */}
        <div data-testid={SENTINEL} />
        <DevSection />
      </QueryClientProvider>,
    );
  });
}

const sentinel = () => container.querySelector(`[data-testid="${SENTINEL}"]`);
const devSection = () => container.querySelector('[data-testid="dev-section"]');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  currentTenant = null;
  setHostname('localhost');
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  if (realLocation) Object.defineProperty(window, 'location', realLocation);
});

// ── 1. The canary, on this machine, in a dev build ─────────────────────────

describe('Developer sidebar block — shows', () => {
  it('renders for northwind on localhost in a development build', async () => {
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    // The probe's own existence test. Every "absent" assertion in this file is
    // worthless unless this one passes.
    expect(sentinel()).not.toBeNull();
    expect(devSection()).not.toBeNull();
    expect(devSection()!.textContent).toContain('Developer');
  });

  it('renders on a tenant subdomain of localhost, which is how the portal is actually served in dev', async () => {
    // `npm run dev:portal` puts the canary on northwind.portal.localhost:4002.
    setHostname('northwind.portal.localhost');
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).not.toBeNull();
  });
});

// ── 2. Every other tenant ──────────────────────────────────────────────────

describe('Developer sidebar block — the tenant gate', () => {
  // Real, live operators. This is the case that would be an incident: the
  // block clears onboarding state and issues a DELETE.
  it.each(['goniko', 'revtek', 'jangram', 'eastpeakrentalsllc', 'globalmotiontransport'])(
    'does not render for %s',
    async (slug) => {
      currentTenant = { id: `tenant-${slug}`, slug };
      await render();

      expect(sentinel()).not.toBeNull();
      expect(devSection()).toBeNull();
    },
  );

  it('is keyed on the slug, so a northwind-shaped id under another slug still gets nothing', async () => {
    // northwind's production id, deliberately paired with someone else's slug.
    // An id-keyed gate would open here; a slug-keyed one cannot.
    currentTenant = { id: '6e5c544f-0000-0000-0000-000000000000', slug: 'goniko' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).toBeNull();
  });
});

// ── 3. A dev build served from somewhere that is not this machine ──────────

describe('Developer sidebar block — the hostname gate', () => {
  it.each([
    'northwind.portal.drive-247.com',
    'portal.drive-247.com',
    '192.168.1.42',
    'northwind.portal.localhost.evil.com',
  ])('does not render for the canary on %s', async (hostname) => {
    setHostname(hostname);
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).toBeNull();
  });
});

// ── 4. The build gate ──────────────────────────────────────────────────────

describe('Developer sidebar block — the build gate', () => {
  /**
   * This asserts the RUNTIME half of the build gate: with NODE_ENV set to
   * production the component returns null even for the canary on localhost,
   * i.e. every other condition satisfied.
   *
   * In a real production bundle the guarantee is stronger than this test can
   * show. `process.env.NODE_ENV` is substituted with the literal "production"
   * at build time, so `DevSection` compiles to `if (true) return null;`, the
   * minifier folds it away, and `DevSectionBody` — which nothing else in the
   * program references — is tree-shaken out along with the markup, the reset
   * actions and the Supabase delete. There is no branch left to take.
   */
  it('does not render in a production build, with every other condition met', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    setHostname('localhost');
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).toBeNull();
  });

  it('does not render in a test/unknown build either — the guard is an allowlist, not a denylist', async () => {
    vi.stubEnv('NODE_ENV', 'staging');
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).toBeNull();
  });
});

// ── 5. Replay actually re-arms the tour ────────────────────────────────────

describe('Developer sidebar block — replay tour', () => {
  /**
   * The two halves of a replay, asserted separately because they fail
   * separately: clearing the per-user seen-key is what restores AUTOSTART (the
   * thing being tested), and the window event is what replays it in this tab
   * without a reload. A replay that only fires the event looks like it works
   * and silently never exercises the autostart gate.
   *
   * The event name is `REPLAY_TOUR_EVENT` from `lib/first-rental-tour.ts`,
   * restated here rather than imported for the same reason the component
   * restates it — and this test is what would catch the two drifting apart.
   */
  it('clears the tour seen-key and fires the replay event', async () => {
    const seenKey = 'd247.tour.first-rental.v1.app-user-1';
    localStorage.setItem(seenKey, new Date().toISOString());
    // A key that has nothing to do with the tour, to prove the sweep is
    // targeted and not "wipe localStorage".
    localStorage.setItem('rentals-calendar-insights', '0');

    const replays: Event[] = [];
    const onReplay = (e: Event) => replays.push(e);
    window.addEventListener('replay-first-rental-tour', onReplay);

    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    const block = devSection();
    expect(block).not.toBeNull();

    const buttonsFor = () => Array.from(block!.querySelectorAll('button'));
    // The block opens collapsed; the first button is the header toggle.
    await act(async () => {
      buttonsFor()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const tourButton = buttonsFor().find((b) => b.textContent?.includes('Tour'));
    expect(tourButton).toBeDefined();

    await act(async () => {
      tourButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(localStorage.getItem(seenKey)).toBeNull();
    expect(localStorage.getItem('rentals-calendar-insights')).toBe('0');
    expect(replays).toHaveLength(1);

    window.removeEventListener('replay-first-rental-tour', onReplay);
    localStorage.clear();
  });
});

// ── 6. Nothing resolved yet ────────────────────────────────────────────────

describe('Developer sidebar block — unresolved tenant', () => {
  it('renders nothing, and does not throw, before the tenant row loads', async () => {
    currentTenant = null;
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).toBeNull();
  });

  it('renders nothing for a host that spells the canary in an environment without one', async () => {
    // TenantContext derives a slug from the hostname before any lookup runs;
    // the gate reads the row that came back, which here is absent.
    setHostname('northwind.portal.localhost');
    currentTenant = null;
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).toBeNull();
  });
});
