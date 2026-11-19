/**
 * SubscriptionActivatedDialog on a v2 first run.
 *
 * A new v2 signup lands in the full-screen first-run wizard. The "subscription
 * is active" dialog used to open as billing loaded and then vanish behind the
 * wizard: a screen flashing up and disappearing on first login. On v2 it now
 * waits while the wizard is deciding and is marked seen, unshown, when the
 * wizard takes the screen. v1 keeps the old behaviour.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { SubscriptionActivatedDialog } from '@/components/subscription/subscription-activated-dialog';

const SUB_ID = 'sub_test_123';
let onV2 = true;
let wizard = { shouldShow: false, isLoading: false };

vi.mock('@/hooks/use-tenant-subscription', () => ({
  useTenantSubscription: () => ({
    isResolved: true,
    isSubscribed: true,
    subscription: {
      stripe_subscription_id: SUB_ID,
      created_at: new Date().toISOString(),
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      amount: 9900,
      currency: 'usd',
      plan_name: 'Pro',
      status: 'trialing',
    },
  }),
}));
vi.mock('@/hooks/use-first-run-wizard', () => ({ useFirstRunWizard: () => wizard }));
vi.mock('@/lib/v2-context', () => ({ usePortalOnV2: () => onV2 }));

const ACK = `d247.subActivated.${SUB_ID}`;
const dialogShown = () => screen.queryByRole('dialog') !== null;

beforeEach(() => {
  onV2 = true;
  wizard = { shouldShow: false, isLoading: false };
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe('SubscriptionActivatedDialog on a v2 first run', () => {
  it('waits while the wizard is still deciding', () => {
    wizard = { shouldShow: false, isLoading: true };
    render(<SubscriptionActivatedDialog />);
    expect(dialogShown()).toBe(false);
    expect(window.localStorage.getItem(ACK)).toBeNull();
  });

  it('never opens under the wizard, and records itself as seen', () => {
    wizard = { shouldShow: true, isLoading: false };
    render(<SubscriptionActivatedDialog />);
    expect(dialogShown()).toBe(false);
    expect(window.localStorage.getItem(ACK)).not.toBeNull();
  });

  it('still opens on v2 when there is no wizard to show', () => {
    render(<SubscriptionActivatedDialog />);
    expect(dialogShown()).toBe(true);
  });

  it('v1 is unchanged: opens whatever the wizard says', () => {
    onV2 = false;
    wizard = { shouldShow: true, isLoading: true };
    render(<SubscriptionActivatedDialog />);
    expect(dialogShown()).toBe(true);
  });
});
