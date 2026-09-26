/**
 * Developer tab — the renewal shadow comparison. Read-only: it lists this
 * tenant's rentals on the old renewal job, asks 'shadow_compare' for each,
 * and shows old vs plan per period with every mismatch marked and its reasons.
 * No read on mount; no write ever.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  calls: [] as string[],
  rentals: [] as Record<string, unknown>[],
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 't1', slug: 'northwind', currency_code: 'USD', timezone: 'America/New_York' }, loading: false }),
}));
vi.mock('@/integrations/supabase/client', () => {
  // Only reads exist on this stub: an insert/update/delete would throw.
  const query = (table: string) => {
    const chain: any = {
      select: (cols: string) => {
        h.calls.push(`select ${table} ${cols.split(',')[0]}`);
        return chain;
      },
      eq: (c: string, v: unknown) => {
        h.calls.push(`eq ${c}=${v}`);
        return chain;
      },
      order: async () => ({ data: h.rentals, error: null }),
    };
    return chain;
  };
  const client = { from: query, functions: { invoke: (...a: unknown[]) => h.invoke(...a) } };
  return { supabase: client, supabaseUntyped: client };
});

import { AutoExtendShadow, breakdownDiff, readShadowRows } from '@/components/dev/auto-extend-shadow';

const REPLY = {
  rows: [
    {
      period: '9 Oct → 16 Oct',
      oldEngine: { dueAt: '2026-10-09T14:00:00.000Z', chargeDate: '2026-10-09', amountCents: 38500, breakdown: { rentalCents: 35000, taxCents: 3500 } },
      newEngine: { dueAt: '2026-10-09T14:00:00.000Z', amountCents: 38500, breakdown: { rentalCents: 35000, taxCents: 3500 } },
      matches: true,
      notes: [],
    },
    {
      period: '16 Oct → 23 Oct',
      oldEngine: { dueAt: '2026-10-16T14:00:00.000Z', chargeDate: '2026-10-16', amountCents: 41195, breakdown: { rentalCents: 35000, taxCents: 3500, insuranceCents: 2695 } },
      newEngine: { dueAt: '2026-10-16T14:00:00.000Z', amountCents: 38500, breakdown: { rentalCents: 35000, taxCents: 3500, insuranceCents: 0 } },
      matches: false,
      notes: ['The old job charges an insurance premium without buying a policy; the plan charges none unless Bonzah issues one.'],
    },
  ],
  notes: ["Credit scope differs: the old job spends all of the customer's unapplied credit, the plan only this rental's."],
};

beforeEach(() => {
  h.invoke.mockReset();
  h.calls = [];
  h.rentals = [
    { id: 'r1', start_date: '2026-10-02', end_date: '2026-10-09', status: 'Active', auto_extend_period_unit: 'Weekly', auto_extend_interval_count: 1, auto_extend_charge_mode: 'pay_link', auto_extend_paused: false, customers: { name: 'Ann Lee' }, vehicles: { reg: 'NW-1' } },
  ];
  h.invoke.mockResolvedValue({ data: REPLY, error: null });
});

describe('AutoExtendShadow', () => {
  it('reads nothing until asked, then only this tenant\'s renewing rentals', async () => {
    render(<AutoExtendShadow />);
    expect(h.calls).toEqual([]);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-shadow-load]')!);
    });
    expect(h.calls).toEqual([expect.stringMatching(/^select rentals id/), 'eq tenant_id=t1', 'eq auto_extend_enabled=true']);
    expect(screen.getByText('Ann Lee · NW-1')).toBeInTheDocument();
  });

  it('shows old vs plan per period, marks the mismatch and gives its reason', async () => {
    const { container } = render(<AutoExtendShadow />);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-shadow-load]')!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-shadow-compare]')!);
    });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith('payment-plan-manage', { body: { action: 'shadow_compare', rentalId: 'r1' } });

    const rows = container.querySelectorAll('[data-shadow-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-shadow-match')).toBe('true');
    expect(rows[1].getAttribute('data-shadow-match')).toBe('false');
    expect(rows[1].className).toMatch(/destructive/);
    expect(rows[1].textContent).toContain('$411.95');
    expect(rows[1].textContent).toContain('$385.00');
    expect(rows[1].querySelector('[data-shadow-notes]')!.textContent).toMatch(/without buying a policy/);
    expect(container.querySelector('[data-shadow-summary]')!.textContent).toBe('1 period differs');
    // What the server says about the rental as a whole is shown too.
    expect(container.querySelector('[data-shadow-rental-notes]')!.textContent).toMatch(/Credit scope differs/);

    // Opening the row lines the two breakdowns up and flags the line that differs.
    fireEvent.click(rows[1]);
    const differs = container.querySelector('[data-breakdown-key="insuranceCents"]')!;
    expect(differs.getAttribute('data-breakdown-differs')).toBe('true');
    expect(container.querySelector('[data-breakdown-key="rentalCents"]')!.getAttribute('data-breakdown-differs')).toBe('false');
  });

  it('the server\'s refusal is shown as its own sentence', async () => {
    const context = new Response(JSON.stringify({ error: 'Only a head admin can compare renewals.' }), { status: 403 });
    h.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }) });
    render(<AutoExtendShadow />);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-shadow-load]')!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-shadow-compare]')!);
    });
    expect(await screen.findByText('Only a head admin can compare renewals.')).toBeInTheDocument();
  });
});

describe('reading the reply', () => {
  it('a malformed row is a visible mismatch with a reason, never a silent match', () => {
    const rows = readShadowRows({ rows: [{ period: 'x', matches: 'yes' }] });
    expect(rows[0].matches).toBe(false);
    expect(rows[0].notes.length).toBeGreaterThan(0);
    expect(readShadowRows(null)).toEqual([]);
  });

  it('breakdownDiff names exactly the lines that differ', () => {
    expect([...breakdownDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 0 })].sort()).toEqual(['b', 'c']);
  });
});
