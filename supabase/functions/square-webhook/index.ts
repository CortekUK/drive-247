/**
 * square-webhook — the Square notification receiver.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE FUNCTION AND NOT A BRANCH INSIDE stripe-webhook-live
 * ============================================================================
 * This is a deliberate, signed-off exception to "no parallel provider
 * functions". The two webhooks are not variations on one shape:
 *
 *   stripe-webhook-live   1,965 lines, 7 event types, delegates to
 *                         sync-deposit-hold / apply-payment with a synchronous
 *                         budget of HOLD_SYNC_TIMEOUT_MS = 15_000 — larger on
 *                         its own than Square's ENTIRE ack budget.
 *   square-webhook        4 event types, pure state-diffing, must ack in <10s.
 *
 * Branching inside stripe-webhook-live would edit the highest-blast-radius file
 * on the platform (52 live tenants, 1,026 payments) to add a rail that shares
 * none of its control flow. The prime directive says a Square bug is
 * acceptable and a Stripe regression is not; the cheapest way to guarantee the
 * second half is to not open the file.
 *
 * ============================================================================
 * FOUR WAYS SQUARE DIFFERS FROM STRIPE HERE — each one drives code below
 * ============================================================================
 * 1. THE URL IS PART OF THE SIGNED MESSAGE.
 *    Square signs `notification_url + raw_body`; Stripe signs `timestamp + body`.
 *    So the URL we hash must be the EXACT string registered on the subscription.
 *    We read it from an env var rather than reconstructing it from the request,
 *    because a proxy rewrite, an added trailing slash, or a host header change
 *    would silently produce "bad signature" on every real event.
 *
 * 2. THERE IS NO TIMESTAMP IN THE SIGNATURE, so there is NO replay window.
 *    Stripe's 300s tolerance does half the anti-replay work for free. Square
 *    gives us nothing. `square_webhook_events.event_id` (PRIMARY KEY) is the
 *    ONLY replay defence in the system, so the claim INSERT happens before any
 *    mutation, not after.
 *
 * 3. ONE APP-LEVEL SUBSCRIPTION SERVES EVERY CONNECTED MERCHANT.
 *    There is no per-tenant endpoint and no Stripe-Account header. Routing is
 *    `payload.merchant_id -> square_connections.merchant_id -> tenant_id`.
 *    An unknown merchant therefore MUST ack 200: a sustained run of non-2xx
 *    disables the subscription for ALL Square tenants at once, and Square has
 *    no manual resend to recover the events lost in the meantime.
 *
 * 4. REFUNDS SETTLE ASYNCHRONOUSLY.
 *    A Square refund is born PENDING and only becomes COMPLETED on
 *    `refund.updated` — and it can still land REJECTED after that. Writing
 *    "Refunded" off `refund.created` would tell an operator money went back
 *    that may never leave. See handleRefundEvent().
 *
 * ============================================================================
 * DOWNSTREAM WORK IS DONE BY DATABASE TRIGGERS, NOT BY THIS FUNCTION
 * ============================================================================
 * `auto_fifo_on_payment_completed` (AFTER UPDATE OF status ON payments) calls
 * payment_apply_fifo_v2 on the transition INTO 'Completed', and
 * `on_payment_received_notify` / `on_refund_processed_notify` raise the operator
 * notifications. So the single UPDATE below performs the allocation and the
 * alerts transactionally, with no extra HTTP hop — which is precisely how we
 * stay inside a 10s ack that stripe-webhook-live's 15s sync call could not.
 *
 * DEPLOYMENT NOTE: this function REQUIRES `verify_jwt = false`, which
 * supabase/config.toml already declares under [functions.square-webhook].
 * Square sends no Authorization header, and it probes the notification URL for
 * reachability when the subscription is created — a gateway 401 there makes
 * creation fail outright, for every merchant at once. The setting must
 * therefore be live BEFORE the Square subscription is created.
 *
 * REQUIRED SECRETS (names follow the SQUARE_TEST_* / SQUARE_LIVE_* convention
 * the sibling OAuth functions use):
 *   SQUARE_TEST_WEBHOOK_SIGNATURE_KEY / SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY
 *     — issued BY Square when the subscription is created, so they can only be
 *       set afterwards. Until one is set nothing verifies and every event is a
 *       401, by design.
 *   SQUARE_WEBHOOK_NOTIFICATION_URL
 *     — the exact URL registered on the subscription. Per-mode overrides
 *       (SQUARE_TEST_/SQUARE_LIVE_WEBHOOK_NOTIFICATION_URL) exist for the case
 *       where sandbox and production point at different projects.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifySquareWebhook } from "../_shared/payments/square-client.ts";
import {
  InternalPaymentStatus,
  mapSquarePaymentStatus,
  mapSquareRefundStatus,
} from "../_shared/payments/square-status-map.ts";
import { capabilitiesFor } from "../_shared/payments/capabilities.ts";
import { PROVIDER_COLUMN, SQUARE } from "../_shared/payments/predicates.ts";
import { SquareMode } from "../_shared/payments/types.ts";

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Square's hard ack budget, taken from the capability manifest (10_000ms). */
const ACK_BUDGET_MS = capabilitiesFor("square").webhookAckBudgetMs;

/**
 * How long the processing phase may run before we abandon it.
 *
 * Deliberately short of ACK_BUDGET_MS: Square counts a delivery as failed the
 * moment the budget lapses, and a failure booked against the app-level
 * subscription is charged to EVERY Square tenant, not just this one. The
 * headroom covers TLS + cold start + the response write.
 */
const PROCESSING_BUDGET_MS = Math.max(2_000, ACK_BUDGET_MS - 2_500);

/**
 * Past this age we stop asking Square to redeliver and ack instead.
 *
 * Square retries 11 times across 24h. Without a cap, one poison event burns a
 * full day of non-2xx responses against the subscription's auto-disable budget
 * — which would take down payment notifications for every Square tenant to
 * chase a single row. Six hours still allows ~8 attempts.
 */
const MAX_RETRY_AGE_MS = 6 * 60 * 60 * 1000;

/** Postgres unique_violation. The dedupe hinges on recognising exactly this. */
const PG_UNIQUE_VIOLATION = "23505";

/** The header Square signs with. Lower-case; Headers.get is case-insensitive. */
const SIGNATURE_HEADER = "x-square-hmacsha256-signature";

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

interface SquareMoney {
  amount?: number;
  currency?: string;
}

interface SquarePaymentObject {
  id?: string;
  status?: string;
  order_id?: string;
  reference_id?: string;
  note?: string;
  location_id?: string;
  created_at?: string;
  updated_at?: string;
  amount_money?: SquareMoney;
  refunded_money?: SquareMoney;
}

interface SquareRefundObject {
  id?: string;
  status?: string;
  payment_id?: string;
  order_id?: string;
  location_id?: string;
  created_at?: string;
  updated_at?: string;
  amount_money?: SquareMoney;
}

interface SquareEventEnvelope {
  merchant_id?: string;
  type?: string;
  event_id?: string;
  created_at?: string;
  data?: {
    type?: string;
    id?: string;
    object?: {
      payment?: SquarePaymentObject;
      refund?: SquareRefundObject;
    };
  };
}

/** The payments columns this function reads. Nothing else is needed. */
const PAYMENT_COLUMNS =
  "id, tenant_id, amount, status, capture_status, paid_at, refund_amount, refund_status, " +
  "refund_processed_at, square_order_id, square_payment_id, square_refund_id";

interface PaymentRow {
  id: string;
  tenant_id: string | null;
  amount: number | null;
  status: string | null;
  capture_status: string | null;
  paid_at: string | null;
  refund_amount: number | null;
  refund_status: string | null;
  refund_processed_at: string | null;
  square_order_id: string | null;
  square_payment_id: string | null;
  square_refund_id: string | null;
}

/**
 * A processing failure we WANT Square to retry (transient: DB unreachable,
 * statement aborted by our own deadline). Distinct from "nothing to do here",
 * which acks 200 and keeps the dedupe claim.
 */
class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

interface SignatureCandidate {
  /** Which Square environment this key belongs to; null for a single-app setup. */
  mode: SquareMode | null;
  key: string;
  notificationUrl: string;
}

/**
 * The notification URL registered for a mode.
 *
 * Sandbox and Production are physically separate Square applications, so they
 * carry separate subscriptions and MAY be registered against different URLs
 * (a staging project vs prod). Per-mode overrides win; otherwise both fall back
 * to the one generic value.
 */
function notificationUrlFor(mode: SquareMode | null): string {
  const generic = Deno.env.get("SQUARE_WEBHOOK_NOTIFICATION_URL") ?? "";
  if (mode === "live") {
    return (Deno.env.get("SQUARE_LIVE_WEBHOOK_NOTIFICATION_URL") ?? "") || generic;
  }
  if (mode === "test") {
    return (Deno.env.get("SQUARE_TEST_WEBHOOK_NOTIFICATION_URL") ?? "") || generic;
  }
  return generic;
}

/**
 * Every (key, url) pair we are willing to verify against.
 *
 * Mirrors getWebhookSecretCandidates() in stripe-client.ts, including its
 * hard-won lesson: an env value that is missing or blank must be DISCARDED, not
 * defaulted to "".
 *
 * MEASURED, not assumed: crypto.subtle.importKey("raw", <empty>) throws
 * `DataError: Key length is zero`. That throw would happen inside
 * verifySquareWebhook, i.e. before any handler try/catch, so a single blank
 * SQUARE_*_WEBHOOK_SIGNATURE_KEY would answer 500 to EVERY event for EVERY
 * Square tenant — the exact failure mode that eventually disables the shared
 * subscription. `?? ""` here is therefore not untidy, it is an outage.
 *
 * Note also that every env name below is a literal: Deno.env.get('') throws
 * TypeError, so a computed name could take the endpoint down while the array
 * was still being built — before .filter() ever ran.
 */
function signatureCandidates(): SignatureCandidate[] {
  const raw: Array<{ mode: SquareMode | null; key: string | undefined }> = [
    { mode: "test", key: Deno.env.get("SQUARE_TEST_WEBHOOK_SIGNATURE_KEY") },
    { mode: "live", key: Deno.env.get("SQUARE_LIVE_WEBHOOK_SIGNATURE_KEY") },
    { mode: null, key: Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") },
  ];

  return raw
    .filter((c) => typeof c.key === "string" && c.key.trim().length > 0)
    .map((c) => ({
      mode: c.mode,
      key: (c.key as string).trim(),
      notificationUrl: notificationUrlFor(c.mode).trim(),
    }))
    .filter((c) => c.notificationUrl.length > 0);
}

/**
 * Verify against each candidate; the first match also tells us WHICH Square
 * environment sent the event, which is real information — sandbox and
 * production merchants are different merchants with different ids, and knowing
 * the mode lets us prefer the matching square_connections row.
 *
 * Returns undefined when nothing verifies. There is no "skip verification"
 * path: with no replay window, an unverified body is indistinguishable from a
 * forged one.
 */
async function verifyEvent(
  rawBody: string,
  signature: string | null,
): Promise<{ mode: SquareMode | null } | undefined> {
  if (!signature) return undefined;
  for (const candidate of signatureCandidates()) {
    try {
      const ok = await verifySquareWebhook(
        candidate.key,
        candidate.notificationUrl,
        rawBody,
        signature,
      );
      if (ok) return { mode: candidate.mode };
    } catch (err) {
      // WebCrypto rejects some key material outright (see signatureCandidates).
      // One unusable secret must disqualify that candidate, never the request:
      // an uncaught throw here answers 500 to every tenant's events at once.
      // The key itself is never logged.
      console.error(
        "[square-webhook] candidate key unusable",
        candidate.mode ?? "generic",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Square money is integer minor units; payments.amount is numeric MAJOR units
 * (stripe-webhook-live does the same `/ 100` on charge.amount_refunded). Doing
 * this conversion in one place is the difference between a $12.34 refund and a
 * $1,234 refund.
 */
function minorToMajor(minor: number | undefined | null): number | null {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return null;
  return Math.round(minor) / 100;
}

/** Kill binary float drift before it reaches a numeric column. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** An ISO timestamp we trust, else now. Square timestamps are RFC3339. */
function isoOrNow(value: string | undefined | null): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Deadline for a single DB round trip.
 *
 * Every statement this function issues is idempotent (see the rank gate in
 * handlePaymentEvent and the same-refund-id gate in handleRefundEvent), so an
 * aborted call that actually committed is harmless on redelivery. That property
 * is what makes it safe to abandon a hung query rather than blow the ack budget.
 */
function deadlineSignal(startedAt: number): AbortSignal {
  const remaining = PROCESSING_BUDGET_MS - (Date.now() - startedAt);
  return AbortSignal.timeout(Math.max(500, remaining));
}

// ---------------------------------------------------------------------------
// Status translation — payments.status has a CHECK constraint, obey it
// ---------------------------------------------------------------------------

/**
 * Translate the seam's internal vocabulary onto the values payments.status
 * actually permits.
 *
 * THIS IS LOAD-BEARING. payments_status_check allows exactly
 *   Applied | Credit | Partial | Reversed | Pending | Completed | Refunded | Partial Refund
 * and mapSquarePaymentStatus() legitimately returns 'Failed' and 'Cancelled',
 * neither of which is a member. Writing one raises 23514, the write throws, we
 * answer non-2xx, Square retries, and a sustained run of that disables the
 * app-level subscription for every Square tenant. So the mapping is narrowed
 * here rather than at the seam, which has no business knowing this table.
 *
 * 'Reversed' is the established local meaning of "this payment row will never
 * become money" — void-payment-link writes exactly that pair
 * (status 'Reversed' + capture_status 'cancelled') and the portal renders it.
 */
function toPaymentsColumnStatus(internal: InternalPaymentStatus): string {
  switch (internal) {
    case "Completed":
      return "Completed";
    case "Pending":
      return "Pending";
    case "Failed":
    case "Cancelled":
      return "Reversed";
    default:
      return "Pending";
  }
}

/**
 * Lifecycle rank, used to refuse BACKWARD transitions.
 *
 * Square does not guarantee delivery order, and Stripe's habit of arriving
 * in-order is not a property we get here. Without this gate a late
 * `payment.created` (PENDING) landing after `payment.updated` (COMPLETED) would
 * flip a collected payment back to Pending, un-firing nothing but leaving the
 * rental looking unpaid; and a stale COMPLETED arriving after a refund would
 * silently un-refund the row.
 */
const STATUS_RANK: Record<string, number> = {
  Pending: 1,
  Applied: 1,
  Credit: 1,
  Partial: 1,
  Completed: 2,
  Reversed: 3,
  "Partial Refund": 3,
  Refunded: 3,
};

function rankOf(status: string | null): number {
  return STATUS_RANK[status ?? "Pending"] ?? 1;
}

/**
 * Square Payment.status -> payments.capture_status.
 *
 * APPROVED means authorised and NOT captured — money has not moved — so it maps
 * to 'requires_capture', never 'captured'. Values outside
 * payments_capture_status_check return null and simply are not written.
 */
function toCaptureStatus(squareStatus: string): string | null {
  switch (squareStatus) {
    case "COMPLETED":
      return "captured";
    case "APPROVED":
      return "requires_capture";
    case "CANCELED":
    case "FAILED":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * capture_status has its OWN forward-only rank, deliberately not tied to
 * STATUS_RANK.
 *
 * Square's APPROVED maps to internal 'Pending', so an authorise-then-capture
 * pair produces NO payments.status change — meaning a capture_status gated on a
 * status advance would never be stamped at all. Ranking it separately keeps the
 * two facts independent while still refusing to walk 'captured' back to
 * 'requires_capture' on an out-of-order redelivery.
 */
const CAPTURE_RANK: Record<string, number> = {
  requires_capture: 1,
  captured: 2,
  cancelled: 3,
  expired: 3,
};

function captureRankOf(status: string | null): number {
  return status ? (CAPTURE_RANK[status] ?? 0) : 0;
}

// ---------------------------------------------------------------------------
// Correlation: Square handle -> local payments row
// ---------------------------------------------------------------------------

/**
 * Find the local row by DB LOOKUP on the Square handles.
 *
 * This mirrors stripe-webhook-live, which correlates on
 * `.eq('stripe_checkout_session_id', session.id)` rather than trusting metadata
 * echoed back by the processor — and it matters more here, because Square's
 * Order.metadata caps at 10 keys / 255 chars and reference_id at 40, so the
 * rich correlation bag a Stripe session carries does not fit in the first place.
 *
 * The lookups are ordered most-specific first. The provider predicate is
 * defence-in-depth: payments_provider_handle_exclusivity_check already makes a
 * square_* handle impossible on a Stripe row, so it can only ever narrow a
 * result set that is already correct — it can never hide a Stripe row from its
 * own webhook. It is spelled out with the centralised PROVIDER_COLUMN/SQUARE
 * constants rather than predicates.ts's applySquareOnly() helper for one
 * mechanical reason: that helper's generic parameter, instantiated against
 * PostgrestFilterBuilder, trips TS2589 ("type instantiation is excessively
 * deep") on this repo's Deno/TypeScript pair. Same predicate, same single
 * source of truth for the column and value, no raw provider-name literal.
 */
async function findPaymentByHandles(
  supabase: SupabaseClient,
  startedAt: number,
  handles: {
    squarePaymentId?: string | null;
    squareRefundId?: string | null;
    squareOrderId?: string | null;
  },
): Promise<PaymentRow | null> {
  const attempts: Array<[string, string]> = [];
  if (handles.squarePaymentId) attempts.push(["square_payment_id", handles.squarePaymentId]);
  if (handles.squareRefundId) attempts.push(["square_refund_id", handles.squareRefundId]);
  if (handles.squareOrderId) attempts.push(["square_order_id", handles.squareOrderId]);

  for (const [column, value] of attempts) {
    // maybeSingle + deterministic ordering: webhook retries race, and legacy
    // duplicates exist. stripe-webhook-live settled on the same shape.
    const { data, error } = await supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq(PROVIDER_COLUMN, SQUARE)
      .eq(column, value)
      .order("created_at", { ascending: false })
      .limit(1)
      .abortSignal(deadlineSignal(startedAt))
      .maybeSingle();

    if (error) {
      // A failed READ is transient by assumption — never treat it as "no such
      // payment", which would silently drop a real collection.
      throw new RetryableError(`payments lookup on ${column} failed: ${error.message}`);
    }
    if (data) return data as unknown as PaymentRow;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

interface HandlerResult {
  matched: boolean;
  paymentId?: string;
  applied?: Record<string, unknown>;
  note?: string;
}

async function handlePaymentEvent(
  supabase: SupabaseClient,
  startedAt: number,
  payment: SquarePaymentObject,
): Promise<HandlerResult> {
  const squarePaymentId = payment.id ?? null;
  const squareOrderId = payment.order_id ?? null;

  const row = await findPaymentByHandles(supabase, startedAt, {
    squarePaymentId,
    squareOrderId,
  });

  if (!row) {
    // Money may have moved with no local record. There is no Square equivalent
    // of recover-pending-stripe-payments yet (that cron is Stripe-fenced), so
    // console.error is currently the only signal. Deliberately still a 200:
    // retrying cannot conjure the missing row, and the non-2xx would be charged
    // to every Square tenant's shared subscription.
    return {
      matched: false,
      note: `no local payments row for square payment ${squarePaymentId ?? "?"} / order ${squareOrderId ?? "?"}`,
    };
  }

  const squareStatus = String(payment.status ?? "");
  const nextStatus = toPaymentsColumnStatus(mapSquarePaymentStatus(squareStatus));

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Handle backfill is unconditional and safe: these columns are write-once in
  // practice, and stamping the payment id is what lets a later refund event
  // correlate at all.
  if (squarePaymentId && !row.square_payment_id) update.square_payment_id = squarePaymentId;
  if (squareOrderId && !row.square_order_id) update.square_order_id = squareOrderId;

  const capture = toCaptureStatus(squareStatus);
  if (capture && captureRankOf(capture) > captureRankOf(row.capture_status)) {
    update.capture_status = capture;
  }

  // The lifecycle block moves FORWARD only. See STATUS_RANK.
  const advances = rankOf(nextStatus) > rankOf(row.status);
  if (advances) {
    update.status = nextStatus;

    if (nextStatus === "Completed" && !row.paid_at) {
      // Prefer Square's own clock: a redelivered event hours later must not
      // record the money as arriving now.
      update.paid_at = isoOrNow(payment.updated_at ?? payment.created_at);
    }

    if (nextStatus === "Reversed") {
      // Mirrors void-payment-link: a row that will never become money must not
      // be left allocatable by the FIFO engine.
      update.remaining_amount = 0;
    }
  }

  // Nothing but the timestamp changed — usually a redelivery of an event we have
  // already applied. Skip the write: payments_rag_trigger fires on EVERY update,
  // so a no-op write is not free, it is RAG queue churn per retry.
  if (Object.keys(update).length > 1) {
    const { error } = await supabase
      .from("payments")
      .update(update)
      .eq("id", row.id)
      .abortSignal(deadlineSignal(startedAt));

    if (error) throw new RetryableError(`payments update failed: ${error.message}`);
  }

  return {
    matched: true,
    paymentId: row.id,
    applied: update,
    note: advances ? undefined : `status held at '${row.status}' (event was '${squareStatus}')`,
  };
}

async function handleRefundEvent(
  supabase: SupabaseClient,
  startedAt: number,
  refund: SquareRefundObject,
): Promise<HandlerResult> {
  const row = await findPaymentByHandles(supabase, startedAt, {
    squarePaymentId: refund.payment_id ?? null,
    squareRefundId: refund.id ?? null,
    squareOrderId: refund.order_id ?? null,
  });

  if (!row) {
    return {
      matched: false,
      note: `no local payments row for square refund ${refund.id ?? "?"} on payment ${refund.payment_id ?? "?"}`,
    };
  }

  const internal = mapSquareRefundStatus(String(refund.status ?? ""));
  const thisRefund = minorToMajor(refund.amount_money?.amount);
  const existing = Number(row.refund_amount ?? 0);

  /**
   * Accumulate correctly across the PENDING -> COMPLETED lifecycle.
   *
   * The same refund is reported at least twice (created, then updated), so a
   * blind `existing + this` would double the refunded total on the second
   * event. Comparing the stored square_refund_id distinguishes "this refund
   * again" (take the max — idempotent) from "a second, distinct refund"
   * (add it), and a rejection unwinds what its own create banked.
   *
   * Known limit: two DISTINCT refunds whose created/updated events
   * interleave can over-count the first, because only one refund id is stored
   * per payments row. Square caps us at 20 partial refunds per payment and our
   * flows issue one at a time, so this is recorded rather than engineered
   * around — fixing it properly needs a per-refund table.
   */
  const sameRefund = !!row.square_refund_id && !!refund.id && row.square_refund_id === refund.id;

  // Once a refund is settled it cannot un-settle. A late-arriving
  // `refund.created` (PENDING) must not walk 'completed' back to 'processing'.
  const alreadySettled = row.refund_status === "completed";

  let nextRefundAmount: number;
  if (thisRefund === null) {
    nextRefundAmount = existing;
  } else if (internal === "Failed") {
    // REJECTED / FAILED. We bank the amount optimistically on refund.created
    // (it is the only event that carries it early), so a refund that then dies
    // must hand it back — otherwise the payment reads as partly refunded when
    // no money ever left. Only unwind OUR OWN pending amount: if we never saw
    // the create, there is nothing of ours to remove.
    nextRefundAmount = sameRefund && !alreadySettled
      ? round2(Math.max(0, existing - thisRefund))
      : existing;
  } else if (sameRefund) {
    nextRefundAmount = round2(Math.max(existing, thisRefund));
  } else {
    nextRefundAmount = round2(existing + thisRefund);
  }

  // Build the diff, then prune anything already equal to what is stored. Every
  // key that survives is a real change: payments_rag_trigger fires on EVERY
  // update, so a no-op write costs RAG queue work on every Square redelivery.
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (nextRefundAmount !== existing) update.refund_amount = nextRefundAmount;
  if (refund.id && refund.id !== row.square_refund_id) update.square_refund_id = refund.id;

  if (internal === "Completed") {
    if (row.refund_status !== "completed") update.refund_status = "completed";
    if (!row.refund_processed_at) {
      // Square's clock, not ours: a redelivery hours later must not restate when
      // the refund actually settled.
      update.refund_processed_at = isoOrNow(refund.updated_at ?? refund.created_at);
    }
    // Full vs partial measured against the ORIGINAL amount, same test as
    // stripe-webhook-live's charge.refunded handler.
    const original = Number(row.amount ?? 0);
    const nextStatus = original > 0 && nextRefundAmount >= original ? "Refunded" : "Partial Refund";
    if (nextStatus !== row.status) update.status = nextStatus;
  } else if (internal === "Failed" && !alreadySettled) {
    // REJECTED / FAILED. payments.status is deliberately untouched: the original
    // charge is still good money, only the refund attempt died.
    if (row.refund_status !== "failed") update.refund_status = "failed";
  } else if (!alreadySettled) {
    /**
     * PENDING — this is where `refund.created` ALWAYS lands.
     *
     * A Square refund is asynchronous: it is born PENDING, becomes COMPLETED on
     * a later refund.updated, and can still end REJECTED. Marking the payment
     * 'Refunded' here would tell the operator the customer has their money back
     * while the transfer may still fail. 'processing' is the honest state, and
     * it is a member of payments_refund_status_check.
     */
    if (row.refund_status !== "processing") update.refund_status = "processing";
  }

  if (Object.keys(update).length > 1) {
    const { error } = await supabase
      .from("payments")
      .update(update)
      .eq("id", row.id)
      .abortSignal(deadlineSignal(startedAt));

    if (error) throw new RetryableError(`payments refund update failed: ${error.message}`);
  }

  return { matched: true, paymentId: row.id, applied: update };
}

// ---------------------------------------------------------------------------
// Tenant routing
// ---------------------------------------------------------------------------

interface ConnectionRow {
  tenant_id: string;
  square_mode: string;
  status: string;
}

/**
 * merchant_id -> tenant_id.
 *
 * ONE app-level subscription serves every connected merchant, so this lookup —
 * not the endpoint URL — is the multi-tenant routing. A revoked or expired
 * connection still resolves: an event about money that already moved must be
 * recorded even if the operator has since disconnected.
 */
async function resolveTenant(
  supabase: SupabaseClient,
  startedAt: number,
  merchantId: string,
  mode: SquareMode | null,
): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from("square_connections")
    .select("tenant_id, square_mode, status")
    .eq("merchant_id", merchantId)
    .abortSignal(deadlineSignal(startedAt));

  if (error) throw new RetryableError(`square_connections lookup failed: ${error.message}`);

  const rows = (data ?? []) as unknown as ConnectionRow[];
  if (rows.length === 0) return null;

  // Prefer an active connection in the environment whose signing key verified
  // this event; sandbox and production merchant ids are disjoint, so this is a
  // tie-break for the pathological case rather than the normal path.
  const score = (r: ConnectionRow) =>
    (r.status === "active" ? 2 : 0) + (mode !== null && r.square_mode === mode ? 1 : 0);

  return rows.reduce((best, r) => (score(r) > score(best) ? r : best), rows[0]);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startedAt = Date.now();

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  // RAW BODY FIRST, BEFORE ANY PARSE. The signature covers these exact bytes;
  // re-serialising a parsed object changes key order and whitespace and would
  // fail verification on a perfectly genuine event.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    return errorResponse(`Unreadable body: ${err instanceof Error ? err.message : "unknown"}`, 400);
  }

  // ---- 1. FAIL CLOSED -------------------------------------------------------
  // No DB is touched before this passes. With no timestamp in the signature
  // there is no replay window to lean on, so an unverified body gets nothing.
  const verified = await verifyEvent(rawBody, req.headers.get(SIGNATURE_HEADER));
  if (!verified) {
    console.error("[square-webhook] signature verification FAILED — rejecting");
    return errorResponse("Invalid signature", 401);
  }

  let envelope: SquareEventEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SquareEventEnvelope;
  } catch {
    // Signed but unparseable: a redelivery cannot fix malformed JSON.
    console.error("[square-webhook] signed payload was not valid JSON");
    return jsonResponse({ received: true, processed: false, reason: "malformed_json" });
  }

  const eventId = envelope.event_id;
  const eventType = envelope.type ?? "";
  const merchantId = envelope.merchant_id ?? null;

  if (!eventId) {
    // Without an event id there is no dedupe key, and dedupe is the ONLY replay
    // defence. Processing anyway would risk applying the same money twice.
    console.error("[square-webhook] event has no event_id; refusing to process", { eventType });
    return jsonResponse({ received: true, processed: false, reason: "missing_event_id" });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // ---- 2. CLAIM THE EVENT ---------------------------------------------------
  // Before any mutation, so two concurrent redeliveries cannot both process.
  const { error: claimError } = await supabase
    .from("square_webhook_events")
    .insert({
      event_id: eventId,
      event_type: eventType,
      merchant_id: merchantId,
      payload: envelope,
    })
    .abortSignal(deadlineSignal(startedAt));

  if (claimError) {
    if (claimError.code === PG_UNIQUE_VIOLATION) {
      console.log("[square-webhook] duplicate event, already processed:", eventId, eventType);
      return jsonResponse({ received: true, duplicate: true });
    }
    // Could not claim => cannot safely process. Invite a redelivery.
    console.error("[square-webhook] claim insert failed:", claimError.message);
    return errorResponse("Could not record event", 500);
  }

  /**
   * Undo the claim so Square's retry can genuinely re-process.
   *
   * Leaving the claim behind on a failed run would make the dedupe swallow every
   * retry — and Square has NO manual resend, so the event would be gone for good.
   */
  const releaseClaim = async () => {
    const { error } = await supabase
      .from("square_webhook_events")
      .delete()
      .eq("event_id", eventId);
    if (error) {
      console.error("[square-webhook] FAILED to release claim", eventId, error.message);
    }
  };

  try {
    // ---- 3. ROUTE BY MERCHANT ----------------------------------------------
    let tenantId: string | null = null;
    if (merchantId) {
      const conn = await resolveTenant(supabase, startedAt, merchantId, verified.mode);
      if (!conn) {
        // Not our merchant (or connected on another project). 200 ON PURPOSE —
        // see the module header: sustained non-2xx disables the ONE subscription
        // that serves every Square tenant.
        console.error("[square-webhook] unknown merchant_id, acking anyway:", merchantId, eventType);
        return jsonResponse({ received: true, processed: false, reason: "unknown_merchant" });
      }
      tenantId = conn.tenant_id;
    } else {
      console.error("[square-webhook] event carried no merchant_id:", eventId, eventType);
      return jsonResponse({ received: true, processed: false, reason: "missing_merchant_id" });
    }

    // Best-effort audit stamp. A failure here must not fail the event.
    const { error: stampError } = await supabase
      .from("square_webhook_events")
      .update({ tenant_id: tenantId })
      .eq("event_id", eventId);
    if (stampError) {
      console.error("[square-webhook] tenant stamp failed (non-fatal):", stampError.message);
    }

    // ---- 4. DISPATCH --------------------------------------------------------
    const payment = envelope.data?.object?.payment;
    const refund = envelope.data?.object?.refund;
    let result: HandlerResult;

    switch (eventType) {
      case "payment.created":
      case "payment.updated": {
        if (!payment) {
          console.error("[square-webhook] payment event without data.object.payment:", eventId);
          result = { matched: false, note: "missing payment object" };
          break;
        }
        result = await handlePaymentEvent(supabase, startedAt, payment);
        break;
      }

      case "refund.created":
      case "refund.updated": {
        if (!refund) {
          console.error("[square-webhook] refund event without data.object.refund:", eventId);
          result = { matched: false, note: "missing refund object" };
          break;
        }
        result = await handleRefundEvent(supabase, startedAt, refund);
        break;
      }

      default:
        // Square emits more types than we subscribe to; an unknown one is not an
        // error. The claim row stays, so it will not be reconsidered.
        console.log("[square-webhook] unhandled event type:", eventType, eventId);
        result = { matched: false, note: `unhandled type ${eventType}` };
    }

    if (!result.matched && result.note) {
      console.error("[square-webhook] not applied:", eventType, eventId, result.note);
    } else if (result.matched) {
      // Log the columns that actually changed, not their values — this is the
      // audit trail for "why did this payment flip", and it is what makes the
      // no-op-write guards visible when they fire (an empty list).
      console.log(
        "[square-webhook] applied", eventType, "to payment", result.paymentId,
        "fields:", Object.keys(result.applied ?? {}).filter((k) => k !== "updated_at").join(",") || "(none)",
        "in", `${Date.now() - startedAt}ms`, result.note ? `(${result.note})` : "",
      );
    }

    return jsonResponse({
      received: true,
      processed: result.matched,
      event_id: eventId,
      tenant_id: tenantId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const ageMs = Date.now() - Date.parse(envelope.created_at ?? "");
    const tooOld = Number.isFinite(ageMs) && ageMs > MAX_RETRY_AGE_MS;

    console.error("[square-webhook] processing failed:", eventType, eventId, message);

    if (tooOld) {
      // Give up asking for redelivery, but KEEP the claim so the endpoint stops
      // failing. A poison event must not spend 24h of non-2xx responses on a
      // subscription shared by every Square tenant.
      console.error("[square-webhook] event past retry age; acking to protect the subscription:", eventId);
      return jsonResponse({ received: true, processed: false, reason: "gave_up", event_id: eventId });
    }

    await releaseClaim();
    return errorResponse(`Processing failed: ${message}`, 500);
  }
});
