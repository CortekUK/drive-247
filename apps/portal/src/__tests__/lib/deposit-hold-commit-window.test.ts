/**
 * The renewal commit window — when it is worth DESTROYING a healthy hold.
 *
 * THE INCIDENT THIS PREVENTS (real: GMT, R-161fe1, $100, 14 Aug 2026)
 * A renewal cancels the incumbent authorisation and then places a replacement.
 * The 2-day lookahead decided when a hold was worth LOOKING at, and was also,
 * accidentally, deciding when to ACT — so the cron cancelled an authorisation
 * with 38 hours of Stripe-verified life still on it, the replacement came back
 * `insufficient_funds`, and an active rental sat unsecured for over a day. The
 * cover we threw away to get there was not recoverable.
 *
 * WHY NOT JUST CREATE BEFORE CANCELLING
 * Considered and rejected on evidence. A second authorisation competes with the
 * first for the same available credit, so a funds decline becomes MORE likely,
 * not less — it would not have prevented this incident. It also breaks the
 * "never authorize a renter twice" invariant the subsystem is built on.
 *
 * WHAT IS ASSERTED HERE
 * The guard is inline in refreshOneHold (not a pure function), so these tests
 * lift the CONSTANT from the real source and assert the arithmetic and the
 * conjunct logic that governs it. The constant cannot drift from production
 * without this suite failing.
 */

import { describe, it, expect } from 'vitest';
import { readEdgeSource } from '../helpers/edge-source';

const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

const COMMIT_WINDOW_HOURS = Number(
  /export const RENEWAL_COMMIT_WINDOW_HOURS = (\d+)/.exec(engine)![1],
);
const LOOKAHEAD_DAYS = Number(
  /export const DEFAULT_LOOKAHEAD_DAYS = (\d+)/.exec(engine)![1],
);

/** The production cron interval the window must out-run. */
const CRON_INTERVAL_HOURS = 24;

/** Reproduction of the guard's decision, for arithmetic assertions. */
const wouldDefer = (hoursLeft: number) => hoursLeft > COMMIT_WINDOW_HOURS;

describe('RENEWAL_COMMIT_WINDOW_HOURS', () => {
  it('is longer than the cron interval, or a deferral could never come back', () => {
    // Deferring is only safe if another pass is guaranteed before the deadline.
    expect(COMMIT_WINDOW_HOURS).toBeGreaterThan(CRON_INTERVAL_HOURS);
  });

  it('leaves real slack for a late or failed run, not a couple of hours', () => {
    expect(COMMIT_WINDOW_HOURS - CRON_INTERVAL_HOURS).toBeGreaterThanOrEqual(6);
  });

  it('sits INSIDE the lookahead, so deferred rows are still selected next pass', () => {
    // A row is only looked at when expiry < now + lookahead. If the commit
    // window were wider than the lookahead, the guard would defer rows that the
    // query had already stopped returning — and the hold would lapse unseen.
    expect(COMMIT_WINDOW_HOURS).toBeLessThan(LOOKAHEAD_DAYS * 24);
  });
});

describe('the incident, replayed against the real constant', () => {
  // Incumbent verified to 2026-08-15 17:19. Cron ran 2026-08-14 03:00.
  const HOURS_LEFT_AT_INCIDENT = 38.3;

  it('would have DEFERRED rather than destroying a hold with 38h left', () => {
    expect(wouldDefer(HOURS_LEFT_AT_INCIDENT)).toBe(true);
  });

  it('would have COMMITTED on the following pass, 24h later', () => {
    expect(wouldDefer(HOURS_LEFT_AT_INCIDENT - CRON_INTERVAL_HOURS)).toBe(false);
  });

  it('shrinks the avoidable unsecured window to under a day', () => {
    // Had the card still declined on the second pass, the renter would have
    // kept cover until then instead of losing it a day early.
    const hoursOfCoverPreserved = HOURS_LEFT_AT_INCIDENT - COMMIT_WINDOW_HOURS;
    expect(hoursOfCoverPreserved).toBeGreaterThan(0);
    expect(hoursOfCoverPreserved).toBeLessThan(24);
  });
});

describe('deferral arithmetic', () => {
  it('commits once inside the window', () => {
    expect(wouldDefer(COMMIT_WINDOW_HOURS - 0.1)).toBe(false);
    expect(wouldDefer(1)).toBe(false);
  });

  it('commits on an already-expired incumbent rather than deferring forever', () => {
    expect(wouldDefer(-5)).toBe(false);
  });

  it('defers only while there is more life than the window', () => {
    expect(wouldDefer(COMMIT_WINDOW_HOURS + 0.1)).toBe(true);
  });

  it('a deferred hold always survives to the next pass', () => {
    for (const hoursLeft of [30.5, 36, 42, 47]) {
      if (!wouldDefer(hoursLeft)) continue;
      expect(hoursLeft - CRON_INTERVAL_HOURS).toBeGreaterThan(0);
    }
  });
});

describe('the guard conjuncts are all present in the source', () => {
  const guard = engine.slice(
    engine.indexOf('RENEWAL COMMIT WINDOW'),
    engine.indexOf('RENEWAL COMMIT WINDOW') + 2600,
  );

  it('only defers a row that is actually held', () => {
    expect(guard).toMatch(/startingStatus === "held"/);
  });

  it('only defers when there is an incumbent worth preserving', () => {
    expect(guard).toMatch(/incumbentPi/);
  });

  it('never defers an auto-extend rental (those take the release branch)', () => {
    expect(guard).toMatch(/auto_extend_enabled !== true/);
  });

  it('ONLY trusts a Stripe-verified deadline, never the fallback guess', () => {
    // A 'fallback' expiry is an admitted guess that can sit LATER than the real
    // deadline. Deferring against one could push the commit past the point of
    // no return — the single most dangerous way this guard could be wrong.
    expect(guard).toMatch(/deposit_hold_expiry_source === "stripe_capture_before"/);
  });

  it('defers via the no-write `untouched` path, not a status change', () => {
    // Deferring must write nothing, call no Stripe API and burn no attempt_seq.
    expect(guard).toMatch(/untouched\(\s*\n?\s*"skipped"/);
  });
});

describe('the column the guard depends on is actually selected', () => {
  it('deposit_hold_expiry_source is in HOLD_REFRESH_COLUMNS', () => {
    // Without it, rental.deposit_hold_expiry_source is undefined, the conjunct
    // is always false, and the guard is a silent no-op that reads as shipped.
    const cols = engine.slice(
      engine.indexOf('HOLD_REFRESH_COLUMNS'),
      engine.indexOf('HOLD_REFRESH_COLUMNS') + 900,
    );
    expect(cols).toMatch(/deposit_hold_expiry_source/);
  });
});
