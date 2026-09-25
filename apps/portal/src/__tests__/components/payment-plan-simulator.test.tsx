/**
 * The /dev payment plan simulator runs the REAL engine in the browser: the
 * scenario list is the one vitest runs, Run all produces a pass/fail per
 * assertion, and free play drives `runTick` and renders the real plan card.
 * It must never touch Supabase — the client is mocked to throw if it is used.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  const boom = () => {
    throw new Error('the simulator must not touch Supabase');
  };
  return { supabase: new Proxy({}, { get: boom }), supabaseUntyped: new Proxy({}, { get: boom }) };
});

import { PaymentPlanSimulator } from '@/components/dev/payment-plan-simulator';
import { PickableProvider, tickWords } from '@/components/dev/payment-plan-free-play';
import { SCENARIOS } from '@/lib/payment-plans/scenarios';
import { METHOD_CHOICES } from '@/lib/payment-plans-ui/plan-form-model';

// floating-ui (dropdowns/popovers) needs a constructible ResizeObserver.
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

describe('Scenarios', () => {
  it('lists every scenario the automated suite runs', () => {
    const { container } = render(<PaymentPlanSimulator />);
    const ids = [...container.querySelectorAll('[data-sim-scenario]')].map((e) => e.getAttribute('data-sim-scenario'));
    expect(ids).toEqual(SCENARIOS.map((s) => s.id));
    expect(ids.length).toBeGreaterThanOrEqual(18);
  });

  it('Run all produces a pass or fail per assertion, and a summary', async () => {
    const { container } = render(<PaymentPlanSimulator />);
    await act(async () => {
      fireEvent.click(container.querySelector('[data-sim-run-all]')!);
    });
    await waitFor(() => expect(container.querySelector('[data-sim-summary]')).not.toBeNull(), { timeout: 20000 });
    await waitFor(
      () => expect(container.querySelectorAll('[data-sim-result="not-run"]')).toHaveLength(0),
      { timeout: 20000 },
    );
    const results = [...container.querySelectorAll('[data-sim-scenario]')].map((e) => e.getAttribute('data-sim-result'));
    for (const r of results) expect(['pass', 'fail', 'error']).toContain(r);

    // Open one: every assertion row is marked pass or fail with expected and actual.
    const first = container.querySelector(`[data-sim-scenario="${SCENARIOS[0].id}"]`) as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { expanded: false }));
    const rows = first.querySelectorAll('[data-sim-assertion]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(['pass', 'fail']).toContain(row.getAttribute('data-sim-assertion'));
    // …and the end state is the REAL plan card.
    expect(first.querySelector('[data-payment-plan-card]')).not.toBeNull();
  }, 60000);
});

describe('Free play', () => {
  it('drives the real engine: start a plan, run to the end, every payment paid', async () => {
    const { container } = render(<PaymentPlanSimulator />);
    fireEvent.click(screen.getByRole('tab', { name: 'Free play' }));
    const free = container.querySelector('[data-sim-free-play]') as HTMLElement;
    // The defaults: $600 owed, 2 Oct – 23 Oct, weekly on the start's weekday, spread evenly —
    // switched to card auto-charge, so the simulated card is charged on each date.
    fireEvent.click(within(free).getByRole('button', { name: METHOD_CHOICES.find((m) => m.id === 'auto_charge')!.label }));
    await act(async () => {
      fireEvent.click(within(free).getByRole('button', { name: /Start the plan/ }));
    });
    expect(free.querySelector('[data-payment-plan-card]')).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(free).getByRole('button', { name: /To the end/ }));
    });
    await waitFor(() => expect(free.querySelector('[data-plan-status="completed"]')).not.toBeNull(), { timeout: 20000 });
    const statuses = [...free.querySelectorAll('[data-occurrence-status]')].map((e) => e.getAttribute('data-occurrence-status'));
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) expect(s).toBe('paid');
    // The math line reads it back: nothing remains.
    expect(free.querySelector('[data-figure="remaining"] dd')!.textContent).toBe('$0.00');
    expect(free.querySelector('[data-sim-log]')!.textContent).toMatch(/tick/);
  }, 60000);
});

describe('the card the tester controls', () => {
  it('applies a picked outcome to the next NEW charge only; a replayed key keeps its stored answer', async () => {
    const p = new PickableProvider();
    p.next = { decline: 'insufficient_funds' };
    const req = (key: string) => ({ amountCents: 100, currency: 'usd', idempotencyKey: key, account: 'acct_sim', customerRef: null, paymentMethodRef: null, metadata: { occurrence_id: 'o1' } });
    expect((await p.charge(req('k1'))).kind).toBe('declined');
    expect((await p.charge(req('k1'))).kind).toBe('declined'); // replay: same answer
    expect((await p.charge(req('k2'))).kind).toBe('succeeded'); // back to succeeding
  });

  it('puts a tick into words', () => {
    const words = tickWords(
      { asOf: 'x', recovered: [], reminders: [{ occurrenceId: 'o1', planId: 'p', offset: -2, sent: true }], actions: [{ occurrenceId: 'o1', planId: 'p', action: 'charged', amountCents: 20000, idempotencyKey: 'pp:acct_sim:o1:1' }], errors: [] },
      () => 1,
    );
    expect(words).toEqual(['reminder #1 (-2d)', '#1 charged $200.00 · pp:acct_sim:o1:1']);
  });
});
