/**
 * Idempotency keys on the deposit-hold money paths.
 *
 * TWO OPPOSITE BUGS, BOTH REAL, BOTH IN THIS FILE
 *
 * 1. A key that does NOT move between attempts.
 *    The old refresh engine built its key from the OLD payment-intent id, which
 *    the failure path never updated. A retry inside Stripe's 24h idempotency
 *    window therefore replayed the cached decline verbatim — the card could have
 *    been topped up, the issuer could have cleared it, and the chain would still
 *    die on a stale answer. `deposit_hold_attempt_seq` is now in the key, so
 *    attempt N+1 is genuinely a new request.
 *
 * 2. A key that moves when it must NOT.
 *    The portal's charge-saved-card key was minted per opening of the confirm
 *    step. The operator's response to a timed-out request is to cancel and
 *    reopen — which under a per-open key issues a genuinely SECOND charge for
 *    the same money. The key is now DERIVED from the charge intent, so it
 *    survives reopen, remount and a full page reload.
 *
 * The two are in tension, and the resolution is the point: the refresh key moves
 * with the ATTEMPT (a counter the engine controls and persists), never with an
 * incidental UI event; the charge key moves only when a repeat has been PROVEN
 * safe (Stripe refused, so no charge exists) or explicitly demanded (the
 * operator confirmed a duplicate).
 *
 * Defect 2's own tail: because the refresh key always moves, a create that
 * SUCCEEDED at Stripe but whose response was lost can no longer be recovered by
 * a replay. That is what `findLiveDepositIntent` exists for, and the last block
 * here pins it.
 *
 * The key templates are LIFTED from the real files and executed. `fnv1aHex` and
 * `stableIntentToken` are the shipped functions, not copies.
 */

import { describe, it, expect } from 'vitest';
import {
  readEdgeSource,
  readPortalSource,
  liftDeclaration,
  compile,
  compileExpression,
  codeOnly,
} from '../helpers/edge-source';

// ---------------------------------------------------------------------------
// 1. The refresh engine — the key MUST move between attempts.
// ---------------------------------------------------------------------------

const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

/** The real template, lifted out of refreshOneHold and made callable. */
const refreshKey = compileExpression<
  (rentalId: string, attemptSeq: number, amountCents: number) => string
>(
  ['rentalId', 'attemptSeq', 'amountCents'],
  [liftDeclaration(engine, 'idempotencyKey')],
  'idempotencyKey',
);

describe('refresh engine — the key moves with the attempt', () => {
  it('produces a different key for attempt N and attempt N+1', () => {
    // THE regression. Same rental, same amount, next attempt: Stripe must treat
    // it as a new request, not replay the decline it cached 20 minutes ago.
    const a = refreshKey('r-1', 3, 50_000);
    const b = refreshKey('r-1', 4, 50_000);
    expect(a).not.toBe(b);
  });

  it('is stable for a given attempt, so a re-run of the same attempt cannot double-authorize', () => {
    expect(refreshKey('r-1', 3, 50_000)).toBe(refreshKey('r-1', 3, 50_000));
  });

  it('separates rentals and amounts', () => {
    expect(refreshKey('r-1', 3, 50_000)).not.toBe(refreshKey('r-2', 3, 50_000));
    // A rebased amount on the same key returns Stripe's `idempotency_error`,
    // which the card-feature ladder does not match — so the amount is in the key
    // rather than being allowed to collide.
    expect(refreshKey('r-1', 3, 50_000)).not.toBe(refreshKey('r-1', 3, 60_000));
  });

  it('does NOT embed the payment-intent id being replaced', () => {
    // The original defect, stated as an absence: the incumbent PI is exactly the
    // value the failure path never updated.
    const decl = liftDeclaration(engine, 'idempotencyKey');
    expect(decl).not.toContain('incumbentPi');
    expect(decl).toContain('attemptSeq');
  });

  it('increments attempt_seq on the claim, before Stripe is contacted', () => {
    // The counter has to be persisted BEFORE the create, or a crash mid-attempt
    // leaves the next run reusing the same key.
    const claim = engine.slice(
      engine.indexOf('const attemptSeq = Number(rental.deposit_hold_attempt_seq ?? 0) + 1;'),
      engine.indexOf('} catch (dbErr) {', engine.indexOf('deposit_hold_status: "refreshing"')),
    );
    expect(claim).toContain('deposit_hold_status: "refreshing"');
    expect(claim).toContain('deposit_hold_attempt_seq: attemptSeq');
    expect(engine.indexOf('deposit_hold_attempt_seq: attemptSeq')).toBeLessThan(
      engine.indexOf('const idempotencyKey ='),
    );
  });

  it('moves the key again when the card is swapped mid-attempt', () => {
    // A different card is a different request. Reusing the key there would
    // replay the FIRST card's decline against the second card.
    expect(engine).toContain('`${idempotencyKey}-pm2`');
  });

  it('places its first hold under an attempt-keyed key too', () => {
    // place-deposit-hold has the same shape: keyed on the ATTEMPT, not on the
    // rental — otherwise a rental whose first hold was released could never have
    // a second one placed.
    const place = readEdgeSource('place-deposit-hold/index.ts');
    const placeKey = compileExpression<(rentalId: string, attemptSeq: number) => string>(
      ['rentalId', 'attemptSeq'],
      [liftDeclaration(place, 'idempotencyKey')],
      'idempotencyKey',
    );
    expect(placeKey('r-1', 1)).not.toBe(placeKey('r-1', 2));
    expect(placeKey('r-1', 1)).toBe(placeKey('r-1', 1));
  });
});

describe('refresh engine — the consequence of an always-moving key', () => {
  it('sweeps for an untracked live authorization before creating another', () => {
    // Because the key always moves, a create that succeeded at Stripe but whose
    // response was lost cannot be recovered by replay. Left unhandled that is a
    // SECOND live authorization on the renter's card with the first invisible
    // forever — stampLinkIntent never ran, so its ledger row has a NULL
    // payment_intent_id and the reconciler explicitly refuses to guess on those.
    const orphan = engine.slice(
      engine.indexOf('// ── ORPHAN RECONCILIATION'),
      engine.indexOf('newIntent = await createReplacement(card.id, idempotencyKey, false)'),
    );
    expect(orphan).toContain('if (priorFailures > 0)');
    expect(orphan).toContain('findLiveDepositIntent(');
    // The sweep must happen BEFORE the create, or it is pointless.
    expect(engine.indexOf('findLiveDepositIntent(')).toBeLessThan(
      engine.indexOf('newIntent = await createReplacement(card.id, idempotencyKey, false)'),
    );
  });

  it('does not use Stripe search or an idempotency replay to find the orphan', () => {
    // paymentIntents.search lags writes by up to a minute, and a lagging index
    // here answers "no orphan" — the fail-OPEN direction. A replay only returns
    // the cached response for a byte-identical body, and the body carries the
    // payment method, which this engine re-resolves on every link.
    const fn = engine.slice(
      engine.indexOf('async function findLiveDepositIntent'),
      engine.indexOf('interface CasExpectation'),
    );
    expect(codeOnly(fn)).not.toContain('paymentIntents.search');
    expect(fn).toContain('paymentIntents.list');
    expect(fn).toContain('metadata');
  });

  it('sweeps the previously-anchored Stripe customer as well as the current one', () => {
    // The rental can be moved onto a new Stripe customer between attempts, and
    // the orphan stays attached to the old one.
    expect(engine).toContain('rental.deposit_hold_stripe_customer_id');
    const sweep = engine.slice(engine.indexOf('const sweepCustomers = ['), engine.indexOf('let orphan'));
    expect(sweep).toContain('customerId');
    expect(sweep).toContain('deposit_hold_stripe_customer_id');
  });
});

// ---------------------------------------------------------------------------
// 2. The portal charge dialog — the key must NOT move on a reopen.
// ---------------------------------------------------------------------------

const dialog = readPortalSource('components/shared/dialogs/add-payment-dialog.tsx');

const stableIntentToken = compile<(input: string) => string>(
  [liftDeclaration(dialog, 'fnv1aHex', { tsx: true }), liftDeclaration(dialog, 'stableIntentToken', { tsx: true })],
  'stableIntentToken',
);

/** The real intent string, lifted out of the component body. */
const chargeIntentFor = compileExpression<
  (
    rentalId: string | null,
    chargeAmount: number,
    targetCategories: string[] | undefined,
    extensionId: string | undefined,
  ) => string
>(
  ['rentalId', 'chargeAmount', 'targetCategories', 'extensionId'],
  [liftDeclaration(dialog, 'chargeIntent', { tsx: true })],
  'chargeIntent',
);

/** The real key builder, with the rotation map supplied as a parameter. */
const chargeRequestIdFor = compileExpression<
  (chargeRotations: { current: Map<string, number> }, intent: string) => string
>(
  ['chargeRotations', 'intent'],
  [
    liftDeclaration(dialog, 'stableIntentToken', { tsx: true }),
    liftDeclaration(dialog, 'fnv1aHex', { tsx: true }),
    liftDeclaration(dialog, 'chargeRequestIdFor', { tsx: true }),
  ],
  'chargeRequestIdFor(intent)',
);

/** A fresh rotation store, standing in for the component's useRef. */
const rotations = () => ({ current: new Map<string, number>() });

describe('charge dialog — the key survives a confirm-step reopen', () => {
  it('derives the same key from the same charge intent, every time', () => {
    // A pure function of (rental, amount, purpose) cannot change when the dialog
    // closes and reopens — which is the whole design.
    const intent = chargeIntentFor('r-1', 250, ['Rental'], undefined);
    expect(stableIntentToken(intent)).toBe(stableIntentToken(intent));

    // Reopen: a brand-new component instance, so a brand-new rotation ref.
    const first = chargeRequestIdFor(rotations(), intent);
    const afterReopen = chargeRequestIdFor(rotations(), intent);
    expect(afterReopen).toBe(first);
  });

  it('does not fold the operator\'s free-text reason into the key', () => {
    // Reason wording varies between attempts ("card retry", "card retry 2"). Any
    // input the operator retypes on a retry would mint a new key and defeat the
    // guard — the very failure this replaced.
    const decl = liftDeclaration(dialog, 'chargeIntent', { tsx: true });
    expect(decl).not.toContain('reason');
    expect(decl).not.toContain('chargeReason');
  });

  it('is a function of exactly rental, amount and purpose', () => {
    const base = chargeIntentFor('r-1', 250, ['Rental'], undefined);
    expect(chargeIntentFor('r-2', 250, ['Rental'], undefined)).not.toBe(base);
    expect(chargeIntentFor('r-1', 250.01, ['Rental'], undefined)).not.toBe(base);
    expect(chargeIntentFor('r-1', 250, ['Tax'], undefined)).not.toBe(base);
    expect(chargeIntentFor('r-1', 250, ['Rental'], 'ext-9')).not.toBe(base);
  });

  it('normalises the amount so 250 and 250.00 are the same charge', () => {
    expect(chargeIntentFor('r-1', 250, [], undefined)).toBe(chargeIntentFor('r-1', 250.0, [], undefined));
  });

  it('produces a stable, short token — the same input, the same 16 hex chars', () => {
    const t = stableIntentToken('r-1|250.00|Rental|');
    expect(t).toMatch(/^[0-9a-f]{16}$/);
    expect(stableIntentToken('r-1|250.00|Rental|')).toBe(t);
    expect(stableIntentToken('r-1|250.01|Rental|')).not.toBe(t);
  });
});

describe('charge dialog — the key moves only when a repeat is proven safe', () => {
  it('steps the key when the operator confirms a deliberate duplicate', () => {
    const store = rotations();
    const intent = chargeIntentFor('r-1', 250, [], undefined);
    const first = chargeRequestIdFor(store, intent);
    store.current.set(intent, 1);
    expect(chargeRequestIdFor(store, intent)).not.toBe(first);
    expect(chargeRequestIdFor(store, intent)).toBe(`${first}-r1`);
  });

  it('rotates ONCE per intent no matter how many times the duplicate is overridden', () => {
    // Overriding twice must retry the SAME second charge, not create a third.
    const handler = dialog.slice(dialog.indexOf('const intent = chargeIntent;'), dialog.indexOf('chargeInFlight.current = true;'));
    expect(handler).toContain('!chargeDuplicateOverridden.current.has(intent)');
    expect(handler).toContain('chargeDuplicateOverridden.current.add(intent)');
    expect(handler).toContain('rotateChargeRequestId(intent)');
  });

  it('steps the key only for the two codes that prove Stripe refused', () => {
    // charge_failed / charge_not_succeeded mean the function reached Stripe and
    // Stripe said no, so no charge exists and the cached failure would otherwise
    // be replayed for 24h — even after the customer's bank clears the card.
    const errorPath = dialog.slice(dialog.indexOf("if (detail.code === 'charge_failed'"), dialog.indexOf('throw new Error(detail.message);'));
    expect(errorPath).toContain("detail.code === 'charge_failed' || detail.code === 'charge_not_succeeded'");
    expect(errorPath).toContain('rotateChargeRequestId(intent)');
  });

  it('leaves the key ALONE when we do not know whether the money moved', () => {
    // A timeout, a dropped connection, or charged_but_not_recorded: the charge
    // may well have gone through, and replaying the same key is exactly what
    // stops a second one.
    const unrecorded = dialog.slice(
      dialog.indexOf("if (detail.code === 'charged_but_not_recorded')"),
      dialog.indexOf("if (detail.code === 'possible_duplicate')"),
    );
    expect(codeOnly(unrecorded)).not.toContain('rotateChargeRequestId');
    expect(unrecorded).toContain('setChargeUnrecorded(');

    // …and the catch-all tells the operator retrying is safe rather than
    // asserting a failure it cannot know about.
    const catchAll = dialog.slice(dialog.indexOf('console.error("Error charging saved card:", error);'));
    expect(codeOnly(catchAll.slice(0, 900))).not.toContain('rotateChargeRequestId');
    expect(catchAll).toContain('Charge did not complete');
    expect(catchAll).toMatch(/Retrying is safe/);
  });

  it('does not drop the rotations when the dialog closes', () => {
    // Clearing them on close would rewind a burnt key: the next open would reuse
    // a key Stripe has already answered, and a genuinely-new charge would be
    // served the old PaymentIntent back.
    const onClose = dialog.slice(dialog.indexOf('// Reset form when dialog closes'), dialog.indexOf('const selectedCustomerId'));
    expect(codeOnly(onClose)).not.toContain('chargeRotations.current.clear');
    expect(onClose).toMatch(/chargeRotations is NOT cleared/);
  });

  it('steps the key after a settled charge, so a later identical charge is not replayed', () => {
    const from = dialog.indexOf("if (onPaymentSuccess) onPaymentSuccess('recorded');");
    expect(from).toBeGreaterThan(-1);
    const success = dialog.slice(from, dialog.indexOf('setChargeCardOpen(false);', from));
    expect(success).toContain('rotateChargeRequestId(intent)');
    expect(success).toContain('chargeDuplicateOverridden.current.delete(intent)');
  });
});
