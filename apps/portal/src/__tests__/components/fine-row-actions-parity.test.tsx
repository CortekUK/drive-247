/**
 * The fines tab's Record Payment and Waive Fine, lifted into ONE shared hook
 * (`components/fines/use-fine-row-actions.tsx`) that both `fines/page.tsx` and
 * the Finances Fines view run.
 *
 * The expected database calls below are transcribed by hand from the code as
 * it stood inline in `fines/page.tsx` before the lift (commit 2d6e1000): the
 * same tables, filters, request bodies, invalidations and audit entry, in the
 * same order. The hook must make exactly those calls — no more, no fewer —
 * and the only addition, `onChanged`, must be inert when not passed (the
 * fines tab passes nothing).
 */
import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  log: [] as unknown[][],
  ledgerRow: null as null | { remaining_amount: number; amount: number },
  invoke: { data: { success: true, amount: 75 }, error: null } as { data: any; error: any },
  toast: vi.fn(),
  logAction: vi.fn(),
  addPaymentProps: null as any,
}));

vi.mock('@/integrations/supabase/client', () => {
  /** Records every step of a query chain as [method, ...args]. */
  const chain = (table: string) => {
    const b: any = {};
    const step = (name: string) => (...args: unknown[]) => {
      h.log.push([name, ...args]);
      return b;
    };
    for (const m of ['delete', 'update', 'select', 'eq', 'is']) b[m] = step(m);
    b.maybeSingle = async () => {
      h.log.push(['maybeSingle']);
      return { data: h.ledgerRow, error: null };
    };
    // An awaited chain (delete / update) resolves like PostgREST.
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
    h.log.push(['from', table]);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      functions: {
        invoke: async (name: string, opts: unknown) => {
          h.log.push(['invoke', name, opts]);
          return h.invoke;
        },
      },
    },
  };
});
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/hooks/use-audit-log', () => ({ useAuditLog: () => ({ logAction: h.logAction }) }));
vi.mock('@/components/shared/dialogs/add-payment-dialog', () => ({
  AddPaymentDialog: (p: any) => {
    h.addPaymentProps = p;
    return <div data-testid="add-payment-dialog" />;
  },
}));

import { FinePaymentDialog, fineCanCharge, fineCanWaive, useFineRowActions } from '@/components/fines/use-fine-row-actions';
import { codeOnly, readPortalSource } from '../helpers/edge-source';

const FINE = {
  id: 'f1',
  status: 'Open',
  amount: 75,
  rental_id: 'r1',
  customer_id: 'c1',
  vehicle_id: 'v1',
} as any;

function setup(options?: { onChanged?: () => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidated: unknown[] = [];
  vi.spyOn(qc, 'invalidateQueries').mockImplementation(async (f: any) => {
    invalidated.push(f.queryKey);
  });
  const wrapper = ({ children }: { children?: any }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useFineRowActions(options), { wrapper });
  return { hook, invalidated, wrapper };
}

beforeEach(() => {
  h.log = [];
  h.ledgerRow = null;
  h.invoke = { data: { success: true, amount: 75 }, error: null };
  h.addPaymentProps = null;
});
afterEach(() => vi.clearAllMocks());

describe('Waive Fine — the fines tab’s calls, exactly', () => {
  it('deletes the fine’s Charge row, then asks apply-fine to waive, then refreshes and audits', async () => {
    const { hook, invalidated } = setup();
    await act(async () => {
      await hook.result.current.waiveFineAction.mutateAsync('f1');
    });
    expect(h.log).toEqual([
      ['from', 'ledger_entries'],
      ['delete'],
      ['eq', 'reference', 'FINE-f1'],
      ['eq', 'type', 'Charge'],
      ['invoke', 'apply-fine', { body: { fineId: 'f1', action: 'waive' } }],
    ]);
    expect(invalidated).toEqual([
      ['fines-enhanced'],
      ['fines-kpis'],
      ['customer-balance'],
      ['customer-balance-status'],
      ['customer-fine-stats'],
      ['audit-logs'],
    ]);
    expect(h.logAction).toHaveBeenCalledWith({ action: 'fine_waived', entityType: 'fine', entityId: 'f1', details: { amount: 75 } });
    expect(h.toast).toHaveBeenCalledWith({ title: 'Fine waived successfully' });
  });

  it('a refusal from apply-fine is shown and refreshes nothing', async () => {
    h.invoke = { data: { success: false, error: 'Fine already paid' }, error: null };
    const { hook, invalidated } = setup();
    await act(async () => {
      await hook.result.current.waiveFineAction.mutateAsync('f1').catch(() => {});
    });
    expect(invalidated).toEqual([]);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Fine already paid', variant: 'destructive' }));
  });
});

describe('Record Payment — the fines tab’s calls, exactly', () => {
  it('stamps the rental on a rental-less FINE Charge row, then opens the payment window for the fine', async () => {
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.openPaymentDialog(FINE);
    });
    expect(h.log).toEqual([
      ['from', 'ledger_entries'],
      ['update', { rental_id: 'r1' }],
      ['eq', 'reference', 'FINE-f1'],
      ['eq', 'type', 'Charge'],
      ['is', 'rental_id', null],
    ]);
    expect(hook.result.current.paymentFine).toBe(FINE);
  });

  it('a fine on no rental touches nothing before the window opens', async () => {
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.openPaymentDialog({ ...FINE, rental_id: null });
    });
    expect(h.log).toEqual([]);
    expect(hook.result.current.paymentFine).toMatchObject({ id: 'f1' });
  });

  it('the window is the fines tab’s AddPaymentDialog call, prop for prop, and syncs the fine once paid', async () => {
    const { hook, wrapper } = setup();
    await act(async () => {
      await hook.result.current.openPaymentDialog(FINE);
    });
    h.log = [];
    const view = render(<FinePaymentDialog actions={hook.result.current} />, { wrapper });
    expect(view.getByTestId('add-payment-dialog')).toBeInTheDocument();
    const { onOpenChange, onPaymentSuccess, ...props } = h.addPaymentProps;
    expect(props).toEqual({
      open: true,
      customer_id: 'c1',
      vehicle_id: 'v1',
      rental_id: 'r1',
      defaultAmount: 75,
      targetCategories: ['Fine'],
    });
    h.ledgerRow = { remaining_amount: 0, amount: 75 };
    await act(async () => {
      onPaymentSuccess();
    });
    await waitFor(() => expect(h.log.some((s) => s[0] === 'from' && s[1] === 'fines')).toBe(true));
    act(() => onOpenChange(false));
    expect(hook.result.current.paymentFine).toBeNull();
  });

  it('renders nothing while no fine is chosen', () => {
    const { hook, wrapper } = setup();
    const view = render(<FinePaymentDialog actions={hook.result.current} />, { wrapper });
    expect(view.container.innerHTML).toBe('');
  });
});

describe('the status sync after a payment — the fines tab’s calls, exactly', () => {
  const syncCalls = (status: 'Paid' | 'Charged') => [
    ['from', 'ledger_entries'],
    ['select', 'remaining_amount, amount'],
    ['eq', 'reference', 'FINE-f1'],
    ['eq', 'type', 'Charge'],
    ['maybeSingle'],
    ['from', 'fines'],
    ['update', status === 'Paid' ? { status: 'Paid', charged_at: expect.any(String), resolved_at: expect.any(String) } : { status: 'Charged', charged_at: expect.any(String) }],
    ['eq', 'id', 'f1'],
  ];
  const INVALIDATED = [
    ['fines-enhanced'],
    ['fines-kpis'],
    ['customer-balance'],
    ['customer-balance-status'],
    ['customer-fine-stats'],
    ['rental-fines'],
    ['rental-totals'],
    ['audit-logs'],
  ];

  it('settled in full → Paid', async () => {
    h.ledgerRow = { remaining_amount: 0, amount: 75 };
    const { hook, invalidated } = setup();
    await act(async () => hook.result.current.syncFineStatusAfterPayment(FINE));
    expect(h.log).toEqual(syncCalls('Paid'));
    expect(invalidated).toEqual(INVALIDATED);
  });

  it('part paid → Charged', async () => {
    h.ledgerRow = { remaining_amount: 25, amount: 75 };
    const { hook } = setup();
    await act(async () => hook.result.current.syncFineStatusAfterPayment(FINE));
    expect(h.log).toEqual(syncCalls('Charged'));
  });

  it('no ledger row (a fine older than the ledger) → Paid', async () => {
    h.ledgerRow = null;
    const { hook } = setup();
    await act(async () => hook.result.current.syncFineStatusAfterPayment(FINE));
    expect(h.log).toEqual(syncCalls('Paid'));
  });

  it('already in that status → no write, still refreshes', async () => {
    h.ledgerRow = { remaining_amount: 0, amount: 75 };
    const { hook, invalidated } = setup();
    await act(async () => hook.result.current.syncFineStatusAfterPayment({ ...FINE, status: 'Paid' }));
    expect(h.log.some((s) => s[0] === 'from' && s[1] === 'fines')).toBe(false);
    expect(invalidated).toEqual(INVALIDATED);
  });
});

describe('onChanged — the one addition, inert unless passed', () => {
  it('Finances passes it: called after a waive and after a sync, and adds no database call', async () => {
    const onChanged = vi.fn();
    const { hook } = setup({ onChanged });
    await act(async () => {
      await hook.result.current.waiveFineAction.mutateAsync('f1');
    });
    const afterWaive = h.log.length;
    expect(onChanged).toHaveBeenCalledTimes(1);
    h.ledgerRow = { remaining_amount: 0, amount: 75 };
    await act(async () => hook.result.current.syncFineStatusAfterPayment(FINE));
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(afterWaive).toBe(5);
  });
});

describe('the gates', () => {
  it('Record Payment and Waive Fine are offered only on an Open fine, as on the fines tab', () => {
    for (const status of ['Open', 'Charged', 'Paid', 'Waived', 'Appealed', 'Refunded']) {
      expect([status, fineCanCharge({ status } as any), fineCanWaive({ status } as any)]).toEqual([status, status === 'Open', status === 'Open']);
    }
  });
});

describe('one copy: both screens run the shared hook', () => {
  it('the fines tab mounts the hook and its payment window, and no longer carries its own copy', () => {
    const page = codeOnly(readPortalSource('app/(dashboard)/fines/page.tsx'));
    expect(page).toMatch(/import \{[^}]*\buseFineRowActions\b[^}]*\} from "@\/components\/fines\/use-fine-row-actions"/);
    expect(page).toMatch(/useFineRowActions\(\)/);
    expect(page).toMatch(/<FinePaymentDialog actions=\{fineActions\} \/>/);
    expect(page).not.toContain("functions.invoke('apply-fine'");
    expect(page).not.toContain('useMutation(');
  });

  it('the Finances screen mounts the same hook and the same payment window', () => {
    const view = codeOnly(readPortalSource('components/finances/finances-view.tsx'));
    expect(view).toMatch(/import \{[^}]*\buseFineRowActions\b[^}]*\} from "@\/components\/fines\/use-fine-row-actions"/);
    expect(view).toMatch(/<FinePaymentDialog actions=\{fineActions\} \/>/);
    expect(view).not.toContain('apply-fine');
  });
});
