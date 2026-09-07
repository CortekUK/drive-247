/**
 * rentals.deposit_hold_status — the state machine, asserted as a machine.
 *
 * WHAT WENT WRONG BEFORE
 * The old refresh engine funnelled EVERY throw — including throws from before
 * Stripe was ever contacted, e.g. the tenants lookup — into one catch that
 * wrote terminal 'expired'. The driver only ever selected 'held', so the rental
 * was never looked at again: no alert, no retry, no backoff. A 90-day rental's
 * deposit chain died on a transport hiccup and nothing said so. "I cannot
 * refresh the hold. This is affecting our day to day business." (GMT, Aug 2026)
 *
 * 'expired' is not a general-purpose failure state. It is a CLAIM ABOUT THE
 * RENTER'S MONEY: the authorisation is gone and the funds are back with them.
 * Writing it is what makes the placement paths stop short-circuiting on "a hold
 * is already active", so writing it on a guess is how a renter ends up
 * double-authorised. It may follow one thing only: Stripe telling us the
 * PaymentIntent is no longer capturable.
 *
 * WHAT THIS FILE ASSERTS
 *   1. Every status literal written anywhere in the repo is one of the eleven
 *      the CHECK constraint permits. A twelfth is rejected by Postgres at
 *      runtime, i.e. discovered in production.
 *   2. The refresh engine — the component that used to write 'expired' from its
 *      catch — never writes it at all, from any path.
 *   3. Every site in the repo that DOES write 'expired' is downstream of a
 *      Stripe read that proves the authorisation is gone.
 *   4. The two Stripe-status maps that can produce 'expired' produce it only
 *      for Stripe's `canceled`, and their probes fail SAFE (a Stripe error
 *      means "still alive", never "dead").
 *
 * The Deno edge functions cannot be imported under Vitest, so the maps and
 * probes are LIFTED — the real source text, compiled and executed. The
 * whole-repo scan is a text scan, which is the right shape for "no site
 * anywhere does X".
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readEdgeSource, liftDeclaration, compile, codeOnly } from '../helpers/edge-source';

const REPO_ROOT = resolve(__dirname, '../../../../..');

/**
 * The CHECK constraint on rentals.deposit_hold_status, verbatim. Applied to
 * production; Postgres rejects anything else, so this list is closed and a new
 * member cannot arrive without a migration.
 */
const PERMITTED_STATUSES = [
  'processing',
  'refreshing',
  'capturing',
  'held',
  'requires_action',
  'failed',
  'needs_review',
  'disputed',
  'captured',
  'released',
  'expired',
] as const;

// ---------------------------------------------------------------------------
// Whole-repo scan
// ---------------------------------------------------------------------------

const walk = (dir: string, exts: string[], out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
};

const SCANNED_FILES = [
  ...walk(join(REPO_ROOT, 'supabase/functions'), ['.ts']),
  ...walk(join(REPO_ROOT, 'apps/portal/src'), ['.ts', '.tsx']),
];

/** Every `deposit_hold_status: '<literal>'` written in the repo, with its file. */
const STATUS_WRITES: { file: string; status: string }[] = [];
for (const file of SCANNED_FILES) {
  const body = codeOnly(readFileSync(file, 'utf8'));
  for (const m of body.matchAll(/deposit_hold_status\s*:\s*['"]([a-z_]+)['"]/g)) {
    // Forward slashes regardless of platform. `join` gives backslashes on
    // Windows, and every expected path in this suite is written POSIX-style —
    // so the set comparison below failed on a Windows checkout against source
    // that was correct, naming the right two files in the wrong dialect.
    const relative = file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
    STATUS_WRITES.push({ file: relative, status: m[1] });
  }
}

describe('deposit_hold_status — only the eleven permitted values are ever produced', () => {
  it('finds the status writes at all (a scan that matches nothing proves nothing)', () => {
    // Guards the guard: if the property is ever renamed, every assertion below
    // would pass vacuously.
    expect(STATUS_WRITES.length).toBeGreaterThan(20);
  });

  it('writes no status the CHECK constraint would reject', () => {
    const illegal = STATUS_WRITES.filter(
      (w) => !(PERMITTED_STATUSES as readonly string[]).includes(w.status),
    );
    expect(
      illegal,
      `these writes would be rejected by the CHECK constraint at runtime: ${JSON.stringify(illegal)}`,
    ).toEqual([]);
  });

  it('routes the Stripe-status maps only to permitted values', () => {
    // Each map is the real one, lifted and executed — not a description of it.
    for (const [file, decl] of [
      ['reconcile-deposit-holds/index.ts', 'PI_STATUS_TO_HOLD_STATUS'],
      ['verify-deposit-hold/index.ts', 'PI_STATUS_TO_HOLD_STATUS'],
      ['create-hold-checkout/index.ts', 'DEAD_PI_STATUS_TO_HOLD_STATUS'],
      ['place-deposit-hold/index.ts', 'DEAD_PI_STATUS_TO_HOLD_STATUS'],
    ] as const) {
      const map = compile<Record<string, string>>(
        [liftDeclaration(readEdgeSource(file), decl)],
        decl,
      );
      expect(Object.keys(map).length, `${file}: ${decl} is empty`).toBeGreaterThan(0);
      for (const [piStatus, holdStatus] of Object.entries(map)) {
        expect(
          PERMITTED_STATUSES as readonly string[],
          `${file}: Stripe '${piStatus}' maps to '${holdStatus}', which the CHECK constraint rejects`,
        ).toContain(holdStatus);
      }
    }
  });
});

describe("'expired' is unreachable from a generic error path", () => {
  const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

  it('is never written by the refresh engine, from any path', () => {
    // THE regression. The engine has ~18 status writes across success, decline,
    // SCA, dead-card, lost-race, zero-amount and unhandled-throw paths; not one
    // of them may be 'expired'. Its catch-all now writes 'needs_review' (or
    // recoverable 'failed'), which the driver re-selects.
    const writes = [...codeOnly(engine).matchAll(/deposit_hold_status\s*:\s*"([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    expect(writes.length).toBeGreaterThan(10);
    expect(writes).not.toContain('expired');
  });

  it('hands an unclassified throw to needs_review, and a classified one to retryable failed', () => {
    // The outer catch, quoted structurally rather than by prose. `terminalReview`
    // is the only thing standing between a transport blip and a dead chain.
    const outerCatch = codeOnly(engine.slice(engine.lastIndexOf('} catch (err) {')));
    expect(outerCatch).toContain('const failureClass = classifyStripeFailure(err);');
    expect(outerCatch).toMatch(
      /terminalReview\s*=\s*failureClass === "ambiguous" \|\| orphaned \|\| failureCount >= MAX_HOLD_ATTEMPTS/,
    );
    expect(outerCatch).toContain('deposit_hold_status: terminalReview ? "needs_review" : "failed"');
    // …and a recoverable failure always carries a retry time, or the driver's
    // backoff filter parks it forever.
    expect(outerCatch).toContain('computeRetryAt(failureClass, priorFailures, storedExpiresAt, now)');
  });

  it('never lets a failure classification imply a terminal status', () => {
    // classifyStripeFailure is the one function every failure path consults.
    // Its entire codomain, executed for real.
    const classify = compile<(err: unknown) => string>(
      [
        liftDeclaration(engine, 'TRANSIENT_CODES'),
        liftDeclaration(engine, 'FUNDS_CODES'),
        liftDeclaration(engine, 'DEAD_CARD_CODES'),
        liftDeclaration(engine, 'stripeErrorCode'),
        liftDeclaration(engine, 'classifyStripeFailure'),
      ],
      'classifyStripeFailure',
    );
    const classes = new Set(
      [
        { statusCode: 500 },
        { code: 'insufficient_funds' },
        { code: 'authentication_required' },
        { code: 'expired_card' },
        { code: 'something_new_from_stripe' },
        {},
        null,
        new Error('boom'),
      ].map((e) => classify(e)),
    );
    expect([...classes].sort()).toEqual([
      'ambiguous',
      'dead_card',
      'funds',
      'sca',
      'transient',
    ]);
    // None of the five is a status. The ladder that turns them into statuses is
    // asserted in deposit-hold-decline-classification.test.ts; the point here is
    // that no error class is even NAMED 'expired'.
    expect([...classes]).not.toContain('expired');
  });

  it('writes expired literally in exactly two places, both of them capture paths', () => {
    // Every DIRECT `deposit_hold_status: 'expired'` in the repo, enumerated. The
    // only other route to 'expired' is the Stripe-status maps, covered below. A
    // new site has to be added here deliberately, with its evidence named.
    const sites = STATUS_WRITES.filter((w) => w.status === 'expired').map((w) => w.file);
    expect(new Set(sites)).toEqual(
      new Set([
        'supabase/functions/capture-deposit-hold/index.ts',
        'supabase/functions/deduct-from-deposit/index.ts',
      ]),
    );
  });

  it('gates the capture path on a live Stripe read of the PaymentIntent', () => {
    // capture-deposit-hold and deduct-from-deposit both retrieve the intent and
    // only write 'expired' when Stripe reports it is no longer capturable. If
    // that read is ever removed, the write becomes a guess about the renter's
    // money.
    for (const file of ['capture-deposit-hold/index.ts', 'deduct-from-deposit/index.ts']) {
      const src = readEdgeSource(file);
      const write = src.indexOf('deposit_hold_status: "expired"');
      expect(write, `${file}: no 'expired' write found`).toBeGreaterThan(-1);
      const guard = src.lastIndexOf('preCaptureIntent.status !== "requires_capture"', write);
      const read = src.lastIndexOf('paymentIntents.retrieve', guard);
      expect(guard, `${file}: 'expired' is written without the not-capturable guard`).toBeGreaterThan(-1);
      expect(read, `${file}: the guard is not backed by a Stripe retrieve`).toBeGreaterThan(-1);
      expect(read).toBeLessThan(guard);
      expect(guard).toBeLessThan(write);
    }
  });

  it("maps only Stripe's canceled to expired, never a transport failure", () => {
    for (const [file, decl] of [
      ['reconcile-deposit-holds/index.ts', 'PI_STATUS_TO_HOLD_STATUS'],
      ['verify-deposit-hold/index.ts', 'PI_STATUS_TO_HOLD_STATUS'],
      ['create-hold-checkout/index.ts', 'DEAD_PI_STATUS_TO_HOLD_STATUS'],
      ['place-deposit-hold/index.ts', 'DEAD_PI_STATUS_TO_HOLD_STATUS'],
    ] as const) {
      const map = compile<Record<string, string>>(
        [liftDeclaration(readEdgeSource(file), decl)],
        decl,
      );
      const expiring = Object.entries(map).filter(([, v]) => v === 'expired').map(([k]) => k);
      expect(expiring, `${file}: ${decl}`).toEqual(['canceled']);
      // An in-motion PaymentIntent must map to NOTHING. 'processing' and
      // 'requires_confirmation' mean no funds are authorised yet — but they also
      // do not mean the authorisation is dead, and a terminal status for either
      // would be a lie in the dangerous direction.
      expect(map.processing, `${file}: 'processing' must not be resolved`).toBeUndefined();
      expect(map.requires_confirmation).toBeUndefined();
    }
  });

  it('treats an unreadable PaymentIntent as ALIVE in the liveness probe', async () => {
    // probeRecordedHold is what create-hold-checkout and place-deposit-hold ask
    // before deciding a recorded hold is dead. Fail-safe is the whole contract:
    // a Stripe outage must not unlock a second authorisation on the card. Both
    // copies are executed for real, against a Stripe stub that throws.
    for (const file of ['create-hold-checkout/index.ts', 'place-deposit-hold/index.ts']) {
      const src = readEdgeSource(file);
      const probe = compile<
        (
          stripe: unknown,
          id: string,
          opts: unknown,
        ) => Promise<{ alive: boolean; deadStatus: string | null }>
      >(
        [liftDeclaration(src, 'DEAD_PI_STATUS_TO_HOLD_STATUS'), liftDeclaration(src, 'probeRecordedHold')],
        'probeRecordedHold',
      );

      const throwing = {
        paymentIntents: {
          retrieve: () => Promise.reject(new Error('Stripe is unreachable')),
        },
      };
      await expect(probe(throwing, 'pi_x', undefined), file).resolves.toEqual({
        alive: true,
        deadStatus: null,
      });
    }
  });

  it('reports a still-authorising PaymentIntent as alive rather than expired', async () => {
    const src = readEdgeSource('create-hold-checkout/index.ts');
    const probe = compile<
      (
        stripe: unknown,
        id: string,
        opts: unknown,
      ) => Promise<{ alive: boolean; deadStatus: string | null }>
    >(
      [liftDeclaration(src, 'DEAD_PI_STATUS_TO_HOLD_STATUS'), liftDeclaration(src, 'probeRecordedHold')],
      'probeRecordedHold',
    );
    const stripeWith = (status: string) => ({
      paymentIntents: { retrieve: () => Promise.resolve({ status }) },
    });

    // In motion — no conclusion may be drawn.
    await expect(probe(stripeWith('processing'), 'pi_x', undefined)).resolves.toEqual({
      alive: true,
      deadStatus: null,
    });
    await expect(probe(stripeWith('requires_action'), 'pi_x', undefined)).resolves.toEqual({
      alive: true,
      deadStatus: null,
    });
    // Live authorisation — obviously alive.
    await expect(probe(stripeWith('requires_capture'), 'pi_x', undefined)).resolves.toEqual({
      alive: true,
      deadStatus: null,
    });
    // Stripe says cancelled: THIS is the only route to 'expired'.
    await expect(probe(stripeWith('canceled'), 'pi_x', undefined)).resolves.toEqual({
      alive: false,
      deadStatus: 'expired',
    });
  });
});

describe('deposit_hold_status — the reconciler cannot resolve a state it did not observe', () => {
  const src = readEdgeSource('reconcile-deposit-holds/index.ts');

  it('flags an unverifiable hold for review instead of guessing it expired', () => {
    // A 'held' row with no PaymentIntent cannot be checked at Stripe. Guessing
    // 'expired' unlocks a second authorisation; guessing 'held' keeps a lie on
    // screen. 'needs_review' is the honest answer and the one the code takes.
    const branch = src.slice(src.indexOf('if (!probedPiId) {'), src.indexOf('if (!probedPiId) {') + 1200);
    expect(branch).toContain('deposit_hold_status: "needs_review"');
    expect(codeOnly(branch)).not.toContain('"expired"');
  });

  it('does not relabel a deliberate staff release as a silent network expiry', () => {
    // Terminal either way and the renter has their money back, so no money is at
    // risk — but an operator-initiated release recorded as an expiry is an audit
    // trail that lies about who acted.
    expect(src).toMatch(/if \(trueStatus === "expired"\) \{/);
    expect(src).toContain('cancellationReason === "requested_by_customer"');
    expect(src).toContain('rental.deposit_hold_release_requested_at');
    expect(src).toContain('resolvedStatus = "released"');
  });
});
