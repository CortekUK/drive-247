/**
 * The /dev page mounts the live test runner section — for the canary, and for
 * nobody else. The section's own behaviour is `e2e-live-runner.test.tsx`; this
 * file only pins that the page carries it, so deleting the one line in
 * `dev-page.tsx` is caught, and that it sits after the instant tier (the
 * payment plan simulator) its tier note points up to.
 */
import { act, render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        calls.push(`from ${table}`);
        return Promise.resolve({ data: [], error: null }).then(res);
      },
    };
    return b;
  };
  const supabase = {
    functions: {
      invoke: async (name: string, opts: { method?: string } = {}) => {
        calls.push(`${opts.method ?? 'POST'} ${name}`);
        const context = { status: 404, clone: () => ({ json: async () => ({ message: 'Requested function was not found' }) }) };
        return { data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }) };
      },
    },
    from: builder,
  };
  return { supabase, supabaseUntyped: supabase };
});

let currentTenant: { id: string; slug: string } | null = null;
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: currentTenant, loading: false, tenantSlug: currentTenant?.slug ?? null }),
}));

const NOT_FOUND = 'NEXT_NOT_FOUND (test sentinel)';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dev',
  useSearchParams: () => new URLSearchParams(),
}));

import { DevPageBody } from '@/components/dev/dev-page';

const SetupResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = SetupResizeObserver;
});

describe('/dev carries the live test runner', () => {
  it('for northwind: the section is there, after the simulator, and says the backend is missing', async () => {
    currentTenant = { id: 'tenant-northwind', slug: 'northwind' };
    const { container } = render(<DevPageBody />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const section = container.querySelector('[data-e2e-live-runner]');
    expect(section).not.toBeNull();
    const sim = container.querySelector('[data-payment-plan-simulator]');
    expect(sim).not.toBeNull();
    // After the instant tier, which its tier note calls "the payment plan simulator above".
    expect(sim!.compareDocumentPosition(section!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-e2e-status="unavailable"]')).not.toBeNull();
    expect(section!.querySelectorAll('button')).toHaveLength(0);
    expect(calls).toContain('GET e2e-runner');
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
  });
});
