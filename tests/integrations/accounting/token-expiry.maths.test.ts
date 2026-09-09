// =============================================================================
// integrations/accounting — LAYER 3. THE MATHS.
//
//   "FUNCTIONAL test hai, aur phir MATH wale test hain… maths wale test bade
//    important hain."
//
// WHAT ARITHMETIC ACTUALLY EXISTS ON THIS SURFACE
// -----------------------------------------------
// The brief was: no maths suite here unless there is real arithmetic. There is
// exactly one piece in these four functions, and it is not decorative —
//
//     token_expires_at = now + (expires_in - 30) * 1000
//
// — the conversion from the provider's RELATIVE `expires_in` (seconds) to the
// ABSOLUTE timestamp stored on the connection. `refresh-accounting-tokens`
// reads that timestamp to decide when to refresh, so this one line decides
// whether every tenant's accounting sync keeps working or 401s on a schedule.
//
// It is also the one place the two providers' arithmetic differs, which is why
// the two forms are tested side by side rather than as one parameterised case.
//
// WHAT IS NOT HERE, DELIBERATELY
// ------------------------------
// Invoice totals, tax and currency conversion are NOT in these four functions.
// They are downstream, in `process-accounting-sync` and the two provider
// clients, and the money there travels as INTEGER CENTS end to end
// (`amount_cents`, `tax_cents`) with the only arithmetic being `Math.abs()` for
// credit notes and a `/ 100` at the provider boundary — four call sites in each
// client. Tax is not computed by us at all: Xero is sent
// `LineAmountTypes: "Exclusive"` and works it out, Zoho is sent a `tax_id`.
//
// That is a real maths surface and it belongs in the same category as the
// Bonzah maths tests, but it is not this folder's four functions, so it is
// reported in the README rather than half-covered here.
//
// Pure. No network, no mocks, no clock — `nowMs` is an argument, so these
// assertions are the same at every hour of every day.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  EXPIRY_SKEW_SECONDS,
  ZOHO_FALLBACK_SECONDS,
  guardedExpiresAtIso,
  headroomSeconds,
  unguardedExpiresAtIso,
} from "./helpers/token-expiry";
import { readAccountingFunction } from "./helpers/accounting-source";

/** A fixed instant. Any instant would do; a fixed one makes failures readable. */
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

describe("accounting/maths — expires_in becomes token_expires_at", () => {
  it("a typical Xero grant (1800s) is stored 1770s ahead", () => {
    const iso = unguardedExpiresAtIso(1800, NOW);
    expect(
      headroomSeconds(iso, NOW),
      "The stored expiry for a 30-minute Xero access token is no longer 1770s ahead. " +
        "Either the 30s skew changed or the seconds->milliseconds conversion did.",
    ).toBe(1770);
    expect(iso).toBe("2026-01-01T12:29:30.000Z");
  });

  it("a typical Zoho grant (3600s) is stored 3570s ahead", () => {
    const iso = guardedExpiresAtIso(3600, NOW);
    expect(headroomSeconds(iso, NOW)).toBe(3570);
    expect(iso).toBe("2026-01-01T12:59:30.000Z");
  });

  it("the skew always SHORTENS the recorded life, never lengthens it", () => {
    // The direction is the whole safety property. `+ 30` instead of `- 30`
    // stores every expiry a minute later than the truth, so the refresher waits
    // until after the provider has already stopped accepting the token: a 401
    // mid-sync, on a schedule, for every tenant at once — and it looks like a
    // provider outage rather than like arithmetic.
    for (const expiresIn of [60, 300, 1800, 3600, 86_400]) {
      const stored = headroomSeconds(guardedExpiresAtIso(expiresIn, NOW), NOW);
      expect(
        stored,
        `expires_in=${expiresIn} was stored as ${stored}s of headroom — that is not less ` +
          `than the ${expiresIn}s the provider granted. The margin is now pointing the ` +
          `wrong way, and every refresh will be attempted too late.`,
      ).toBeLessThan(expiresIn);
      expect(stored).toBe(expiresIn - EXPIRY_SKEW_SECONDS);
    }
  });

  it("a token granted for exactly the skew is stored as already due", () => {
    // Boundary. 30s in, 0s of headroom out: the refresher treats it as due
    // immediately, which is the correct reading of a token with no usable life.
    expect(headroomSeconds(guardedExpiresAtIso(EXPIRY_SKEW_SECONDS, NOW), NOW)).toBe(0);
  });

  it("a token granted for less than the skew is stored in the PAST, not clamped", () => {
    // Fails closed, and it should. Clamping a 5-second token to "now" would
    // claim headroom that does not exist; storing -25s makes every reader treat
    // it as expired, which it effectively is.
    const stored = headroomSeconds(guardedExpiresAtIso(5, NOW), NOW);
    expect(
      stored,
      "A token granted for 5 seconds is no longer stored as already expired. If this is " +
        "now clamped to `now`, a refresher that checks `expires_at > now()` will treat a " +
        "dead token as live.",
    ).toBe(-25);
    expect(stored).toBeLessThan(0);
  });

  it("the unit is seconds -> milliseconds, and one second moves it by exactly 1000ms", () => {
    // `* 100` instead of `* 1000` produces a perfectly valid ISO string three
    // minutes out instead of half an hour, and nothing anywhere reports an error.
    // Only a differential check catches it.
    const a = Date.parse(guardedExpiresAtIso(1800, NOW));
    const b = Date.parse(guardedExpiresAtIso(1801, NOW));
    expect(
      b - a,
      `One extra second of granted life moved the stored expiry by ${b - a}ms, not 1000ms. ` +
        `The seconds->milliseconds conversion is wrong; at *100 every token would be ` +
        `refreshed ten times more often than needed, and at *10000 far too late.`,
    ).toBe(1000);
  });

  it("the stored value round-trips through UTC without drift", () => {
    // These strings are handed to Postgres as TIMESTAMPTZ. A value that parses
    // back to a different instant is a silent timezone bug, and the symptom
    // would be tokens refreshed hours early or late depending on where the
    // function happened to run.
    const iso = guardedExpiresAtIso(3600, NOW);
    expect(iso.endsWith("Z"), `Stored expiry "${iso}" is not UTC.`).toBe(true);
    expect(Date.parse(iso)).toBe(NOW + (3600 - EXPIRY_SKEW_SECONDS) * 1000);
  });
});

describe("accounting/maths — the two providers guard the input differently", () => {
  it("Zoho falls back to one hour for any unusable expires_in", () => {
    // Mirrors `Number.isFinite(x) && x > 0 ? x : 3600` exactly, including the
    // cases that are easy to get wrong: a NUMERIC STRING is not finite by
    // `Number.isFinite`, so "3600" takes the fallback too. That is the source's
    // behaviour, and this test exists to notice if it stops being.
    const expected = ZOHO_FALLBACK_SECONDS - EXPIRY_SKEW_SECONDS;
    for (const bad of [undefined, null, NaN, Infinity, 0, -1, "3600", {}]) {
      const stored = headroomSeconds(guardedExpiresAtIso(bad as unknown, NOW), NOW);
      expect(
        stored,
        `expires_in=${JSON.stringify(bad) ?? String(bad)} no longer falls back to ` +
          `${ZOHO_FALLBACK_SECONDS}s. Zoho's access tokens are one hour; the fallback is ` +
          `what stops a missing field turning into an Invalid Date.`,
      ).toBe(expected);
    }
  });

  it("Zoho still honours a real expires_in rather than always using the fallback", () => {
    // The other half of the guard. A fallback that fires on GOOD input would
    // quietly overwrite whatever Zoho actually granted.
    expect(headroomSeconds(guardedExpiresAtIso(900, NOW), NOW)).toBe(870);
  });

  it("Xero's form THROWS on a missing expires_in — after the code is already spent", () => {
    // The asymmetry, as arithmetic. `undefined - 30` is NaN, and
    // `new Date(NaN).toISOString()` throws a RangeError. In
    // xero-oauth-callback that throw happens AFTER the authorization code has
    // been redeemed: the grant is spent, the tokens are in a local variable
    // about to be discarded, and the operator lands on an error page having
    // already consented. See README finding 4.
    //
    // This asserts the arithmetic as it is written, which is the honest thing
    // for a maths test to do — the fix belongs in the function, not here.
    expect(
      () => unguardedExpiresAtIso(undefined, NOW),
      "unguardedExpiresAtIso no longer throws on a missing expires_in. If " +
        "xero-oauth-callback grew the same guard zoho-oauth-callback has, that is the fix " +
        "for README finding 4 — point this helper at the guarded form and retire this case.",
    ).toThrow(RangeError);

    // And the contrast that makes the point: identical input, one provider copes.
    expect(() => guardedExpiresAtIso(undefined, NOW)).not.toThrow();
  });
});

describe("accounting/maths — the formula still matches the functions", () => {
  // A maths suite that drifts from the code it mirrors is worse than none: it
  // keeps passing while the thing it claims to describe has changed. The
  // helper's arithmetic is written by hand, so these read the constants back
  // out of the functions' own source. Same rule as the contract layer — only
  // one side of a comparison may be typed by a human.

  it("both callbacks still subtract the same skew and multiply by 1000", () => {
    for (const fn of ["xero-oauth-callback", "zoho-oauth-callback"]) {
      const shape = readAccountingFunction(fn, "query-string");
      const m = /Date\.now\(\)\s*\+\s*\(\s*[A-Za-z_$][\w$.]*\s*-\s*(\d+)\s*\)\s*\*\s*(\d+)/.exec(
        shape.src,
      );
      expect(
        m,
        `Could not find the expiry arithmetic in ${shape.file}. It was rewritten — ` +
          `retarget this assertion, because everything in this file is a mirror of that ` +
          `one line and a mirror nobody checks is not a test.`,
      ).not.toBeNull();

      const [, skew, unit] = m as RegExpExecArray;
      expect(
        Number(skew),
        `${fn} now subtracts ${skew}s of clock skew, but helpers/token-expiry.ts still ` +
          `models ${EXPIRY_SKEW_SECONDS}s. Update the helper and the expected values above ` +
          `together — failure mode (a).`,
      ).toBe(EXPIRY_SKEW_SECONDS);
      expect(Number(unit), `${fn} no longer converts seconds to milliseconds.`).toBe(1000);
    }
  });

  it("only zoho-oauth-callback carries the 3600s fallback", () => {
    const zoho = readAccountingFunction("zoho-oauth-callback", "query-string");
    const xero = readAccountingFunction("xero-oauth-callback", "query-string");

    expect(
      zoho.src,
      "zoho-oauth-callback's expires_in guard is gone. Zoho reports a bad grant as HTTP " +
        "200 with an error body, so a response with no usable expires_in is a shape it " +
        "genuinely produces.",
    ).toMatch(/Number\.isFinite\([^)]*expires_in[^)]*\)/);
    expect(zoho.src).toContain(String(ZOHO_FALLBACK_SECONDS));

    expect(
      /Number\.isFinite/.test(xero.src),
      "xero-oauth-callback has grown a Number.isFinite guard on expires_in. That is " +
        "README finding 4 being FIXED — good. Retire the throwing case above and point " +
        "the helper at the guarded form.",
    ).toBe(false);
  });
});
