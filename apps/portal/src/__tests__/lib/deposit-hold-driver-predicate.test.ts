/**
 * The refresh driver's selection predicate — the mass-flip blocker.
 *
 * THE INCIDENT THIS PREVENTS
 * `deposit_hold_status = 'failed'` has two producers with opposite meanings:
 *
 *   (a) the refresh engine, after a chain link failed to place its replacement.
 *       The renter WAS secured a moment ago; `deposit_hold_placed_at` and a
 *       PaymentIntent are on the row, and retrying is exactly right.
 *   (b) `stripe-webhook-{live,test}`, which write `{ deposit_hold_status:
 *       'failed' }` gated on `.is('deposit_hold_status', null)` when the FIRST
 *       auto-placement of a brand-new hold fails. `place-deposit-hold` has
 *       already burned an attempt_seq, so these rows carry attempt_seq >= 1 with
 *       NO PaymentIntent, NO deposit_hold_amount and NO deposit_hold_placed_at.
 *       They mean "we never took this renter's deposit".
 *
 * Widening the driver from `'held'` to `IN ('held','failed')` swept up every (b)
 * row across all 28 tenants. Their NULL amount coerced to 0, which took the
 * engine's "nothing left to authorize" branch, which writes 'released'. One cron
 * tick after deploy would have rewritten fleet-wide 'Hold failed' as 'Released'
 * — destroying the signal the portal renders and removing the rows from the
 * reconciler's non-terminal sweep. `attempt_seq` is NOT a usable discriminator
 * (see (b)); a persisted PaymentIntent or a `deposit_hold_placed_at` stamp is,
 * because Stripe has to have confirmed an authorization before either is written.
 *
 * WHAT IS REAL HERE AND WHAT IS A REPLICA
 *  * `applyDueHoldFilters` and `HOLD_HISTORY_PREDICATE` are LIFTED from
 *    `supabase/functions/_shared/deposit-hold-refresh.ts` and executed. The
 *    strings asserted on are the strings production sends to PostgREST.
 *  * `evaluate()` below is a REPLICA of PostgREST's `or=` semantics, written for
 *    this suite. It is not PostgREST. It models the two things that matter here:
 *    comma-separated disjunction with `and(...)` groups, and NULL-blindness (a
 *    comparison against NULL is NULL, i.e. not true — the reason `.lt()` on
 *    `deposit_hold_expires_at` used to make NULL-expiry rows invisible forever).
 *    A behaviour that depends on some subtler PostgREST detail would not be
 *    caught here, and should be asserted against the query string instead.
 */

import { describe, it, expect } from 'vitest';
import { readEdgeSource, liftDeclaration, compile, compileExpression, codeOnly } from '../helpers/edge-source';

const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

// ---------------------------------------------------------------------------
// The real predicate builder, lifted.
// ---------------------------------------------------------------------------

type Q = { or: (expr: string) => Q };

const applyDueHoldFilters = compile<
  (q: Q, opts?: { lookaheadDays?: number; now?: Date }) => Q
>(
  [
    liftDeclaration(engine, 'TERMINAL_RENTAL_STATUSES'),
    liftDeclaration(engine, 'TERMINAL_RENTAL_STATUS_LIST'),
    liftDeclaration(engine, 'HOLD_HISTORY_PREDICATE'),
    liftDeclaration(engine, 'DEFAULT_LOOKAHEAD_DAYS'),
    // chainCutoffDate closes over CHAIN_GRACE_DAYS_AFTER_END, which lives in
    // _shared/stripe-client.ts. Its value (3 days) is asserted separately below
    // against that file, so this cannot drift silently.
    `const CHAIN_GRACE_DAYS_AFTER_END = ${
      /export const CHAIN_GRACE_DAYS_AFTER_END = (\d+)/.exec(
        readEdgeSource('_shared/stripe-client.ts'),
      )![1]
    };`,
    liftDeclaration(engine, 'chainCutoffDate'),
    liftDeclaration(engine, 'applyDueHoldFilters'),
  ],
  'applyDueHoldFilters',
);

/** Collect the `.or()` expressions the builder emits for a given `now`. */
const predicatesAt = (now: Date, lookaheadDays?: number): string[] => {
  const ors: string[] = [];
  const q: Q = { or: (expr: string) => (ors.push(expr), q) };
  applyDueHoldFilters(q, { now, ...(lookaheadDays !== undefined ? { lookaheadDays } : {}) });
  return ors;
};

// ---------------------------------------------------------------------------
// REPLICA — PostgREST `or=` evaluation. Not the real thing; see the header.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Split on top-level commas, respecting `and(...)` / `(a,b,c)` nesting. */
const splitTerms = (expr: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  out.push(expr.slice(start));
  return out.map((t) => t.trim()).filter(Boolean);
};

const compareInstants = (
  op: string,
  left: unknown,
  right: string,
): boolean => {
  // NULL-blind, exactly like SQL: any comparison against NULL is NULL, not true.
  if (left === null || left === undefined) return false;
  const a = new Date(String(left)).getTime();
  const b = new Date(right).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // Not a timestamp — fall back to string comparison (PostgREST does this for
    // text/date columns; `end_date` is a date column compared to a date string).
    const s = String(left);
    if (op === 'lt') return s < right;
    if (op === 'lte') return s <= right;
    if (op === 'gt') return s > right;
    if (op === 'gte') return s >= right;
  }
  if (op === 'lt') return a < b;
  if (op === 'lte') return a <= b;
  if (op === 'gt') return a > b;
  if (op === 'gte') return a >= b;
  throw new Error(`replica does not model operator '${op}'`);
};

const evaluateTerm = (term: string, row: Row): boolean => {
  if (term.startsWith('and(')) {
    return splitTerms(term.slice(4, -1)).every((t) => evaluateTerm(t, row));
  }
  if (term.startsWith('or(')) {
    return splitTerms(term.slice(3, -1)).some((t) => evaluateTerm(t, row));
  }
  const [col, ...rest] = term.split('.');
  const value = row[col];

  if (rest[0] === 'is' && rest[1] === 'null') return value === null || value === undefined;
  if (rest[0] === 'not' && rest[1] === 'is' && rest[2] === 'null') {
    return !(value === null || value === undefined);
  }
  if (rest[0] === 'eq') return value === rest.slice(1).join('.');
  if (rest[0] === 'not' && rest[1] === 'in') {
    if (value === null || value === undefined) return false; // NULL NOT IN (…) is NULL
    const list = term.slice(term.indexOf('(') + 1, term.lastIndexOf(')')).split(',');
    return !list.includes(String(value));
  }
  if (['lt', 'lte', 'gt', 'gte'].includes(rest[0])) {
    return compareInstants(rest[0], value, rest.slice(1).join('.'));
  }
  throw new Error(`replica does not model term '${term}'`);
};

/** A row is selected when EVERY `.or()` disjunction holds — successive `.or()`
 *  calls are AND-ed by PostgREST, which is why the chain bound had to be four
 *  terms in ONE call rather than two calls. */
const isSelected = (row: Row, now: Date, lookaheadDays?: number): boolean =>
  predicatesAt(now, lookaheadDays).every((expr) =>
    splitTerms(expr).some((t) => evaluateTerm(t, row)),
  );

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-09T12:00:00.000Z');
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const date = (days: number) => iso(days).slice(0, 10);

/** A healthy chained hold that is due for its next link. */
const dueHeldRow = (): Row => ({
  status: 'Active',
  end_date: date(60),
  deposit_hold_status: 'held',
  deposit_hold_payment_intent_id: 'pi_live_1',
  deposit_hold_placed_at: iso(-3),
  deposit_hold_expires_at: iso(1), // inside the 2-day lookahead
  deposit_hold_next_retry_at: null,
  deposit_hold_chain_expires_at: iso(63),
});

/**
 * (b) — the webhook's first-placement failure. NO PaymentIntent, NO placed_at.
 * This is the row that must never be selected.
 */
const legacyWebhookFailedRow = (): Row => ({
  status: 'Active',
  end_date: date(60),
  deposit_hold_status: 'failed',
  deposit_hold_payment_intent_id: null,
  deposit_hold_placed_at: null,
  deposit_hold_amount: null,
  deposit_hold_attempt_seq: 1,
  deposit_hold_expires_at: null,
  deposit_hold_next_retry_at: null,
  deposit_hold_chain_expires_at: null,
});

describe('driver predicate — a legacy failed row is never selected', () => {
  it('EXCLUDES a failed row with no PaymentIntent AND no placed_at', () => {
    // THE regression test. One cron tick would have rewritten these as
    // 'released' across 28 tenants.
    expect(isSelected(legacyWebhookFailedRow(), NOW)).toBe(false);
  });

  it('excludes it even when every other filter would wave it through', () => {
    // NULL expiry sorts FIRST in the driver's ordering, so this row would be at
    // the head of the very first batch. Nothing else in the predicate stops it.
    const row = legacyWebhookFailedRow();
    const others = predicatesAt(NOW).filter((e) => !e.includes('deposit_hold_payment_intent_id'));
    for (const expr of others) {
      expect(
        splitTerms(expr).some((t) => evaluateTerm(t, row)),
        `this row passes '${expr}' — only the hold-history predicate excludes it`,
      ).toBe(true);
    }
  });

  it('INCLUDES a failed row the engine itself produced (PaymentIntent on the row)', () => {
    // The retry path. Excluding these would be the opposite bug: a chain that
    // failed one link is never retried.
    const row = { ...legacyWebhookFailedRow(), deposit_hold_payment_intent_id: 'pi_prev' };
    expect(isSelected(row, NOW)).toBe(true);
  });

  it('INCLUDES a failed row whose PaymentIntent was cleared but which was once placed', () => {
    // recordFailure NULLs deposit_hold_payment_intent_id deliberately — the
    // renter is unsecured and a NULL expiry sorts them to the front of the
    // queue. deposit_hold_placed_at is what still proves an authorization
    // existed, so it is the second arm of the predicate.
    const row = { ...legacyWebhookFailedRow(), deposit_hold_placed_at: iso(-9) };
    expect(isSelected(row, NOW)).toBe(true);
  });

  it('INCLUDES an ordinary held row', () => {
    expect(isSelected(dueHeldRow(), NOW)).toBe(true);
  });

  it('excludes every status that belongs to another worker or to a human', () => {
    // 'processing'/'refreshing'/'capturing' are claims; 'requires_action',
    // 'needs_review' and 'disputed' wait on a person; 'captured'/'released'/
    // 'expired' are finished. Selecting any of them would either race a live
    // worker or re-authorize a settled rental.
    for (const status of [
      'processing',
      'refreshing',
      'capturing',
      'requires_action',
      'needs_review',
      'disputed',
      'captured',
      'released',
      'expired',
    ]) {
      const row = { ...dueHeldRow(), deposit_hold_status: status };
      expect(isSelected(row, NOW), `status '${status}' must not be selected`).toBe(false);
    }
  });
});

describe('driver predicate — the rest of the disjunctions', () => {
  it('selects a row whose expiry we never learned', () => {
    // `.lt()` against NULL is NULL, not true, so these rows were invisible to
    // the old driver forever. A NULL expiry means "we do not know it is alive"
    // and must sort FIRST, not vanish.
    const row = { ...dueHeldRow(), deposit_hold_expires_at: null };
    expect(isSelected(row, NOW)).toBe(true);
  });

  it('leaves a hold alone until it enters the lookahead window', () => {
    expect(isSelected({ ...dueHeldRow(), deposit_hold_expires_at: iso(10) }, NOW)).toBe(false);
    expect(isSelected({ ...dueHeldRow(), deposit_hold_expires_at: iso(1) }, NOW)).toBe(true);
  });

  it('honours a pending backoff, and picks the row up once it has elapsed', () => {
    expect(isSelected({ ...dueHeldRow(), deposit_hold_next_retry_at: iso(0.5) }, NOW)).toBe(false);
    expect(isSelected({ ...dueHeldRow(), deposit_hold_next_retry_at: iso(-0.5) }, NOW)).toBe(true);
  });

  it('stops chaining once the rental is unambiguously finished', () => {
    for (const status of ['Closed', 'Completed', 'Cancelled', 'Canceled', 'Rejected']) {
      expect(isSelected({ ...dueHeldRow(), status }, NOW), status).toBe(false);
    }
  });

  it('keeps chaining for a NULL or unrecognised rental status', () => {
    // A DENY list, not an allow list: `status` is nullable and the CHECK
    // constraint passes NULL, and an unknown status must not be able to end a
    // chain silently.
    expect(isSelected({ ...dueHeldRow(), status: null }, NOW)).toBe(true);
    expect(isSelected({ ...dueHeldRow(), status: 'Awaiting Handback' }, NOW)).toBe(true);
  });

  it('selects an EXTENDED rental whose stored chain bound is frozen in the past', () => {
    // The defect: deposit_hold_chain_expires_at is written ONCE at placement
    // from the end_date as it stood then. Extending the rental moves end_date
    // and leaves the bound behind, so filtering on the stored column alone meant
    // the row was never SELECTED and the authoritative recomputation inside the
    // engine could never run. The chain died on the ORIGINAL end date while the
    // car was still out — for a manually-extended fleet, every rental.
    const row = {
      ...dueHeldRow(),
      deposit_hold_chain_expires_at: iso(-20), // frozen at the original end date
      end_date: date(45), // …but the rental now runs 45 more days
    };
    expect(isSelected(row, NOW)).toBe(true);
  });

  it('finally stops when BOTH the stored bound and the live end_date have passed', () => {
    const row = {
      ...dueHeldRow(),
      deposit_hold_chain_expires_at: iso(-20),
      end_date: date(-10), // handed back 10 days ago, well past the 3-day grace
    };
    expect(isSelected(row, NOW)).toBe(false);
  });

  it('still covers the grace window after handback', () => {
    // CHAIN_GRACE_DAYS_AFTER_END — how long after handback an operator may still
    // authorise against a renter's card. Deliberately conservative and, per the
    // engine's own note, a product decision that has not been formally ratified.
    expect(/export const CHAIN_GRACE_DAYS_AFTER_END = 3;/.test(
      readEdgeSource('_shared/stripe-client.ts'),
    )).toBe(true);
    expect(isSelected({ ...dueHeldRow(), deposit_hold_chain_expires_at: iso(-20), end_date: date(-2) }, NOW)).toBe(true);
    expect(isSelected({ ...dueHeldRow(), deposit_hold_chain_expires_at: iso(-20), end_date: date(-4) }, NOW)).toBe(false);
  });
});

describe('driver predicate — shape of the emitted query', () => {
  it('emits the hold-history predicate as a single disjunction of three arms', () => {
    // Successive `.or()` calls are AND-ed. If the three arms were ever split
    // across two calls, every row would have to satisfy all of them and the
    // driver would select nothing at all.
    const [, holdHistory] = predicatesAt(NOW);
    expect(splitTerms(holdHistory)).toEqual([
      'deposit_hold_status.eq.held',
      'and(deposit_hold_status.eq.failed,deposit_hold_payment_intent_id.not.is.null)',
      'and(deposit_hold_status.eq.failed,deposit_hold_placed_at.not.is.null)',
    ]);
  });

  it('puts all four chain-bound terms in ONE .or()', () => {
    const chain = predicatesAt(NOW).find((e) => e.includes('deposit_hold_chain_expires_at'))!;
    expect(splitTerms(chain)).toHaveLength(4);
    expect(chain).toContain('end_date.is.null');
  });

  it('never widens the hold predicate to a bare status list', () => {
    // `IN ('held','failed')` is the exact shape that caused the mass flip. It
    // must not come back, in the engine or in either driver.
    for (const file of [
      '_shared/deposit-hold-refresh.ts',
      'refresh-deposit-holds/index.ts',
      'sandbox-refresh-deposit-holds/index.ts',
    ]) {
      const code = codeOnly(readEdgeSource(file));
      expect(code, file).not.toMatch(/deposit_hold_status\.in\./);
      expect(code, file).not.toMatch(/\.in\(\s*["']deposit_hold_status["']/);
    }
  });

  it('is the SAME predicate in production and in the sandbox', () => {
    // The two drivers were hand-maintained verbatim forks; the sandbox is the
    // de-facto verification path, so a fork means staging green-lights logic
    // production no longer runs.
    for (const file of ['refresh-deposit-holds/index.ts', 'sandbox-refresh-deposit-holds/index.ts']) {
      const src = readEdgeSource(file);
      expect(src, file).toContain('applyDueHoldFilters');
      expect(src, file).toContain('HOLD_REFRESH_COLUMNS');
      expect(src, file).toContain('_shared/deposit-hold-refresh.ts');
    }
  });
});

describe('the engine repeats the check itself — belt to the driver\'s braces', () => {
  // refreshOneHold is also called directly by the sandbox, and could be called
  // by anything later, so the SQL predicate is not the only line of defence.
  const hasHoldHistory = compileExpression<
    (incumbentPi: string | null, rental: Record<string, unknown>) => boolean
  >(['incumbentPi', 'rental'], [liftDeclaration(engine, 'hasHoldHistory')], 'hasHoldHistory');

  it('refuses a rental that never carried an authorization', () => {
    expect(hasHoldHistory(null, { deposit_hold_placed_at: null })).toBe(false);
  });

  it('accepts one with a PaymentIntent, or with a placement stamp', () => {
    expect(hasHoldHistory('pi_1', { deposit_hold_placed_at: null })).toBe(true);
    expect(hasHoldHistory(null, { deposit_hold_placed_at: '2026-07-01T00:00:00Z' })).toBe(true);
  });

  it('does not accept attempt_seq as evidence', () => {
    // place-deposit-hold burns an attempt_seq on every failure path, so a row
    // that never got a hold still carries attempt_seq >= 1. Using it as the
    // discriminator is precisely how (b) rows would be swept up again.
    expect(hasHoldHistory(null, { deposit_hold_placed_at: null, deposit_hold_attempt_seq: 7 })).toBe(false);
  });

  it('skips rather than writing any status when there is no chain to extend', () => {
    // The destructive version wrote 'released'. `untouched('skipped', …)` writes
    // nothing at all, which is the only safe answer for a row this engine does
    // not own.
    const branch = engine.slice(
      engine.indexOf('const hasHoldHistory'),
      engine.indexOf('const rawAmount = rental.deposit_hold_amount'),
    );
    expect(branch).toContain('if (!hasHoldHistory)');
    expect(branch).toContain('untouched(');
    expect(branch).toContain('"skipped"');
    expect(codeOnly(branch)).not.toContain('released');
  });

  it('keeps a NULL deposit_hold_amount apart from a genuine zero', () => {
    // Coercing NULL to 0 turned "we cannot read the amount" into "there is
    // nothing left to hold", and the release branch acted on it.
    const amountKnown = compileExpression<(rawAmount: unknown) => boolean>(
      ['rawAmount'],
      [liftDeclaration(engine, 'amountKnown')],
      'amountKnown',
    );
    expect(amountKnown(null)).toBe(false);
    expect(amountKnown(undefined)).toBe(false);
    expect(amountKnown('not a number')).toBe(false);
    expect(amountKnown(0)).toBe(true); // a real zero IS a legitimate release
    expect(amountKnown(250)).toBe(true);
  });
});
