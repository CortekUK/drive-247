// @vitest-environment jsdom

/**
 * The v1 warning for "the signed agreement names a different car".
 *
 * An operator swapped a vehicle fourteen hours after the renter signed, and
 * reported the new car as "not populating in the rental agreement". The
 * document was right — a signed contract is a record of what was agreed and
 * must not rewrite itself — but v1 said nothing at all, so the only way to
 * notice was to open the PDF and read the VIN.
 *
 * WHAT THESE PIN, each being a way to get a drift warning wrong:
 *   - it fires when a swap FOLLOWS the agreement going out;
 *   - it stays silent for a swap that came BEFORE it, which is already in the
 *     document and is not drift;
 *   - it stays silent on an unsent draft, which cannot have drifted;
 *   - it names BOTH cars, because "something changed" sends an operator hunting;
 *   - a failed query renders nothing, rather than sending somebody to re-issue a
 *     contract that was never wrong.
 */

import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  swaps: [] as unknown[],
  error: null as unknown,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: async () => ({ data: db.error ? null : db.swaps, error: db.error }),
          }),
        }),
      }),
    }),
  },
}));

const { AgreementVehicleDrift } = await import('@/components/rentals/agreement-vehicle-drift');

const SENT = '2026-10-02T02:00:15.000Z';
const accord = { reg: 'ACC-1', make: 'Honda', model: 'Accord sport' };
const civic = { reg: 'CIV-9', make: 'Honda', model: 'Civic' };

const agreement = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  agreement_type: 'original',
  document_status: 'completed',
  signed_document_id: 'sd1',
  envelope_sent_at: SENT,
  envelope_created_at: SENT,
  created_at: SENT,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  db.swaps = [];
  db.error = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const render = async (props: Record<string, unknown>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AgreementVehicleDrift as never, {
          rentalId: 'r1',
          tenantId: 't1',
          agreements: [agreement()],
          vehicle: civic,
          ...props,
        } as never),
      ),
    );
  });
  // A real macrotask, not two microtasks: the query resolves through react-query
  // and the FIRST render in the file also pays module init, which two awaits did
  // not cover — that showed up as one empty assertion and nine passes.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container.textContent ?? '';
};

describe('a swap after the agreement went out', () => {
  beforeEach(() => {
    db.swaps = [{ id: 's1', created_at: '2026-10-02T16:43:08.000Z', old_vehicle: accord }];
  });

  it('warns that the vehicle changed', async () => {
    expect(await render({})).toMatch(/vehicle changed after the agreement was signed/i);
  });

  it('names the car on the document and the car on the rental', async () => {
    const text = await render({});
    expect(text).toContain('Honda Accord sport');
    expect(text).toContain('Honda Civic');
  });

  it('says a signed agreement cannot be edited, and what to do instead', async () => {
    const text = await render({});
    expect(text).toMatch(/cannot be edited/i);
    expect(text).toMatch(/send a new agreement/i);
  });

  it('asks for a re-send, not a new one, when it was only sent and not signed', async () => {
    const text = await render({
      agreements: [agreement({ document_status: 'sent', signed_document_id: null })],
    });
    expect(text).toMatch(/sent the agreement again|send the agreement again/i);
    expect(text).not.toMatch(/cannot be edited/i);
  });
});

describe('it stays silent when there is nothing to report', () => {
  it('no swaps at all', async () => {
    expect(await render({})).toBe('');
  });

  it('a swap that PREDATES the agreement — already in the document', async () => {
    db.swaps = [{ id: 's0', created_at: '2026-10-01T09:00:00.000Z', old_vehicle: accord }];
    expect(await render({})).toBe('');
  });

  it('an unsent draft, which cannot have drifted', async () => {
    db.swaps = [{ id: 's1', created_at: '2026-10-02T16:43:08.000Z', old_vehicle: accord }];
    const text = await render({
      agreements: [
        agreement({ envelope_sent_at: null, envelope_created_at: null, created_at: null }),
      ],
    });
    expect(text).toBe('');
  });

  it('no agreement on the rental', async () => {
    db.swaps = [{ id: 's1', created_at: '2026-10-02T16:43:08.000Z', old_vehicle: accord }];
    expect(await render({ agreements: [] })).toBe('');
  });

  it('the swap returned the same car it started on', async () => {
    db.swaps = [{ id: 's1', created_at: '2026-10-02T16:43:08.000Z', old_vehicle: civic }];
    expect(await render({})).toBe('');
  });

  it('a query that fails, rather than guessing', async () => {
    db.error = { message: 'permission denied' };
    db.swaps = [{ id: 's1', created_at: '2026-10-02T16:43:08.000Z', old_vehicle: accord }];
    expect(await render({})).toBe('');
  });
});
