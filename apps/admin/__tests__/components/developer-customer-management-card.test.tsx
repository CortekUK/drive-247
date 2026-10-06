/**
 * The rehearsal card on /admin/developer cannot email a real operator.
 *
 * That page's header promises "nothing here affects any other tenant", and this
 * card is the one thing on it wired to a sender. The promise is kept
 * structurally rather than by wording: **Run rehearsal is enabled only while
 * test mode is on**, and test mode redirects every recipient to the rehearsal
 * address.
 *
 * It matters because the audience lives on the OTHER page. `scope_all_tenants`
 * may well be on by the time somebody opens this one, and then an always-live
 * Run button would mail the entire platform from a screen that told them it
 * could not. So the disabled state is a safety control, not a nicety, and it is
 * asserted here.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  loadSteps: vi.fn(),
  runNow: vi.fn(),
  saveSettings: vi.fn(),
  setTestMode: vi.fn(),
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
  test_recipient_email: 'dev@drive-247.com',
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

/**
 * The first automation's button (Signup Sequences). There is one per
 * automation, and the gate under test is the same on all three — asserting on
 * one keeps the test about the gate rather than about the catalogue's length.
 */
const rehearse = () => screen.getAllByRole('button', { name: /Run rehearsal/i })[0];

describe('the live sender is locked behind test mode', () => {
  it('is disabled while test mode is off', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_mode: false });
    render(<CustomerManagementCard />);
    await screen.findByText(/Customer Management rehearsal/i);

    expect(rehearse()).toBeDisabled();
    // ...and says why, rather than looking broken.
    expect(rehearse()).toHaveAttribute('title', expect.stringMatching(/test mode on first/i));
  });

  it('is enabled once test mode is on, and names where it will go', async () => {
    api.loadSettings.mockResolvedValue({
      ...base,
      test_mode: true,
      test_mode_started_at: '2026-10-06T12:00:00Z',
      test_run_id: 'abc123',
    });
    render(<CustomerManagementCard />);
    await screen.findByText(/Customer Management rehearsal/i);

    expect(rehearse()).toBeEnabled();
    expect(rehearse()).toHaveAttribute('title', expect.stringContaining('dev@drive-247.com'));
  });

  it('leaves the dry run available either way, because it sends nothing', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_mode: false });
    render(<CustomerManagementCard />);
    await screen.findByText(/Customer Management rehearsal/i);

    expect(screen.getAllByRole('button', { name: /^Preview$/i })[0]).toBeEnabled();
  });
});

describe('the card shows when each email will actually fire', () => {
  it('counts in real days when test mode is off', async () => {
    api.loadSettings.mockResolvedValue({ ...base, test_mode: false });
    render(<CustomerManagementCard />);
    expect(await screen.findByText('7d')).toBeInTheDocument();
  });

  it('counts in compressed time when it is on', async () => {
    // Day 7 is one of the two specified anchors: 7 days -> 1 minute.
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
    expect(screen.queryByRole('button', { name: /Run rehearsal/i })).not.toBeInTheDocument();
  });
});
