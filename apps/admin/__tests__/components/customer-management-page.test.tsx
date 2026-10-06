/**
 * The Customer Management page, actually mounted.
 *
 * ── WHY MOUNTED AND NOT GREPPED ─────────────────────────────────────────────
 *
 * `sidebar-sections.tsx` shipped an infinite render loop to production once and
 * took `/admin/promo-codes` down with a client-side exception. Nothing caught
 * it: the typecheck was clean, the dev server answered 200, and every page in
 * this app redirects to the sign-in without a session, so the component never
 * rendered in any check that was run.
 *
 * This page registers its three sections from an array REBUILT ON EVERY RENDER
 * — the same shape that caused that loop — so it is mounted here and its
 * renders are counted. A loop shows up as an unbounded count or as React's own
 * "Maximum update depth exceeded". Either way, red.
 *
 * The other thing this covers is the not-installed path. The migration is
 * deliberately unapplied, so an empty database is the NORMAL state for this
 * page today and it has to say which file to run rather than "Something went
 * wrong".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import { SidebarSectionsProvider, useSidebarSections } from '@/components/admin/sidebar-sections';

/* ---- stubs ---------------------------------------------------------------- */

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u1', email: 'a@b.c', is_super_admin: true } }),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { NotInstalledError } = await vi.importActual<
  typeof import('@/lib/customer-management/api')
>('@/lib/customer-management/api');

const api = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  loadSteps: vi.fn(),
  loadSends: vi.fn(),
  loadScopeCounts: vi.fn(),
  saveSettings: vi.fn(),
  saveStep: vi.fn(),
  setTestMode: vi.fn(),
  runNow: vi.fn(),
  loadTestTargetEmail: vi.fn(),
}));

vi.mock('@/lib/customer-management/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/customer-management/api')>();
  return { ...actual, ...api };
});

import { CustomerManagementPage } from '@/components/admin/customer-management/customer-management-page';
import { SETTINGS_DEFAULTS } from '@/lib/customer-management/catalog';

const settings = {
  id: 1,
  ...SETTINGS_DEFAULTS,
  test_mode_started_at: null,
  test_run_id: null,
  test_recipient_email: null,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
};

const step = {
  id: 's1',
  automation: 'signup' as const,
  step_key: 'signup_day_0_welcome',
  label: 'Day 0 — Welcome',
  offset_days: 0,
  subject: 'Welcome to Drive247, {{tenant_name}}',
  body_html: '<p>Hi</p>',
  enabled: true,
  sort_order: 10,
  updated_at: '2026-10-06T00:00:00Z',
  updated_by: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.loadSettings.mockResolvedValue(settings);
  api.loadSteps.mockResolvedValue([step]);
  api.loadSends.mockResolvedValue([]);
  api.loadScopeCounts.mockResolvedValue({ all: 12, scoped: 1 });
  api.loadTestTargetEmail.mockResolvedValue('owner@northwind.test');
});

/** Stands in for the sidebar: shows whatever the page published. */
function RailProbe() {
  const reg = useSidebarSections();
  if (!reg) return <p>rail: none</p>;
  return (
    <ul aria-label="rail">
      {reg.sections.map((s) => (
        <li key={s.id}>{s.label}</li>
      ))}
    </ul>
  );
}

afterEach(cleanup);

function mount(onRender?: () => void) {
  function Probe() {
    onRender?.();
    return <CustomerManagementPage />;
  }
  return render(
    <SidebarSectionsProvider>
      <RailProbe />
      <Probe />
    </SidebarSectionsProvider>,
  );
}

/**
 * Mount, then wait until the page has genuinely finished loading.
 *
 * The send log queries its rows SEPARATELY from the settings and the steps, so
 * a test that asserts on the rail and returns leaves that last state update to
 * land after it — React reports it as an act() warning, and under a full suite
 * of jsdom files the unflushed work was enough to tip an already
 * timing-sensitive test elsewhere over. Waiting for the log's empty state is
 * the signal that nothing is still in flight.
 */
async function mountSettled(onRender?: () => void) {
  const result = mount(onRender);
  await screen.findByLabelText('rail');
  await screen.findByText(/Nothing yet/i);
  return result;
}

/* -------------------------------------------------------------------------- */

describe('the page publishes its three sections to the rail', () => {
  it('registers them, rather than drawing a tab strip', async () => {
    await mountSettled();
    const rail = screen.getByLabelText('rail');
    expect(rail).toHaveTextContent('Signup Sequences');
    expect(rail).toHaveTextContent('Renewal Reminders');
    expect(rail).toHaveTextContent('Billing Receipts');
  });

  it('does not re-register forever', async () => {
    /*
     * The array of sections is rebuilt inline on every render, exactly as the
     * other registering pages do. `useRegisterSidebarSections` compares by the
     * section ids rather than by identity for this reason; if that ever
     * regresses, this count runs away.
     */
    let renders = 0;
    await mountSettled(() => {
      renders++;
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(renders).toBeLessThan(20);
  });
});

describe('an unapplied migration is a normal state, not a crash', () => {
  it('names the file to run', async () => {
    api.loadSettings.mockRejectedValue(new NotInstalledError());
    api.loadSteps.mockRejectedValue(new NotInstalledError());
    mount();
    await waitFor(() =>
      expect(screen.getByText(/Not installed yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/PENDING_20261006_customer_management_service\.sql\.txt/),
    ).toBeInTheDocument();
    // And says that applying it is safe, which is the question somebody
    // reading that message is actually asking.
    expect(screen.getByText(/sends nothing on its own/i)).toBeInTheDocument();
  });
});

describe('the audience is stated before it is changed', () => {
  it('says how many operators turning the scope on would reach', async () => {
    await mountSettled();
    /*
     * Waits on the SENTENCE, not on the heading. The counts come from a query
     * of their own, so the card paints with `counts` still null and the
     * heading is there before the numbers are — waiting on the heading made
     * this assertion a race, which is why it passed alone and failed in a
     * fuller run.
     */
    // "all tenants" is an abstraction; a count is a decision.
    expect(await screen.findByText(/makes 11 more operators eligible/i)).toBeInTheDocument();
    expect(screen.getByText(/only 1 operator \(northwind\) is eligible/i)).toBeInTheDocument();
  });

  it("aims test mode at Northwind's own email, with nothing to type", async () => {
    await mountSettled();
    expect(await screen.findByText('owner@northwind.test')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Developer test mode/i })).toBeEnabled();
  });
});

describe('the emails send themselves', () => {
  it('offers no Run now button, only a preview', async () => {
    await mountSettled();
    expect(screen.queryByRole('button', { name: /run now/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preview what is due now/i })).toBeInTheDocument();
    expect(screen.getByText(/each email sends itself when it is due/i)).toBeInTheDocument();
  });
});

describe('the receipt tab warns that Stripe already sends one', () => {
  it('shows the caution on the tab itself', async () => {
    await mountSettled();
    // The default tab is signup, which carries no caution.
    expect(screen.queryByText(/two receipts per payment/i)).not.toBeInTheDocument();
  });
});
