import { describe, expect, it } from 'vitest';
import {
  classifyText,
  headline,
  inPeriod,
  parseRequestNote,
  reasonShares,
  resolveChurn,
  type ChurnSubscription,
  type ChurnTenant,
} from '@/lib/customer-management/cancellations';

const NOW = new Date('2026-10-07T12:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const tenant = (over: Partial<ChurnTenant> = {}): ChurnTenant => ({
  id: 't1',
  company_name: 'Mike Rentals',
  slug: 'mike',
  created_at: ago(400),
  status: 'active',
  portal_experience: 'v1',
  setup_completed_at: ago(380),
  stripe_onboarding_complete: true,
  stripe_account_status: 'active',
  own_stripe_account_id: 'acct_1',
  own_stripe_test_account_id: null,
  ...over,
});

const sub = (over: Partial<ChurnSubscription> = {}): ChurnSubscription => ({
  status: 'canceled',
  plan_name: 'Growth',
  amount: 19900,
  currency: 'usd',
  interval: 'month',
  created_at: ago(390),
  cancel_at: null,
  canceled_at: ago(20),
  ended_at: ago(20),
  cancellation_reason: 'cancellation_requested',
  cancellation_feedback: null,
  cancellation_comment: null,
  ...over,
});

const base = { requests: [], override: null, paidCents: 0, now: NOW };

describe('who counts', () => {
  it('a cancelled subscription and nothing live is LEFT', () => {
    const r = resolveChurn({ ...base, tenant: tenant(), subscriptions: [sub()] });
    expect(r?.state).toBe('left');
    expect(r?.leftAt).toBe(ago(20));
  });

  it('a UAE-migrated operator (old UK row cancelled, new one live) is NOT churn', () => {
    const r = resolveChurn({
      ...base,
      tenant: tenant(),
      subscriptions: [sub(), sub({ status: 'active', canceled_at: null, ended_at: null, created_at: ago(25) })],
    });
    expect(r).toBeNull();
  });

  it('a live subscription set to cancel is LEAVING', () => {
    const r = resolveChurn({
      ...base,
      tenant: tenant(),
      subscriptions: [sub({ status: 'active', cancel_at: ago(-10), canceled_at: null, ended_at: null })],
    });
    expect(r?.state).toBe('leaving');
  });

  it('a signup that never paid is not a lost customer', () => {
    expect(resolveChurn({ ...base, tenant: tenant(), subscriptions: [sub({ status: 'incomplete_expired' })] })).toBeNull();
  });

  it('a suspended company with no subscription counts as left, with no date', () => {
    const r = resolveChurn({ ...base, tenant: tenant({ status: 'suspended' }), subscriptions: [] });
    expect(r?.state).toBe('left');
    expect(r?.leftAt).toBeNull();
  });
});

describe('the reason', () => {
  it('reads the v2 dropdown word for word, with their extra words as detail', () => {
    expect(parseRequestNote("CANCELLATION — It's too expensive. We only have 2 cars.")).toEqual({
      reason: 'too_expensive',
      detail: 'We only have 2 cars.',
    });
    expect(parseRequestNote("CANCELLATION — I'm switching to another tool.")?.reason).toBe('switched_tools');
  });

  it('ignores retention outcomes (a call, a discount) — they did not leave', () => {
    expect(parseRequestNote('CALL REQUESTED — Something else.')).toBeNull();
  });

  it('reads v1 free text by keywords', () => {
    expect(classifyText('honestly the price is too high for us')).toBe('too_expensive');
    expect(classifyText('we are moving to a competitor')).toBe('switched_tools');
    expect(classifyText('closing the business at the end of the month')).toBe('closing_business');
    expect(classifyText('just because')).toBe('other');
  });

  it('admin > what they said > Stripe > inferred', () => {
    const said = [{ status: 'approved', note: "CANCELLATION — It's too expensive.", created_at: ago(25) }];
    const viaAdmin = resolveChurn({
      ...base,
      tenant: tenant(),
      subscriptions: [sub()],
      requests: said,
      override: { reason: 'switched_tools', note: 'Told us on the phone', updated_at: ago(1) },
    });
    expect([viaAdmin?.reason, viaAdmin?.source]).toEqual(['switched_tools', 'admin']);

    const viaRequest = resolveChurn({ ...base, tenant: tenant(), subscriptions: [sub()], requests: said });
    expect([viaRequest?.reason, viaRequest?.source]).toEqual(['too_expensive', 'request']);

    const viaStripe = resolveChurn({ ...base, tenant: tenant(), subscriptions: [sub({ cancellation_reason: 'payment_failed' })] });
    expect([viaStripe?.reason, viaStripe?.source]).toEqual(['payment_failed', 'stripe']);

    const inferred = resolveChurn({
      ...base,
      tenant: tenant({ own_stripe_account_id: null, stripe_onboarding_complete: false, setup_completed_at: null }),
      subscriptions: [sub()],
    });
    expect([inferred?.reason, inferred?.source]).toEqual(['never_finished_setup', 'inferred']);

    const nothing = resolveChurn({ ...base, tenant: tenant(), subscriptions: [sub()] });
    expect([nothing?.reason, nothing?.source]).toEqual(['unknown', 'none']);
  });
});

describe('the report', () => {
  it('writes the brief\'s one-line answer', () => {
    const mk = (reason: string) =>
      resolveChurn({
        ...base,
        tenant: tenant(),
        subscriptions: [sub()],
        override: { reason, note: null, updated_at: ago(1) },
      })!;
    const rows = [mk('too_expensive'), mk('too_expensive'), mk('never_finished_setup'), mk('switched_tools')];
    expect(reasonShares(rows)[0]).toMatchObject({ reason: 'too_expensive', count: 2, percent: 50 });
    expect(headline(rows, '90')).toBe('Last 3 months: 50% too expensive, 25% never finished setup, 25% switched to another tool.');
  });

  it('filters by when they left', () => {
    const r = resolveChurn({ ...base, tenant: tenant(), subscriptions: [sub({ ended_at: ago(100), canceled_at: ago(100) })] })!;
    expect(inPeriod(r, '90', NOW)).toBe(false);
    expect(inPeriod(r, '365', NOW)).toBe(true);
  });
});
