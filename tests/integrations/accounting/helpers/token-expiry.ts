// =============================================================================
// token-expiry.ts — LAYER 3. The one piece of real arithmetic in these four
// functions, extracted as a pure function so it can be tested without a
// network, a mock or a Deno runtime.
//
// WHERE THE ARITHMETIC IS
// -----------------------
// Both callbacks turn the provider's `expires_in` (SECONDS, relative) into a
// `token_expires_at` (ISO timestamp, absolute) that is stored on the connection
// and later read by `refresh-accounting-tokens` to decide when to refresh:
//
//   xero-oauth-callback:99
//     const expiresAt = new Date(Date.now() + (tokenJson.expires_in - 30) * 1000)
//                         .toISOString();
//
//   zoho-oauth-callback:164-167
//     const expiresInSeconds =
//       Number.isFinite(tokenJson.expires_in) && tokenJson.expires_in > 0
//         ? tokenJson.expires_in
//         : 3600;
//     const expiresAt = new Date(Date.now() + (expiresInSeconds - 30) * 1000)
//                         .toISOString();
//
// WHY IT DESERVES A MATHS SUITE AND IS NOT JUST "A SUBTRACTION"
// -------------------------------------------------------------
// Three separate ways to be wrong, each with a different and non-obvious cost:
//
//   THE SIGN OF THE SKEW.  `- 30` shortens the token's recorded life. Flip it
//   to `+ 30` and every stored expiry is 60 seconds later than the truth, so
//   the refresher waits until AFTER the provider has already stopped accepting
//   the token. The failure is a 401 mid-sync, on a schedule, for every tenant
//   at once — and it looks like a provider outage, not like arithmetic.
//
//   THE UNIT.  `* 1000` is seconds -> milliseconds. `* 100` still produces a
//   perfectly valid ISO string, three minutes into the future instead of half
//   an hour, and nothing anywhere would report an error.
//
//   THE MISSING VALUE.  Zoho guards a non-numeric `expires_in`; Xero does not.
//   `undefined - 30` is NaN, `new Date(NaN).toISOString()` THROWS a RangeError,
//   and in xero-oauth-callback that throw lands in the outer catch AFTER the
//   authorization code has been redeemed — the consent grant is spent, the
//   tokens are in a local variable that is about to be discarded, and the
//   operator is redirected to an error page. See README finding 4.
//
// The two forms below are separate exports rather than one function with a
// flag, because the difference between them IS the finding.
// =============================================================================

/** The clock-skew margin both callbacks subtract. Seconds. */
export const EXPIRY_SKEW_SECONDS = 30;

/** Zoho's fallback when the provider does not send a usable `expires_in`. */
export const ZOHO_FALLBACK_SECONDS = 3600;

/**
 * The GUARDED form — zoho-oauth-callback.
 *
 * Mirrors the source exactly, including the `> 0` half of the condition: a
 * zero or negative `expires_in` also takes the fallback, because a token that
 * is already expired on arrival is a provider bug, not an instruction to store
 * a timestamp in the past.
 */
export function guardedExpiresAtIso(
  expiresIn: unknown,
  nowMs: number,
  fallbackSeconds: number = ZOHO_FALLBACK_SECONDS,
): string {
  const seconds =
    Number.isFinite(expiresIn) && (expiresIn as number) > 0
      ? (expiresIn as number)
      : fallbackSeconds;
  return new Date(nowMs + (seconds - EXPIRY_SKEW_SECONDS) * 1000).toISOString();
}

/**
 * The UNGUARDED form — xero-oauth-callback.
 *
 * Reproduced faithfully, RangeError and all. A test that quietly "fixed" the
 * copy would assert that Xero behaves like Zoho, which is the one thing this
 * pair exists to show is false.
 */
export function unguardedExpiresAtIso(expiresIn: unknown, nowMs: number): string {
  return new Date(nowMs + ((expiresIn as number) - EXPIRY_SKEW_SECONDS) * 1000).toISOString();
}

/**
 * How many seconds of usable life a stored expiry claims, relative to `nowMs`.
 *
 * The unit the assertions are written in. Comparing ISO strings would pass on a
 * `* 100` bug as readily as it fails on one.
 */
export function headroomSeconds(iso: string, nowMs: number): number {
  return (Date.parse(iso) - nowMs) / 1000;
}
