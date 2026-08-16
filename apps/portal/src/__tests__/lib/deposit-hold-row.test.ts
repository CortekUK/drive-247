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
 * The seven statuses this row was originally built around.
 *
 * NOTE (Aug 2026): this is not the whole of the CHECK constraint. The
 * chained-hold work widened rentals.deposit_hold_status to ELEVEN values —
 * 'capturing', 'requires_action', 'needs_review' and 'disputed' joined the list,
 * and the refresh engine writes two of them routinely. The row has since caught
 * up; the four are covered by the last block of this file, which asserts what
 * each of them badges, captions and offers.
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

/** The full CHECK constraint, as applied to production. */
const ALL_HOLD_STATUSES = [
  ...HOLD_STATUSES,
  'capturing',
  'requires_action',
  'needs_review',
  'disputed',
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

  it('leaves captured on its original ladder', () => {
    // 'captured' means the money has been taken. It falls outside every
    // placement branch — no reconcile button, no Add Hold.
    expect(stripComments(holdBranch)).not.toContain("'captured'");
    expect(stripComments(inFlightExtras)).not.toContain("'captured'");
  });

  it('offers Add Hold on a RELEASED hold, but only while the rental is still open', () => {
    // This assertion used to bracket 'released' with 'captured' and require it
    // to appear in no branch at all. That was the conservative scope of an
    // earlier change, not a product decision — and it left a real gap.
    //
    // THE INCIDENT: GMT rental R-161fe1, status Active, car still out, deposit
    // hold 'released' after a failed renewal. 'expired', null, 'failed',
    // 'requires_action' and 'needs_review' each offer a placement action;
    // 'released' offered none. The operator saw a green "Released" badge and had
    // no way to re-secure the vehicle from the rental screen.
    //
    // Safe because place-deposit-hold probes Stripe before refusing and only
    // blocks when an authorisation is genuinely ALIVE, so a released (cancelled)
    // PaymentIntent cannot produce a double hold.
    const releasedBranch = stripComments(holdBranch).slice(
      stripComments(holdBranch).indexOf("depositHoldStatus === 'released'"),
    );
    expect(releasedBranch).toContain('Add Hold');

    // ...but a deposit released at the end of a finished rental is the CORRECT
    // outcome. Offering to re-authorise a customer who has returned the car and
    // been given their money back would be worse than useless, so the branch is
    // gated on the rental still being open.
    expect(releasedBranch.slice(0, 400)).toMatch(/rental\.status !== 'Closed'/);
    expect(releasedBranch.slice(0, 400)).toMatch(/rental\.status !== 'Cancelled'/);
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

describe('the four statuses the chained-hold work added', () => {
  /**
   * WHAT THIS BLOCK USED TO SAY
   * It recorded a gap. The schema permits ELEVEN values and this row knew seven;
   * the other four hit neither if-ladder and fell through to the grey "No Hold"
   * badge with the caption "No hold placed" — the EXACT regression the top of
   * this file was written to close, reopened from the other end by the widened
   * CHECK constraint. The assertions below the comment were
   * `expect(badgeFor[status]).toBeUndefined()`, i.e. they pinned the gap open,
   * and four `it.todo`s named the tests to write once it closed. It has closed,
   * so they are written.
   *
   * It was never hypothetical for two of the four.
   * `_shared/deposit-hold-refresh.ts` writes 'requires_action' on every SCA and
   * dead-card decline and 'needs_review' on every unclassified failure and at
   * the 8-attempt ceiling; the reconciler writes 'needs_review' for a hold it
   * cannot verify. Each is a state where the renter is UNSECURED and a human is
   * being asked to act.
   *
   * WHO HAS TO ACT is what decides the actions, and it differs per status — so
   * that, rather than the styling, is what these tests assert:
   *   capturing        nobody; a capture is in flight. No action at all, and
   *                    deliberately not even Check with Stripe (see below).
   *   requires_action  the CUSTOMER. No server-side fix exists, so the useful
   *                    action is a fresh authorisation link to them.
   *   needs_review     US. Check with Stripe is the whole job.
   *   disputed         the dispute process. Charging and deducting are blocked.
   */
  const NEWLY_RENDERED = ['capturing', 'requires_action', 'needs_review', 'disputed'] as const;

  /** The action block appended for exactly these four statuses. */
  const newStatusExtras = (() => {
    const start = pageSource.indexOf(
      "&& ['capturing', 'requires_action', 'needs_review', 'disputed'].includes(depositHoldStatus || '')",
    );
    if (start === -1) {
      throw new Error(
        'The four-status action block is gone, or its condition was changed. These four statuses ' +
          'fall through to "No Hold" without it — update this test to match the code it guards ' +
          'rather than deleting the assertions.',
      );
    }
    return pageSource.slice(start, pageSource.indexOf('{applied && (', start));
  })();

  /** The JSX offered for one status, from its branch to the next one. */
  const branchFor = (status: string, until: string) => {
    const from = newStatusExtras.indexOf(status);
    expect(from, `no branch opens with \`${status}\``).toBeGreaterThan(-1);
    const to = newStatusExtras.indexOf(until, from);
    return stripComments(newStatusExtras.slice(from, to > from ? to : undefined));
  };

  it('lists every status the constraint permits', () => {
    expect(ALL_HOLD_STATUSES).toHaveLength(11);
    for (const status of NEWLY_RENDERED) {
      expect(ALL_HOLD_STATUSES as readonly string[]).toContain(status);
    }
  });

  it.each(NEWLY_RENDERED)('badges %s instead of falling through to "No Hold"', (status) => {
    expect(badgeFor[status], `no badge branch for deposit_hold_status='${status}'`).toBeTruthy();
    expect(badgeFor[status]).not.toBe('No Hold');
  });

  it.each(NEWLY_RENDERED)('captions %s instead of falling through to "No hold placed"', (status) => {
    expect(detailFor[status], `no detail caption for deposit_hold_status='${status}'`).toBeTruthy();
    expect(detailFor[status]).not.toBe('No hold placed');
  });

  it('gives each of the four a label of its own', () => {
    // Collapsing any two of these would hide the one thing the operator needs:
    // they call for four different people to act.
    const labels = NEWLY_RENDERED.map((s) => badgeFor[s]);
    expect(new Set(labels).size).toBe(NEWLY_RENDERED.length);
    expect(badgeFor.capturing).toBe('Capturing');
    expect(badgeFor.requires_action).toBe('Action Needed');
    expect(badgeFor.needs_review).toBe('Needs Review');
    expect(badgeFor.disputed).toBe('Disputed');
  });

  it('is reached from live writers, not only in theory', () => {
    const engine = readFileSync(
      resolve(__dirname, '../../../../../supabase/functions/_shared/deposit-hold-refresh.ts'),
      'utf8',
    );
    expect(engine).toContain('deposit_hold_status: "requires_action"');
    expect(engine).toContain('deposit_hold_status: "needs_review"');
  });

  it('captions the two live ones in the same words as the refresh toast', () => {
    // REFRESH_RESULT_COPY on the same page already named 'requires_action' and
    // 'needs_review'. The row now consults the same wording, so the toast the
    // operator saw and the row they look at afterwards cannot disagree.
    expect(pageSource).toContain("requires_action: 'Card needs the customer'");
    expect(pageSource).toContain("needs_review: 'Needs a closer look'");
    expect(detailFor.requires_action).toBe('Card needs the customer');
    expect(detailFor.needs_review).toBe('Needs a closer look');
  });

  it('badges requires_action distinctly and offers a way to reach the customer', () => {
    expect(badgeFor.requires_action).toBe('Action Needed');
    const branch = branchFor(
      "{depositHoldStatus === 'requires_action' && canEdit('rentals') && (",
      "{(depositHoldStatus === 'requires_action'",
    );
    // Reaching the cardholder IS the fix: the engine has no server-side retry
    // for an SCA or a dead card, so the action is a fresh authorisation link.
    expect(branch).toContain('Send card link');
    expect(branch).toContain('setShowAddHoldDialog(true)');
    // It writes to the customer's card, so it is not a viewer action.
    expect(branch).toContain("canEdit('rentals')");
    // And the row says who has to act, rather than only colouring the badge.
    expect(pageSource).toContain('Not secured — the customer must authorise the card');
  });

  it('badges needs_review distinctly and offers Check with Stripe', () => {
    expect(badgeFor.needs_review).toBe('Needs Review');
    const branch = branchFor(
      "{(depositHoldStatus === 'requires_action' || depositHoldStatus === 'needs_review') && canEdit('rentals') && (",
      '</>',
    );
    expect(branch).toContain('Check with Stripe');
    expect(branch).toContain('handleVerifyDepositHold()');
    expect(branch).toContain('disabled={verifyingHold}');
    expect(branch).toContain("canEdit('rentals')");
    // Nothing else moves a row off needs_review, so it must not be the one
    // status whose only exit is a button that was never placed.
    expect(newStatusExtras).toContain("depositHoldStatus === 'needs_review'");
    expect(pageSource).toContain('Not secured — we could not establish what this authorisation is doing');
  });

  it('badges capturing as in-flight and offers no placement action', () => {
    expect(badgeFor.capturing).toBe('Capturing');
    expect(detailFor.capturing).toBe('Charging the hold');
    const branch = branchFor(
      "{depositHoldStatus === 'capturing' && (",
      "{depositHoldStatus === 'disputed' && (",
    );
    expect(branch).toContain('animate-spin');
    expect(branch).toContain('Capturing…');
    // No second authorisation on top of a capture in flight…
    expect(branch).not.toContain('setShowAddHoldDialog');
    expect(branch).not.toContain('Add Hold');
    // …and deliberately not Check with Stripe either: verify-deposit-hold treats
    // only 'processing'/'refreshing' as worker-owned, so on 'capturing' it WOULD
    // write, and a PaymentIntent still at requires_capture maps back to 'held' —
    // stamping that straight over a capture that is mid-flight.
    expect(branch).not.toContain('handleVerifyDepositHold');
    const reconcileGate = "{(depositHoldStatus === 'requires_action' || depositHoldStatus === 'needs_review')";
    expect(newStatusExtras).toContain(reconcileGate);
    expect(newStatusExtras).not.toContain("depositHoldStatus === 'capturing' || ");
  });

  it('badges disputed distinctly and offers no placement action', () => {
    expect(badgeFor.disputed).toBe('Disputed');
    expect(detailFor.disputed).toBe('Disputed by the customer');
    const branch = branchFor(
      "{depositHoldStatus === 'disputed' && (",
      "{depositHoldStatus === 'requires_action'",
    );
    expect(branch).toContain('Charge blocked');
    expect(branch).not.toContain('setShowAddHoldDialog');
    expect(branch).not.toContain('handleVerifyDepositHold');
  });

  it('blocks Deduct Deposit while the authorisation is disputed', () => {
    // deduct-from-deposit draws on the same PaymentIntent the chargeback is
    // against, so the row on the Excess Mileage side has to refuse too — a guard
    // on the deposit row alone would leave the money path open.
    const deductCell = pageSource.slice(
      pageSource.indexOf('const depositCharge = (rentalCharges || []).find'),
      pageSource.indexOf('setShowDeductFromDepositDialog(true)'),
    );
    expect(stripComments(deductCell)).toContain("rental.deposit_hold_status === 'disputed'");
    expect(deductCell).toContain('Deposit disputed');
  });

  it('keeps the four out of the hold-only branch, so a manual deposit stays releasable', () => {
    // Same rule the in-flight states follow: the hold-only branch REPLACES the
    // generic ladder, and that ladder is where a deposit collected in cash gets
    // its Release / Add Payment button. A rental whose card went bad must not
    // lose it.
    const holdBranch = stripComments(
      pageSource.slice(
        pageSource.indexOf("{category === 'Security Deposit' && (depositHoldStatus === 'held'"),
        pageSource.indexOf(') : isExcessMileageUnpaid && excessMileageCharge ? ('),
      ),
    );
    for (const status of NEWLY_RENDERED) {
      expect(holdBranch, `${status} must not be captured by the hold-only branch`).not.toContain(`'${status}'`);
    }
  });
});
