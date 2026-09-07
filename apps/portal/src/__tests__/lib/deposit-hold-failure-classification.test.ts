/**
 * Failure classification and retry backoff for the chained deposit hold.
 *
 * WHY THIS SUITE EXISTS
 * The 90-day chain was proven end to end against a live Stripe test account —
 * 16 consecutive re-authorisations, a mid-chain decline, a honoured backoff and
 * a recovery. But two paths could NOT be reached that way:
 *
 *   * MAX_HOLD_ATTEMPTS (8) escalation — the live run only ever reached a
 *     failure_count of 1, because provoking eight consecutive declines against
 *     real Stripe means eight real authorisations and a fixture that survives
 *     all of them.
 *   * SCA / `requires_action` — Stripe only returns it for specific test cards
 *     on off-session confirms, and the fixture had already been consumed.
 *
 * Both decisions are made by PURE functions, so they can be lifted from the edge
 * source and executed here for real. This is not a mock: `classifyStripeFailure`
 * and `computeRetryAt` below ARE the production implementations.
 *
 * THE INCIDENT THIS GUARDS
 * Misclassification is not cosmetic. 'ambiguous' routes to `needs_review`, which
 * the refresh driver does NOT re-select — so a class that lands there is a chain
 * that silently stops being renewed while the car is still out. `generic_decline`
 * and `do_not_honor` are the two most common declines in existence; if either
 * ever falls through to 'ambiguous', most chains die on a routine hiccup.
 */

import { describe, it, expect } from 'vitest';
import { readEdgeSource, liftDeclaration, compile } from '../helpers/edge-source';

const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

type FailureClass = 'transient' | 'funds' | 'sca' | 'dead_card' | 'ambiguous';

const classifyStripeFailure = compile<(err: unknown) => FailureClass>(
  [
    liftDeclaration(engine, 'TRANSIENT_CODES'),
    liftDeclaration(engine, 'FUNDS_CODES'),
    liftDeclaration(engine, 'DEAD_CARD_CODES'),
    liftDeclaration(engine, 'stripeErrorCode'),
    liftDeclaration(engine, 'classifyStripeFailure'),
  ],
  'classifyStripeFailure',
);

const computeRetryAt = compile<
  (cls: FailureClass, priorFailures: number, expiresAt: string | null, now?: Date) => string
>(
  [
    liftDeclaration(engine, 'TRANSIENT_BACKOFF_HOURS'),
    liftDeclaration(engine, 'FUNDS_BACKOFF_HOURS'),
    liftDeclaration(engine, 'computeRetryAt'),
  ],
  'computeRetryAt',
);

const MAX_HOLD_ATTEMPTS = Number(
  /export const MAX_HOLD_ATTEMPTS = (\d+)/.exec(engine)![1],
);

const NOW = new Date('2026-08-11T12:00:00.000Z');
const hoursBetween = (iso: string, from: Date = NOW) =>
  (new Date(iso).getTime() - from.getTime()) / 3_600_000;

/** A Stripe-shaped error. */
const stripeErr = (fields: Record<string, unknown>) => ({ ...fields });

describe('classifyStripeFailure', () => {
  describe('SCA — the path the live run could not reach', () => {
    it('classifies authentication_required as sca', () => {
      expect(classifyStripeFailure(stripeErr({ code: 'authentication_required' }))).toBe('sca');
    });

    it('classifies payment_intent_authentication_failure as sca', () => {
      expect(
        classifyStripeFailure(stripeErr({ code: 'payment_intent_authentication_failure' })),
      ).toBe('sca');
    });

    it('reads SCA off decline_code in preference to code', () => {
      // stripeErrorCode() prefers decline_code, and Stripe sends the specific
      // reason there while `code` stays the generic 'card_declined'.
      expect(
        classifyStripeFailure(
          stripeErr({ code: 'card_declined', decline_code: 'authentication_required' }),
        ),
      ).toBe('sca');
    });

    it('finds SCA nested under raw (the shape the Stripe SDK actually throws)', () => {
      expect(classifyStripeFailure(stripeErr({ raw: { code: 'authentication_required' } }))).toBe(
        'sca',
      );
    });

    it('does NOT let SCA fall through to ambiguous', () => {
      // ambiguous => needs_review => the driver never re-selects it.
      expect(classifyStripeFailure(stripeErr({ code: 'authentication_required' }))).not.toBe(
        'ambiguous',
      );
    });
  });

  describe('the two most common declines must never be ambiguous', () => {
    it.each(['generic_decline', 'do_not_honor'])('%s is a funds decline, not ambiguous', (code) => {
      expect(classifyStripeFailure(stripeErr({ decline_code: code }))).toBe('funds');
    });

    it.each([
      'insufficient_funds',
      'withdrawal_count_limit_exceeded',
      'card_velocity_exceeded',
      'call_issuer',
      'transaction_not_allowed',
      'service_not_allowed',
      'card_declined',
    ])('%s takes the funds ladder', (code) => {
      expect(classifyStripeFailure(stripeErr({ decline_code: code }))).toBe('funds');
    });
  });

  describe('dead card — re-resolve the payment method', () => {
    it.each(['expired_card', 'lost_card', 'stolen_card', 'pickup_card', 'restricted_card'])(
      '%s is dead_card',
      (code) => {
        expect(classifyStripeFailure(stripeErr({ decline_code: code }))).toBe('dead_card');
      },
    );

    it('treats resource_missing as dead_card, not ambiguous', () => {
      expect(classifyStripeFailure(stripeErr({ code: 'resource_missing' }))).toBe('dead_card');
    });
  });

  describe('transient — never the renter’s fault', () => {
    it('classifies HTTP 429 as transient', () => {
      expect(classifyStripeFailure(stripeErr({ statusCode: 429 }))).toBe('transient');
    });

    it.each([500, 502, 503])('classifies HTTP %i as transient', (statusCode) => {
      expect(classifyStripeFailure(stripeErr({ statusCode }))).toBe('transient');
    });

    it.each(['StripeConnectionError', 'StripeAPIError'])('classifies %s as transient', (type) => {
      expect(classifyStripeFailure(stripeErr({ type }))).toBe('transient');
    });

    it('classifies OUR OWN database failures as transient, not ambiguous', () => {
      // db_write_failed is tagged by casUpdate. Untagged it fell through to
      // ambiguous -> needs_review with next_retry_at NULL, i.e. a PostgREST
      // blip silently retired a rental from the retry loop.
      expect(classifyStripeFailure(stripeErr({ code: 'db_write_failed' }))).toBe('transient');
    });

    it('classifies a fetch TypeError as transient', () => {
      expect(classifyStripeFailure(new TypeError('fetch failed'))).toBe('transient');
    });
  });

  describe('genuinely unknown failures stay ambiguous', () => {
    it('an untagged Error is ambiguous', () => {
      expect(classifyStripeFailure(new Error('something odd'))).toBe('ambiguous');
    });

    it('an unrecognised decline_code is ambiguous', () => {
      expect(classifyStripeFailure(stripeErr({ decline_code: 'some_new_code' }))).toBe('ambiguous');
    });

    it('null/undefined do not throw', () => {
      expect(classifyStripeFailure(null)).toBe('ambiguous');
      expect(classifyStripeFailure(undefined)).toBe('ambiguous');
    });
  });
});

describe('computeRetryAt', () => {
  describe('funds declines take the long ladder and are NOT clamped', () => {
    it.each([
      [0, 24],
      [1, 72],
      [2, 72],
    ])('prior failures %i -> %ih', (prior, hours) => {
      expect(hoursBetween(computeRetryAt('funds', prior, null, NOW))).toBeCloseTo(hours, 5);
    });

    it('ignores an imminent expiry rather than re-presenting a declined card', () => {
      // The clamp exists to make a retry SOONER. For funds that would mean
      // hammering a card the issuer just refused, so it must not apply.
      const soon = new Date(NOW.getTime() + 2 * 3_600_000).toISOString();
      expect(hoursBetween(computeRetryAt('funds', 0, soon, NOW))).toBeCloseTo(24, 5);
    });

    it('saturates at the last rung rather than running off the end of the ladder', () => {
      // This is what a row at MAX_HOLD_ATTEMPTS would ask for.
      expect(hoursBetween(computeRetryAt('funds', 99, null, NOW))).toBeCloseTo(72, 5);
    });
  });

  describe('non-funds failures take the short ladder', () => {
    it.each([
      [0, 6],
      [1, 24],
      [2, 72],
    ])('prior failures %i -> %ih', (prior, hours) => {
      expect(hoursBetween(computeRetryAt('transient', prior, null, NOW))).toBeCloseTo(hours, 5);
    });

    it('saturates at the last rung', () => {
      expect(hoursBetween(computeRetryAt('transient', 99, null, NOW))).toBeCloseTo(72, 5);
    });
  });

  describe('the expiry clamp can only ever SHORTEN the wait', () => {
    it('pulls the retry back to an hour before the deadline', () => {
      const deadline = new Date(NOW.getTime() + 10 * 3_600_000).toISOString();
      expect(hoursBetween(computeRetryAt('transient', 2, deadline, NOW))).toBeCloseTo(9, 5);
    });

    it('never pushes it out past the ladder', () => {
      const farOff = new Date(NOW.getTime() + 1000 * 3_600_000).toISOString();
      expect(hoursBetween(computeRetryAt('transient', 0, farOff, NOW))).toBeCloseTo(6, 5);
    });

    it('floors at 30 minutes so a hard-down Stripe cannot become a hot loop', () => {
      const alreadyPast = new Date(NOW.getTime() - 5 * 3_600_000).toISOString();
      expect(hoursBetween(computeRetryAt('transient', 0, alreadyPast, NOW))).toBeCloseTo(0.5, 5);
    });

    it('ignores an unparseable deadline instead of producing an invalid date', () => {
      const out = computeRetryAt('transient', 0, 'not-a-date', NOW);
      expect(Number.isNaN(new Date(out).getTime())).toBe(false);
      expect(hoursBetween(out)).toBeCloseTo(6, 5);
    });
  });

  describe('every class yields a usable future timestamp', () => {
    it.each<FailureClass>(['transient', 'funds', 'sca', 'dead_card', 'ambiguous'])(
      '%s produces a parseable ISO time in the future',
      (cls) => {
        const out = computeRetryAt(cls, 0, null, NOW);
        expect(Number.isNaN(new Date(out).getTime())).toBe(false);
        expect(new Date(out).getTime()).toBeGreaterThan(NOW.getTime());
      },
    );
  });
});

describe('MAX_HOLD_ATTEMPTS', () => {
  it("is 8, matching Stripe's published retry guidance", () => {
    // "We recommend a maximum of eight retries… issuers might see additional
    // retries as potential fraud."
    expect(MAX_HOLD_ATTEMPTS).toBe(8);
  });

  it('escalates to needs_review rather than a terminal status', () => {
    // The distinction that matters: needs_review is a human queue, 'expired' is
    // a claim the money is gone. Exhausting retries must never assert the
    // latter — the authorization may still be live.
    const source = engine.slice(engine.indexOf('failureCount >= MAX_HOLD_ATTEMPTS'));
    expect(source.slice(0, 400)).toMatch(/needs_review/);
    expect(source.slice(0, 400)).not.toMatch(/deposit_hold_status:\s*["']expired["']/);
  });

  it('never writes a terminal "expired" from the engine at all', () => {
    // A generic error must not be able to condemn a live authorization.
    expect(engine).not.toMatch(/deposit_hold_status:\s*["']expired["']/);
  });
});
