/**
 * One engine per rental, on the rental's Payments stage: "Set up a plan" is
 * DISABLED — with the server's own sentence beside it — while the rental is
 * still on auto-extend, an open pay-as-you-go or a live installment plan. The
 * database refuses the plan anyway (migration 20260925120200); this is the
 * operator being told before they fill in a form.
 *
 * Pinned by behaviour (disabled / enabled, the dialog opening, the mechanism
 * named in `data-plan-setup-blocked`) and against the exported sentences —
 * never by literal copy.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_MECHANISM_REASON } from '@/lib/payment-plans/errors';
import { legacyMechanismForRental } from '@/lib/payment-plans-ui/legacy-mechanism';

const h = vi.hoisted(() => ({
  plan: null as any,
  installment: { data: undefined as boolean | undefined, isLoading: false },
  installmentCalls: [] as [string, boolean][],
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1', slug: 'northwind', timezone: 'America/New_York', currency_code: 'USD' } }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({ useManagerPermissions: () => ({ canEdit: () => true }) }));
vi.mock('@/hooks/use-payment-plan', () => ({
  usePaymentPlansFeature: () => ({ enabled: true, isLoading: false }),
  usePaymentPlan: () => ({ data: h.plan, isLoading: false, error: null, refetch: vi.fn() }),
  usePaymentPlanAccounts: () => null,
  usePaymentPlanActions: () => ({ create: vi.fn(), refresh: vi.fn() }),
  readPreview: () => ({ owedCents: null }),
  useLiveInstallmentPlan: (rentalId: string, enabled: boolean) => {
    h.installmentCalls.push([rentalId, enabled]);
    return enabled ? h.installment : { data: undefined, isLoading: false };
  },
}));
vi.mock('@/components/payment-plans/payment-plan-dialogs', () => ({
  SetUpPlanDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="setup-dialog" /> : null),
  EditPlanDialog: () => null,
}));
vi.mock('@/components/payment-plans/payment-plan-card', () => ({ PaymentPlanCard: () => <div data-testid="plan-card" /> }));

import { RentalPaymentPlanSection } from '@/components/payment-plans/rental-payment-plan';

const renderSection = (rental: Record<string, unknown> | null) =>
  render(<RentalPaymentPlanSection rentalId="rental-1" rentalStart="2026-10-02" rentalEnd="2026-10-30" balanceCents={60000} rental={rental} />);

const button = (c: HTMLElement) => c.querySelector('[data-plan-setup-button]') as HTMLButtonElement;
const blocked = (c: HTMLElement) => c.querySelector('[data-plan-setup-blocked]') as HTMLElement | null;

beforeEach(() => {
  h.plan = null;
  h.installment = { data: false, isLoading: false };
  h.installmentCalls = [];
});

describe('"Set up a plan" on a rental still on an old mechanism', () => {
  it('control: no old mechanism — the button works and says nothing extra', () => {
    const { container } = renderSection({ auto_extend_enabled: false, is_pay_as_you_go: false, payg_closed_at: null });
    expect(button(container).disabled).toBe(false);
    expect(blocked(container)).toBeNull();
    fireEvent.click(button(container));
    expect(screen.getByTestId('setup-dialog')).toBeInTheDocument();
  });

  it.each([
    ['auto-extend on', { auto_extend_enabled: true }, 'auto_extend', false],
    ['an open pay-as-you-go', { is_pay_as_you_go: true, payg_closed_at: null }, 'payg', false],
    ['a live installment plan', {}, 'installment', true],
  ] as const)('%s → disabled, with the server\'s sentence, and the dialog cannot open', (_label, rental, mechanism, liveInstallment) => {
    h.installment = { data: liveInstallment, isLoading: false };
    const { container } = renderSection(rental);
    const b = button(container);
    expect(b.disabled).toBe(true);
    const reason = blocked(container)!;
    expect(reason.getAttribute('data-plan-setup-blocked')).toBe(mechanism);
    expect(reason.textContent).toBe(LEGACY_MECHANISM_REASON[mechanism]);
    expect(b.getAttribute('aria-describedby')).toBe(reason.id);
    fireEvent.click(b);
    expect(screen.queryByTestId('setup-dialog')).toBeNull();
  });

  it('a CLOSED pay-as-you-go does not block', () => {
    const { container } = renderSection({ is_pay_as_you_go: true, payg_closed_at: '2026-09-20T10:00:00Z' });
    expect(button(container).disabled).toBe(false);
    expect(blocked(container)).toBeNull();
  });

  it('while the installment check is still reading, the button waits (no reason shown); a failed read leaves it on', () => {
    h.installment = { data: undefined, isLoading: true };
    const reading = renderSection({});
    expect(button(reading.container).disabled).toBe(true);
    expect(blocked(reading.container)).toBeNull();
    reading.unmount();

    h.installment = { data: undefined, isLoading: false }; // the query errored: unknown, the server still guards
    const failed = renderSection({});
    expect(button(failed.container).disabled).toBe(false);
  });

  it('asks about installment plans only while a plan could be set up', () => {
    renderSection({});
    expect(h.installmentCalls.at(-1)).toEqual(['rental-1', true]);
    h.installmentCalls = [];
    h.plan = { plan: { id: 'p1', status: 'active', timezone: 'America/New_York', version: 1 }, occurrences: [], attempts: [], events: [], history: [] };
    const { container } = renderSection({ auto_extend_enabled: false });
    expect(h.installmentCalls.every(([, enabled]) => enabled === false)).toBe(true);
    expect(button(container)).toBeNull();
  });
});

describe('legacyMechanismForRental — the SQL rule, in the same order', () => {
  it('auto-extend, then open PAYG, then a live installment plan; nothing otherwise', () => {
    expect(legacyMechanismForRental({ auto_extend_enabled: true, is_pay_as_you_go: true }, true)).toBe('auto_extend');
    expect(legacyMechanismForRental({ is_pay_as_you_go: true, payg_closed_at: null }, true)).toBe('payg');
    expect(legacyMechanismForRental({ is_pay_as_you_go: true, payg_closed_at: '2026-09-20T10:00:00Z' }, true)).toBe('installment');
    expect(legacyMechanismForRental({ is_pay_as_you_go: true, payg_closed_at: '2026-09-20T10:00:00Z' }, false)).toBeNull();
    expect(legacyMechanismForRental(null, false)).toBeNull();
  });
});
