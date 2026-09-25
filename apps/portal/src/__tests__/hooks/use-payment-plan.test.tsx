/**
 * The payment-plan hooks: the gate issues no query for a non-canary tenant,
 * hides the feature before the migration, and every edge-function failure
 * reaches the caller as the server's own sentence (supabase-js never throws).
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tenant: { id: 'tenant-1', slug: 'northwind', timezone: 'America/New_York', currency_code: 'USD' } as any,
  probe: { error: null } as { error: unknown },
  from: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: h.tenant, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => {
  const client = {
    from: (...args: unknown[]) => {
      h.from(...args);
      return { select: () => ({ limit: () => Promise.resolve(h.probe) }) };
    },
    functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  };
  return { supabase: client, supabaseUntyped: client };
});

import { invokePaymentPlanManage, usePaymentPlansFeature } from '@/hooks/use-payment-plan';

// `any`: the monorepo carries two @types/react copies, and the provider's
// ReactNode is not the one this file would import.
const wrapper = ({ children }: { children?: any }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  h.tenant = { id: 'tenant-1', slug: 'northwind' };
  h.probe = { error: null };
  h.from.mockClear();
  h.invoke.mockReset();
});

describe('usePaymentPlansFeature', () => {
  it('is on for the canary when the tables answer', async () => {
    const { result } = renderHook(() => usePaymentPlansFeature(), { wrapper });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(h.from).toHaveBeenCalledWith('payment_plans');
  });

  it('is off — silently — before the migration is applied', async () => {
    h.probe = { error: { code: 'PGRST205', message: "Could not find the table 'public.payment_plans' in the schema cache" } };
    const { result } = renderHook(() => usePaymentPlansFeature(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it('never even asks for any other tenant', async () => {
    h.tenant = { id: 'tenant-2', slug: 'kedic' };
    const { result } = renderHook(() => usePaymentPlansFeature(), { wrapper });
    expect(result.current).toEqual({ enabled: false, isLoading: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe('invokePaymentPlanManage', () => {
  it('sends the action with its body', async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, planId: 'p1' }, error: null });
    await expect(invokePaymentPlanManage('pause', { planId: 'p1' })).resolves.toEqual({ ok: true, planId: 'p1' });
    expect(h.invoke).toHaveBeenCalledWith('payment-plan-manage', { body: { action: 'pause', planId: 'p1' } });
  });

  it('throws the server\'s sentence from a non-2xx body, never the generic one', async () => {
    const context = new Response(JSON.stringify({ error: 'A payment is in progress on this plan; wait for it to finish' }), { status: 409 });
    h.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }) });
    await expect(invokePaymentPlanManage('cancel', { planId: 'p1' })).rejects.toThrow('A payment is in progress on this plan; wait for it to finish');
  });

  it('treats a 200 that says ok:false as a failure', async () => {
    h.invoke.mockResolvedValue({ data: { ok: false, error: 'The last payment cannot be skipped' }, error: null });
    await expect(invokePaymentPlanManage('occurrence_skip', { occurrenceId: 'o3' })).rejects.toThrow('The last payment cannot be skipped');
  });
});
