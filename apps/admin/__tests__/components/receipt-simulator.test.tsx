/**
 * The billing receipt test on /admin/developer: one button records a pretend
 * payment for Northwind, and the card then reports the receipt the cron job
 * sent for it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
  loadSends: vi.fn(),
  simulateReceipt: vi.fn(),
}));

vi.mock('@/lib/customer-management/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-management/api')>();
  return { ...actual, ...api };
});

import { ReceiptSimulator } from '@/components/admin/developer/receipt-simulator';
import { SETTINGS_DEFAULTS } from '@/lib/customer-management/catalog';

const settings = {
  id: 1,
  ...SETTINGS_DEFAULTS,
  test_mode: false,
  test_mode_started_at: null,
  test_run_id: null,
  test_recipient_email: null,
  test_renewal_date: null,
  test_receipt_at: null as string | null,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.loadSends.mockResolvedValue([]);
});

afterEach(cleanup);

describe('simulating a paid payment', () => {
  it('records a pretend payment when pressed', async () => {
    const paidAt = new Date().toISOString();
    api.simulateReceipt.mockResolvedValue({ ...settings, test_receipt_at: paidAt });
    const onChange = vi.fn();
    render(<ReceiptSimulator settings={settings} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Simulate a paid payment/i }));
    await waitFor(() => expect(api.simulateReceipt).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ test_receipt_at: paidAt }));
  });

  it('reports the receipt once the cron job has sent it', async () => {
    const paidAt = new Date('2026-10-06T16:00:00Z');
    const stamp = Math.floor(paidAt.getTime() / 60_000);
    api.loadSends.mockResolvedValue([
      {
        id: 'x',
        tenant_id: 't',
        automation: 'receipt',
        step_key: 'receipt_payment_succeeded',
        cycle_key: `test:sim:sim-${stamp}`,
        due_at: paidAt.toISOString(),
        sent_at: paidAt.toISOString(),
        status: 'sent',
        to_email: 'owner@northwind.test',
        subject: `Payment received — receipt TEST-${stamp}`,
        detail: null,
        test_mode: true,
        created_at: paidAt.toISOString(),
        tenant_name: 'Northwind Rentals',
        tenant_slug: 'northwind',
      },
    ]);
    render(
      <ReceiptSimulator settings={{ ...settings, test_receipt_at: paidAt.toISOString() }} onChange={vi.fn()} />,
    );
    expect(await screen.findByText(/Receipt sent → owner@northwind.test/i)).toBeInTheDocument();
  });

  it('warns when receipts are switched off', () => {
    render(<ReceiptSimulator settings={{ ...settings, receipt_enabled: false }} onChange={vi.fn()} />);
    expect(screen.getByText(/Billing Receipts are switched off/i)).toBeInTheDocument();
  });
});
