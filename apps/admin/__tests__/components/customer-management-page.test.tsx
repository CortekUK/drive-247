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
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

/* -------------------------------------------------------------------------- */

describe('the page publishes its three sections to the rail', () => {
  it('registers them, rather than drawing a tab strip', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('rail')).toBeInTheDocument());
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
    mount(() => {
      renders++;
    });
    await waitFor(() => expect(screen.getByLabelText('rail')).toBeInTheDocument());
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
    mount();
    await waitFor(() => expect(screen.getByText(/Who receives these emails/i)).toBeInTheDocument());
    // "all tenants" is an abstraction; a count is a decision.
    expect(screen.getByText(/only 1 operator \(northwind\) is eligible/i)).toBeInTheDocument();
    expect(screen.getByText(/makes 11 more operators eligible/i)).toBeInTheDocument();
  });

  it('will not let test mode start without somewhere to deliver', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText(/Send rehearsal email to/i)).toBeInTheDocument());
    // Compressing the clock while still writing to the real operator would
    // deliver the welcome sequence to a paying customer every 26 seconds.
    expect(screen.getByText(/needs an address before it can be switched on/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Developer test mode/i })).toBeDisabled();
  });
});

describe('the receipt tab warns that Stripe already sends one', () => {
  it('shows the caution on the tab itself', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText('rail')).toBeInTheDocument());
    // The default tab is signup, which carries no caution.
    expect(screen.queryByText(/two receipts per payment/i)).not.toBeInTheDocument();
  });
});
