/**
 * D-8 (the "defect 4" restyle) — the paywall was v1 chrome on a v2 portal.
 *
 * `SubscriptionGateDialog` builds on `@/components/ui/dialog`, whose content is
 * `z-[100] border bg-background shadow-lg sm:rounded-lg`, while `ui-v2/dialog`
 * is `rounded-4xl bg-popover ring-1 ring-foreground/5 shadow-xl`. The v2 feature
 * dialog already uses the v2 primitive, so on a `portal_experience = 'v2'`
 * tenant THE MOST IMPORTANT MODAL IN THE PRODUCT rendered with square-ish
 * corners, a hard border and the v1 shadow, right next to v2 dialogs that did
 * not. Seen in the simulation screenshots at 1280 and 360, light and dark
 * (scratchpad/ann/subsim/harness/shots-chrome).
 *
 * It is a RESTYLE, not a swap of primitive. `system-announcement-dialog.tsx`
 * documents staying on the v1 primitive deliberately — that is what shares
 * `z-[100]` with the gates so a notice can never paint under one — and the same
 * argument applies here with more force: this dialog IS the gate. So the v1
 * Radix primitive and its `z-[100]` stay, and only the surface tokens move.
 *
 * Gated on the `theme` v2 area, for two reasons: `--v2-radius-4xl` is defined
 * only inside the `.v2-theme` block (a non-v2 caller would get Tailwind v4's
 * 2rem fallback, which is neither design), and the other 56 tenants' markup must
 * come out byte-for-byte what it is today.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SubscriptionGateDialog } from '@/components/subscription/subscription-gate-dialog';
import { V2Provider } from '@/lib/v2-context';

vi.mock('@/hooks/use-subscription-plans', () => ({
  useSubscriptionPlans: () => ({ data: [], isLoading: false, isSuccess: true, isError: false }),
}));

vi.mock('@/hooks/use-tenant-subscription', () => ({
  useTenantSubscription: () => ({
    createCheckoutSession: { mutateAsync: vi.fn(), isPending: false },
    outstandingInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/test_in_style',
  }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1', slug: 'northwind' } }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
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

/** Radix portals to document.body. */
const dialogClasses = () =>
  (document.querySelector('[role="dialog"]')?.className ?? '').split(/\s+/);

const paint = async (node: React.ReactElement) => {
  await act(async () => {
    root.render(node);
  });
};

/* The v2 surface tokens, taken from `ui-v2/dialog.tsx`'s DialogContent. */
const V2_TOKENS = [
  'rounded-4xl',
  // `sm:rounded-lg` sits in the v1 base class and lands inside a media query,
  // so it beats a base-layer `rounded-4xl` from 640px up on its own. The
  // responsive twin is what actually makes the corner round on a desktop.
  'sm:rounded-4xl',
  'bg-popover',
  'text-popover-foreground',
  'shadow-xl',
  'ring-1',
  'ring-foreground/5',
  'dark:ring-foreground/10',
  // tailwind-merge resolves border-width against the base `border`.
  'border-0',
];

describe('the paywall on a v2 tenant', () => {
  it.each(['setup', 'expired', 'past_due'] as const)(
    'wears the v2 surface tokens (%s)',
    async (variant) => {
      await paint(
        <V2Provider flags={{ theme: true }}>
          <SubscriptionGateDialog open variant={variant} />
        </V2Provider>,
      );
      const classes = dialogClasses();
      expect(classes.length).toBeGreaterThan(0);
      for (const token of V2_TOKENS) expect(classes).toContain(token);
    },
  );

  it('keeps the v1 primitive and its z-[100], so nothing can paint over the gate', async () => {
    await paint(
      <V2Provider flags={{ theme: true }}>
        <SubscriptionGateDialog open variant="past_due" />
      </V2Provider>,
    );
    // z-50 is the v2 primitive's stacking level; a notice dialog at z-[100]
    // would then paint OVER the paywall.
    expect(dialogClasses()).toContain('z-[100]');
    expect(dialogClasses()).not.toContain('z-50');
  });

  it('still hides the close button and keeps the scroll cap', async () => {
    await paint(
      <V2Provider flags={{ theme: true }}>
        <SubscriptionGateDialog open variant="past_due" />
      </V2Provider>,
    );
    const classes = dialogClasses();
    expect(classes).toContain('[&>button:last-child]:hidden');
    expect(classes).toContain('max-h-[90vh]');
    expect(classes).toContain('overflow-y-auto');
  });
});

describe('the paywall on a v1 tenant is untouched', () => {
  it.each(['setup', 'expired', 'past_due'] as const)(
    'carries none of the v2 tokens (%s)',
    async (variant) => {
      // No provider at all: useV2 falls back to v1 for every area, which is
      // what the other 56 tenants get.
      await paint(<SubscriptionGateDialog open variant={variant} />);
      const classes = dialogClasses();
      expect(classes.length).toBeGreaterThan(0);
      for (const token of V2_TOKENS) expect(classes).not.toContain(token);
      // The v1 surface, exactly as it is today.
      expect(classes).toContain('bg-background');
      expect(classes).toContain('shadow-lg');
      expect(classes).toContain('border');
      expect(classes).toContain('sm:rounded-lg');
    },
  );

  it('is v1 when the theme area is explicitly off', async () => {
    await paint(
      <V2Provider flags={{ theme: false, chrome: true }}>
        <SubscriptionGateDialog open variant="past_due" />
      </V2Provider>,
    );
    expect(dialogClasses()).not.toContain('rounded-4xl');
    expect(dialogClasses()).toContain('bg-background');
  });
});
