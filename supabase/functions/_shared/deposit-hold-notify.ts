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
//   - IT NEVER GUESSES ABOUT THE MONEY. Whether the renter is still secured is
//     a fact the CALLER asserts (`moneyState`), never something this file infers
//     from the row — a recorded `deposit_hold_payment_intent_id` is not an
//     authorization, and treating it as one told operators the deposit was safe
//     on the two paths where it demonstrably was not. Absent an assertion the
//     alert says NOTHING about the money. See `DepositHoldMoneyState`.
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

/**
 * What is TRUE of the renter's money at the moment this alert is raised.
 *
 * This is the single most dangerous sentence in the whole alert, so it is a
 * CALLER-SUPPLIED FACT and never an inference made here.
 *
 * The first version of this helper derived it from "does the row carry a
 * `deposit_hold_payment_intent_id` after the patch". That conflates *an id is
 * recorded* with *an authorization is live*, and the two come apart on exactly
 * the paths that matter most: the 3DS `requires_action` exit and the
 * non-capturable-replacement `needs_review` exit both CANCEL the incumbent and
 * then record a PaymentIntent that is holding nothing (`requires_action` /
 * `processing` / `requires_payment_method`). The alert would have told an
 * operator the renter was secured at the precise moment they were not — the
 * single worst thing an alert about money can do.
 *
 *   'live'      — a CONFIRMED capturable authorization exists right now, where
 *                 "confirmed" means STRIPE SAID SO IN THIS INVOCATION: a
 *                 PaymentIntent seen at `requires_capture` whose capture window
 *                 has not closed. A row that merely reads 'held' with a
 *                 PaymentIntent id and a stored expiry is NOT evidence — the
 *                 stored expiry is frequently an admitted guess
 *                 (`deposit_hold_expiry_source = 'fallback'`), and a lapsed,
 *                 captured or disputed authorization keeps the 'held' status
 *                 until somebody looks. An earlier version inferred 'live' from
 *                 exactly that row state and printed it as fact.
 *   'unsecured' — there is definitively no live authorization: the incumbent was
 *                 cancelled and a REPLACEMENT WAS DEFINITIVELY NOT CREATED —
 *                 Stripe or the issuer returned a verdict (a decline, a dead
 *                 card, an SCA demand). A create that failed with no verdict (a
 *                 connection reset, a timeout, a 5xx) is NOT this: Stripe may
 *                 have accepted it and be holding funds under an id we never
 *                 received, so that case is 'unknown'.
 *   'unknown'   — we cannot prove either. WE THEN SAY NOTHING ABOUT THE MONEY.
 *                 Silence is the correct output of doubt here; a guess in either
 *                 direction sends the operator to do the wrong thing (sit on an
 *                 unsecured rental, or re-charge an already-authorized renter).
 *
 * Callers that do not know — a webhook, a manual tool — simply omit it and get
 * 'unknown'. A missing sentence is a supported outcome, not a degraded one.
 */
export type DepositHoldMoneyState = "live" | "unsecured" | "unknown";

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
  /**
   * What is true of the renter's money RIGHT NOW — see `DepositHoldMoneyState`.
   * Omit when you do not know; the alert then says nothing about the money
   * rather than guessing. NEVER inferred from the row.
   */
  moneyState?: DepositHoldMoneyState | null;
  /**
   * Verbatim replacement for the money sentence, for the cases the three-value
   * vocabulary cannot express honestly — chiefly "a live authorization exists,
   * but for a DIFFERENT amount than this rental's deposit" (the orphan-mismatch
   * park). Used as given; when present, `moneyState` only feeds `metadata`.
   */
  moneyStatement?: string | null;
  /**
   * One extra sentence appended to the body — for facts the generic copy cannot
   * carry, e.g. "the status write also failed, so the row is stuck at
   * 'refreshing'". Kept separate from `message` so the shared copy stays stable.
   */
  detail?: string | null;
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

    // A patch that sets `deposit_hold_next_retry_at: null` is ASSERTING "no
    // retry is scheduled" — every 'needs_review' / 'requires_action' exit does
    // exactly that. Falling through to the row's older value would resurrect a
    // stale retry time and, worse, could make a dead-end failure read as
    // auto-recovering. An explicit null in the patch therefore wins.
    const patchTouchedRetry = Object.prototype.hasOwnProperty.call(
      patch,
      "deposit_hold_next_retry_at",
    );
    const nextRetryAt = firstString(params.nextRetryAt) ??
      (patchTouchedRetry
        ? firstString(patch.deposit_hold_next_retry_at)
        : firstString(rental.deposit_hold_next_retry_at));
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
    // WE DO NOT WORK THIS OUT HERE. It is `params.moneyState`, asserted by the
    // caller that watched the attempt happen — see `DepositHoldMoneyState` for
    // why deriving it from the row is wrong in the two places it matters most.
    // Anything not explicitly asserted is 'unknown', and 'unknown' prints no
    // sentence about the money at all.
    const moneyState: DepositHoldMoneyState =
      params.moneyState === "live" || params.moneyState === "unsecured"
        ? params.moneyState
        : "unknown";

    // The PaymentIntent id the row carries after the patch. RECORDED ONLY — it
    // is diagnostic metadata for whoever opens the rental, and it deliberately
    // does NOT feed the "is the deposit secured" sentence: a cancelled, expired
    // or never-confirmed PaymentIntent still leaves its id on the row.
    const patchTouchedPi = Object.prototype.hasOwnProperty.call(
      patch,
      "deposit_hold_payment_intent_id",
    );
    const recordedPaymentIntentId = patchTouchedPi
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

    // The one sentence an operator has to read. It states what is KNOWN to be
    // true of the renter's money right now — and prints nothing at all when that
    // is not known. An empty string here is a deliberate, supported outcome.
    const depositLabel = amountText ? `${amountText} deposit` : "deposit";
    const moneySentence = firstString(params.moneyStatement) ??
      (moneyState === "live"
        ? `The ${depositLabel} authorization recorded on this rental was not cancelled by this attempt and is still live, ` +
          `but the chain has stopped — it will lapse when it expires.`
        : moneyState === "unsecured"
        ? `The ${depositLabel} is NOT currently held — the renter is unsecured.`
        : null);
    // Trailing space folded in here so an unknown money state leaves no double
    // space in the body.
    const money = moneySentence ? `${moneySentence} ` : "";

    // AUTO-RECOVERING vs ACTION-REQUIRED. The engine only writes 'failed'
    // together with a `deposit_hold_next_retry_at`, and that pairing is the ONLY
    // thing that makes "no action needed" a true statement. A 'failed' row with
    // no scheduled retry (the Stripe webhooks write exactly that for a first
    // placement that never succeeded) is not self-healing, so it must not be
    // announced as if it were: nothing will pick it up on its own.
    const autoRecovering = status === "failed" && !!nextRetryAt;

    let title: string;
    let body: string;
    let severity: "warning" | "critical";

    if (autoRecovering) {
      // AUTO-RECOVERING. The engine wrote a backoff and will come back on its
      // own; this is an FYI so a chain that is quietly bleeding attempts is
      // visible BEFORE it exhausts them, not after. Telling staff to act here is
      // how an alert channel earns its mute.
      severity = "warning";
      const when = formatWhen(nextRetryAt);
      const attemptText = failureCount !== null
        ? ` (attempt ${failureCount} of ${maxAttempts})`
        : "";
      title = `Deposit hold retrying — ${ref}`;
      body =
        `Renewing the deposit hold on ${ref} failed${cause}. ${money}` +
        `It will be retried automatically ${when ? `at ${when}` : "on the next sweep"}${attemptText}. ` +
        `No action needed unless this keeps repeating.`;
    } else if (status === "failed") {
      // 'failed' with NO retry scheduled — nothing is coming back for it.
      severity = "critical";
      title = `Deposit hold failed — ${ref}`;
      body =
        `Renewing the deposit hold on ${ref} failed${cause}, and NO automatic retry is scheduled. ${money}` +
        `Review this rental and either re-place the hold or release it.`;
    } else if (status === "requires_action") {
      // The cardholder is required. Nothing server-side can fix this.
      severity = "critical";
      title = `Deposit hold needs the cardholder — ${ref}`;
      body =
        `The deposit hold on ${ref} could not be renewed${cause} and cannot be retried automatically — ` +
        `it needs the cardholder (a new card, or the bank's authentication step). ${money}` +
        `Contact the renter for a usable card, then re-place the hold from the rental page.`;
    } else {
      // needs_review — attempts exhausted, or something we refuse to guess at.
      severity = "critical";
      const exhausted = failureCount !== null && failureCount >= maxAttempts;
      title = `Deposit hold needs review — ${ref}`;
      body = exhausted
        ? `Automatic renewal of the deposit hold on ${ref} stopped after ${failureCount} failed attempts${cause}. ` +
          `No further retries are scheduled. ${money}` +
          `Review this rental and either re-place the hold on a working card or release it.`
        : `The deposit hold on ${ref} was parked for a human${cause}. ` +
          `No further retries are scheduled. ${money}` +
          `Review this rental and either re-place the hold or release it.`;
    }

    const detail = firstString(params.detail);
    if (detail) body = `${body} ${detail}`;

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
        payment_intent_id: recordedPaymentIntentId,
        // TRI-STATE, and never derived from `payment_intent_id`: true / false /
        // null for "we could not prove it either way". A consumer must treat
        // null as unknown, NOT as false.
        money_state: moneyState,
        secured: moneyState === "unknown" ? null : moneyState === "live",
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

/**
 * Separate slug for the config-blocked bell. It must NOT share
 * `DEPOSIT_HOLD_ALERT_TYPE`: `notifyOperatorsInApp` scopes its dedupe lookup to
 * `type` + key, and these two have completely different keying (per rental +
 * attempt vs per tenant + day).
 */
export const DEPOSIT_HOLD_CONFIG_ALERT_TYPE = "deposit_hold_config_blocked";

/**
 * "We could not even try." — the `config_unavailable` outcome.
 *
 * The engine returns `config_unavailable` when the tenant row or the Stripe
 * context could not be resolved (`getConnectAccountId` throws for a live
 * `payment_model='own'` tenant with no connected account — the likeliest shape
 * of the in-flight UK->UAE migration going wrong) or when the claim/flag write
 * itself failed. The row is left UNTOUCHED, which is the right thing to do with
 * a renter's money, but it also means the authorization simply stops being
 * renewed and lapses, with nothing louder than a `skippedConfig` counter on
 * `cron_runs` to say so. That is the exact "nobody is told" outcome this whole
 * workstream exists to kill.
 *
 * Deliberately AGGREGATED and rate-limited, because the cause is per-TENANT and
 * the symptom is per-RENTAL: one broken Connect account would otherwise ring
 * once per affected rental, every night. One bell per tenant per UTC day, with
 * the count and the first message on it. A config outage that lasts a week is
 * worth seven bells; it is not worth 25 a night.
 *
 * NEVER THROWS.
 */
export async function notifyDepositHoldConfigBlocked(params: {
  tenantId: string;
  /** Rentals left untouched this pass. Length drives the copy. */
  rentalIds: string[];
  /** The engine's message for the first affected rental. */
  sampleMessage?: string | null;
  /** 'cron' | 'sandbox' | … */
  source?: string;
  now?: Date;
}): Promise<void> {
  try {
    const tenantId = firstString(params.tenantId);
    const rentalIds = (params.rentalIds ?? []).filter((id) => typeof id === "string" && id);
    if (!tenantId || rentalIds.length === 0) return;

    const now = params.now ?? new Date();
    const day = now.toISOString().slice(0, 10);
    const sample = firstString(params.sampleMessage);
    const count = rentalIds.length;

    await notifyOperatorsInApp({
      tenantId,
      type: DEPOSIT_HOLD_CONFIG_ALERT_TYPE,
      title: `Deposit holds not being renewed — the run could not proceed`,
      message:
        // DO NOT name Stripe as the cause here. `config_unavailable` is also
        // returned for pure DATABASE problems — the tenant lookup erroring, the
        // claim write failing, the PaymentIntent-less flag write failing — and
        // sending an operator to audit their Connect settings after a PostgREST
        // blip burns the channel's credibility. The sample message below carries
        // the actual cause; the headline states only what is certain.
        `${count} deposit hold${count === 1 ? "" : "s"} could not be renewed this run because the ` +
        `configuration or records needed to do it could not be read${sample ? ` (${sample.slice(0, 200)})` : ""}. ` +
        `The existing authorization${count === 1 ? "" : "s"} ${count === 1 ? "was" : "were"} left untouched — ` +
        `nothing was charged and nothing was cancelled — but ${count === 1 ? "it" : "they"} will lapse on ` +
        `the card network's own schedule unless the configuration is fixed.`,
      link: count === 1 ? `/rentals/${rentalIds[0]}` : `/rentals`,
      metadata: {
        rental_ids: rentalIds.slice(0, 50),
        rental_count: count,
        severity: "warning",
        result: "config_unavailable",
        // No money claim: the rows were not touched, so whatever was true before
        // this run is still true, and this helper did not verify it.
        money_state: "unknown",
        secured: null,
        sample_message: sample ? sample.slice(0, 500) : null,
        source: params.source ?? "cron",
        day,
      },
      // Per TENANT per UTC DAY. The cause is one configuration, not N rentals.
      dedupeKey: `deposit_hold_config:${tenantId}:${day}`,
    });

    console.log(
      `[deposit-hold-notify] config-blocked alert for tenant ${tenantId} (${count} rental(s), day ${day})`,
    );
  } catch (err) {
    console.error("[deposit-hold-notify] config alert failed, swallowing:", err);
    return;
  }
}

/**
 * "The chain has reached its end and the money is still ring-fenced."
 *
 * A chained deposit stops being renewed when the rental's end date plus the
 * grace window has passed. The engine deliberately does NOT capture or release
 * at that point — that is an operator decision — so the last authorization is
 * left alive and simply lapses on the card network's own schedule, days later,
 * with the renter's funds held the whole time and nobody told.
 *
 * WHY THIS LIVES IN THE RECONCILER AND NOT AT THE ENGINE'S `chain_expired` EXIT:
 * the refresh driver's SQL pre-filter drops a row at the very moment its bound
 * passes (the `chain_expires_at.gt.now` and `end_date.gte.now-grace` terms both
 * fail together), so `refreshOneHold` is never even called and its
 * `chain_expired` branch is effectively unreachable from cron. Observed
 * directly: a 16-link chain walked past its bound returned `not-selected`, never
 * `chain_expired`. The reconciler filters only on hold status, so it keeps
 * seeing the row — it is the only sweep that still can.
 *
 * Keyed per RENTAL, not per rental+day: a chain ends exactly once, and this is a
 * "come and do something" bell, not a recurring condition. Re-alerting nightly
 * for a fortnight would train operators to ignore it.
 *
 * NEVER THROWS.
 */
export const DEPOSIT_HOLD_CHAIN_ENDED_ALERT_TYPE = "deposit_hold_chain_ended";

export async function notifyDepositHoldChainEnded(params: {
  tenantId: string;
  rentalId: string;
  /** Kept live at Stripe — the amount still ring-fenced on the renter's card. */
  amount?: number | null;
  currency?: string | null;
  /** When the authorization lapses by itself if nobody acts. */
  expiresAt?: string | null;
  /** The chain bound that has passed. */
  chainEndedAt?: string | null;
  source?: string;
}): Promise<void> {
  try {
    const tenantId = firstString(params.tenantId);
    const rentalId = firstString(params.rentalId);
    if (!tenantId || !rentalId) return;

    const amt = typeof params.amount === "number" && params.amount > 0 ? params.amount : null;
    const cur = (firstString(params.currency) ?? "").toUpperCase();
    const money = amt ? `${cur ? cur + " " : ""}${amt.toFixed(2)}` : "The deposit";
    const lapses = firstString(params.expiresAt);

    await notifyOperatorsInApp({
      tenantId,
      type: DEPOSIT_HOLD_CHAIN_ENDED_ALERT_TYPE,
      title: "Deposit hold no longer being renewed — capture or release it",
      message:
        `This rental has passed the end of its deposit chain, so the hold is no longer being ` +
        `renewed. ${money} is STILL held on the renter's card right now` +
        (lapses ? ` and the authorization lapses on its own after ${lapses.slice(0, 10)}` : "") +
        `. Nothing has been charged and nothing has been cancelled — capture what you are owed ` +
        `or release it back to the renter.`,
      link: `/rentals/${rentalId}`,
      metadata: {
        rental_id: rentalId,
        severity: "warning",
        result: "chain_ended",
        // The authorization is confirmed live at Stripe — the reconciler just
        // probed it — so unlike config_unavailable this CAN claim money state.
        money_state: "live",
        secured: true,
        amount: amt,
        currency: cur || null,
        expires_at: lapses,
        chain_ended_at: firstString(params.chainEndedAt),
        source: params.source ?? "reconciler",
      },
      dedupeKey: `deposit_hold_chain_ended:${rentalId}`,
    });

    console.log(`[deposit-hold-notify] chain-ended alert for rental ${rentalId}`);
  } catch (err) {
    console.error("[deposit-hold-notify] chain-ended alert failed, swallowing:", err);
    return;
  }
}

/**
 * Fourth slug: an authorization that exists at Stripe and that NOTHING in the
 * product points at.
 *
 * Separate from `DEPOSIT_HOLD_ALERT_TYPE` for two reasons, both hard:
 *   * `notifyOperatorsInApp` scopes dedupe to `type` + key, and this keys per
 *     PaymentIntent rather than per (rental, status, attempt);
 *   * this is NOT a hold-status alert. The rental's `deposit_hold_status` here
 *     belongs to whoever won the race — it may legitimately read 'held',
 *     'released' or 'captured' — so routing this through the status-shaped bell
 *     would have meant asserting a status the row does not carry.
 */
export const DEPOSIT_HOLD_ORPHAN_ALERT_TYPE = "deposit_hold_orphaned_authorization";

/**
 * "There is a live authorization out there and we lost the thread." — the
 * stranded-PaymentIntent bell.
 *
 * WHEN: the engine created (or adopted) a replacement authorization at Stripe,
 * then failed to record it on the rental because another worker took the row,
 * AND the compensating cancel did not happen — either because we could not
 * confirm the id was still unrecorded, or because the cancel itself failed.
 *
 * WHY IT IS ITS OWN BELL: this is the worst state the engine can produce. The
 * renter's funds may be frozen under an id that appears on no rental, in no
 * portal screen, and in no reconciler sweep (the ledger row is closed
 * 'orphaned', and the reconciler's pending sweep only looks at 'pending'). The
 * ONLY route back is a human opening this PaymentIntent in the Stripe
 * dashboard, so the id is in the message body — not just in metadata — because
 * that is what an operator can copy.
 *
 * WHAT IT REFUSES TO SAY: whether the renter is secured. `orphaned` is raised
 * both when the cancel failed (the authorization probably IS live) and when we
 * could not even confirm the id was unrecorded (in which case the winner may
 * have recorded this very id, and everything is fine). Claiming either would be
 * a guess, and a wrong "you are covered" is exactly what this workstream exists
 * to stop. The copy therefore describes the ARTEFACT and the ACTION, and says
 * nothing about cover.
 *
 * NEVER THROWS.
 */
export async function notifyDepositHoldOrphanedAuthorization(params: {
  /** The rental row (needs `id` and `tenant_id`; `rental_number` if it has it). */
  rental: Record<string, unknown>;
  /** The authorization nothing points at. Required — the alert is about it. */
  paymentIntentId: string;
  /** What the engine was doing when it lost the row, in one clause. */
  reason: string;
  /** Why the compensating cancel did not happen, in one clause. */
  cleanupFailure?: string | null;
  /** Deposit size in MINOR units, when known. */
  amountCents?: number | null;
  /** ISO 4217 code. Falls back to `deposit_hold_currency` on the row. */
  currency?: string | null;
  /** Connect account the authorization lives on — where to go look. */
  connectAccountId?: string | null;
  /** 'test' | 'live' — which Stripe dashboard. */
  stripeMode?: string | null;
  /** The attempt that produced it, for the audit trail. */
  attemptSeq?: number | null;
  /** The engine's `RefreshResult` (always 'lost_race' today). */
  result?: string | null;
  /** 'cron' | 'sandbox' | 'manual'. */
  source?: string;
  /** Service-role client, for the best-effort `rental_number` lookup. */
  // deno-lint-ignore no-explicit-any
  supabase?: any;
}): Promise<void> {
  try {
    const rental = params.rental ?? {};
    const rentalId = firstString(rental.id);
    const tenantId = firstString(rental.tenant_id);
    const intentId = firstString(params.paymentIntentId);

    if (!rentalId || !tenantId || !intentId) {
      console.error(
        "[deposit-hold-notify] orphan alert missing rental id / tenant_id / PaymentIntent id — cannot raise",
        { rentalId, tenantId, intentId },
      );
      return;
    }

    let rentalNumber = firstString(rental.rental_number);
    if (!rentalNumber && params.supabase) {
      rentalNumber = await lookupRentalNumber(params.supabase, rentalId);
    }
    const ref = rentalRef(rentalNumber, rentalId);

    // Same rule as the failure bell: no currency, no number. A "$" printed on a
    // GBP authorization is a wrong number in an alert about money.
    const amountMajor = params.amountCents !== null && params.amountCents !== undefined &&
        Number.isFinite(Number(params.amountCents))
      ? Number(params.amountCents) / 100
      : null;
    const currency = firstString(params.currency, rental.deposit_hold_currency)?.toUpperCase() ?? null;
    const amountText = amountMajor !== null && currency ? formatCurrency(amountMajor, currency) : null;

    const mode = firstString(params.stripeMode);
    const account = firstString(params.connectAccountId);
    const whereToLook = account
      ? ` (Stripe account ${account}${mode ? `, ${mode} mode` : ""})`
      : mode
      ? ` (${mode} mode)`
      : "";

    const reason = firstString(params.reason) ?? "the rental changed owner before it could be recorded";
    const cleanup = firstString(params.cleanupFailure);

    const title = `Untracked deposit authorization — ${ref}`;
    const body =
      `A ${amountText ? `${amountText} ` : ""}deposit authorization was created at Stripe for ${ref} ` +
      `but never recorded on the rental — ${reason}${cleanup ? `, and ${cleanup}` : ""}. ` +
      `It is not linked to this rental, so nothing in the portal can find, capture or release it: ` +
      `PaymentIntent ${intentId}${whereToLook}. ` +
      `Open it in the Stripe dashboard and cancel it (or capture it deliberately) — if it is still ` +
      `authorized, the renter's funds stay frozen until it lapses. ` +
      `Check it BEFORE placing another hold on this renter's card, or they can end up authorized twice.`;

    await notifyOperatorsInApp({
      tenantId,
      type: DEPOSIT_HOLD_ORPHAN_ALERT_TYPE,
      title,
      message: body,
      link: `/rentals/${rentalId}`,
      metadata: {
        rental_id: rentalId,
        rental_number: rentalNumber,
        // NOT `payment_intent_id`: this id is deliberately NOT the rental's hold
        // — the whole point is that the rental points somewhere else (or
        // nowhere). A consumer must never read it as the current hold.
        orphaned_payment_intent_id: intentId,
        connect_account_id: account,
        stripe_mode: mode,
        severity: "critical",
        result: params.result ?? "lost_race",
        reason,
        cleanup_failure: cleanup,
        attempt_seq: params.attemptSeq ?? null,
        amount: amountMajor,
        currency,
        // We do not know whether the renter is covered — see the docblock. Null
        // is "unknown", never "no".
        money_state: "unknown",
        secured: null,
        source: params.source ?? "cron",
      },
      // Per PaymentIntent. One stranded authorization is one bell, forever: it
      // is a static condition until a human acts, and re-ringing it nightly is
      // how a channel gets muted. A NEW stranded id rings again, which is right.
      dedupeKey: `deposit_hold_orphan:${rentalId}:${intentId}`,
    });

    console.error(
      `[deposit-hold-notify] ORPHANED AUTHORIZATION alerted: tenant ${tenantId}, rental ${rentalId}, ` +
        `PaymentIntent ${intentId} (${reason}${cleanup ? `; ${cleanup}` : ""})`,
    );
  } catch (err) {
    console.error("[deposit-hold-notify] orphan alert failed, swallowing:", err);
    return;
  }
}
