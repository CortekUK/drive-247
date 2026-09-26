/**
 * Finances parity — the model fields the old Payments, Invoices and Fines
 * screens' buttons need, added to the rows ADDITIVELY:
 *
 *  - `vehicleId` on receipts and bills (the Payments tab linked each row's vehicle);
 *  - `invoiceId` on the booking bill (Email and Delete invoice act on that row);
 *  - `isPaymentRequest` on receipts, and the `payment_request` status filter —
 *    EXACTLY the rows the old Invoices tab's "Payment Requests" list selected,
 *    proved by running that list's own query (`useTenantPaymentRequests`) over
 *    the same rows;
 *  - the fines filter's two quick filters (`overdue`, `due-next-7`).
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import { narrowReceipts, PAYMENT_REQUEST_STATUS, selectFinances } from '@/lib/finances/filters';
import type { RawPayment } from '@/lib/finances/types';
import { fineFiltersOf } from '@/components/finances/fines-view';
import { charge, CTX, emptyRaw, payment, rental, TODAY } from '../helpers/finances-fixture';

/* ── the old Payment Requests query, run for real over fixture rows ──────── */

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], orFilter: '' as string }));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1' } }) }));
vi.mock('@/integrations/supabase/client', () => {
  /** Applies a PostgREST `.or("a.not.is.null,b.not.is.null")` the way the server does. */
  const applyOr = (rows: Record<string, unknown>[], filter: string) => {
    const clauses = filter.split(',').map((c) => {
      const m = /^(\w+)\.not\.is\.null$/.exec(c.trim());
      if (!m) throw new Error(`the test does not understand the clause ${c}`);
      return m[1];
    });
    return rows.filter((r) => clauses.some((col) => r[col] !== null && r[col] !== undefined));
  };
  const builder = () => {
    let out = db.rows;
    const b: any = {
      select: () => b,
      eq: (col: string, v: unknown) => {
        out = out.filter((r) => r[col] === v);
        return b;
      },
      or: (f: string) => {
        db.orFilter = f;
        out = applyOr(out, f);
        return b;
      },
      order: () => b,
      limit: async () => ({ data: out.map((r) => ({ ...r, customers: { name: 'X' } })), error: null }),
    };
    return b;
  };
  return { supabase: {}, supabaseUntyped: { from: () => builder() } };
});

import { useTenantPaymentRequests } from '@/hooks/use-payment-links';

const paymentsWithEveryShape = (): RawPayment[] => [
  // A Stripe checkout link, paid.
  payment('link-paid', 'c1', 'r1', 100, { stripe_checkout_session_id: 'cs_live_a', stripe_payment_intent_id: 'pi_a' }),
  // A Stripe checkout link, never paid (a placeholder, not money).
  payment('link-open', 'c1', 'r1', 80, { status: 'Pending', capture_status: 'requires_capture', verification_status: 'pending', stripe_checkout_session_id: 'cs_live_b' }),
  // A Square payment link.
  payment('square-link', 'c2', null, 60, { payment_provider: 'square', square_payment_link_id: 'sq_link_1', square_order_id: 'sq_ord_1' }),
  // A voided link — still a request that was sent.
  payment('link-void', 'c2', 'r2', 40, { status: 'Reversed', capture_status: 'cancelled', stripe_checkout_session_id: 'cs_live_c' }),
  // Taken by card on the portal (intent, no session): NOT a request.
  payment('card', 'c1', 'r1', 50, { stripe_payment_intent_id: 'pi_card' }),
  // A Square card payment with no link: NOT a request.
  payment('square-card', 'c2', null, 30, { payment_provider: 'square', square_payment_id: 'sq_pay_2' }),
  // Cash, recorded by hand: NOT a request.
  payment('cash', 'c1', 'r1', 20, { method: 'Cash' }),
];

function modelOf(payments: RawPayment[]) {
  const raw = emptyRaw();
  raw.rentals = [rental('r1', 'c1', { vehicle_id: 'v1' }), rental('r2', 'c2')];
  raw.vehicles = [{ id: 'v1', reg: 'NW-01' }, { id: 'v9', reg: 'NW-09' }];
  raw.payments = payments;
  return buildFinanceModel(raw, CTX);
}

describe('Payment requests: the old sub-tab’s rows, exactly', () => {
  it('marks a row a payment request when it carries a checkout session or a Square link, in any status', () => {
    const byId = new Map(modelOf(paymentsWithEveryShape()).receipts.map((r) => [r.paymentId, r.isPaymentRequest]));
    expect(Object.fromEntries(byId)).toEqual({
      'link-paid': true,
      'link-open': true,
      'square-link': true,
      'link-void': true,
      card: false,
      'square-card': false,
      cash: false,
    });
  });

  it('the payment_request status keeps the same ids the old list’s own query returns', async () => {
    const payments = paymentsWithEveryShape();
    db.rows = payments.map((p) => ({ ...p, tenant_id: 't1' }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children?: any }): any => React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useTenantPaymentRequests(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    // The query really is the one this test interprets.
    expect(db.orFilter).toBe('stripe_checkout_session_id.not.is.null,square_payment_link_id.not.is.null');
    const oldIds = result.current.data!.map((r) => r.id).sort();

    const model = modelOf(payments);
    // Over all time, as the old list (no date filter) — via the model's own selection.
    const selected = selectFinances(model, { statuses: [PAYMENT_REQUEST_STATUS], period: 'all' }, TODAY).receipts;
    expect(selected.map((r) => r.paymentId).sort()).toEqual(oldIds);
    expect(oldIds).toEqual(['link-open', 'link-paid', 'link-void', 'square-link']);
  });

  it('narrows receipts only; combined with a real status it keeps the requests in that status', () => {
    const model = modelOf(paymentsWithEveryShape());
    const both = narrowReceipts(model.receipts, { statuses: [PAYMENT_REQUEST_STATUS, 'pending_review'], period: 'all' });
    expect(both.map((r) => r.paymentId)).toEqual(['link-open']);
    // Bills are untouched by it.
    const raw = emptyRaw();
    raw.rentals = [rental('r1', 'c1')];
    raw.charges = [charge('ch1', 'r1', 'c1', 'Rental', 100, 100, '2026-09-01')];
    const m = buildFinanceModel(raw, CTX);
    expect(selectFinances(m, { statuses: [PAYMENT_REQUEST_STATUS], period: 'all' }, TODAY).bills).toHaveLength(1);
  });
});

describe('vehicle and invoice ids on the rows', () => {
  it('a receipt names its own vehicle, else its rental’s, else none', () => {
    const model = modelOf([
      payment('own', 'c1', 'r1', 10, { vehicle_id: 'v9' }),
      payment('via-rental', 'c1', 'r1', 10),
      payment('none', 'c2', null, 10),
    ]);
    const v = Object.fromEntries(model.receipts.map((r) => [r.paymentId, r.vehicleId]));
    expect(v).toEqual({ own: 'v9', 'via-rental': 'v1', none: null });
  });

  it('a bill names its rental’s vehicle, and the booking bill its invoices row', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r1', 'c1', { vehicle_id: 'v1' })];
    raw.vehicles = [{ id: 'v1', reg: 'NW-01' }];
    raw.invoices = [{ id: 'inv-7', rental_id: 'r1', invoice_number: 'INV-0007', created_at: '2026-09-01T00:00:00Z' }];
    raw.extensions = [{ id: 'e1', rental_id: 'r1', sequence_number: 1 }];
    raw.charges = [
      charge('ch1', 'r1', 'c1', 'Rental', 100, 0, '2026-09-01'),
      { ...charge('ch2', 'r1', 'c1', 'Extension Rental', 50, 50, '2026-09-10'), extension_id: 'e1' },
    ];
    const bills = buildFinanceModel(raw, CTX).bills;
    const booking = bills.find((b) => b.key === 'r1:booking')!;
    const ext = bills.find((b) => b.extensionId === 'e1')!;
    expect([booking.vehicleId, booking.invoiceId, booking.invoiceNumber]).toEqual(['v1', 'inv-7', 'INV-0007']);
    // An extension has no invoices row of its own.
    expect([ext.vehicleId, ext.invoiceId, ext.invoiceNumber]).toEqual(['v1', null, null]);
  });
});

describe('the fines filter, from the shared status', () => {
  it('maps the two quick filters and passes a stored status straight through', () => {
    expect(fineFiltersOf('', 'due_next_7')).toMatchObject({ status: [], quickFilter: 'due-next-7' });
    expect(fineFiltersOf('', 'overdue')).toMatchObject({ status: [], quickFilter: 'overdue' });
    expect(fineFiltersOf('', 'Partially Refunded')).toMatchObject({ status: ['Partially Refunded'], quickFilter: undefined });
  });
});
