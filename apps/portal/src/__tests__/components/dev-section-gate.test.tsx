/**
 * The sidebar Developer link's TWO gates.
 *
 * The link is a local-only affordance leading to the `/dev` page, which
 * carries a Supabase DELETE and clears operator-facing state. "It must never
 * appear for a paying tenant, and it must never reach production" are the
 * only two things about it that actually matter.
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
 * IS found under the one configuration that should produce it. Without that,
 * every "absent" assertion below would pass just as happily against a typo in
 * the test id.
 *
 *   1. dev build + localhost + northwind          → SHOWS, as a link to /dev
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
  vi.stubEnv('NODE_ENV', 'development');
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  if (realLocation) Object.defineProperty(window, 'location', realLocation);
});

// ── 1. The canary, on this machine, in a dev build ─────────────────────────

describe('Developer sidebar link — shows', () => {
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

describe('Developer sidebar link — the hostname gate', () => {
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

describe('Developer sidebar link — the build gate', () => {
  /**
   * This asserts the RUNTIME half of the build gate: with NODE_ENV set to
   * production the component returns null even for the canary on localhost,
   * i.e. every other condition satisfied.
   *
   * In a real production bundle the guarantee is stronger than this test can
   * show. `process.env.NODE_ENV` is substituted with the literal "production"
   * at build time, so `DevSection` compiles to `if (false) return <Body />;
   * return null;`, the minifier drops the dead branch, and `DevSectionBody` —
   * which nothing else in the program references — is tree-shaken out along
   * with the markup. There is no branch left to take.
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

// ── 5. Nothing resolved yet ────────────────────────────────────────────────

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
