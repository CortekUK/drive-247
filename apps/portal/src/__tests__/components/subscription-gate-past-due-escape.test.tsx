/**
 * The `past_due` paywall must not be a dead end while the PLANS query is still
 * in flight.
 *
 * `SubscriptionGateDialog` short-circuits its whole body to a spinner whenever
 * `useSubscriptionPlans().isLoading` — and the Sign out escape is rendered under
 * the same `!plansLoading` condition. That is right for the two variants that
 * SELL something (`setup`, `expired`: they render PricingCards built from the
 * plans). It is wrong for `past_due`, which never reads `plans` at all: that
 * variant's whole job is to hand an existing customer the hosted invoice link.
 *
 * So for as long as the plans request is unresolved — and it is one request with
 * `retry: 1`, so a slow or failing network makes that window seconds, not
 * milliseconds — a tenant who is hard-blocked sees a non-dismissible modal
 * (no Esc, no outside click, no close button) containing a spinner, no way to
 * pay, and no way to sign out.
 *
 * Found by simulating the real lifecycle: renewal declines → 7-day grace →
 * hard block. See scratchpad/ann/subsim.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SubscriptionGateDialog } from '@/components/subscription/subscription-gate-dialog';

const INVOICE_URL = 'https://invoice.stripe.com/i/acct_test/test_in_gatepastdue';

/** Flipped per test: the plans query in flight vs settled. */
let plansLoading = true;

vi.mock('@/hooks/use-subscription-plans', () => ({
  useSubscriptionPlans: () => ({
    data: plansLoading ? undefined : [],
    isLoading: plansLoading,
    isSuccess: !plansLoading,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-tenant-subscription', () => ({
  useTenantSubscription: () => ({
    createCheckoutSession: { mutateAsync: vi.fn(), isPending: false },
    outstandingInvoiceUrl: INVOICE_URL,
  }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1', slug: 'zz-subsim' } }),
}));

const signOut = vi.fn();
vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ signOut }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

/** Radix portals to document.body, so assertions read the whole document. */
const text = () => document.body.textContent ?? '';
const links = () => Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
const buttonLabels = () =>
  Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

describe('SubscriptionGateDialog — past_due while the plans query is in flight', () => {
  it('still offers the invoice link and the sign-out escape', async () => {
    plansLoading = true;
    await act(async () => {
      root.render(<SubscriptionGateDialog open variant="past_due" />);
    });

    // The point of the variant: pay the invoice you already owe.
    expect(links()).toContain(INVOICE_URL);
    expect(text()).toContain('Your subscription has expired');
    // The only way out of a modal that refuses Esc, outside-click and a close button.
    expect(buttonLabels()).toContain('Sign out');
  });

  it('is unchanged once the plans query settles', async () => {
    plansLoading = false;
    await act(async () => {
      root.render(<SubscriptionGateDialog open variant="past_due" />);
    });

    expect(links()).toContain(INVOICE_URL);
    expect(buttonLabels()).toContain('Sign out');
  });

  it('keeps the spinner for the variants that actually need plans', async () => {
    plansLoading = true;
    await act(async () => {
      root.render(<SubscriptionGateDialog open variant="setup" />);
    });

    // `setup` renders PricingCards from `plans`, so waiting is correct there.
    expect(text()).toContain('Loading plans');
    expect(links()).not.toContain(INVOICE_URL);
  });
});
