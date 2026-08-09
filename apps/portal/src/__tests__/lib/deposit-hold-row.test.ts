/**
 * The Security Deposit row of the rental page's Payment Breakdown.
 *
 * Three decision tables live inside that row — the status badge, the detail
 * line, and which actions the operator is offered — and all three used to be
 * incomplete. `processing`, `refreshing` and `failed` fell straight through to
 * a grey "No Hold" badge with the caption "No hold placed" and zero actions,
 * i.e. the UI asserted the opposite of the truth while a real authorisation was
 * in flight or broken. That is the bug this file guards.
 *
 * The row is JSX inside a ~6000-line page component that cannot be rendered
 * here (Next router, 40+ hooks, the whole Supabase client). So the tables are
 * lifted out of the source text and asserted as tables. This will not catch a
 * layout regression, but it does catch the thing that actually went wrong:
 * a hold state with nowhere to go.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(
  resolve(__dirname, '../../app/(dashboard)/rentals/[id]/page.tsx'),
  'utf8',
);

/**
 * Every value rentals.deposit_hold_status can legally hold. The CHECK
 * constraint on the column permits exactly these seven and no more — a new
 * status cannot be introduced without a migration, so this list is closed.
 */
const HOLD_STATUSES = [
  'processing',
  'held',
  'captured',
  'released',
  'expired',
  'refreshing',
  'failed',
] as const;

/** status -> badge text, read out of the badge cell's if-ladder. */
const badgeFor: Record<string, string> = Object.fromEntries(
  [...pageSource.matchAll(/depositHoldStatus === '(\w+)'\) return <Badge[^>]*>([^<]+)<\/Badge>/g)]
    .map((m) => [m[1], m[2]]),
);

/** status -> detail caption, read out of the row's `detail` IIFE. */
const detailFor: Record<string, string> = Object.fromEntries(
  [...pageSource.matchAll(/rental\.deposit_hold_status === '(\w+)'\) return '([^']+)'/g)]
    .map((m) => [m[1], m[2]]),
);

describe('Security Deposit row — status badge', () => {
  it('names every one of the seven hold statuses', () => {
    // A status with no branch here silently becomes "No Hold".
    for (const status of HOLD_STATUSES) {
      expect(badgeFor[status], `no badge branch for deposit_hold_status='${status}'`).toBeTruthy();
    }
  });

  it.each(['processing', 'refreshing', 'failed'])(
    'does not label %s as "No Hold"',
    (status) => {
      // The regression, stated plainly. There IS a hold record in each of these
      // states — mid-flight, being replaced, or broken — and calling it "No
      // Hold" is what sent operators to Add Hold, which then refused them.
      expect(badgeFor[status]).not.toBe('No Hold');
    },
  );

  it('gives the three formerly-invisible states distinguishable labels', () => {
    expect(badgeFor.processing).toBe('Processing');
    expect(badgeFor.refreshing).toBe('Refreshing');
    expect(badgeFor.failed).toBe('Failed');
  });

  it('leaves the settled states reading as they always did', () => {
    // Unchanged behaviour for the other 27 tenants.
    expect(badgeFor.held).toBe('Held');
    expect(badgeFor.captured).toBe('Charged');
    expect(badgeFor.released).toBe('Released');
    expect(badgeFor.expired).toBe('Expired');
  });

  it('keeps "No Hold" as the fallback for a deposit with no hold record at all', () => {
    // Still correct — and still reached, because the ladder above only fires
    // when depositHoldStatus is truthy.
    expect(pageSource).toMatch(/if \(depositHoldStatus\) \{/);
    expect(pageSource).toMatch(/return <Badge[^>]*>No Hold<\/Badge>/);
  });
});

describe('Security Deposit row — detail caption', () => {
  it('captions every one of the seven hold statuses', () => {
    for (const status of HOLD_STATUSES) {
      expect(detailFor[status], `no detail caption for deposit_hold_status='${status}'`).toBeTruthy();
    }
  });

  it.each(['processing', 'refreshing', 'failed'])(
    'does not caption %s as "No hold placed"',
    (status) => {
      expect(detailFor[status]).not.toBe('No hold placed');
    },
  );

  it('distinguishes in-flight from broken', () => {
    // "Authorisation in progress" and "Hold failed" call for opposite operator
    // responses (wait vs. act); collapsing them would be worse than useless.
    expect(detailFor.processing).toBe('Authorisation in progress');
    expect(detailFor.refreshing).toBe('Replacing the hold');
    expect(detailFor.failed).toBe('Hold failed');
  });
});

describe('Security Deposit row — actions', () => {
  it('offers the reconcile action on every non-terminal hold state', () => {
    // The whole point: the stored status is not trustworthy on its own, so
    // every state that is not already settled needs a way to ask Stripe.
    expect(pageSource).toMatch(
      /category === 'Security Deposit' && !\['captured', 'released'\]\.includes\(depositHoldStatus \|\| ''\)/,
    );
  });

  it('gates the Check-with-Stripe button on there being a hold to check', () => {
    // A rental that never had a hold has no PaymentIntent to verify — offering
    // the button there would 404 against verify-deposit-hold.
    const branchStart = pageSource.indexOf('{depositHoldStatus && (');
    expect(branchStart, 'the reconcile branch is not gated on depositHoldStatus').toBeGreaterThan(-1);
    const btn = pageSource.slice(branchStart, branchStart + 900);
    expect(btn).toContain('Check with Stripe');
    expect(btn).toContain('disabled={verifyingHold}');
  });

  it('routes the button at verify-deposit-hold and refreshes the rental afterwards', () => {
    const handler = pageSource.slice(
      pageSource.indexOf('const handleVerifyDepositHold'),
      pageSource.indexOf('const handleVerifyDepositHold') + 2000,
    );
    expect(handler).toContain("supabase.functions.invoke('verify-deposit-hold'");
    expect(handler).toContain('rentalId: rental.id');
    // invoke() resolves (not throws) on a non-2xx, so the error branch has to
    // be inspected explicitly or a 500 shows a success toast.
    expect(handler).toContain('extractFunctionError');
    // Without awaiting the invalidation the badge keeps showing the old status
    // right after the operator was told it changed.
    expect(handler).toMatch(/await queryClient\.invalidateQueries\(\{ queryKey: \['rental', id\] \}\)/);
  });

  it('offers Add Hold when the hold failed or was never placed', () => {
    expect(pageSource).toMatch(/\{\(depositHoldStatus === 'failed' \|\| !depositHoldStatus\) && \(/);
  });

  it('offers Add Hold alongside Refresh & Charge once the hold has expired', () => {
    // Putting a live hold back on the card is a legitimate end in itself; it
    // does not have to be followed by taking the money.
    const expiredBranch = pageSource.slice(
      pageSource.indexOf("{depositHoldStatus === 'expired' && ("),
      pageSource.indexOf("{(depositHoldStatus === 'failed'"),
    );
    expect(expiredBranch).toContain('Refresh &amp; Charge');
    expect(expiredBranch).toContain('Add Hold');
  });

  it('offers NO placement action while an authorisation is in flight', () => {
    // A second authorisation attempt on top of one already running double-holds
    // the customer's card. 'processing'/'refreshing' therefore appear in no
    // placement branch — only in the reconcile branch.
    const placementConditions = [
      ...pageSource.matchAll(/\{\(?depositHoldStatus === '(\w+)'/g),
    ].map((m) => m[1]);
    expect(placementConditions).not.toContain('processing');
    expect(placementConditions).not.toContain('refreshing');
  });

  it('leaves captured and released on their original ladder', () => {
    // These fall outside the new branch entirely — no reconcile button, no
    // behaviour change for tenants who never hit the stale-hold bug.
    expect(pageSource).toContain("!['captured', 'released'].includes(depositHoldStatus || '')");
  });
});

describe('Security Deposit row — expiry line', () => {
  it('renders the authorisation expiry for the states where one is still running', () => {
    expect(pageSource).toMatch(
      /\['held', 'refreshing', 'processing'\]\.includes\(depositHoldStatus \|\| ''\)/,
    );
    expect(pageSource).toContain('describeHoldExpiry(rental.deposit_hold_expires_at)');
  });

  it('escalates the expiry line visually instead of leaving it muted', () => {
    // An operator on a 90-day rental will not notice a grey date. The amber/red
    // escalation is the only thing that makes a dying hold visible in time.
    const line = pageSource.slice(
      pageSource.indexOf("describeHoldExpiry(rental.deposit_hold_expires_at)"),
      pageSource.indexOf("describeHoldExpiry(rental.deposit_hold_expires_at)") + 900,
    );
    expect(line).toContain("expiry.tone === 'past'");
    expect(line).toContain('text-red-500');
    expect(line).toContain("expiry.tone === 'soon'");
    expect(line).toContain('text-amber-500');
    expect(line).toContain('AlertTriangle');
  });
});
