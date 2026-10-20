/**
 * The shared Agreements list and drawer (shared/portal-v2/agreements), as the
 * customer portal's Agreements page draws them: the operator's Customer and
 * Email swapped for the Company and its main email, everything else the
 * operator's. Fed with the Northwind canary customer's real agreements (rows
 * as read from production on Oct 21 2026).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgreementsTable } from '../../../../../shared/portal-v2/agreements/table';
import { AgreementViewDialog } from '../../../../../shared/portal-v2/agreements/view-dialog';
import { agreementMetrics, sortAgreementRows, toAgreementStatus, type AgreementListRow } from '../../../../../shared/portal-v2/agreements/list';
import { flowSeries } from '../../../../../shared/portal-v2/hero-series';
import { useProgressiveRows } from '../../../../../shared/portal-v2/list-table';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

/** The canary customer's five rental agreements (document_status as stored). */
const CANARY: Array<[string, string, string, string | null]> = [
  ['c75b57f9-236d-4903-a3f8-5c018097d0da', 'R-936c59', 'completed', '2026-09-20T03:45:54Z'],
  ['6f81090c-82e9-491f-a215-f19df3469099', 'R-fcc596', 'completed', '2026-09-20T03:45:54Z'],
  ['98040cd7-60ae-41f2-9055-04e52a0d4aa9', 'R-d34f08', 'sent', null],
  ['fa342379-bd18-4739-944f-6d8d7047e79e', 'R-791ba6', 'completed', '2026-09-20T03:45:54Z'],
  ['50035e83-88d6-4cfd-9f4d-422c9c720372', 'R-9b4eed', 'completed', '2026-09-20T03:45:54Z'],
];

const rows: AgreementListRow[] = sortAgreementRows(
  CANARY.map(([id, ref, raw, signedAt]) => ({
    id,
    kind: 'rental' as const,
    customerName: 'Ghulam',
    customerEmail: 'ilyasghulam32@gmail.com',
    sentAt: '2026-09-19T03:45:54Z',
    status: toAgreementStatus(raw) as AgreementListRow['status'],
    rawStatus: raw,
    rentalId: `rental-${ref}`,
    rentalRef: ref,
    customerId: 'e72e623d-3a06-490c-891b-69e8c2174bc6',
    documentId: 'doc',
    title: 'Rental agreement',
    message: null,
    cc: [],
    signedAt,
  })),
);

const COMPANY = { label: 'Company', name: 'Northwind Rentals', email: 'hariszahid720@gmail.com' };

function Table({ onOpen }: { onOpen: (row: AgreementListRow) => void }) {
  const progressive = useProgressiveRows(rows, 'k');
  return <AgreementsTable rows={progressive} party={{ label: 'Company', name: () => COMPANY.name, email: () => COMPANY.email }} onOpen={onOpen} />;
}

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('shared Agreements table, as the customer sees it', () => {
  it('has the operator columns with the first two flipped: Company and Email', () => {
    const { container } = render(<Table onOpen={() => {}} />);
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Company', 'Email', 'Linked to', 'Reference', 'Sent', 'Status']);
    const first = container.querySelectorAll('tbody tr')[0];
    const cells = [...first.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells[0]).toBe('Northwind Rentals');
    expect(cells[1]).toBe('hariszahid720@gmail.com');
    expect(cells[2]).toBe('Rental');
    expect(cells[3]).toMatch(/^R-[0-9a-f]{6}$/);
    expect(cells[4]).toMatch(/^Sep 1[89], \d{1,2}:45 (AM|PM)$/);
  });

  it('colours status as the operator does: Signed green, Pending amber', () => {
    render(<Table onOpen={() => {}} />);
    const signed = screen.getAllByText('Signed');
    const pending = screen.getAllByText('Pending');
    expect(signed).toHaveLength(4);
    expect(pending).toHaveLength(1);
    expect(signed[0].className).toContain('text-emerald-600');
    expect(pending[0].className).toContain('text-amber-600');
  });

  it('opens the agreement from the row', () => {
    const onOpen = vi.fn();
    render(<Table onOpen={onOpen} />);
    fireEvent.click(screen.getByText('R-d34f08'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ rentalRef: 'R-d34f08' }));
  });
});

describe('shared agreement drawer, as the customer sees it', () => {
  const signed = rows.find((r) => r.rentalRef === 'R-936c59')!;
  const history = vi.fn(async () => ({
    events: [
      { at: '2026-09-19T03:45:54Z', type: 'created', label: 'Agreement created from the rental' },
      { at: '2026-09-19T03:45:55Z', type: 'sent', label: 'Sent for signature' },
      { at: '2026-09-19T03:46:00Z', type: 'downloaded', label: 'Downloaded by Northwind' },
      { at: '2026-09-20T03:45:54Z', type: 'completed', label: 'Completed, signed copy ready' },
    ],
    partial: false,
  }));

  const open = () =>
    wrap(
      <AgreementViewDialog
        row={signed}
        open
        onOpenChange={() => {}}
        loadDocument={async () => ({ kind: 'unavailable', reason: 'Not ready.' })}
        fetchHistory={history}
        party={COMPANY}
      />,
    );

  it('is "Rental agreement", with Details flipped to the company, and the operator buttons', async () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Rental agreement' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tab', { name: 'Activity' })).toBeInTheDocument();
    const terms = [...dialog.querySelectorAll('dt')].map((d) => d.textContent);
    expect(terms).toEqual(['Company', 'Email', 'Sent', 'Status', 'Linked to']);
    const values = [...dialog.querySelectorAll('dd')].map((d) => d.textContent);
    expect(values[0]).toBe('Northwind Rentals');
    expect(values[1]).toBe('hariszahid720@gmail.com');
    expect(values[3]).toBe('Signed');
    expect(values[4]).toBe('Rental · R-936c59');
    expect(within(dialog).getByRole('button', { name: /Download signed PDF/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/signature/i, { selector: 'button' })).toBeNull();
    expect(await within(dialog).findByText('Not ready.')).toBeInTheDocument();
  });

  it('shows the activity, every step oldest first, without the portal\'s own downloads', async () => {
    open();
    const dialog = screen.getByRole('dialog');
    const tab = within(dialog).getByRole('tab', { name: 'Activity' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await within(dialog).findByText('Every step, oldest first')).toBeInTheDocument();
    expect(await within(dialog).findByText('Completed, signed copy ready')).toBeInTheDocument();
    const labels = [...dialog.querySelectorAll('ol li p:first-child')].map((p) => p.textContent);
    expect(labels).toEqual(['Agreement created from the rental', 'Sent for signature', 'Completed, signed copy ready']);
    expect(within(dialog).getByRole('button', { name: 'Refresh activity' })).toBeInTheDocument();
    expect(history).toHaveBeenCalledWith(signed.id, 'rental');
  });
});

describe('the Agreements graph for the canary customer', () => {
  it('counts their agreements sent and signed over each range', () => {
    const today = new Date(2026, 9, 21);
    const [sent] = agreementMetrics(rows, { sentDescription: '' });
    if (sent.kind !== 'flow' || !sent.secondary) throw new Error('flow');
    const values: Record<string, { sent: number; signed: number; previous: number | null }> = {};
    for (const range of ['30d', '3m', '12m'] as const) {
      const main = flowSeries(sent.events, range, today, {});
      const second = flowSeries(sent.secondary.events, range, today, {});
      values[range] = { sent: main.currentTotal, signed: second.currentTotal, previous: main.hasPrevious ? main.previousTotal : null };
    }
    expect(values).toEqual({
      '30d': { sent: 0, signed: 0, previous: 5 },
      '3m': { sent: 5, signed: 4, previous: 0 },
      '12m': { sent: 5, signed: 4, previous: 0 },
    });
  });
});
