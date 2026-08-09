/**
 * AddHoldDialog — the dead end GMT reported, and the way out of it.
 *
 * Before Aug 2026, a rental whose Stripe authorisation had silently lapsed still
 * read deposit_hold_status='held'. create-hold-checkout answered
 * { skipped: 'hold_already_active' }, this dialog threw a destructive toast, the
 * toast vanished, and the operator was left staring at a green "Held" badge over
 * a dead authorisation with no next action. GMT: "I cannot refresh the hold.
 * This is affecting our day to day business."
 *
 * The dialog cannot be rendered in this workspace (React 18/19 split — see
 * helpers/source.ts), so its copy table is executed for real and its state
 * wiring is asserted against the source. The wiring assertions are the point:
 * each one names a way the escape hatch could quietly stop working.
 */

import { describe, it, expect } from 'vitest';
import { readAppSource, sliceModuleConst, evalModuleConsts } from '../helpers/source';

const source = readAppSource('components/shared/dialogs/add-hold-dialog.tsx');

const describeHoldSkip = evalModuleConsts<(code: string) => string>(
  [sliceModuleConst(source, 'HOLD_SKIP_MESSAGES'), source.match(/const describeHoldSkip =.*;/)![0]],
  'describeHoldSkip',
);

/** The section of the file between two markers, for ordering assertions. */
const between = (from: string, to: string) => {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + 1);
  if (a === -1 || b === -1) throw new Error(`Could not slice ${from} … ${to}`);
  return source.slice(a, b);
};

describe('AddHoldDialog — skip copy', () => {
  it('translates every skip code create-hold-checkout can return', () => {
    for (const code of [
      'auto_extend_rental',
      'auto_extend_or_extended_rental',
      'hold_already_active',
      'deposit_disabled_for_tenant',
      'deposit_amount_is_zero',
    ]) {
      expect(describeHoldSkip(code), `no operator-facing copy for '${code}'`).not.toMatch(/Hold not placed/);
    }
  });

  it('degrades gracefully for a code it has never seen', () => {
    expect(describeHoldSkip('some_new_guard')).toBe('Hold not placed (some_new_guard).');
  });

  it('no longer states the hold IS active as settled fact', () => {
    // The stored flag is precisely what cannot be trusted: an expired Stripe
    // authorisation never reports back to us. The old copy — "A deposit hold is
    // already active on this rental." — told the operator the one thing we do
    // not actually know.
    const msg = describeHoldSkip('hold_already_active');
    expect(msg).not.toBe('A deposit hold is already active on this rental.');
    expect(msg).toMatch(/recorded as already holding/);
    expect(msg).toMatch(/expired or been released/);
  });

  it('leaves the auto-extension explanation untouched', () => {
    // Unchanged for the other 27 tenants — this skip is a policy, not a bug.
    expect(describeHoldSkip('auto_extend_rental')).toMatch(/renewal price replaces the deposit/);
    expect(describeHoldSkip('auto_extend_or_extended_rental')).toBe(describeHoldSkip('auto_extend_rental'));
  });
});

describe('AddHoldDialog — the conflict is raised inline, not thrown away', () => {
  it('handles hold_already_active before the generic destructive toast, on both paths', () => {
    // Ordering is the whole fix. If the toast line ever moves above the branch,
    // the operator is back to a message that disappears.
    for (const [path, marker] of [
      ['Place via Stripe', 'const handlePlaceViaStripe'],
      ['Send email link', 'const handleSendEmail'],
    ] as const) {
      const body = source.slice(source.indexOf(marker), source.indexOf(marker) + 2200);
      const branch = body.indexOf("=== \"hold_already_active\"");
      const toastLine = body.indexOf('title: "Hold not placed"') >= 0
        ? body.indexOf('title: "Hold not placed"')
        : body.indexOf('title: "Hold not created"');
      expect(branch, `${path}: no hold_already_active branch`).toBeGreaterThan(-1);
      expect(branch, `${path}: the toast would fire first`).toBeLessThan(toastLine);
      expect(body.slice(branch, branch + 200)).toContain('setHoldConflict(true)');
    }
  });

  it('stops the email path before it emails the customer', () => {
    // The refused checkout has no URL; sending anyway would mail a broken link.
    const emailBody = source.slice(source.indexOf('const handleSendEmail'), source.indexOf('return ('));
    const branch = emailBody.indexOf('setHoldConflict(true)');
    const sendCall = emailBody.indexOf('send-invoice-email');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(sendCall);
    expect(emailBody.slice(branch, sendCall)).toContain('return;');
  });

  it('blocks both placement options while the conflict is unresolved', () => {
    // Leaving them live just re-runs create-hold-checkout into the same refusal.
    // Both placement buttons — and only those two — carry the holdConflict gate;
    // Cancel and the reconcile button stay reachable on `busy` alone.
    const grid = between('<div className="grid gap-3 pt-2">', '<div className="flex justify-end pt-1">');
    const gates = [...grid.matchAll(/disabled=\{[^}]*\}/g)].map((m) => m[0]);
    expect(gates).toHaveLength(2);
    expect(gates[0]).toBe('disabled={busy || holdConflict}');
    expect(gates[1]).toBe('disabled={busy || holdConflict || !customerEmail}');
  });

  it('shows the reconcile button inside the conflict panel', () => {
    const panel = between('{holdConflict && (', '{verifyMessage && (');
    expect(panel).toContain('A deposit hold is already recorded on this rental.');
    expect(panel).toContain('onClick={handleVerify}');
    expect(panel).toMatch(/Check with Stripe/);
  });
});

describe('AddHoldDialog — reconciling with Stripe', () => {
  const handler = source.slice(source.indexOf('const handleVerify ='), source.indexOf('const getBookingOrigin'));

  it('calls verify-deposit-hold with the rental id', () => {
    expect(handler).toContain('supabase.functions.invoke("verify-deposit-hold"');
    expect(handler).toContain('body: { rentalId }');
  });

  it('unwraps the edge function error instead of showing the opaque Supabase one', () => {
    // invoke() resolves — it does not throw — on a non-2xx, and its .message is
    // always the generic "Edge Function returned a non-2xx status code".
    expect(handler).toContain('if (error) throw');
    expect(handler).toContain('extractFunctionError');
  });

  it('re-reads the rental so the rest of the page stops showing the stale status', () => {
    expect(handler).toContain('invalidateQueries({ queryKey: ["rental", rentalId] })');
  });

  it('only unblocks placement when the classifier says the authorisation is dead', () => {
    // Note the shape: the ONE positive case, never a negation of "live".
    expect(handler).toContain('const outcome = classifyVerify(data)');
    expect(handler).toMatch(/if \(outcome === "resolved"\) setHoldConflict\(false\)/);
  });

  it('prefers the function\'s own message but always says something', () => {
    expect(handler).toContain('data?.message ||');
    expect(handler).toContain('Stripe still has a live authorisation');
    expect(handler).toContain('Stripe has no live authorisation');
  });

  it('does not repeat the server\'s "place a new hold" advice for an in-flight hold', () => {
    // verify-deposit-hold builds its message from DEAD_HOLD_MESSAGES even when
    // it wrote nothing because another worker owns the row — so its copy says
    // "Place a new hold to re-authorise the deposit" while an authorisation is
    // still running. Echoing that talks the operator into a double hold.
    expect(handler).toContain('describeInProgress(data?.status)');
    const copy = source.slice(source.indexOf('const describeInProgress'), source.indexOf('export const AddHoldDialog'));
    expect(copy).toMatch(/still being worked on/);
    expect(copy).toMatch(/Nothing was changed/);
  });

  it('reports a failed reconcile without pretending it succeeded', () => {
    expect(handler).toContain('title: "Could not check with Stripe"');
    expect(handler).toContain('variant: "destructive"');
  });

  it('re-opens the placement options when the CHECK ITSELF fails', () => {
    // The check failing (function not deployed, Stripe unreachable, 5xx) is not
    // evidence of a live hold — and leaving both buttons greyed with no way to
    // retry rebuilds the dead end this dialog exists to remove. Safe to reopen:
    // create-hold-checkout runs its own liveness probe and treats an
    // inconclusive probe as ALIVE, so the worst case is a second refusal.
    const catchBlock = handler.slice(handler.indexOf('} catch'));
    expect(catchBlock).toContain('setHoldConflict(false)');
    expect(catchBlock).toContain('setVerifyUnresolved(true)');
    expect(catchBlock).toMatch(/couldn't reach Stripe/);
    // …and the operator can ask again without closing the dialog.
    const strip = between('{verifyMessage && (', '<div className="grid gap-3 pt-2">');
    expect(strip).toContain('verifyUnresolved && !holdConflict');
    expect(strip).toContain('Check again');
  });
});

describe('AddHoldDialog — classifying what verify-deposit-hold answered', () => {
  // The blocker this suite previously enshrined: `liveHold || needsReview` read
  // everything else as RESOLVED, cleared the conflict panel and re-enabled both
  // placement buttons — including for three answers that are anything but.
  const classifyVerify = evalModuleConsts<(data: any) => string>(
    [
      source.match(/const CONCLUSIVELY_DEAD = \[[^\]]*\];/)![0],
      sliceModuleConst(source, 'classifyVerify'),
    ],
    'classifyVerify',
  );

  it.each(['expired', 'captured', 'failed'])(
    'resolves on a conclusively dead hold (%s)',
    (status) => {
      expect(classifyVerify({ verified: true, liveHold: false, status, changed: true })).toBe('resolved');
    },
  );

  it('does NOT resolve while the card is still authorising', () => {
    // verify-deposit-hold, requires_action branch: liveHold:false, no
    // needsReview, status left at whatever the row says. No funds are held YET —
    // but one authorisation is already in flight on that card.
    expect(
      classifyVerify({ verified: true, liveHold: false, status: 'held', changed: false }),
    ).toBe('in_progress');
  });

  it('does NOT resolve while another worker owns the row', () => {
    // place-deposit-hold parks the row at 'processing', refresh-deposit-holds at
    // 'refreshing'. Both cases come back liveHold:false carrying DEAD_HOLD copy.
    // create-hold-checkout guards only on 'held', so a resolve here would let a
    // second authorisation through underneath the first.
    for (const status of ['processing', 'refreshing']) {
      expect(classifyVerify({ verified: true, liveHold: false, status, changed: false })).toBe('in_progress');
    }
  });

  it('does NOT resolve when Stripe could not be read', () => {
    expect(
      classifyVerify({ verified: false, liveHold: false, status: 'held', needsReview: true }),
    ).toBe('needs_review');
  });

  it('does NOT resolve on a live authorisation', () => {
    expect(classifyVerify({ verified: true, liveHold: true, status: 'held' })).toBe('live');
  });

  it('reads a missing or renamed liveHold field as live, not dead', () => {
    // Fail safe: if the contract drifts, the cost is an operator clicking twice,
    // not a second hold on a renter's card.
    expect(classifyVerify({ verified: true, status: 'expired' })).toBe('live');
    expect(classifyVerify({})).toBe('needs_review');
    expect(classifyVerify(null)).toBe('needs_review');
  });
});

describe('AddHoldDialog — state hygiene', () => {
  it('clears the conflict panel every time the dialog opens', () => {
    // A leftover "already active" panel from a previous rental would block a
    // rental that has no hold at all.
    const effect = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('const handleVerify ='));
    expect(effect).toContain('if (open)');
    expect(effect).toContain('setHoldConflict(false)');
    expect(effect).toContain('setVerifyMessage(null)');
    expect(effect).toContain('setVerifyUnresolved(false)');
    expect(effect).toMatch(/\}, \[open\]\)/);
  });

  it('counts the reconcile call as busy so the dialog cannot be closed mid-flight', () => {
    expect(source).toMatch(/const busy = stripeLoading \|\| emailLoading \|\| verifying/);
  });
});
