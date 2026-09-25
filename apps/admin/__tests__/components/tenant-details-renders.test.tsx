/**
 * The rental company page actually renders.
 *
 * `/admin/rentals/<id>` has thrown a client-side exception in production twice
 * this week, both times from changes of mine, and both times every check I had
 * was green: `tsc --noEmit` clean, dev server 200, source scans passing. None
 * of those render a component. The page is behind a sign-in, so it had never
 * been mounted by anything.
 *
 * This mounts it. Supabase, the auth store and the router are stubbed, and the
 * tenant query resolves with a row — which is the important part, because the
 * crash only appeared on the SECOND render, the one after the data lands and
 * the `if (loading)` guard stops firing. A hook below that guard runs for the
 * first time on that render and React throws "rendered more hooks than during
 * the previous render".
 *
 * It does not assert what the page looks like. It asserts that mounting it,
 * letting the data arrive, and re-rendering does not throw — which is the
 * thing that was actually broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'tenant-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/rentals/tenant-1',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u1', email: 'a@b.c', is_super_admin: true }, logout: vi.fn() }),
}));

const TENANT = {
  id: 'tenant-1',
  company_name: "Mahadi's Rentals",
  slug: 'mahadis-rentals',
  admin_name: 'Stafa',
  contact_email: 'a@b.c',
  status: 'active',
  environment: 'production',
  created_at: '2026-01-01T00:00:00Z',
};

/* One chainable stub for every `.from().select()…` shape the page uses. */
function queryStub() {
  /* Lists come back EMPTY. Returning the tenant row for every query made
     a users table render a row with no `role` and blow up on
     `user.role.replace` — a fault in the stub, not the page. */
  const result = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'is', 'or', 'not',
    'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'order', 'limit', 'range', 'filter', 'match',
  ];
  for (const m of methods) chain[m] = () => chain;
  chain.single = async () => ({ data: TENANT, error: null });
  chain.maybeSingle = async () => ({ data: TENANT, error: null });
  chain.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => queryStub(),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}));

import TenantDetailsPage from '@/app/admin/(protected)/rentals/[id]/page';
import { SidebarSectionsProvider } from '@/components/admin/sidebar-sections';

describe('the rental company page mounts', () => {
  beforeEach(() => {
    // Left unmocked on purpose: the message is the point.
  });

  it('renders through the loading guard and out the other side without throwing', async () => {
    expect(() =>
      render(
        <SidebarSectionsProvider>
          <TenantDetailsPage />
        </SidebarSectionsProvider>,
      ),
    ).not.toThrow();

    // The second render — the one after the data lands — is where a hook
    // declared below `if (loading)` runs for the first time and React throws.
    await waitFor(
      () => {
        expect(document.body.textContent ?? '').not.toBe('');
      },
      { timeout: 4000 },
    );
  });

  it('logs no React hook-order complaint while doing it', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      seen.push(String(args[0] ?? ''));
    });

    render(
      <SidebarSectionsProvider>
        <TenantDetailsPage />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });
    spy.mockRestore();

    // The exact family of message React prints for the bug that took this page
    // down: a hook declared below an early return running for the first time on
    // a later render.
    expect(seen.filter((m) => /more hooks than|Rules of Hooks|order of Hooks/i.test(m))).toEqual([]);
  });
});
