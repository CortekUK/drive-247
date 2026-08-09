// Shared helper: raise an OPERATOR-VISIBLE alert when a deposit-hold chain link
// fails.
//
// WHY THIS EXISTS
// ---------------
// The chained-authorization engine can keep a deposit alive across a 60-120 day
// rental, but until now a chain that DIED said nothing. A link that fails on day
// 45 leaves the renter unsecured — the incumbent authorization has already been
// cancelled by the time the replacement is attempted — and the row quietly sits
// in 'failed' / 'requires_action' / 'needs_review' until somebody happens to open
// the rental. In practice that is the day the car comes back, which is the one
// day the deposit was for.
//
// This helper is the notification half of that story. It does NOT decide policy,
// it does not write to `rentals`, and it does not retry anything: it reads the
// outcome the engine already committed and turns it into one bell an operator
// can act on.
//
// CONTRACT
// --------
//   - NEVER THROWS. It is called from inside catch blocks and from the tail of
//     money-path writes; a notification problem must never change what the
//     engine did with a renter's card. Everything is wrapped, and the underlying
//     `notifyOperatorsInApp` is itself contractually non-throwing.
//   - IDEMPOTENT per (rental, hold status, attempt). The dedupe key means a
//     nightly cron that re-examines the same stuck rental cannot re-ring the same
//     bell, while a genuinely NEW attempt that fails again does ring — that is
//     the signal, not the noise.
//   - SILENT for every non-failure outcome. Passing a 'refreshed' / 'released' /
//     'lost_race' / 'skipped' / 'config_unavailable' / 'chain_expired' result is
//     legal and is a no-op, so the call can sit on the single funnel every exit
//     path goes through instead of being duplicated down four failure branches.
//   - NO EMAIL / NO SMS. In-app only, deliberately: the portal bell is
//     always-on for every tenant and needs no per-tenant toggle, so this cannot
//     be silently switched off on the one tenant that needed it.
//
// This deliberately does NOT build on `reminders-generate` / `reminders-digest`.
// Those are dead code — `reminders-digest` is a literal TODO followed by a
// console.log, so a reminder row raised there reaches nobody.

import { notifyOperatorsInApp } from "./notify-inapp.ts";
import { formatCurrency } from "./format-utils.ts";

/**
 * Hold statuses that mean "the deposit is NOT currently secured and the engine
 * has stopped or paused". These are the only states that raise a bell.
 *
 * Everything else in the 11-value `deposit_hold_status` vocabulary is either
 * healthy ('held'), mid-flight and owned by another worker ('processing',
 * 'refreshing', 'capturing'), or finished by intent ('captured', 'released',
 * 'expired', 'disputed') — none of which is news.
 */
export const ALERTING_HOLD_STATUSES = [
  "failed",
  "requires_action",
  "needs_review",
] as const;

export type AlertingHoldStatus = (typeof ALERTING_HOLD_STATUSES)[number];

/** Every column this helper reads off a rental row. */
export const DEPOSIT_HOLD_ALERT_COLUMNS = `
  id, tenant_id, rental_number,
  deposit_hold_status,
  deposit_hold_payment_intent_id,
  deposit_hold_amount,
  deposit_hold_currency,
  deposit_hold_attempt_seq,
  deposit_hold_failure_count,
  deposit_hold_next_retry_at,
  deposit_hold_last_error,
  deposit_hold_last_error_code,
  deposit_hold_expires_at,
  deposit_hold_chain_expires_at
`;

/**
 * Single stable notification `type`.
 *
 * It must NOT vary by status: `notifyOperatorsInApp` scopes its dedupe lookup to
 * `type` + the key, so a type that moved with the status would defeat dedupe the
 * moment a rental changed state. The status lives in the dedupe key and in
 * `metadata.hold_status` instead. The portal bell treats `type` as free-form
 * (only `chat_message` is special-cased, into its own tab), so a new slug lands
 * in the General tab with no UI change required.
 */
export const DEPOSIT_HOLD_ALERT_TYPE = "deposit_hold_failure";

/**
 * Mirrors `MAX_HOLD_ATTEMPTS` in `_shared/deposit-hold-refresh.ts` (Stripe's own
 * guidance: "a maximum of eight retries"). Passed in by callers that already
 * import the engine so the two cannot drift; defaulted here so a caller that
 * does not (a webhook, a manual tool) still gets sane copy.
 */
const DEFAULT_MAX_ATTEMPTS = 8;

export interface DepositHoldAlertParams {
  /**
   * The rental row. Anything with `id` and `tenant_id` works; every other column
   * is read opportunistically, so a caller holding only the engine's
   * `HOLD_REFRESH_COLUMNS` projection (which has no `rental_number`) is fine.
   */
  rental: Record<string, unknown>;
  /** The engine's `RefreshResult` for this attempt. */
  result: string;
  /** The engine's human-readable outcome message. */
  message?: string | null;
  /**
   * The patch the engine just wrote, when the caller has it. Read for
   * `deposit_hold_status`, `_next_retry_at`, `_failure_count`,
   * `_last_error_code` and `_last_error`, all of which are fresher than the
   * pre-attempt rental row.
   */
  patch?: Record<string, unknown> | null;
  /** Explicit override for the post-attempt hold status. */
  status?: string | null;
  /** Error taxonomy bucket: transient | funds | sca | dead_card | ambiguous. */
  failureClass?: string | null;
  /** Stripe (or internal) error code. Falls back to the patch / rental row. */
  errorCode?: string | null;
  /** Raw failure text. Falls back to the patch / rental row / `message`. */
  errorMessage?: string | null;
  /** When the engine will try again. Falls back to the patch / rental row. */
  nextRetryAt?: string | null;
  /** The attempt sequence THIS failure belongs to (prior seq + 1). */
  attemptSeq?: number | null;
  /** Consecutive failure count AFTER this failure. */
  failureCount?: number | null;
  /** Deposit size in minor units, when the caller has it in that form. */
  amountCents?: number | null;
  /** ISO 4217 code. Falls back to `deposit_hold_currency` on the row. */
  currency?: string | null;
  /** Retry ceiling; pass `MAX_HOLD_ATTEMPTS` from the engine to keep them locked. */
  maxAttempts?: number | null;
  /** Who ran this pass — 'cron', 'sandbox', 'webhook', 'manual'. */
  source?: string;
  /**
   * Optional service-role client, used for ONE best-effort read: looking up
   * `rental_number` when the caller's row does not carry it (the engine's
   * `HOLD_REFRESH_COLUMNS` projection does not). It turns "rental 1a2b3c4d" into
   * "#R-1042" in the operator's bell, which is the difference between an alert
   * they can act on and one they have to go looking for.
   *
   * Deliberately a parameter rather than a client this module builds for itself:
   * the callers all already hold one, and a failed alert must never be able to
   * cost a money path a second connection. If it is absent, or the read fails,
   * the copy simply falls back to the short id.
   */
  // deno-lint-ignore no-explicit-any
  supabase?: any;
}

/**
 * Is this outcome worth waking an operator for?
 *
 * Exported so a caller can skip the extra round-trips (a post-attempt re-read,
 * say) it would otherwise do purely to build an alert that is then discarded.
 * Calling `notifyDepositHoldFailure` unconditionally is equally correct — it
 * makes the same decision internally.
 */
export function shouldAlertDepositHold(resultOrStatus: string | null | undefined): boolean {
  if (!resultOrStatus) return false;
  return (ALERTING_HOLD_STATUSES as readonly string[]).includes(String(resultOrStatus));
}

/** `2026-08-09 03:15 UTC`, or null if the value is missing/unparseable. */
function formatWhen(iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return `${new Date(t).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function firstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Human label for a rental: its number when we have one, else a short id. */
function rentalRef(rentalNumber: string | null, rentalId: string): string {
  return rentalNumber ? `#${rentalNumber}` : `rental ${rentalId.slice(0, 8)}`;
}

/**
 * Best-effort `rental_number` lookup. One PK read, only on a failure path, and
 * only when the caller's projection did not carry it. Any problem returns null
 * and the copy degrades to the short id — this must never be able to fail an
 * alert, let alone the money path that raised it.
 */
async function lookupRentalNumber(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rentalId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("rentals")
      .select("rental_number")
      .eq("id", rentalId)
      .maybeSingle();
    if (error) {
      console.error("[deposit-hold-notify] rental_number lookup failed:", error.message);
      return null;
    }
    return firstString(data?.rental_number);
  } catch (err) {
    console.error("[deposit-hold-notify] rental_number lookup threw, ignoring:", err);
    return null;
  }
}

/** Plain-English gloss for the taxonomy bucket, appended when we know it. */
function failureClassGloss(failureClass: string | null): string | null {
  switch (failureClass) {
    case "transient":
      return "a temporary card-network or Stripe problem";
    case "funds":
      return "the issuer declined the amount";
    case "sca":
      return "the bank wants the cardholder to authenticate";
    case "dead_card":
      return "the card on file is no longer usable";
    case "ambiguous":
      return "an unrecognised failure we will not guess at";
    default:
      return null;
  }
}

/**
 * Raise the bell for a failed deposit-hold chain link.
 *
 * Safe to call for ANY outcome: non-failure results return immediately.
 */
export async function notifyDepositHoldFailure(
  params: DepositHoldAlertParams,
): Promise<void> {
  try {
    const rental = params.rental ?? {};
    const patch = params.patch ?? {};

    const rentalId = firstString(rental.id);
    const tenantId = firstString(rental.tenant_id);

    // ── Resolve the POST-attempt hold status. ────────────────────────────────
    // `result` is preferred over the rental row because the row a caller holds
    // is usually the PRE-attempt snapshot; for the three results we alert on,
    // the engine writes exactly the same-named status, so the mapping is exact.
    const status = firstString(
      params.status,
      patch.deposit_hold_status,
      shouldAlertDepositHold(params.result) ? params.result : null,
      rental.deposit_hold_status,
    );

    if (!shouldAlertDepositHold(status)) return; // healthy / mid-flight / finished — no news.

    if (!rentalId || !tenantId) {
      console.error(
        "[deposit-hold-notify] rental is missing id or tenant_id — cannot raise alert",
        { rentalId, tenantId, status },
      );
      return;
    }

    const attemptSeq = firstNumber(params.attemptSeq, rental.deposit_hold_attempt_seq);
    const failureCount = firstNumber(
      params.failureCount,
      patch.deposit_hold_failure_count,
      rental.deposit_hold_failure_count,
    );
    const maxAttempts = firstNumber(params.maxAttempts) ?? DEFAULT_MAX_ATTEMPTS;

    const nextRetryAt = firstString(
      params.nextRetryAt,
      patch.deposit_hold_next_retry_at,
      rental.deposit_hold_next_retry_at,
    );
    const errorCode = firstString(
      params.errorCode,
      patch.deposit_hold_last_error_code,
      rental.deposit_hold_last_error_code,
    );
    const errorMessage = firstString(
      params.errorMessage,
      patch.deposit_hold_last_error,
      rental.deposit_hold_last_error,
      params.message,
    );
    const failureClass = firstString(params.failureClass);

    // Amount: minor units from the caller, else the row's decimal column
    // (`deposit_hold_amount` is stored in MAJOR units — the engine multiplies it
    // by 100 to reach Stripe).
    const amountMajor = params.amountCents !== null && params.amountCents !== undefined &&
        Number.isFinite(Number(params.amountCents))
      ? Number(params.amountCents) / 100
      : firstNumber(rental.deposit_hold_amount);

    // NO DEFAULT CURRENCY. Assuming USD would print "$500" on a GBP hold, and a
    // wrong number in an alert about money is worse than no number: the operator
    // acts on it. When the currency is unknown the amount is simply omitted and
    // the copy talks about "the deposit". Legacy rows predating
    // `deposit_hold_currency` are exactly the population this protects.
    const currency = firstString(params.currency, rental.deposit_hold_currency)?.toUpperCase() ?? null;
    const amountText = amountMajor !== null && currency
      ? formatCurrency(amountMajor, currency)
      : null;

    // ── Is the renter's money actually unsecured right now? ──────────────────
    // NOT the same question as "did this attempt fail". `recordFailure` clears
    // the PaymentIntent after cancelling the incumbent, so those rows genuinely
    // are unsecured — but two `needs_review` paths deliberately leave a LIVE
    // authorization in place (the "deposit amount unknown" park, which never
    // touches Stripe, and the orphan-amount-mismatch park, which repoints the row
    // at the authorization actually holding the money). Telling an operator their
    // deposit is gone when it is not would send them to re-charge a renter who is
    // already authorized, so the sentence is derived from the PaymentIntent the
    // row carries AFTER the attempt, not from the failure itself.
    const patchTouchedPi = Object.prototype.hasOwnProperty.call(
      patch,
      "deposit_hold_payment_intent_id",
    );
    const livePaymentIntentId = patchTouchedPi
      ? firstString(patch.deposit_hold_payment_intent_id)
      : firstString(rental.deposit_hold_payment_intent_id);

    let rentalNumber = firstString(rental.rental_number);
    if (!rentalNumber && params.supabase) {
      rentalNumber = await lookupRentalNumber(params.supabase, rentalId);
    }
    const ref = rentalRef(rentalNumber, rentalId);

    // ── The cause clause, shared by all three shapes. ────────────────────────
    const gloss = failureClassGloss(failureClass);
    const causeBits = [
      errorCode ? `code ${errorCode}` : null,
      gloss,
    ].filter(Boolean).join(" — ");
    const cause = causeBits
      ? ` (${causeBits})`
      : errorMessage
      ? ` (${errorMessage.slice(0, 160)})`
      : "";

    // The one sentence an operator has to read. See the derivation above — it
    // states what is true of the renter's money right now, not what the engine
    // tried to do.
    const depositLabel = amountText ? `${amountText} deposit` : "deposit";
    const moneyState = livePaymentIntentId
      ? `The ${depositLabel} authorization on file is still live, but the chain has stopped, so it will lapse when it expires.`
      : `The ${depositLabel} is NOT currently held.`;

    let title: string;
    let body: string;
    let severity: "warning" | "critical";

    if (status === "failed") {
      // AUTO-RECOVERING. The engine wrote a backoff and will come back on its
      // own; this is an FYI so a chain that is quietly bleeding attempts is
      // visible BEFORE it exhausts them, not after.
      severity = "warning";
      const when = formatWhen(nextRetryAt);
      const attemptText = failureCount !== null
        ? ` (attempt ${failureCount} of ${maxAttempts})`
        : "";
      title = `Deposit hold retrying — ${ref}`;
      body =
        `Renewing the deposit hold on ${ref} failed${cause}. ${moneyState} ` +
        `It will be retried automatically ${when ? `at ${when}` : "on the next sweep"}${attemptText}. ` +
        `No action needed unless this keeps repeating.`;
    } else if (status === "requires_action") {
      // The cardholder is required. Nothing server-side can fix this.
      severity = "critical";
      title = `Deposit hold needs the cardholder — ${ref}`;
      body =
        `The deposit hold on ${ref} could not be renewed${cause} and cannot be retried automatically — ` +
        `it needs the cardholder (a new card, or the bank's authentication step). ${moneyState} ` +
        `Contact the renter for a usable card, then re-place the hold from the rental page.`;
    } else {
      // needs_review — attempts exhausted, or something we refuse to guess at.
      severity = "critical";
      const exhausted = failureCount !== null && failureCount >= maxAttempts;
      title = `Deposit hold needs review — ${ref}`;
      body = exhausted
        ? `Automatic renewal of the deposit hold on ${ref} stopped after ${failureCount} failed attempts${cause}. ` +
          `No further retries are scheduled. ${moneyState} ` +
          `Review this rental and either re-place the hold on a working card or release it.`
        : `The deposit hold on ${ref} was parked for a human${cause}. ` +
          `No further retries are scheduled. ${moneyState} ` +
          `Review this rental and either re-place the hold or release it.`;
    }

    // ── Dedupe: rental + status + attempt. ───────────────────────────────────
    // Attempt is in the key on purpose. Without it, a chain that failed once
    // would never ring again no matter how many further links died; with it, a
    // nightly cron that re-reads the SAME stuck attempt stays silent while each
    // genuinely new failed attempt is reported. `attemptSeq` is normalised to a
    // string so a caller that has no seq still gets a stable key.
    const dedupeKey = `deposit_hold:${rentalId}:${status}:${attemptSeq ?? "na"}`;

    await notifyOperatorsInApp({
      tenantId,
      type: DEPOSIT_HOLD_ALERT_TYPE,
      title,
      message: body,
      link: `/rentals/${rentalId}`,
      metadata: {
        rental_id: rentalId,
        rental_number: rentalNumber,
        hold_status: status,
        result: params.result ?? null,
        severity,
        failure_class: failureClass,
        error_code: errorCode,
        error_message: errorMessage ? errorMessage.slice(0, 500) : null,
        attempt_seq: attemptSeq,
        failure_count: failureCount,
        max_attempts: maxAttempts,
        next_retry_at: nextRetryAt,
        amount: amountMajor,
        currency,
        payment_intent_id: livePaymentIntentId,
        secured: !!livePaymentIntentId,
        chain_expires_at: firstString(rental.deposit_hold_chain_expires_at),
        source: params.source ?? "cron",
      },
      dedupeKey,
    });

    console.log(
      `[deposit-hold-notify] alerted tenant ${tenantId} for rental ${rentalId} ` +
        `(status ${status}, attempt ${attemptSeq ?? "?"}, severity ${severity})`,
    );
  } catch (err) {
    // NEVER THROW — this runs on money paths, inside catch blocks.
    console.error("[deposit-hold-notify] unexpected error, swallowing:", err);
    return;
  }
}
