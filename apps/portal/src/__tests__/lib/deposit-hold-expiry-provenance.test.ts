/**
 * Expiry provenance — a guess must never be stored as if it were Stripe's answer.
 *
 * THE FAILURE MODE
 * `rentals.deposit_hold_expires_at` is the only thing that decides when a hold
 * is re-authorised, and the refresh driver selects on it
 * (`expires_at < now + 2 days`). Stripe publishes the REAL deadline on the
 * authorising charge as `payment_method_details.card.capture_before`. When it
 * has not published one yet, we have to write something — and the old code
 * wrote `now + 7 days` with nothing to distinguish it from a real deadline.
 *
 * Two ways that kills a deposit:
 *   * 7 days is an OVER-estimate. Visa's card-absent merchant-initiated window
 *     is 4d18h, so a 7-day guess plus the 2-day lookahead means the row is first
 *     examined roughly a day AFTER the authorisation already died. The row says
 *     'held', the money is back with the renter, and nothing notices.
 *   * The fallback timestamp MOVES on every call. Persisting it from a
 *     reconciliation path re-arms the expiry on every pass, so a
 *     frequently-verified rental can never enter the refresh window at all.
 *
 * Hence the rule this file guards, in two halves:
 *   (a) a value we invented is stamped `deposit_hold_expiry_source='fallback'`,
 *       never `'stripe_capture_before'`, and carries no `window_seconds` and no
 *       `verified_at`;
 *   (b) the reconciliation paths — whose whole job is agreeing with truth — do
 *       not layer a fallback at all: an absent `capture_before` leaves the
 *       STORED expiry untouched.
 *
 * `readHoldCaptureFacts`, `resolveHoldExpiryDetailed` and the engine's
 * `readHoldWindow` are LIFTED from their real files and executed against Stripe
 * stubs. The persistence decisions around them are asserted against the source,
 * because they live inside 1000-line request handlers.
 */

import { describe, it, expect } from 'vitest';
import { readEdgeSource, liftDeclaration, compile, codeOnly } from '../helpers/edge-source';

const stripeClient = readEdgeSource('_shared/stripe-client.ts');
const engine = readEdgeSource('_shared/deposit-hold-refresh.ts');

const HOUR = 3600;
const DAY = 24 * HOUR;

/** A Stripe charge whose card block carries (or omits) capture_before. */
const chargeWith = (opts: {
  captureBefore?: number;
  created?: number;
  extendedAuth?: string;
  brand?: string;
  last4?: string;
  funding?: string;
}) => ({
  id: 'ch_1',
  created: opts.created ?? Math.floor(Date.now() / 1000),
  payment_method_details: {
    card: {
      ...(opts.captureBefore !== undefined ? { capture_before: opts.captureBefore } : {}),
      ...(opts.extendedAuth ? { extended_authorization: { status: opts.extendedAuth } } : {}),
      brand: opts.brand ?? 'visa',
      last4: opts.last4 ?? '4242',
      funding: opts.funding ?? 'credit',
    },
  },
});

// ---------------------------------------------------------------------------
// The no-fallback reader (used by the reconciliation paths)
// ---------------------------------------------------------------------------

const readHoldCaptureFacts = compile<
  (stripe: unknown, pi: unknown, opts?: unknown) => Promise<{
    captureBefore: string;
    extendedAuth: boolean | null;
    extendedAuthStatus: string | null;
    windowSeconds: number | null;
  } | null>
>([liftDeclaration(stripeClient, 'readHoldCaptureFacts')], 'readHoldCaptureFacts');

describe('readHoldCaptureFacts — never invents a deadline', () => {
  it('returns null when Stripe has published no capture_before', () => {
    // null is the load-bearing answer: it is what lets the caller leave the
    // stored expiry alone instead of overwriting it with a guess.
    return expect(
      readHoldCaptureFacts({}, { id: 'pi_1', latest_charge: chargeWith({}) }),
    ).resolves.toBeNull();
  });

  it('returns null for a zero or negative capture_before', () => {
    return expect(
      readHoldCaptureFacts({}, { id: 'pi_1', latest_charge: chargeWith({ captureBefore: 0 }) }),
    ).resolves.toBeNull();
  });

  it('reports the deadline Stripe published, verbatim', async () => {
    const created = Math.floor(Date.parse('2026-08-01T00:00:00Z') / 1000);
    const captureBefore = created + 7 * DAY;
    const facts = await readHoldCaptureFacts({}, {
      id: 'pi_1',
      latest_charge: chargeWith({ captureBefore, created }),
    });
    expect(facts!.captureBefore).toBe(new Date(captureBefore * 1000).toISOString());
    // Measured from the CHARGE, not from now — a hold read back days later would
    // otherwise look like it was granted a much shorter window than it was.
    expect(facts!.windowSeconds).toBe(7 * DAY);
  });

  it('keeps extended-authorization UNKNOWN when the network did not report it', () => {
    // Tri-state, not a boolean-with-a-default. "Stripe did not tell us" is a
    // different fact from "the network said no", and writing false would claim
    // knowledge we do not have.
    return expect(
      readHoldCaptureFacts({}, {
        id: 'pi_1',
        latest_charge: chargeWith({ captureBefore: Math.floor(Date.now() / 1000) + DAY }),
      }),
    ).resolves.toMatchObject({ extendedAuth: null, extendedAuthStatus: null });
  });

  it('records extended authorization as granted or refused when it IS reported', async () => {
    const cb = Math.floor(Date.now() / 1000) + DAY;
    await expect(
      readHoldCaptureFacts({}, { id: 'pi_1', latest_charge: chargeWith({ captureBefore: cb, extendedAuth: 'enabled' }) }),
    ).resolves.toMatchObject({ extendedAuth: true, extendedAuthStatus: 'enabled' });
    await expect(
      readHoldCaptureFacts({}, { id: 'pi_1', latest_charge: chargeWith({ captureBefore: cb, extendedAuth: 'disabled' }) }),
    ).resolves.toMatchObject({ extendedAuth: false, extendedAuthStatus: 'disabled' });
  });

  it('throws on a transport failure rather than reporting "no deadline"', async () => {
    // A caller that read the throw as "no capture_before" would silently
    // downgrade every hold to the fallback whenever Stripe hiccupped.
    const stripe = { charges: { retrieve: () => Promise.reject(new Error('network')) } };
    await expect(
      readHoldCaptureFacts(stripe, { id: 'pi_1', latest_charge: 'ch_unexpanded' }),
    ).rejects.toThrow('network');
  });
});

// ---------------------------------------------------------------------------
// The fallback-layering reader (used by the placement paths, which must store
// SOMETHING)
// ---------------------------------------------------------------------------

const resolveHoldExpiryDetailed = compile<
  (stripe: unknown, pi: unknown, opts?: unknown) => Promise<{
    expiresAt: string;
    source: 'stripe_capture_before' | 'fallback';
    extendedAuth: boolean | null;
    extendedAuthStatus: string | null;
    windowSeconds: number | null;
  }>
>(
  [
    liftDeclaration(stripeClient, 'HOLD_EXPIRY_FALLBACK_DAYS'),
    liftDeclaration(stripeClient, 'readHoldCaptureFacts'),
    liftDeclaration(stripeClient, 'resolveHoldExpiryDetailed'),
  ],
  'resolveHoldExpiryDetailed',
);

describe('resolveHoldExpiryDetailed — a fallback is labelled as a fallback', () => {
  it("never stamps an invented expiry as 'stripe_capture_before'", async () => {
    // THE assertion this file exists for.
    const noDeadline = await resolveHoldExpiryDetailed({}, { id: 'pi_1', latest_charge: chargeWith({}) });
    expect(noDeadline.source).toBe('fallback');
    expect(noDeadline.source).not.toBe('stripe_capture_before');
  });

  it("never stamps 'stripe_capture_before' when Stripe could not be read at all", async () => {
    const stripe = { charges: { retrieve: () => Promise.reject(new Error('502')) } };
    const thrown = await resolveHoldExpiryDetailed(stripe, { id: 'pi_1', latest_charge: 'ch_unexpanded' });
    expect(thrown.source).toBe('fallback');
  });

  it('carries no window_seconds and no extended-auth claim on the fallback path', () => {
    // Writing the fallback's own length into deposit_hold_window_seconds would
    // make a guess indistinguishable from a measurement.
    return expect(
      resolveHoldExpiryDetailed({}, { id: 'pi_1', latest_charge: chargeWith({}) }),
    ).resolves.toMatchObject({ windowSeconds: null, extendedAuth: null, extendedAuthStatus: null });
  });

  it('guesses SHORT — 4 days, inside Visa\'s 4d18h card-absent window', () => {
    // An under-estimate costs one harmless early refresh; an over-estimate costs
    // the deposit. The old 7-day guess plus the 2-day lookahead meant the row was
    // examined a day AFTER the authorisation had already died.
    expect(stripeClient).toMatch(/export const HOLD_EXPIRY_FALLBACK_DAYS = 4;/);
    expect(engine).toMatch(/export const FALLBACK_HOLD_WINDOW_DAYS = 4;/);
  });

  it("stamps 'stripe_capture_before' only when Stripe actually published one", async () => {
    const created = Math.floor(Date.now() / 1000);
    const real = await resolveHoldExpiryDetailed({}, {
      id: 'pi_1',
      latest_charge: chargeWith({ captureBefore: created + 30 * DAY, created, extendedAuth: 'enabled' }),
    });
    expect(real.source).toBe('stripe_capture_before');
    expect(real.expiresAt).toBe(new Date((created + 30 * DAY) * 1000).toISOString());
    expect(real.windowSeconds).toBe(30 * DAY);
  });
});

// ---------------------------------------------------------------------------
// The refresh engine's own reader + what it persists
// ---------------------------------------------------------------------------

const readHoldWindow = compile<
  (stripe: unknown, intent: unknown, opts: unknown, now: Date) => Promise<{
    expiresAt: string;
    source: 'stripe_capture_before' | 'fallback';
    windowSeconds: number | null;
    extendedAuthStatus: string | null;
    captureBefore: string | null;
    cardFunding: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
  }>
>(
  [
    liftDeclaration(engine, 'FALLBACK_HOLD_WINDOW_DAYS'),
    liftDeclaration(engine, 'readHoldWindow'),
  ],
  'readHoldWindow',
);

describe('refresh engine — readHoldWindow', () => {
  const NOW = new Date('2026-08-09T12:00:00.000Z');

  it('falls back to exactly 4 days, labelled, with no captureBefore', async () => {
    const w = await readHoldWindow({}, { latest_charge: chargeWith({}) }, undefined, NOW);
    expect(w.source).toBe('fallback');
    expect(w.expiresAt).toBe(new Date(NOW.getTime() + 4 * 86_400_000).toISOString());
    expect(w.captureBefore).toBeNull();
    expect(w.windowSeconds).toBeNull();
  });

  it('still harvests card identity on the fallback path', async () => {
    // "Which card is this hold on" has to stay answerable across a 90-day chain
    // even when the deadline is a guess — it is what makes debit stacking
    // detectable.
    const w = await readHoldWindow(
      {},
      { latest_charge: chargeWith({ brand: 'mastercard', last4: '9999', funding: 'debit' }) },
      undefined,
      NOW,
    );
    expect(w.source).toBe('fallback');
    expect(w).toMatchObject({ cardBrand: 'mastercard', cardLast4: '9999', cardFunding: 'debit' });
  });

  it('falls back — never throws — when the charge cannot be read', async () => {
    const stripe = { charges: { retrieve: () => Promise.reject(new Error('boom')) } };
    const w = await readHoldWindow(stripe, { latest_charge: 'ch_unexpanded' }, undefined, NOW);
    expect(w.source).toBe('fallback');
  });

  it('reports the real deadline and window when Stripe published them', async () => {
    const created = Math.floor(NOW.getTime() / 1000) - 60;
    const captureBefore = created + 5 * DAY;
    const w = await readHoldWindow(
      {},
      { latest_charge: chargeWith({ captureBefore, created, extendedAuth: 'disabled' }) },
      undefined,
      NOW,
    );
    expect(w.source).toBe('stripe_capture_before');
    expect(w.captureBefore).toBe(new Date(captureBefore * 1000).toISOString());
    expect(w.expiresAt).toBe(w.captureBefore);
    expect(w.windowSeconds).toBe(5 * DAY);
    expect(w.extendedAuthStatus).toBe('disabled');
  });
});

describe('refresh engine — what it persists alongside the expiry', () => {
  const successWrite = engine.slice(
    engine.indexOf('const window = await readHoldWindow(stripe, newIntent, stripeOptions, now);'),
    engine.indexOf('{ status: "refreshing", paymentIntentId: incumbentPi }'),
  );

  it('writes the provenance the reader returned, never a hardcoded one', () => {
    expect(successWrite).toContain('deposit_hold_expiry_source: window.source');
    expect(codeOnly(successWrite)).not.toContain('deposit_hold_expiry_source: "stripe_capture_before"');
  });

  it('stamps verified_at ONLY when Stripe published the deadline', () => {
    // On the fallback path the expiry is an admitted guess. Stamping it verified
    // would let a downstream "verified recently?" check trust a value nothing
    // verified — so the column is left untouched and the previous genuine
    // verification (or NULL) stands.
    expect(successWrite).toContain('const verifiedFromStripe = window.source === "stripe_capture_before"');
    expect(successWrite).toContain('...(verifiedFromStripe ? { deposit_hold_verified_at: now.toISOString() } : {})');
  });

  it('keeps extended_auth tri-state rather than defaulting it to false', () => {
    expect(successWrite).toMatch(
      /deposit_hold_extended_auth:\s*\n?\s*window\.extendedAuthStatus === null \? null : window\.extendedAuthStatus === "enabled"/,
    );
  });
});

// ---------------------------------------------------------------------------
// The reconciliation paths — an absent capture_before changes nothing
// ---------------------------------------------------------------------------

describe('reconciliation paths — an absent capture_before leaves the stored expiry alone', () => {
  it('verify-deposit-hold uses the no-fallback reader and says why', () => {
    const src = readEdgeSource('verify-deposit-hold/index.ts');
    // It must NOT use resolveHoldExpiry* — those layer a `now + N days` floor
    // that moves on every call, so persisting it would re-arm the expiry and the
    // rental could never enter the refresh window.
    expect(src).toContain('readHoldCaptureFacts');
    expect(codeOnly(src)).not.toContain('resolveHoldExpiryDetailed');
    expect(codeOnly(src)).not.toMatch(/resolveHoldExpiry\b/);
    // Its own wrapper swallows the throw into null — "leave the stored value
    // alone" — rather than into a guess.
    const wrapper = src.slice(src.indexOf('async function readCaptureFacts'), src.indexOf('Deno.serve'));
    expect(wrapper).toContain('return null;');
    expect(wrapper).toMatch(/leaving stored expiry untouched/);
  });

  it('verify-deposit-hold only patches the expiry when it has a real one', () => {
    const src = readEdgeSource('verify-deposit-hold/index.ts');
    const patch = src.slice(src.indexOf('deposit_hold_status: "held",'), src.indexOf('let applied: boolean;'));
    // Guarded — so a null reading leaves deposit_hold_expires_at out of the
    // patch object entirely.
    expect(patch).toMatch(/if \(stripeExpiresAt !== null\) \{/);
    const guarded = patch.slice(patch.indexOf('if (stripeExpiresAt !== null)'));
    expect(guarded).toContain('patch.deposit_hold_expires_at = stripeExpiresAt;');
    expect(guarded).toContain('patch.deposit_hold_expiry_source = "stripe_capture_before";');
    // …and the only value it can ever report is Stripe's or nothing.
    expect(src).toContain(
      "expirySource: stripeExpiresAt !== null ? \"stripe_capture_before\" : null,",
    );
  });

  it('the reconciler excludes the expiry from its patch when Stripe published none', () => {
    const src = readEdgeSource('reconcile-deposit-holds/index.ts');
    const block = src.slice(
      src.indexOf('const facts = await readChargeFacts(ctx.stripe, intent, ctx.stripeOptions);'),
      src.indexOf('if (facts.extendedAuth !== null'),
    );
    expect(block).toMatch(/if \(facts\.captureBefore\) \{/);
    expect(block).toContain('patch.deposit_hold_expires_at = facts.captureBefore;');
    expect(block).toContain('patch.deposit_hold_expiry_source = "stripe_capture_before";');
    // Its reader returns null on both "not published" and "could not read", and
    // logs which — the handling is the same either way.
    const reader = src.slice(src.indexOf('async function readChargeFacts'), src.indexOf('return {', src.indexOf('async function readChargeFacts')));
    expect(reader).toMatch(/stored expiry left untouched/);
    expect(reader).toMatch(/leaving stored expiry untouched/);
    expect(codeOnly(src)).not.toContain('resolveHoldExpiryDetailed');
  });

  it('the reconciler compares expiries as instants, not as strings', () => {
    // Postgres returns "…+00:00" while toISOString() gives "…Z", so a string
    // compare is never equal and the reconciler would write on every single run.
    const src = readEdgeSource('reconcile-deposit-holds/index.ts');
    expect(src).toContain('const drifted = !(Math.abs(storedMs - new Date(facts.captureBefore).getTime()) < 1000);');
  });

  it("re-labels a row whose expiry was stored as a guess, once Stripe publishes the truth", () => {
    // `drifted || source !== 'stripe_capture_before'` — a fallback-sourced row
    // with a coincidentally-close timestamp still gets corrected, so provenance
    // converges on truth rather than sticking at the guess.
    const src = readEdgeSource('reconcile-deposit-holds/index.ts');
    expect(src).toContain('if (drifted || rental.deposit_hold_expiry_source !== "stripe_capture_before") {');
  });
});
