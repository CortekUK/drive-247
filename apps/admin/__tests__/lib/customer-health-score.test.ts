import { describe, expect, it } from 'vitest';
import {
  bandFor,
  lastPaymentFailed,
  paymentState,
  scoreBuckets,
  scoreTenant,
  type HealthInput,
  type TenantFacts,
} from '@/lib/customer-health/score';

const NOW = new Date('2026-10-07T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const tenant = (over: Partial<TenantFacts> = {}): TenantFacts => ({
  id: 't1',
  company_name: 'Mike Rentals',
  slug: 'mike',
  created_at: daysAgo(200),
  stripe_onboarding_complete: true,
  stripe_account_status: 'active',
  own_stripe_account_id: null,
  own_stripe_test_account_id: null,
  integration_bonzah: false,
  ...over,
});

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  tenant: tenant(),
  lastLoginAt: daysAgo(1),
  bookingsLast30Days: 12,
  subscriptions: [{ status: 'active', cancel_at: null, current_period_end: daysAgo(-20), trial_end: null, created_at: daysAgo(100) }],
  invoices: [{ status: 'paid', attempt_count: 1, created_at: daysAgo(10) }],
  bonzahFormSent: true,
  now: NOW,
  ...over,
});

describe('scoreTenant', () => {
  it('scores a busy, paying, fully set up company 100 and healthy', () => {
    const r = scoreTenant(input());
    expect(r.score).toBe(100);
    expect(r.band).toBe('healthy');
  });

  it("puts the brief's Mike in red: no login for 2 weeks, no bookings, last payment failed", () => {
    const r = scoreTenant(
      input({
        lastLoginAt: daysAgo(14),
        bookingsLast30Days: 0,
        invoices: [
          { status: 'paid', attempt_count: 1, created_at: daysAgo(40) },
          { status: 'open', attempt_count: 2, created_at: daysAgo(5) },
        ],
      }),
    );
    expect(r.payment).toBe('failed');
    expect(r.score).toBeLessThan(40);
    expect(r.band).toBe('critical');
    expect(r.parts.payment.label).toBe('Last payment failed');
  });

  it('treats no login in 90 days as zero login points', () => {
    expect(scoreTenant(input({ lastLoginAt: null })).parts.logins.points).toBe(0);
  });

  it('gives setup points for Stripe and the Bonzah form separately', () => {
    expect(scoreTenant(input({ bonzahFormSent: false })).parts.setup.points).toBe(8);
    expect(
      scoreTenant(input({ tenant: tenant({ stripe_onboarding_complete: false, stripe_account_status: 'pending' }) })).parts.setup
        .points,
    ).toBe(7);
  });
});

describe('payment', () => {
  it('does not call a fresh, never-attempted open invoice a failure', () => {
    expect(lastPaymentFailed([{ status: 'open', attempt_count: 0, created_at: daysAgo(0) }])).toBe(false);
  });

  it('ignores void invoices when finding the latest', () => {
    expect(
      lastPaymentFailed([
        { status: 'uncollectible', attempt_count: 4, created_at: daysAgo(30) },
        { status: 'paid', attempt_count: 1, created_at: daysAgo(10) },
        { status: 'void', attempt_count: 0, created_at: daysAgo(1) },
      ]),
    ).toBe(false);
  });

  it('prefers the live subscription over an older cancelled one', () => {
    const subs = [
      { status: 'canceled', cancel_at: null, current_period_end: null, trial_end: null, created_at: daysAgo(10) },
      { status: 'trialing', cancel_at: null, current_period_end: null, trial_end: daysAgo(-5), created_at: daysAgo(20) },
    ];
    expect(paymentState(subs, [], NOW)).toBe('trialing');
  });

  it('flags past_due and scheduled cancellation', () => {
    const sub = (status: string, cancel_at: string | null = null) => [
      { status, cancel_at, current_period_end: null, trial_end: null, created_at: daysAgo(1) },
    ];
    expect(paymentState(sub('past_due'), [], NOW)).toBe('failed');
    expect(paymentState(sub('active', daysAgo(-10)), [], NOW)).toBe('cancelling');
    expect(paymentState([], [], NOW)).toBe('none');
  });
});

describe('bands and buckets', () => {
  it('uses 70 / 40 as the cut-offs', () => {
    expect(bandFor(70)).toBe('healthy');
    expect(bandFor(69)).toBe('at_risk');
    expect(bandFor(40)).toBe('at_risk');
    expect(bandFor(39)).toBe('critical');
  });

  it('puts 100 in the last bucket and counts every score once', () => {
    const b = scoreBuckets([0, 9, 10, 55, 100, 90]);
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(6);
    expect(b[9].count).toBe(2);
    expect(b[0].count).toBe(2);
  });
});
