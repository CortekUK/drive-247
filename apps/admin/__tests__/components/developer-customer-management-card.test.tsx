/**
 * The rehearsal card on /admin/developer: nothing to press, nothing to type.
 *
 * The emails are sent by the cron job, so this card has no send button at all —
 * only Preview, which sends nothing. And test mode needs no address typed in:
 * it goes to Northwind's own email, looked up when the switch is turned on.
 * Both are asserted here, because a "Run" button creeping back is exactly the
 * manual step the module was rebuilt to remove.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  loadSteps: vi.fn(),
  runNow: vi.fn(),
  saveSettings: vi.fn(),
  setTestMode: vi.fn(),
  loadTestTargetEmail: vi.fn(),
  loadSends: vi.fn(),
  loadSubscriptionsFor: vi.fn(),
  setSimulatedRenewalDate: vi.fn(),
  simulateReceipt: vi.fn(),
}));

vi.mock('@/lib/customer-management/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-management/api')>();
  return { ...actual, ...api };
});

import { CustomerManagementCard } from '@/components/admin/developer/customer-management-card';
import { SETTINGS_DEFAULTS } from '@/lib/customer-management/catalog';
import { NotInstalledError } from '@/lib/customer-management/api';

const base = {
  id: 1,
  ...SETTINGS_DEFAULTS,
  test_mode: false,
  test_mode_started_at: null,
  test_run_id: null,
  test_recipient_email: 'owner@northwind.test',
  test_renewal_date: null,
  test_receipt_at: null,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
};

const step = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  automation: 'signup' as const,
  step_key: 'signup_day_7_checkin',
  label: 'Day 7 — Check-in',
  offset_days: 7,
  subject: 'A week in',
  body_html: '<p>Hi</p>',
  enabled: true,
  sort_order: 20,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.loadSteps.mockResolvedValue([step()]);
  api.loadTestTargetEmail.mockResolvedValue('owner@northwind.test');
  api.loadSends.mockResolvedValue([]);
  api.loadSubscriptionsFor.mockResolvedValue([]);
  api.runNow.mockResolvedValue({
    ok: true,
    dry_run: true,
    test_mode: false,
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    capped: false,
  });
});

afterEach(cleanup);

describe('nothing to press', () => {
  it('has no send button, only a preview', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_mode: false });
    render(<CustomerManagementCard />);
    await screen.findByText(/Customer Management rehearsal/i);

    expect(screen.queryByRole('button', { name: /run/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Preview$/i })[0]).toBeEnabled();
  });

  it('previews without sending', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_mode: false });
    render(<CustomerManagementCard />);
    await screen.findByText(/Customer Management rehearsal/i);

    fireEvent.click(screen.getAllByRole('button', { name: /^Preview$/i })[0]);
    await waitFor(() => expect(api.runNow).toHaveBeenCalled());
    expect(api.runNow.mock.calls[0][0]).toMatchObject({ dryRun: true });
  });
});

describe('nothing to type', () => {
  it("shows Northwind's email as the target before test mode is on", async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_recipient_email: null });
    render(<CustomerManagementCard />);
    expect(await screen.findByText('owner@northwind.test')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('switches on with no address entered, aimed at the scope tenant', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_recipient_email: null });
    api.setTestMode.mockResolvedValue({
      ...base,
      test_mode: true,
      test_mode_started_at: '2026-10-06T12:00:00Z',
      test_run_id: 'abc123',
    });
    render(<CustomerManagementCard />);
    await screen.findByText('owner@northwind.test');

    const toggle = screen.getByRole('switch', { name: /Developer test mode/i });
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setTestMode).toHaveBeenCalledWith(true, 'northwind'));
  });
});

describe('the card shows when each email will actually fire', () => {
  it('counts in real days when test mode is off', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_mode: false });
    render(<CustomerManagementCard />);
    expect(await screen.findByText('7d')).toBeInTheDocument();
  });

  it('counts in compressed time when it is on', async () => {
    // Day 7 is one of the specified anchors: 7 days -> 1 minute.
    api.loadSettings.mockResolvedValue({
      ...base,
      test_mode: true,
      test_mode_started_at: '2026-10-06T12:00:00Z',
      test_run_id: 'abc123',
    });
    render(<CustomerManagementCard />);
    expect(await screen.findByText('1 min')).toBeInTheDocument();
  });
});

describe('an unapplied migration', () => {
  it('says so instead of offering buttons that cannot work', async () => {
    api.loadSettings.mockRejectedValue(new NotInstalledError());
    api.loadSteps.mockRejectedValue(new NotInstalledError());
    render(<CustomerManagementCard />);
    await screen.findByText(/Not installed yet/i);
    expect(screen.queryByRole('button', { name: /Preview/i })).not.toBeInTheDocument();
  });
});
