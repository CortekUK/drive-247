/**
 * The renewal reminder test on /admin/developer.
 *
 * It moves Northwind's PRETEND payment date, and the reminder is then sent by
 * the cron job under the real rules. Asserted here: the buttons set the date
 * the label promises, clearing it goes back to the real date, and the card
 * says what each of the three reminders will do.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
  loadSends: vi.fn(),
  loadSubscriptionsFor: vi.fn(),
  setSimulatedRenewalDate: vi.fn(),
}));

vi.mock('@/lib/customer-management/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-management/api')>();
  return { ...actual, ...api };
});

import { RenewalSimulator } from '@/components/admin/developer/renewal-simulator';
import { SETTINGS_DEFAULTS } from '@/lib/customer-management/catalog';

const DAY = 86_400_000;

const settings = {
  id: 1,
  ...SETTINGS_DEFAULTS,
  test_mode: false,
  test_mode_started_at: null,
  test_run_id: null,
  test_recipient_email: null,
  test_renewal_date: null as string | null,
  test_receipt_at: null,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
};

const renewalStep = (days: number) => ({
  id: `r${days}`,
  automation: 'renewal' as const,
  step_key: `renewal_${days}_day${days === 1 ? '' : 's'}_before`,
  label: `${days} days before payment`,
  offset_days: days,
  subject: '{{days_until_renewal_text}} left',
  body_html: 'Hi',
  enabled: true,
  sort_order: 40 - days * 10,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
});
const steps = [renewalStep(3), renewalStep(2), renewalStep(1)];

beforeEach(() => {
  vi.clearAllMocks();
  api.loadSends.mockResolvedValue([]);
  api.loadSubscriptionsFor.mockResolvedValue([]);
  api.setSimulatedRenewalDate.mockImplementation(async (date: Date | null) => ({
    ...settings,
    test_renewal_date: date ? date.toISOString() : null,
  }));
});

afterEach(cleanup);

describe('setting the pretend payment date', () => {
  it('"3 days from now" sets the date three days ahead', async () => {
    const onChange = vi.fn();
    render(<RenewalSimulator settings={settings} steps={steps} onChange={onChange} />);
    await waitFor(() => expect(api.loadSubscriptionsFor).toHaveBeenCalledWith('northwind'));

    const before = Date.now();
    fireEvent.click(screen.getByRole('button', { name: '3 days from now' }));
    await waitFor(() => expect(api.setSimulatedRenewalDate).toHaveBeenCalled());

    const date = api.setSimulatedRenewalDate.mock.calls[0][0] as Date;
    expect(date.getTime() - before).toBeGreaterThanOrEqual(3 * DAY - 1000);
    expect(date.getTime() - before).toBeLessThan(3 * DAY + 5000);
    expect(onChange).toHaveBeenCalled();
  });

  it('says there is no real payment date when Northwind has no subscription', async () => {
    render(<RenewalSimulator settings={settings} steps={steps} onChange={vi.fn()} />);
    expect(await screen.findByText(/none \(no subscription\)/i)).toBeInTheDocument();
  });

  it('stopping clears the date, back to the real one', async () => {
    const simulating = { ...settings, test_renewal_date: new Date(Date.now() + 3 * DAY).toISOString() };
    render(<RenewalSimulator settings={simulating} steps={steps} onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Stop simulating/i }));
    await waitFor(() => expect(api.setSimulatedRenewalDate).toHaveBeenCalledWith(null));
  });
});

describe('the card says what each reminder will do', () => {
  it('with the payment 3 days away, "3 days left" is due now and the others are later', async () => {
    const simulating = { ...settings, test_renewal_date: new Date(Date.now() + 3 * DAY - 1000).toISOString() };
    render(<RenewalSimulator settings={simulating} steps={steps} onChange={vi.fn()} />);

    expect(await screen.findByText('3 days left')).toBeInTheDocument();
    expect(screen.getByText('2 days left')).toBeInTheDocument();
    expect(screen.getByText('1 day left')).toBeInTheDocument();
    expect(screen.getAllByText(/due now/i)).toHaveLength(1);
    expect(screen.getAllByText(/^sends /i)).toHaveLength(2);
  });

  it('warns that test mode replaces the real-date test', async () => {
    render(
      <RenewalSimulator settings={{ ...settings, test_mode: true }} steps={steps} onChange={vi.fn()} />,
    );
    expect(await screen.findByText(/Switch test mode off to test with a real payment date/i)).toBeInTheDocument();
  });
});
