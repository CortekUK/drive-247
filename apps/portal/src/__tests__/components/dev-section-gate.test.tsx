/**
 * The sidebar Developer link's ONE remaining gate.
 *
 * The link leads to the `/dev` page, which clears operator-facing local state
 * and issues one Supabase DELETE (scoped to the open tenant's own
 * `tenant_first_run` row). It used to carry three gates — a build gate, a
 * localhost gate and a tenant gate — and the first two were removed on Sep 20
 * 2026 because the request was to see the developer tool on the LIVE portal.
 *
 * So the only thing standing between this link and a paying operator is now
 * the tenant gate, and this file is what holds it to that. The cases that
 * matter most are no longer the build ones; they are:
 *
 *   - `nasir` and `squad`, two real tenants whose `tenants.portal_experience`
 *     is already `'v2'` in production. They are "lean", so a gate written as
 *     `useIsLean()` — which is what the localhost version used — would open
 *     for them the moment the host gate went. Every future self-serve signup
 *     lands on v2 as well, so that list only grows.
 *   - the canary on a real production host, which MUST now show, because that
 *     is the whole point of the change.
 *
 * WHY EVERY CASE RENDERS A SENTINEL
 * ---------------------------------
 * "The link is absent" and "the render blew up and produced nothing" look
 * identical from the outside, and so do "the link is absent" and "the query
 * selector is wrong". Every case below mounts a sentinel NEXT TO the link and
 * asserts the sentinel is there first — proving the tree mounted and the link
 * specifically was filtered, rather than the whole render having failed and
 * trivially "hidden" everything.
 *
 * The first case is also the probe's own existence test: it asserts the link
 * IS found under a configuration that should produce it. Without that, every
 * "absent" assertion below would pass just as happily against a typo in the
 * test id.
 *
 *   1. northwind, any host, any build  → SHOWS, as a link to /dev
 *   2. every other tenant              → hidden  (the outage case)
 *   3. a lean, non-canary tenant       → hidden  (portal_experience = 'v2')
 *   4. tenant not resolved yet         → hidden, and nothing throws
 *
 * HARNESS: `react-dom/client` + `act`, matching the other gate tests here
 * (`dev-page-gate.test.tsx`, `first-run-wizard-gate.test.tsx`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DevSection } from '@/components/shared/layout/dev-section';
import { DEV_ROUTE } from '@/lib/dev-actions';

// ── Test doubles ───────────────────────────────────────────────────────────

let currentTenant: { id: string; slug: string } | null = null;

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: currentTenant,
    tenantSlug: currentTenant?.slug ?? null,
  }),
}));

// A plain anchor stands in for next/link: the router context it wants is not
// mounted here, and all this test needs is the href it renders.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.PropsWithChildren<{ href: string } & Record<string, unknown>>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
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
 * The component no longer reads the hostname at all — these cases exist to
 * prove exactly that.
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
  await act(async () => {
    root.render(
      <>
        {/* Stands in for the rest of SidebarFooter. If this is missing, the
            tree never mounted and no "absent" assertion below means anything. */}
        <div data-testid={SENTINEL} />
        <DevSection />
      </>,
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  if (realLocation) Object.defineProperty(window, 'location', realLocation);
});

// ── 1. The canary — now everywhere, not only on this machine ───────────────

describe('Developer sidebar link — shows for the canary', () => {
  it('renders for northwind on localhost', async () => {
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    // The probe's own existence test. Every "absent" assertion in this file is
    // worthless unless this one passes.
    expect(sentinel()).not.toBeNull();
    expect(devSection()).not.toBeNull();
    expect(devSection()!.textContent).toContain('Developer');
  });

  it('renders on a tenant subdomain of localhost, which is how the portal is served in dev', async () => {
    // `npm run dev:portal` puts the canary on northwind.portal.localhost:4002.
    setHostname('northwind.portal.localhost');
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).not.toBeNull();
  });

  it('renders on the LIVE production host — the whole point of dropping the host gate', async () => {
    setHostname('northwind.portal.drive-247.com');
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).not.toBeNull();
  });

  it('renders in a production build — the build gate is gone, deliberately', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    setHostname('northwind.portal.drive-247.com');
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    expect(sentinel()).not.toBeNull();
    expect(devSection()).not.toBeNull();
  });

  it('is a link to the developer page, and carries no actions of its own', async () => {
    // The page is the destination; the block is only the way there. Anything
    // it did itself would be a second copy of what the page does.
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    await render();

    const link = devSection()!;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(DEV_ROUTE);
    expect(DEV_ROUTE).toBe('/dev');
    expect(link.querySelectorAll('button')).toHaveLength(0);
  });
});

// ── 2. Every other tenant ──────────────────────────────────────────────────

describe('Developer sidebar link — the tenant gate', () => {
  // Real, live operators. This is the case that would be an incident: the
  // page it leads to clears onboarding state and issues a DELETE.
  it.each(['goniko', 'revtek', 'jangram', 'eastpeakrentalsllc', 'globalmotiontransport'])(
    'does not render for %s',
    async (slug) => {
      currentTenant = { id: `tenant-${slug}`, slug };
      await render();

      expect(sentinel()).not.toBeNull();
      expect(devSection()).toBeNull();
    },
  );

  // THE case this gate exists for now. Both rows carry
  // `tenants.portal_experience = 'v2'` in production, so they are "lean" —
  // and lean is emphatically not "the canary".
  it.each(['nasir', 'squad'])(
    'does not render for %s, a lean tenant on the v2 portal that is not the canary',
    async (slug) => {
      setHostname(`${slug}.portal.drive-247.com`);
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

// ── 3. Nothing resolved yet ────────────────────────────────────────────────

describe('Developer sidebar link — unresolved tenant', () => {
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
