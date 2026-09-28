/**
 * SOFT SUBSCRIPTION BLOCK — the debtor who cannot pay because we took away the
 * thing they earn with.
 *
 * The hard gate (`SubscriptionGateDialog`) covers the whole product with no Esc,
 * no outside-click and no close button until an invoice is settled. That is the
 * right answer for a tenant who is simply not paying, and the wrong one for a
 * tenant whose ABILITY to pay is what broke — Avery's Rentals, whose Stripe
 * account Stripe itself rejected, could neither take money in nor pay the $250,
 * and the hard gate then removed the only system she could have earned it back
 * with.
 *
 * Soft mode is the other posture: keep the debt loud, keep the door open. What
 * is pinned here is the decision logic, because every failure mode is a wrong
 * answer to "is this tenant blocked":
 *
 *   - the toggle alone must never show a reminder to a tenant who owes nothing
 *   - a tenant who owes money with the toggle OFF must stay on the hard gate
 *   - nothing may render before the billing queries have actually resolved
 *     (`undefined` reads as "no subscription" for the instant before they land)
 *   - a dismissal must last 24h, and must expire after it
 *   - the persistent bar must NOT follow the dialog into hiding
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  useSoftSubscriptionBlock,
  softBlockDismissKey,
  SOFT_BLOCK_DISMISS_WINDOW_MS,
} from '@/hooks/use-soft-subscription-block';

const TENANT_ID = 'tenant-soft-block-test';

let tenantRow: Record<string, unknown> | null = null;
let billing: Record<string, unknown> = {};

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: tenantRow }),
}));

vi.mock('@/hooks/use-tenant-subscription', () => ({
  useTenantSubscription: () => billing,
}));

/** Owes money, queries have answered. */
const OWING = {
  hasExpiredSubscription: true,
  owesOutstandingInvoice: true,
  outstandingInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/soft',
  isResolved: true,
};

const HEALTHY = {
  hasExpiredSubscription: false,
  owesOutstandingInvoice: false,
  outstandingInvoiceUrl: null,
  isResolved: true,
};

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSoftSubscriptionBlock>;

function Probe() {
  latest = useSoftSubscriptionBlock();
  return null;
}

function render() {
  act(() => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  tenantRow = { id: TENANT_ID, subscription_gate_disabled: true };
  billing = { ...OWING };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useSoftSubscriptionBlock', () => {
  it('is active and visible for a soft-mode tenant who owes money', () => {
    render();
    expect(latest.active).toBe(true);
    expect(latest.reminderVisible).toBe(true);
    expect(latest.invoiceUrl).toBe(OWING.outstandingInvoiceUrl);
  });

  it('stays inert for a debtor whose toggle is OFF — they get the hard gate', () => {
    tenantRow = { id: TENANT_ID, subscription_gate_disabled: false };
    render();
    expect(latest.active).toBe(false);
    expect(latest.reminderVisible).toBe(false);
  });

  it('stays inert for a healthy tenant even with the toggle ON', () => {
    billing = { ...HEALTHY };
    render();
    expect(latest.active).toBe(false);
    expect(latest.reminderVisible).toBe(false);
  });

  it('shows nothing until the billing queries have resolved', () => {
    billing = { ...OWING, isResolved: false };
    render();
    expect(latest.active).toBe(false);
  });

  it('treats a null tenant (SSR / no provider) as not soft-blocked', () => {
    tenantRow = null;
    render();
    expect(latest.active).toBe(false);
  });

  it('hides the dialog once dismissed, and remembers it', () => {
    render();
    expect(latest.reminderVisible).toBe(true);

    act(() => latest.dismiss());

    expect(latest.reminderVisible).toBe(false);
    // Still ACTIVE — the bar and the sidebar chip key off this, and they must
    // not vanish with the dialog.
    expect(latest.active).toBe(true);
    expect(window.localStorage.getItem(softBlockDismissKey(TENANT_ID))).toBeTruthy();
  });

  it('keeps the dialog hidden on a fresh mount inside the 24h window', () => {
    window.localStorage.setItem(
      softBlockDismissKey(TENANT_ID),
      String(Date.now() - 60_000),
    );
    render();
    expect(latest.reminderVisible).toBe(false);
    expect(latest.active).toBe(true);
  });

  it('shows the dialog again once the window has passed', () => {
    window.localStorage.setItem(
      softBlockDismissKey(TENANT_ID),
      String(Date.now() - SOFT_BLOCK_DISMISS_WINDOW_MS - 1_000),
    );
    render();
    expect(latest.reminderVisible).toBe(true);
  });

  it('ignores a corrupt stored value rather than throwing', () => {
    window.localStorage.setItem(softBlockDismissKey(TENANT_ID), 'not-a-number');
    render();
    expect(latest.reminderVisible).toBe(true);
  });

  it('scopes the dismissal to the tenant', () => {
    window.localStorage.setItem(
      softBlockDismissKey('some-other-tenant'),
      String(Date.now()),
    );
    render();
    expect(latest.reminderVisible).toBe(true);
  });
});

/* ── wiring ────────────────────────────────────────────────────────────────
   The hook is only useful if the three surfaces actually read it. These are
   source assertions rather than renders because the two sidebars are ~2000-line
   components whose chrome is irrelevant to the question being asked. */
const read = (p: string) =>
  readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('soft block wiring', () => {
  it('the dashboard layout mounts the reminder', () => {
    const src = read('app/(dashboard)/layout.tsx');
    expect(src).toContain('<SubscriptionSoftReminder />');
    expect(src).toContain('subscription-soft-reminder');
  });

  it('the payment-due bar shows for a soft block, not just during grace', () => {
    const src = read('components/subscription/payment-due-bar.tsx');
    expect(src).toContain('useSoftSubscriptionBlock');
    expect(src).toMatch(/const paymentDue =[^;]*softBlock/);
  });

  it('both sidebar chips show for a soft block', () => {
    for (const p of [
      'components/shared/layout/app-sidebar-v2.tsx',
      'components/shared/layout/app-sidebar.tsx',
    ]) {
      const src = read(p);
      expect(src, p).toContain('useSoftSubscriptionBlock');
      expect(src, p).toMatch(/const paymentDue =[^;]*softBlock/);
    }
  });

  it('the hard gate is still suppressed by the same per-tenant flag', () => {
    // Soft mode replaces the hard modal; it must never stack on top of it.
    const src = read('app/(dashboard)/layout.tsx');
    expect(src).toMatch(
      /gateSuppressed\s*=\s*\n?\s*subscriptionGateDisabled \|\| tenant\?\.subscription_gate_disabled === true/,
    );
  });
});
