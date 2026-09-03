/**
 * Finance Sync — exponential backoff schedule (Spec §9.1, §14.2).
 *
 * Standalone helpers extracted so they can be unit-tested without spinning
 * up the whole sync worker. Used by:
 *   - process-accounting-sync — to compute next_attempt_at on failure
 *   - retry-accounting-sync   — to clear next_attempt_at on manual retry
 *   - any future autopilot/anomaly code that needs the same cadence
 *
 * Schedule: 1m → 5m → 30m → 2h → 12h → dead-letter. After dead-letter the
 * row stays `failed` indefinitely; only manual retry from the UI re-queues it.
 *
 * `nextAttemptAfter(attempts)` takes the **current** attempts count BEFORE
 * incrementing. So:
 *   attempts=0 (first failure)  → +1m
 *   attempts=1 (second failure) → +5m
 *   attempts=2                  → +30m
 *   attempts=3                  → +2h
 *   attempts=4                  → +12h
 *   attempts=5+                 → dead-letter (returns null)
 *
 * Auth/validation errors bypass this schedule entirely — the worker passes
 * `errorClass='auth'|'validation'` and the row goes to `failed` with no
 * next_attempt_at (manual fix required).
 */

export const BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;
export const DEAD_LETTER_AT_ATTEMPTS = 5;

export type ErrorClass = "transient" | "auth" | "validation" | "duplicate" | "unknown";

/**
 * Compute the next_attempt_at for a row that just failed.
 * Returns null when the row should NOT auto-retry — i.e.:
 *   - We've hit dead-letter (attempts >= DEAD_LETTER_AT_ATTEMPTS)
 *   - The error class is auth or validation (no point retrying without operator action)
 *   - The error class is duplicate (already synced — caller treats as success)
 *
 * @param currentAttempts the attempts counter BEFORE we increment for this failure
 * @param errorClass classified error from the provider call
 * @param now epoch millis — overridable for testing
 */
export function nextAttemptAfter(
  currentAttempts: number,
  errorClass: ErrorClass,
  now: number = Date.now(),
): Date | null {
  if (errorClass === "auth" || errorClass === "validation" || errorClass === "duplicate") {
    return null;
  }
  const nextAttempts = currentAttempts + 1;
  if (nextAttempts >= DEAD_LETTER_AT_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.min(currentAttempts, BACKOFF_MINUTES.length - 1)];
  return new Date(now + minutes * 60_000);
}

/** Same as nextAttemptAfter but returns the delta in minutes (or null) for logs/UI. */
export function nextAttemptDeltaMinutes(
  currentAttempts: number,
  errorClass: ErrorClass,
): number | null {
  if (errorClass === "auth" || errorClass === "validation" || errorClass === "duplicate") {
    return null;
  }
  const nextAttempts = currentAttempts + 1;
  if (nextAttempts >= DEAD_LETTER_AT_ATTEMPTS) return null;
  return BACKOFF_MINUTES[Math.min(currentAttempts, BACKOFF_MINUTES.length - 1)];
}

/** Whether a row at this attempts count + error class has hit dead-letter. */
export function isDeadLetter(currentAttempts: number, errorClass: ErrorClass): boolean {
  if (errorClass === "auth" || errorClass === "validation") return true;
  return currentAttempts + 1 >= DEAD_LETTER_AT_ATTEMPTS;
}
