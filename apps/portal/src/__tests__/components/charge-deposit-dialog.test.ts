/**
 * ChargeDepositDialog — the expiry copy.
 *
 * This dialog used to tell every tenant that "Stripe card holds only last about
 * 7 days". That number was never ours to quote: the window depends on the card
 * and the account (extended authorization reaches 30 days), and an operator
 * running GMT's 60-120 day rentals needs the date this particular authorisation
 * dies, not a rule of thumb. formatHoldExpiry now drives that copy from
 * rentals.deposit_hold_expires_at.
 *
 * formatHoldExpiry is executed for real (lifted out of the source — the
 * component itself cannot be rendered here; see helpers/source.ts). The copy
 * that consumes it is asserted against the source.
 */

import { describe, it, expect } from 'vitest';
import { readAppSource, sliceModuleConst, evalModuleConsts } from '../helpers/source';

const source = readAppSource('components/shared/dialogs/charge-deposit-dialog.tsx');

type Expiry = { lapsed: boolean; urgent: boolean; dateLabel: string; remaining: string | null } | null;

const formatHoldExpiry = evalModuleConsts<(v: string | null | undefined) => Expiry>(
  [sliceModuleConst(source, 'formatHoldExpiry')],
  'formatHoldExpiry',
);

/** The file with every comment removed — i.e. only what an operator can read. */
const renderedCopy = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // JSX comments
  .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
  .replace(/^\s*\/\/.*$/gm, ''); // line comments

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('formatHoldExpiry', () => {
  it('says nothing when there is no expiry to report', () => {
    // Most rentals have no hold; a mystery date line would be worse than none.
    expect(formatHoldExpiry(null)).toBeNull();
    expect(formatHoldExpiry(undefined)).toBeNull();
    expect(formatHoldExpiry('')).toBeNull();
  });

  it('says nothing for a value Date cannot parse', () => {
    expect(formatHoldExpiry('whenever')).toBeNull();
  });

  it('flags a lapsed authorisation and stops counting down', () => {
    const r = formatHoldExpiry(inMs(-3 * DAY))!;
    expect(r.lapsed).toBe(true);
    expect(r.urgent).toBe(true);
    expect(r.remaining).toBeNull();
    expect(r.dateLabel).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it('treats the exact moment of expiry as already lapsed', () => {
    expect(formatHoldExpiry(new Date(Date.now() - 1).toISOString())!.lapsed).toBe(true);
  });

  it('is urgent strictly inside 3 days and calm at 3', () => {
    // Same threshold the rental page uses, so the two screens cannot disagree
    // about whether a hold is in trouble.
    expect(formatHoldExpiry(inMs(2 * DAY + 23 * HOUR))!.urgent).toBe(true);
    expect(formatHoldExpiry(inMs(3 * DAY + HOUR))!.urgent).toBe(false);
  });

  it('counts down in days, then hours, then gives up on precision', () => {
    expect(formatHoldExpiry(inMs(10 * DAY + HOUR))!.remaining).toBe('10 days left');
    expect(formatHoldExpiry(inMs(DAY + HOUR))!.remaining).toBe('1 day left');
    expect(formatHoldExpiry(inMs(5 * HOUR + 60_000))!.remaining).toBe('5 hours left');
    expect(formatHoldExpiry(inMs(HOUR + 60_000))!.remaining).toBe('1 hour left');
    expect(formatHoldExpiry(inMs(20 * 60_000))!.remaining).toBe('under an hour left');
  });
});

describe('ChargeDepositDialog — copy', () => {
  it('no longer quotes a hold lifetime it cannot know', () => {
    // The regression this file exists for. Comments are stripped first — the
    // file deliberately quotes the old sentence in a comment to record why it
    // went, and that note should not be what keeps this test honest.
    expect(renderedCopy).not.toMatch(/about 7 days/);
    expect(renderedCopy).not.toMatch(/only last about/);
    // …and does not swap one invented number for another.
    expect(renderedCopy.match(/last(?:s)? (?:about )?\d+ days?/gi)).toBeNull();
  });

  it('names the lapse date only once it has actually passed', () => {
    // A hold can also die early (bank pulls it, or it is cancelled) while
    // deposit_hold_expires_at is still in the future; naming a future date as
    // the moment it "lapsed" would just confuse the operator.
    const refreshPhase = source.slice(source.indexOf('This pre-authorization hold has expired.'), source.indexOf('Refresh hold'));
    expect(refreshPhase).toContain('expiry?.lapsed ?');
    const [namedBranch, genericBranch] = refreshPhase
      .slice(refreshPhase.indexOf('expiry?.lapsed ?'))
      .split(') : (');
    expect(namedBranch).toContain('{expiry.dateLabel}');
    expect(genericBranch).not.toContain('dateLabel');
    expect(genericBranch).toContain('Card authorisations are temporary');
  });

  it('warns in the charge phase that a lapsed authorisation will likely decline', () => {
    // Capturing a dead authorisation fails at Stripe; the operator should know
    // before they click, not after.
    const chargePhase = source.slice(source.indexOf('Amount to charge'));
    expect(chargePhase).toContain('expiry.lapsed');
    expect(chargePhase).toMatch(/likely be declined/);
    expect(chargePhase).toMatch(/Check with Stripe from the rental page/);
  });

  it('escalates the charge-phase expiry line from muted to amber to red', () => {
    const chargePhase = source.slice(source.indexOf('Amount to charge'));
    expect(chargePhase).toContain("expiry.lapsed ? \"text-red-500 font-medium\"");
    expect(chargePhase).toContain('expiry.urgent ? "text-amber-500 font-medium"');
    expect(chargePhase).toContain('"text-muted-foreground"');
  });

  it('renders no expiry line at all when the rental has no recorded expiry', () => {
    // formatHoldExpiry returns null and the JSX is gated on the result, so a
    // rental with a null column shows nothing rather than "Invalid Date".
    expect(source).toMatch(/\{expiry && \(/);
  });
});

describe('ChargeDepositDialog — behaviour that must not drift', () => {
  it('takes the expiry from the rental row rather than inventing one', () => {
    const page = readAppSource('app/(dashboard)/rentals/[id]/page.tsx');
    expect(page).toContain('holdExpiresAt={rental.deposit_hold_expires_at}');
    expect(page).toContain('holdStatus={rental.deposit_hold_status}');
  });

  it('opens straight into the refresh step when the hold is already expired', () => {
    // A dead authorisation cannot be captured; offering Charge first would just
    // produce a Stripe error.
    expect(source).toMatch(/setPhase\(holdStatus === "expired" \? "refresh" : "charge"\)/);
  });

  it('still requires a reason before any capture', () => {
    // The reason is written onto the payment record and is what the customer is
    // shown when they query the charge.
    expect(source).toMatch(/reason: z\.string\(\)\.min\(1, "Reason is required"\)/);
    const submit = source.slice(source.indexOf('const onSubmit'), source.indexOf('const busy ='));
    expect(submit).toContain('reason: data.reason');
  });

  it('self-heals to the refresh step if the hold dies mid-dialog', () => {
    const submit = source.slice(source.indexOf('const onSubmit'), source.indexOf('const busy ='));
    expect(submit).toContain('result?.code === "hold_expired"');
    expect(submit).toContain('setPhase("refresh")');
  });

  it('keeps the full-capture lock and its explanation', () => {
    // Partial captures stay off until Stripe approves multicapture — without it
    // a partial capture releases the remainder back to the customer.
    expect(source).toContain('Partial pre-auth charging is not available right now.');
    expect(source).toMatch(/multicapture/);
  });
});
