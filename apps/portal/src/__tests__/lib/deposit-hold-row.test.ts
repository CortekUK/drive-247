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

/** Code only — the branches carry long comments that quote the very statuses
 *  the assertions below check are absent from the code. */
const stripComments = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Security Deposit row — actions', () => {
  /** The hold-specific branch, which owns exactly the statuses it always owned. */
  const holdBranch = pageSource.slice(
    pageSource.indexOf("{category === 'Security Deposit' && (depositHoldStatus === 'held'"),
    pageSource.indexOf(') : isExcessMileageUnpaid && excessMileageCharge ? ('),
  );

  /** The extras appended AFTER the generic ladder, for the in-flight/broken states. */
  const inFlightExtras = pageSource.slice(
    pageSource.indexOf("{category === 'Security Deposit'\n                          && ['processing', 'refreshing', 'failed']"),
    pageSource.indexOf('{applied && (\n                          <button\n                            className="text-muted-foreground hover:text-amber-500'),
  );

  it('claims only the statuses it has always claimed', () => {
    // The regression that made this a `!['captured','released']` branch: it
    // swallowed 'processing', 'refreshing' and 'failed', which have always
    // fallen through to the generic ladder below — and that ladder is where a
    // deposit collected outside the hold gets its Release / Release More /
    // Add Payment button (isDepositUsed, wouldShowRefund). A rental whose hold
    // failed and whose deposit was then taken manually must stay releasable.
    expect(pageSource).toMatch(
      /category === 'Security Deposit' && \(depositHoldStatus === 'held' \|\| depositHoldStatus === 'expired' \|\| !depositHoldStatus\)/,
    );
    expect(pageSource).not.toContain("!['captured', 'released'].includes(depositHoldStatus || '')");
    const code = stripComments(holdBranch);
    for (const status of ['processing', 'refreshing', 'failed']) {
      expect(code, `${status} must not be captured by the hold-only branch`).not.toContain(`'${status}'`);
    }
  });

  it('still reaches the generic ladder for the in-flight and broken states', () => {
    // isDepositUsed / wouldShowRefund / the Release label live there, and the
    // hold actions are appended alongside rather than replacing them.
    expect(inFlightExtras).toContain("['processing', 'refreshing', 'failed'].includes(depositHoldStatus || '')");
    expect(inFlightExtras).toContain('Check with Stripe');
    expect(pageSource).toContain("const isDepositUsed = category === 'Security Deposit'");
    expect(pageSource).toMatch(/category === 'Security Deposit' \? \(refunded > 0 \? 'Release More' : 'Release'\)/);
  });

  it('gates the Check-with-Stripe button on there being a hold to check', () => {
    // A rental that never had a hold has no PaymentIntent to verify — offering
    // the button there would 404 against verify-deposit-hold.
    const branchStart = pageSource.indexOf("{depositHoldStatus && canEdit('rentals') && (");
    expect(branchStart, 'the reconcile branch is not gated on depositHoldStatus').toBeGreaterThan(-1);
    const btn = pageSource.slice(branchStart, branchStart + 900);
    expect(btn).toContain('Check with Stripe');
    expect(btn).toContain('disabled={verifyingHold}');
  });

  it('keeps the reconcile action out of a viewer\'s hands', () => {
    // verify-deposit-hold WRITES (it corrects deposit_hold_status), so it is
    // not a read-only action, and neither is placing a hold.
    expect(pageSource).toContain("{depositHoldStatus && canEdit('rentals') && (");
    expect(inFlightExtras).toContain("canEdit('rentals')");
  });

  it('discriminates an in-progress answer from a resolved one before toasting', () => {
    // verify-deposit-hold returns liveHold:false — carrying "Place a new hold to
    // re-authorise the deposit" — while another worker owns the row. Titling
    // that 'Hold checked' and repeating the advice invites a double hold.
    const handler = pageSource.slice(
      pageSource.indexOf('const handleVerifyDepositHold'),
      pageSource.indexOf('// Fetch renewal chain info'),
    );
    expect(handler).toContain('const outcome = classifyVerify(data)');
    expect(handler).toMatch(/if \(outcome === 'in_progress'\)/);
    expect(handler).toContain("title: 'Still in progress'");
    expect(handler).toContain('describeInProgressHold(data?.status)');
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
    // Two places now, because the two statuses sit on opposite sides of the
    // generic ladder: 'no hold' inside the hold branch, 'failed' appended after.
    expect(holdBranch).toMatch(/\{!depositHoldStatus && \(/);
    expect(holdBranch.slice(holdBranch.indexOf('{!depositHoldStatus && ('))).toContain('Add Hold');
    expect(inFlightExtras).toMatch(/\{depositHoldStatus === 'failed' && \(/);
    expect(inFlightExtras).toContain('Add Hold');
  });

  it('offers Add Hold alongside Refresh & Charge once the hold has expired', () => {
    // Putting a live hold back on the card is a legitimate end in itself; it
    // does not have to be followed by taking the money.
    const expiredBranch = holdBranch.slice(
      holdBranch.indexOf("{depositHoldStatus === 'expired' && ("),
      holdBranch.indexOf('{!depositHoldStatus && ('),
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
    // These fall outside every new branch — no reconcile button, no Add Hold,
    // no behaviour change for tenants who never hit the stale-hold bug.
    for (const status of ['captured', 'released']) {
      expect(stripComments(holdBranch)).not.toContain(`'${status}'`);
      expect(stripComments(inFlightExtras)).not.toContain(`'${status}'`);
    }
  });
});

describe('Security Deposit row — expiry line', () => {
  /** The whole expiry-line IIFE, from its gate to the end of its JSX. */
  const expiryLine = pageSource.slice(
    pageSource.indexOf("{category === 'Security Deposit' && (() => {"),
    pageSource.indexOf('</TableCell>', pageSource.indexOf("{category === 'Security Deposit' && (() => {")),
  );

  it('renders the authorisation expiry for the two states where the date means something', () => {
    expect(expiryLine).toMatch(/depositHoldStatus !== 'held' && depositHoldStatus !== 'expired'\) return null/);
    expect(expiryLine).toContain('describeHoldExpiry(rental.deposit_hold_expires_at)');
  });

  it('does not show the OUTGOING hold\'s date while a new one is being placed', () => {
    // Neither writer clears deposit_hold_expires_at when it claims the row:
    // place-deposit-hold sets { deposit_hold_status: 'processing' } and
    // refresh-deposit-holds { deposit_hold_status: 'refreshing' }, both writing
    // the new expiry only later. So during a refresh the column still holds the
    // dead authorisation's date — which is at or past expiry by definition,
    // since that is why the cron picked the row up. Rendering it would shout
    // "Authorisation lapsed" in red over a hold being placed successfully.
    expect(expiryLine).toMatch(/depositHoldStatus === 'processing' \|\| depositHoldStatus === 'refreshing'/);
    const inFlight = expiryLine.slice(expiryLine.indexOf("depositHoldStatus === 'processing'"));
    expect(inFlight.slice(0, 400)).toContain('Placing a new authorisation');
    expect(inFlight.slice(0, 400)).not.toContain('describeHoldExpiry');
  });

  it('only names a lapse date on an expired hold when the date corroborates it', () => {
    // 'expired' with a still-future timestamp means the hold died EARLY (bank
    // pulled it, or it was cancelled); the stored date then describes nothing
    // that happened.
    expect(expiryLine).toMatch(/depositHoldStatus === 'expired' && expiry\.tone !== 'past'\) return null/);
  });

  it('escalates the expiry line visually instead of leaving it muted', () => {
    // An operator on a 90-day rental will not notice a grey date. The amber/red
    // escalation is the only thing that makes a dying hold visible in time.
    expect(expiryLine).toContain("expiry.tone === 'past'");
    expect(expiryLine).toContain('text-red-500');
    expect(expiryLine).toContain("expiry.tone === 'soon'");
    expect(expiryLine).toContain('text-amber-500');
    expect(expiryLine).toContain('AlertTriangle');
  });
});
