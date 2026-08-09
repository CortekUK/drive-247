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

  it('treats BOTH a live hold and an unreadable one as unresolved', () => {
    // needsReview means the PaymentIntent could not be read at all (wrong
    // platform account, resource_missing). Clearing the block on that would let
    // an operator authorise a card that may already be holding funds.
    expect(handler).toMatch(/const unresolved = liveHold \|\| data\?\.needsReview === true/);
  });

  it('only unblocks placement when the authorisation is conclusively dead', () => {
    expect(handler).toMatch(/if \(!unresolved\) setHoldConflict\(false\)/);
  });

  it('prefers the function\'s own message but always says something', () => {
    expect(handler).toContain('setVerifyMessage(data?.message ||');
    expect(handler).toContain('Stripe still has a live authorisation');
    expect(handler).toContain('Stripe has no live authorisation');
  });

  it('reports a failed reconcile without pretending it succeeded', () => {
    expect(handler).toContain('title: "Could not check with Stripe"');
    expect(handler).toContain('variant: "destructive"');
    // The conflict panel is untouched in the catch — the block must stay up.
    const catchBlock = handler.slice(handler.indexOf('} catch'));
    expect(catchBlock).not.toContain('setHoldConflict(false)');
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
