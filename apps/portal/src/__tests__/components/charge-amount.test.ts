/**
 * "How much does this button actually charge?"
 *
 * Two dialogs move money off a saved card without the customer present, and
 * both of them are one click from an irreversible debit:
 *
 *   * AddPaymentDialog → "Charge saved card" (charge-saved-card). Operator types
 *     an amount.
 *   * ChargeDepositDialog → "Charge" (capture-deposit-hold). Captures the
 *     authorisation already on the card.
 *
 * THE FAILURE THIS GUARDS
 * The obvious-looking amount expression is a fallback chain:
 *
 *     const amount = typedAmount || outstandingBalance || monthly_amount || 0
 *
 * which charges a number that was never on screen the moment the operator clears
 * the field, or clicks before the auto-fill lands. The link buttons can survive
 * that (the customer sees the real figure on Stripe's own page and has to
 * consent); a direct off-session charge cannot, because the confirmation dialog
 * is the last thing ANYONE sees before the money is gone.
 *
 * So the rule is: the charge is EXACTLY the displayed figure, and an empty or
 * non-positive field charges nothing and says why.
 *
 * The amount expressions are computed inside the component bodies, so they are
 * LIFTED from the real files and executed with their inputs supplied. The
 * component cannot be rendered here — apps/portal pins React 18.3.1 while the
 * monorepo root hoists React 19 for admin/web, so root-hoisted UI packages hand
 * React-19 elements to portal's React-18 renderer. See helpers/source.ts.
 */

import { describe, it, expect } from 'vitest';
import { readPortalSource, liftDeclaration, compileExpression, codeOnly } from '../helpers/edge-source';

const dialog = readPortalSource('components/shared/dialogs/add-payment-dialog.tsx');

/** The real derivation: `Number(watchedAmount)` -> the figure that is charged. */
const chargeAmountFor = compileExpression<(watchedAmount: unknown) => number>(
  ['watchedAmount'],
  [
    liftDeclaration(dialog, 'parsedChargeAmount', { tsx: true }),
    liftDeclaration(dialog, 'chargeAmount', { tsx: true }),
  ],
  'chargeAmount',
);

/** The real "why is this button unavailable" ladder. */
const blockedReasonFor = compileExpression<
  (
    rentalId: string | null,
    chargeAmount: number,
    chargeHasNoBasis: boolean,
  ) => string | null
>(
  ['rentalId', 'chargeAmount', 'chargeHasNoBasis'],
  [liftDeclaration(dialog, 'chargeBlockedReason', { tsx: true })],
  'chargeBlockedReason',
);

/** The real "no outstanding balance at all" predicate. */
const hasNoBasis = compileExpression<
  (defaultAmount: unknown, breakdownItems: unknown, outstandingBalance: unknown) => boolean
>(
  ['defaultAmount', 'breakdownItems', 'outstandingBalance'],
  [liftDeclaration(dialog, 'chargeHasNoBasis', { tsx: true })],
  'chargeHasNoBasis',
);

/** The real overpayment predicate. */
const isOverpayment = compileExpression<
  (
    defaultAmount: unknown,
    breakdownItems: unknown,
    outstandingBalance: unknown,
    chargeAmount: number,
  ) => boolean
>(
  ['defaultAmount', 'breakdownItems', 'outstandingBalance', 'chargeAmount'],
  [liftDeclaration(dialog, 'chargeIsOverpayment', { tsx: true })],
  'chargeIsOverpayment',
);

describe('charge-saved-card — the amount is exactly what is on screen', () => {
  it('charges the typed figure, unrounded surprises included', () => {
    expect(chargeAmountFor(250)).toBe(250);
    expect(chargeAmountFor('250')).toBe(250);
    expect(chargeAmountFor(250.5)).toBe(250.5);
    expect(chargeAmountFor('1234.56')).toBe(1234.56);
  });

  it('rounds to whole cents rather than sending a float Stripe would reject', () => {
    expect(chargeAmountFor(10.005)).toBe(10.01);
    expect(chargeAmountFor(0.014)).toBe(0.01);
  });

  it('refuses an EMPTY field — no fallback to anything', () => {
    // The whole point. `undefined` is what react-hook-form holds before the
    // auto-fill lands and after the operator clears the input.
    expect(chargeAmountFor(undefined)).toBe(0);
    expect(chargeAmountFor(null)).toBe(0);
    expect(chargeAmountFor('')).toBe(0);
  });

  it('refuses a non-positive or non-numeric field', () => {
    expect(chargeAmountFor(0)).toBe(0);
    expect(chargeAmountFor(-50)).toBe(0);
    expect(chargeAmountFor('abc')).toBe(0);
    expect(chargeAmountFor(NaN)).toBe(0);
    expect(chargeAmountFor(Infinity)).toBe(0);
  });

  it('blocks the button and explains, rather than charging 0 or charging something else', () => {
    expect(blockedReasonFor('r-1', chargeAmountFor(undefined), false)).toBe(
      'Enter the amount to charge above — the card is charged exactly this figure.',
    );
    expect(blockedReasonFor('r-1', chargeAmountFor(-1), false)).toMatch(/Enter the amount/);
    expect(blockedReasonFor('r-1', chargeAmountFor(250), false)).toBeNull();
  });

  it('blocks when there is no rental to charge against', () => {
    expect(blockedReasonFor(null, 250, false)).toBe('Pick the rental this payment applies to first.');
  });

  it('blocks when the customer owes nothing at all', () => {
    expect(hasNoBasis(undefined, undefined, 0)).toBe(true);
    expect(blockedReasonFor('r-1', 250, hasNoBasis(undefined, undefined, 0))).toBe(
      'This customer has no outstanding balance to charge.',
    );
    // …but not when the caller supplied the amount (extension / targeted
    // payments), exactly as the manual Record-Payment path skips it.
    expect(hasNoBasis(199, undefined, 0)).toBe(false);
    expect(hasNoBasis(undefined, [{ amount: 199 }], 0)).toBe(false);
    // …and not when the balance simply has not loaded yet.
    expect(hasNoBasis(undefined, undefined, undefined)).toBe(false);
  });

  it('makes the operator acknowledge an overpayment instead of silently banking credit', () => {
    expect(isOverpayment(undefined, undefined, 100, 250)).toBe(true);
    expect(isOverpayment(undefined, undefined, 100, 100)).toBe(false);
    expect(isOverpayment(undefined, undefined, 100, 50)).toBe(false);
    // Not asked when the caller supplied the figure.
    expect(isOverpayment(250, undefined, 100, 250)).toBe(false);
  });

  it('carries no fallback chain anywhere in the derivation', () => {
    // Stated as an absence, because that is how the bug returns: someone adds
    // `|| outstandingBalance` to make a half-loaded dialog feel less broken.
    const decl = liftDeclaration(dialog, 'chargeAmount', { tsx: true });
    expect(decl).not.toMatch(/outstandingBalance/);
    expect(decl).not.toMatch(/defaultAmount/);
    expect(decl).not.toMatch(/breakdownTotal/);
    expect(decl).not.toMatch(/monthly_amount/);
    expect(decl).not.toMatch(/\?\?/);
  });
});

describe('charge-saved-card — the submitted amount is the same number', () => {
  const submit = dialog.slice(
    dialog.indexOf('const handleChargeSavedCard'),
    dialog.indexOf('const handleSendInvoiceEmail'),
  );

  it('sends chargeAmount itself, not a re-read of the form', () => {
    // A second `form.getValues()` here would reopen the gap: the field can change
    // between render and submit.
    expect(submit).toContain('const amount = chargeAmount;');
    expect(submit).toContain('amount: Math.round(amount * 100) / 100,');
  });

  it('refuses a non-positive amount at the submit boundary too', () => {
    // Belt to the disabled button's braces — the button can be re-enabled by a
    // stale render, and this is a money path.
    const guard = submit.slice(0, submit.indexOf('const intent = chargeIntent;'));
    expect(guard).toMatch(/if \(!\(amount > 0\)\)|if \(amount <= 0\)|!Number\.isFinite\(amount\)/);
  });

  it('requires a written reason before anything moves', () => {
    expect(submit).toContain('reason.length < MIN_CHARGE_REASON_LENGTH');
    expect(dialog).toMatch(/const MIN_CHARGE_REASON_LENGTH = \d+;/);
  });

  it('shows the operator the exact figure on the confirm button', () => {
    // If the button ever shows a different number from the one submitted, the
    // dialog is lying at the last possible moment.
    const confirm = dialog.slice(dialog.indexOf('The card is charged <strong>exactly'));
    expect(confirm).toContain('formatCurrency(chargeAmount, tenant?.currency_code || \'USD\')');
    expect(confirm).toMatch(/Charge \{formatCurrency\(chargeAmount/);
  });

  it('keeps the button out of the hands of anyone the edge function would refuse', () => {
    // Mirrors charge-saved-card's server-side RBAC gate. hasRole() also enforces
    // is_active, so a deactivated account fails both arms.
    expect(dialog).toContain("const canChargeSavedCard = hasRole(['head_admin', 'admin'])");
    expect(dialog).toContain("|| (hasRole('manager') && canEdit('payments'));");
  });
});

describe('ChargeDepositDialog — captures the authorised figure, and only that', () => {
  const deposit = readPortalSource('components/shared/dialogs/charge-deposit-dialog.tsx');

  it('sends the hold amount the row carries, with no operator-editable input', () => {
    // Partial captures are off until Stripe approves multicapture: without it a
    // partial capture releases the remainder back to the customer and we would
    // have to place a fresh authorisation, which the customer sees as the hold
    // dropping off and a new one appearing.
    const submit = deposit.slice(deposit.indexOf('const onSubmit'), deposit.indexOf('const busy ='));
    expect(submit).toContain('amount: holdAmount,');
    // The form schema carries ONLY the reason — there is no amount field to get
    // out of step with the figure on screen.
    expect(deposit).toMatch(/const schema = z\.object\(\{\s*reason: z\.string\(\)/);
    expect(codeOnly(deposit)).not.toMatch(/amount: z\./);
  });

  it('displays the same figure it will capture', () => {
    const shown = deposit.slice(deposit.indexOf('Amount to charge'), deposit.indexOf('Amount to charge') + 400);
    expect(shown).toContain('formatCurrency(holdAmount, currency)');
  });

  it('states the full-capture consequence before the operator clicks', () => {
    expect(deposit).toContain('Partial pre-auth charging is not available right now.');
    expect(deposit).toMatch(/capture the <strong>full \{formatCurrency\(holdAmount, currency\)\}<\/strong>/);
  });
});
