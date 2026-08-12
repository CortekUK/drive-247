/**
 * Decline classification — every Stripe error the chain engine handles, mapped
 * to the status it lands on and whether it will be retried.
 *
 * WHY THIS IS THE MOST LOAD-BEARING TABLE IN THE FEATURE
 * The old engine had no taxonomy at all: every throw wrote terminal 'expired'
 * and the driver only re-selected 'held', so ONE bad night ended a 90-day chain
 * permanently and silently. The fix is this classifier plus a status ladder, and
 * both are only as good as the codes they know about. Two failure directions,
 * both bad:
 *
 *   * A code that falls through to 'ambiguous' becomes 'needs_review' with NO
 *     retry time. That RETIRES the rental from the retry loop. `do_not_honor`
 *     and `generic_decline` are the two most common declines in existence — a
 *     dead-end on either would end most chains on a routine hiccup. So they are
 *     classified 'funds' (long ladder), not 'ambiguous'.
 *   * A code wrongly called 'transient' gets re-presented to the issuer on a 6h
 *     ladder. Stripe: "issuers might see additional retries as potential fraud."
 *     Real money declines take the 24/72/72 ladder instead, and MAX_HOLD_ATTEMPTS
 *     stops the whole thing at 8.
 *
 * `classifyStripeFailure`, `stripeErrorCode`, `computeRetryAt` and the three code
 * sets are LIFTED from `_shared/deposit-hold-refresh.ts` and executed — these are
 * the shipped functions. `nextState` below is a REPLICA of the ladder inside
 * `recordFailure`, which is a closure inside a 900-line function and cannot be
 * lifted; the block "the replica matches the real ladder" pins each of its five
 * branches against the real source, in order, so the replica cannot drift
 * without going red.
 */

import { describe, it, expect } from 'vitest';
import { readEdgeSource, liftDeclaration, compile, codeOnly } from '../helpers/edge-source';

const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

const lifted = [
  liftDeclaration(engine, 'TRANSIENT_CODES'),
  liftDeclaration(engine, 'FUNDS_CODES'),
  liftDeclaration(engine, 'DEAD_CARD_CODES'),
  liftDeclaration(engine, 'TRANSIENT_BACKOFF_HOURS'),
  liftDeclaration(engine, 'FUNDS_BACKOFF_HOURS'),
  liftDeclaration(engine, 'MAX_HOLD_ATTEMPTS'),
  liftDeclaration(engine, 'stripeErrorCode'),
  liftDeclaration(engine, 'classifyStripeFailure'),
  liftDeclaration(engine, 'computeRetryAt'),
];

type FailureClass = 'transient' | 'funds' | 'sca' | 'dead_card' | 'ambiguous';

const classifyStripeFailure = compile<(err: unknown) => FailureClass>(lifted, 'classifyStripeFailure');
const stripeErrorCode = compile<(err: unknown) => string>(lifted, 'stripeErrorCode');
const computeRetryAt = compile<
  (cls: FailureClass, priorFailures: number, expiresAt: string | null, now?: Date) => string
>(lifted, 'computeRetryAt');
const MAX_HOLD_ATTEMPTS = compile<number>(lifted, 'MAX_HOLD_ATTEMPTS');

/**
 * REPLICA of `recordFailure`'s ladder (deposit-hold-refresh.ts, inside
 * `refreshOneHold`). Pinned to the real source by the last describe block.
 */
const nextState = (
  failureClass: FailureClass,
  priorFailures: number,
): { status: string; retries: boolean } => {
  const failureCount = priorFailures + 1;
  if (failureClass === 'sca') return { status: 'requires_action', retries: false };
  if (failureClass === 'dead_card') return { status: 'requires_action', retries: false };
  if (failureClass === 'ambiguous') return { status: 'needs_review', retries: false };
  if (failureCount >= MAX_HOLD_ATTEMPTS) return { status: 'needs_review', retries: false };
  return { status: 'failed', retries: true };
};

/** Shape a Stripe decline the way stripe-node hands it to us. */
const decline = (declineCode: string) => ({
  type: 'StripeCardError',
  code: 'card_declined',
  decline_code: declineCode,
  statusCode: 402,
  message: `Your card was declined (${declineCode}).`,
});

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** code -> expected class. Everything the engine explicitly handles. */
const CODE_TABLE: [string, FailureClass][] = [
  // Infra / issuer-timeout. Cheap to retry, no issuer decline was recorded.
  ['processing_error', 'transient'],
  ['issuer_not_available', 'transient'],
  ['reenter_transaction', 'transient'],
  ['approve_with_id', 'transient'],
  ['try_again_later', 'transient'],
  ['rate_limit', 'transient'],
  ['lock_timeout', 'transient'],
  ['api_connection_error', 'transient'],
  ['api_error', 'transient'],
  ['temporary_failure', 'transient'],
  // OUR database, not Stripe's — casUpdate tags its throws with this. Untagged
  // it fell through to 'ambiguous' -> 'needs_review' with next_retry_at NULL,
  // i.e. a PostgREST blip silently retired the rental from the retry loop.
  ['db_write_failed', 'transient'],

  // Real declines about money, plus the soft issuer declines Stripe itself
  // advises retrying later.
  ['insufficient_funds', 'funds'],
  ['withdrawal_count_limit_exceeded', 'funds'],
  ['card_velocity_exceeded', 'funds'],
  ['generic_decline', 'funds'],
  ['do_not_honor', 'funds'],
  ['call_issuer', 'funds'],
  ['transaction_not_allowed', 'funds'],
  ['service_not_allowed', 'funds'],
  ['card_declined', 'funds'],

  // The card itself is gone — re-resolve the payment method, once.
  ['expired_card', 'dead_card'],
  ['lost_card', 'dead_card'],
  ['stolen_card', 'dead_card'],
  ['pickup_card', 'dead_card'],
  ['restricted_card', 'dead_card'],
  ['resource_missing', 'dead_card'],

  // Cannot be solved server-side: an off-session authorization needs the
  // cardholder present.
  ['authentication_required', 'sca'],
  ['payment_intent_authentication_failure', 'sca'],
];

describe('classifyStripeFailure — every code the engine handles', () => {
  it('covers the whole table (a missing code silently becomes ambiguous)', () => {
    // Cross-check against the sets in the source, so a code added there without
    // a row here fails this test rather than going untested.
    const sets =
      liftDeclaration(engine, 'TRANSIENT_CODES') +
      liftDeclaration(engine, 'FUNDS_CODES') +
      liftDeclaration(engine, 'DEAD_CARD_CODES');
    const declared = [...sets.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(declared.length, 'the three code sets read as empty — the lift is broken').toBeGreaterThan(20);

    const tabled = new Set(CODE_TABLE.map(([c]) => c));
    const untested = declared.filter((c) => !tabled.has(c));
    expect(untested, 'these Stripe codes are handled by the engine but untested here').toEqual([]);

    // …and the two SCA codes, which are inline `if`s rather than set members.
    for (const code of ['authentication_required', 'payment_intent_authentication_failure']) {
      expect(engine).toContain(`code === "${code}"`);
      expect(tabled.has(code)).toBe(true);
    }
  });

  it.each(CODE_TABLE)("classifies decline_code '%s' as %s", (code, expected) => {
    expect(classifyStripeFailure(decline(code))).toBe(expected);
  });

  it.each(CODE_TABLE)("classifies bare code '%s' as %s (no decline_code present)", (code, expected) => {
    expect(classifyStripeFailure({ code, statusCode: 402 })).toBe(expected);
  });

  it('prefers decline_code over code, so card_declined does not mask the real reason', () => {
    // stripeErrorCode reads decline_code first. Without that every hard decline
    // (lost_card, stolen_card) would arrive as the bare 'card_declined' and be
    // routed to 'funds' — retried on a card the issuer has permanently killed.
    expect(stripeErrorCode(decline('lost_card'))).toBe('lost_card');
    expect(classifyStripeFailure(decline('lost_card'))).toBe('dead_card');
    // …while a decline Stripe gave us no decline_code for stays 'funds'.
    expect(classifyStripeFailure({ code: 'card_declined', statusCode: 402 })).toBe('funds');
  });

  it('reads codes out of a nested raw error too', () => {
    expect(stripeErrorCode({ raw: { decline_code: 'insufficient_funds' } })).toBe('insufficient_funds');
    expect(classifyStripeFailure({ raw: { code: 'expired_card' } })).toBe('dead_card');
  });

  it('never blames the customer for a Stripe 5xx or a rate limit', () => {
    expect(classifyStripeFailure({ statusCode: 500 })).toBe('transient');
    expect(classifyStripeFailure({ statusCode: 503 })).toBe('transient');
    expect(classifyStripeFailure({ statusCode: 429 })).toBe('transient');
    expect(classifyStripeFailure({ raw: { statusCode: 502 } })).toBe('transient');
    expect(classifyStripeFailure({ type: 'StripeConnectionError' })).toBe('transient');
    expect(classifyStripeFailure({ type: 'StripeAPIError' })).toBe('transient');
  });

  it('treats a fetch-level TypeError as transient', () => {
    expect(classifyStripeFailure(new TypeError('fetch failed'))).toBe('transient');
    expect(classifyStripeFailure(new TypeError('network error'))).toBe('transient');
  });

  it('sends an unrecognised failure to ambiguous, not to a terminal status', () => {
    // Deliberately the dead end, and deliberately NOT 'expired': the point is to
    // stop and ask a human, not to declare the renter's money released.
    expect(classifyStripeFailure({ code: 'some_new_stripe_code' })).toBe('ambiguous');
    expect(classifyStripeFailure({})).toBe('ambiguous');
    expect(classifyStripeFailure(null)).toBe('ambiguous');
    expect(classifyStripeFailure(new Error('kaboom'))).toBe('ambiguous');
  });

  it('does not let a 402 status override the code-based routing', () => {
    // Only 429 and >=500 short-circuit. A 402 carrying insufficient_funds must
    // still be 'funds', or every decline would be retried on the 6h ladder.
    expect(classifyStripeFailure(decline('insufficient_funds'))).toBe('funds');
  });
});

describe('the status each class lands on, and whether it will be retried', () => {
  it.each([
    ['authentication_required', 'requires_action', false],
    ['payment_intent_authentication_failure', 'requires_action', false],
    ['expired_card', 'requires_action', false],
    ['lost_card', 'requires_action', false],
    ['stolen_card', 'requires_action', false],
    ['pickup_card', 'requires_action', false],
    ['restricted_card', 'requires_action', false],
    ['resource_missing', 'requires_action', false],
    ['insufficient_funds', 'failed', true],
    ['do_not_honor', 'failed', true],
    ['generic_decline', 'failed', true],
    ['call_issuer', 'failed', true],
    ['transaction_not_allowed', 'failed', true],
    ['service_not_allowed', 'failed', true],
    ['card_declined', 'failed', true],
    ['withdrawal_count_limit_exceeded', 'failed', true],
    ['card_velocity_exceeded', 'failed', true],
    ['processing_error', 'failed', true],
    ['issuer_not_available', 'failed', true],
    ['db_write_failed', 'failed', true],
    ['some_new_stripe_code', 'needs_review', false],
  ] as [string, string, boolean][])(
    "'%s' on a first attempt -> %s (retried: %s)",
    (code, status, retries) => {
      expect(nextState(classifyStripeFailure(decline(code)), 0)).toEqual({ status, retries });
    },
  );

  it('stops at MAX_HOLD_ATTEMPTS even for a retryable class', () => {
    // Stripe: "We recommend a maximum of eight retries… issuers might see
    // additional retries as potential fraud."
    expect(MAX_HOLD_ATTEMPTS).toBe(8);
    expect(nextState('funds', MAX_HOLD_ATTEMPTS - 2)).toEqual({ status: 'failed', retries: true });
    expect(nextState('funds', MAX_HOLD_ATTEMPTS - 1)).toEqual({ status: 'needs_review', retries: false });
    expect(nextState('transient', MAX_HOLD_ATTEMPTS - 1)).toEqual({ status: 'needs_review', retries: false });
  });

  it('produces only permitted statuses, and never expired', () => {
    const produced = new Set(
      (['transient', 'funds', 'sca', 'dead_card', 'ambiguous'] as FailureClass[]).flatMap((c) =>
        [0, 3, 7].map((n) => nextState(c, n).status),
      ),
    );
    expect([...produced].sort()).toEqual(['failed', 'needs_review', 'requires_action']);
    expect([...produced]).not.toContain('expired');
    expect([...produced]).not.toContain('released');
  });
});

describe('computeRetryAt — the backoff ladders', () => {
  const NOW = new Date('2026-08-09T12:00:00.000Z');
  const hoursFromNow = (iso: string) => Math.round((Date.parse(iso) - NOW.getTime()) / 3_600_000);

  it('walks the transient ladder 6h, 24h, 72h and then stays at 72h', () => {
    expect(hoursFromNow(computeRetryAt('transient', 0, null, NOW))).toBe(6);
    expect(hoursFromNow(computeRetryAt('transient', 1, null, NOW))).toBe(24);
    expect(hoursFromNow(computeRetryAt('transient', 2, null, NOW))).toBe(72);
    expect(hoursFromNow(computeRetryAt('transient', 5, null, NOW))).toBe(72);
  });

  it('walks the LONGER funds ladder 24h, 72h, 72h', () => {
    // Re-presenting a declined card every few hours burns issuer goodwill and
    // reads as fraud probing.
    expect(hoursFromNow(computeRetryAt('funds', 0, null, NOW))).toBe(24);
    expect(hoursFromNow(computeRetryAt('funds', 1, null, NOW))).toBe(72);
    expect(hoursFromNow(computeRetryAt('funds', 4, null, NOW))).toBe(72);
  });

  it('brings a non-funds retry forward when the incumbent deadline is sooner', () => {
    // NOT "one last swing before the authorization dies" — by the time
    // recordFailure runs the incumbent is usually already cancelled. What the
    // clamp actually does is stop a rental that WAS due imminently from being
    // parked for 72h while it sits unsecured.
    const deadline = new Date(NOW.getTime() + 5 * 3_600_000).toISOString(); // 5h away
    expect(hoursFromNow(computeRetryAt('transient', 2, deadline, NOW))).toBe(4); // an hour before
  });

  it('never brings it closer than 30 minutes, so a hard-down Stripe is not a hot loop', () => {
    const deadline = new Date(NOW.getTime() + 60_000).toISOString(); // a minute away
    const at = Date.parse(computeRetryAt('transient', 0, deadline, NOW));
    expect(at - NOW.getTime()).toBe(30 * 60_000);
  });

  it('only ever SHORTENS — a distant deadline does not push the retry out', () => {
    const deadline = new Date(NOW.getTime() + 30 * 86_400_000).toISOString();
    expect(hoursFromNow(computeRetryAt('transient', 0, deadline, NOW))).toBe(6);
  });

  it('does NOT clamp a funds decline', () => {
    // Those must respect the long ladder so we are not re-presenting a declined
    // card every half hour just because the authorisation is about to lapse.
    const deadline = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(hoursFromNow(computeRetryAt('funds', 0, deadline, NOW))).toBe(24);
  });

  it('ignores an unparseable stored deadline rather than producing an invalid date', () => {
    const at = computeRetryAt('transient', 0, 'not-a-date', NOW);
    expect(Number.isNaN(Date.parse(at))).toBe(false);
    expect(hoursFromNow(at)).toBe(6);
  });

  it('always returns a real ISO timestamp', () => {
    for (const cls of ['transient', 'funds'] as FailureClass[]) {
      for (const n of [0, 1, 2, 7]) {
        expect(computeRetryAt(cls, n, null, NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      }
    }
  });
});

describe('the replica matches the real ladder', () => {
  // `recordFailure` is a closure inside refreshOneHold, so it cannot be lifted
  // and executed. These assertions are what stop `nextState` above from
  // describing a ladder the code no longer has.
  const ladder = engine.slice(
    engine.indexOf('const recordFailure = async ('),
    engine.indexOf('// ── ORPHAN RECONCILIATION'),
  );

  it('exists and is where we think it is', () => {
    expect(ladder.length).toBeGreaterThan(500);
    expect(ladder).toContain('const failureClass = classifyStripeFailure(err);');
    expect(ladder).toContain('const failureCount = priorFailures + 1;');
  });

  it('routes sca and dead_card to requires_action with no retry', () => {
    expect(ladder).toMatch(
      /if \(failureClass === "sca"\)[\s\S]{0,300}deposit_hold_status: "requires_action", deposit_hold_next_retry_at: null/,
    );
    expect(ladder).toMatch(
      /if \(failureClass === "dead_card"\)[\s\S]{0,300}deposit_hold_status: "requires_action", deposit_hold_next_retry_at: null/,
    );
  });

  it('routes ambiguous and the attempt ceiling to needs_review with no retry', () => {
    expect(ladder).toMatch(
      /if \(failureClass === "ambiguous"\)[\s\S]{0,300}deposit_hold_status: "needs_review", deposit_hold_next_retry_at: null/,
    );
    expect(ladder).toMatch(
      /if \(failureCount >= MAX_HOLD_ATTEMPTS\)[\s\S]{0,400}deposit_hold_status: "needs_review", deposit_hold_next_retry_at: null/,
    );
  });

  it('leaves everything else recoverable, with a retry time', () => {
    expect(ladder).toContain('const retryAt = computeRetryAt(failureClass, priorFailures, storedExpiresAt, now);');
    expect(ladder).toContain('deposit_hold_status: "failed", deposit_hold_next_retry_at: retryAt');
  });

  it('checks the four early exits in that order, before the recoverable default', () => {
    // Anchored on the BRANCH CONDITIONS, not on bare occurrences of the class
    // names. A bare `"ambiguous"` also appears further up the function, in the
    // `money` computation that decides whether the renter is unsecured or
    // merely unknown — so matching the first occurrence of the string measured
    // the wrong thing and reported the ladder as misordered when it was not.
    const marks = [
      'if (failureClass === "sca")',
      'if (failureClass === "dead_card")',
      'if (failureClass === "ambiguous")',
      'if (failureCount >= MAX_HOLD_ATTEMPTS)',
      'const retryAt = computeRetryAt(',
    ];
    const order = marks.map((s) => ladder.indexOf(s));
    for (const [i, s] of marks.entries()) {
      expect(order[i], `missing early exit: ${s}`).toBeGreaterThan(-1);
    }
    // Order is the whole point: `ambiguous` reaching the recoverable default
    // would schedule a retry against a hold nobody can classify, and the
    // attempt ceiling landing after `retryAt` would never cap anything.
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('tells the truth about the renter being unsecured', () => {
    // The incumbent is already cancelled by this point. Clearing the PI id and
    // the expiry is what sorts the row to the head of the driver's queue (NULL
    // expiry first) and stops the reconciler overwriting a recoverable 'failed'
    // with terminal 'expired'.
    expect(ladder).toContain('deposit_hold_payment_intent_id: null,');
    expect(ladder).toContain('deposit_hold_expires_at: null,');
    expect(codeOnly(ladder)).not.toContain('"expired"');
  });

  it('re-resolves the card exactly once on a dead-card decline before giving up', () => {
    // Across 90 days a card expiring or being reissued after fraud is a
    // base-rate event, and the issuer has usually already put the replacement on
    // the Stripe customer. But only ONE re-resolution: a loop would walk every
    // card on file into the same decline.
    const create = engine.slice(
      engine.indexOf('newIntent = await createReplacement(card.id, idempotencyKey, false);'),
      engine.indexOf('unrecordedIntentId = newIntent.id;'),
    );
    expect(create).toContain('if (classifyStripeFailure(createErr) !== "dead_card") {');
    expect(create).toContain('return await recordFailure(createErr);');
    expect(create).toContain('triedPaymentMethods.add(card.id);');
    expect(create).toContain('return await recordFailure(createErr, "no alternative card on file");');
    expect(create).toContain('return await recordFailure(retryErr, "the replacement card also failed");');
    // …and it is a single attempt, not a loop.
    expect(create.match(/createReplacement\(/g)).toHaveLength(2);
  });
});
