/**
 * Extend on the plan: the dialog calls `payment-plan-manage` 'extend' FIRST,
 * and only then — when "Send an extension agreement" is on — the existing
 * `/api/esign` route, with the manual extension's own request body.
 *
 * "Reuse its request body; do not invent one": the key set is read out of
 * `AdminExtendRentalDialog.tsx`'s `/api/esign` call and compared to what this
 * path sends, so the two cannot drift apart silently.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  extRows: [] as Record<string, unknown>[],
  fromCalls: [] as string[],
}));

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant: { id: 't1', slug: 'northwind' }, loading: false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => {
  const client = {
    from: (table: string) => {
      h.fromCalls.push(table);
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => ({ data: h.extRows.filter((r) => ids.includes(String(r.id))), error: null }),
        }),
      };
    },
    functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  };
  return { supabase: client, supabaseUntyped: client };
});

import { ExtendPlanDialog } from '@/components/payment-plans/extend-plan-dialog';
import { extendOnPlan, type ExtendInput } from '@/hooks/use-payment-plan';
import { EXTENSION_AGREEMENT_KEYS } from '@/lib/payment-plans-ui/extension-agreement';

/** The keys the MANUAL extension posts to /api/esign, read from its source. */
function manualEsignKeys(): string[] {
  const src = readFileSync(resolve(process.cwd(), 'src/components/rentals/AdminExtendRentalDialog.tsx'), 'utf8');
  const at = src.indexOf("fetch('/api/esign'");
  expect(at).toBeGreaterThan(-1);
  const open = src.indexOf('JSON.stringify({', at);
  const close = src.indexOf('})', open);
  const block = src.slice(open + 'JSON.stringify({'.length, close);
  expect(block).toMatch(/agreementType:\s*'extension'/);
  return [...block.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
}

let fetchSpy: ReturnType<typeof vi.fn>;
const onExtendReal = (input: ExtendInput) =>
  extendOnPlan({ rentalId: 'r1', tenantId: 't1', customerName: 'Ann Lee', customerEmail: 'ann@example.com', fetchImpl: fetchSpy as unknown as typeof fetch }, input);

const renderDialog = (over: Partial<Parameters<typeof ExtendPlanDialog>[0]> = {}) =>
  render(
    <ExtendPlanDialog
      open
      onOpenChange={vi.fn()}
      plan={{ status: 'active', renewal: { extendsRental: true, periodUnit: 'week', periodCount: 1, insurance: null, sendAgreementEachPeriod: false } }}
      currentEnd="2026-10-09"
      facts={{ periodUnit: 'week', customerEmail: 'ann@example.com', coverage: null }}
      bonzahSellable={false}
      onExtend={onExtendReal}
      {...over}
    />,
  );

const confirm = async () => {
  await act(async () => {
    fireEvent.click(document.querySelector('[data-confirm]') as HTMLElement);
  });
};

beforeEach(() => {
  h.invoke.mockReset();
  h.fromCalls = [];
  h.invoke.mockResolvedValue({ data: { ok: true, extensionIds: ['e3', 'e4'], occurrenceIds: ['o9', 'o10'] }, error: null });
  h.extRows = [
    { id: 'e4', sequence_number: 4, previous_end_date: '2026-10-16', new_end_date: '2026-10-23', total_amount: 350 },
    { id: 'e3', sequence_number: 3, previous_end_date: '2026-10-09', new_end_date: '2026-10-16', total_amount: '350.00' },
  ];
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
});
afterEach(() => vi.clearAllMocks());

describe('Extend on the plan', () => {
  it('the agreement body is the manual extension\'s, key for key', () => {
    expect([...EXTENSION_AGREEMENT_KEYS].sort()).toEqual(manualEsignKeys().sort());
  });

  it('calls manage "extend" with the operator\'s answers, THEN /api/esign once per new extension, with the reused body', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Number of periods'), { target: { value: '2' } });
    expect(document.querySelector('[data-extend-summary]')!.textContent).toContain('Fri 9 Oct → Fri 23 Oct');
    await confirm();

    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith('payment-plan-manage', {
      body: { action: 'extend', rentalId: 'r1', periods: 2, giveDaysNow: true, sendAgreement: true, insurance: null },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // manage before esign — the agreement never goes for an extension that does not exist.
    expect(h.invoke.mock.invocationCallOrder[0]).toBeLessThan(fetchSpy.mock.invocationCallOrder[0]);

    const bodies = fetchSpy.mock.calls.map(([url, init]: any) => {
      expect(url).toBe('/api/esign');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      return JSON.parse(init.body);
    });
    for (const b of bodies) expect(Object.keys(b).sort()).toEqual(manualEsignKeys().sort());
    // In extension order, each with its own dates, number and amount (dollars, as the manual flow sends).
    expect(bodies).toEqual([
      {
        rentalId: 'r1', customerEmail: 'ann@example.com', customerName: 'Ann Lee', tenantId: 't1', agreementType: 'extension',
        extensionPreviousEndDate: '2026-10-09', extensionNewEndDate: '2026-10-16', extensionNumber: 3, extensionAmount: 350,
      },
      {
        rentalId: 'r1', customerEmail: 'ann@example.com', customerName: 'Ann Lee', tenantId: 't1', agreementType: 'extension',
        extensionPreviousEndDate: '2026-10-16', extensionNewEndDate: '2026-10-23', extensionNumber: 4, extensionAmount: 350,
      },
    ]);
    expect(h.fromCalls).toEqual(['rental_extension_totals']);
  });

  it('no agreement asked → manage only, and no /api/esign call at all', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('switch', { name: 'Send an extension agreement' }));
    await confirm();
    expect(h.invoke).toHaveBeenCalledWith('payment-plan-manage', expect.objectContaining({ body: expect.objectContaining({ action: 'extend', sendAgreement: false }) }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('"Give the days when paid" is sent as giveDaysNow: false', async () => {
    renderDialog();
    fireEvent.click(document.querySelector('[data-give-days="when_paid"]') as HTMLElement);
    await confirm();
    expect(h.invoke.mock.calls[0][1].body).toMatchObject({ action: 'extend', periods: 1, giveDaysNow: false });
  });

  it('"until a date" is extended by whole periods — the server is asked for a count', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'until a date' }));
    // No date yet: nothing can be confirmed.
    expect((document.querySelector('[data-confirm]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed extend sends no agreement and keeps the dialog open', async () => {
    h.invoke.mockResolvedValue({ data: { error: 'The rental is not on a plan that can extend it.' }, error: null });
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });
    await confirm();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('insurance is asked only when the tenant sells Bonzah, with Bonzah\'s start rule said plainly', () => {
    const { container, unmount } = renderDialog();
    expect(container.ownerDocument.querySelector('[data-sentence-line="extend-cover"]')).toBeNull();
    unmount();
    renderDialog({ bonzahSellable: true, facts: { periodUnit: 'week', customerEmail: 'ann@example.com', coverage: { cdw: true } } });
    const cover = document.querySelector('[data-sentence-line="extend-cover"]')!;
    expect(cover.textContent).toMatch(/can't start before tomorrow, Pacific time/);
    expect(cover.textContent).toMatch(/no premium is charged/);
  });

  it('the rental\'s cover is sent for the new days when chosen', async () => {
    renderDialog({ bonzahSellable: true, facts: { periodUnit: 'week', customerEmail: 'ann@example.com', coverage: { cdw: true, rcli: true } } });
    await confirm();
    expect(h.invoke.mock.calls[0][1].body.insurance).toEqual({ cdw: true, rcli: true });
  });

  it('a customer with no email: the agreement is off and says why', async () => {
    renderDialog({ facts: { periodUnit: 'week', customerEmail: null, coverage: null } });
    expect(document.querySelector('[data-extend-agreement]')!.textContent).toMatch(/no email address/);
    await confirm();
    expect(h.invoke.mock.calls[0][1].body.sendAgreement).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
