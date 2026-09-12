/**
 * webhook-health.ts — record that a webhook delivery happened, and how it went.
 *
 * WHY THIS EXISTS
 * ---------------
 * The team lead's requirement, verbatim in translation: "make sure that whatever
 * platform our webhook is attached to, we're tracking its health separately."
 *
 * Before this, of the six webhooks that move money or bind a signed document,
 * exactly ONE recorded anything: square-webhook, and even there the record exists
 * for a different reason (see REPLAY below). The Stripe handlers — which settle
 * every rental payment, refund and deposit — wrote the business effect and kept
 * no trace of the delivery itself. That makes one specific failure invisible:
 *
 *   Stripe stops delivering, or we start rejecting what it sends, and NOTHING
 *   goes red. Rentals simply stop being marked paid. The first report comes from
 *   a customer, days later.
 *
 * There is no way to ask "when did Stripe last reach us", no signal to alert on a
 * run of failures, and no way to replay a missed event because nothing recorded
 * that it was missed. The repo already carries the scar: ~3,900 stale Pending
 * payment rows platform-wide from `checkout.session.expired` events whose effect
 * was never completed.
 *
 * THIS IS NOT A REPLAY GUARD
 * --------------------------
 * `square_webhook_events` must stay exactly as it is. Its `event_id` PRIMARY KEY,
 * inserted BEFORE any mutation, is the only replay defence Square has — Square's
 * signature carries no timestamp, so unlike Stripe's 300s tolerance there is no
 * replay window doing that work for free. This module records health ALONGSIDE
 * that, and must never be mistaken for it or used to replace it.
 *
 * FAIL-OPEN, ABSOLUTELY
 * ---------------------
 * Observability must never cost a payment. Every call here swallows its own
 * errors and returns void: a full table, a revoked grant, a network stall or a
 * schema that has not been migrated yet must all be survivable. The webhook's own
 * work is what matters, and a webhook that 500s because its logging failed would
 * make Stripe retry — turning a monitoring gap into an outage.
 *
 * The deadline is deliberate and short. These handlers run to a budget (Square's
 * is 7.5s), so a hung insert must not eat it.
 */

export type WebhookPlatform =
  | "stripe"
  | "stripe_connect"
  | "stripe_subscription"
  | "square"
  | "boldsign";

/**
 * What happened to this delivery. Kept coarse on purpose: these are for
 * alerting, not forensics, and a long tail of statuses makes a health query
 * unwriteable.
 */
export type WebhookOutcome =
  /** Signature verified, body parsed. The handler is about to run. */
  | "accepted"
  /** Refused before any work: bad or missing signature. Expected from scanners. */
  | "rejected_signature"
  /** Signature was fine but the body was not usable. */
  | "rejected_malformed"
  /** Handled to completion. */
  | "handled"
  /** Understood and deliberately not acted on (unknown event type, other tenant). */
  | "ignored"
  /** Verified and understood, but the handler threw. This is the alerting case. */
  | "failed";

export interface WebhookDelivery {
  platform: WebhookPlatform;
  outcome: WebhookOutcome;
  /** 'test' | 'live' where the platform has modes. */
  mode?: string | null;
  /** The provider's own event id. Null when the body could not be parsed. */
  eventId?: string | null;
  eventType?: string | null;
  httpStatus?: number | null;
  /** A short, stable code — never a raw error object, which can echo secrets. */
  failureCode?: string | null;
  tenantId?: string | null;
  durationMs?: number | null;
}

/** Minimal shape so this imports cleanly wherever a Supabase client already exists. */
interface InsertableClient {
  from(table: string): {
    insert(rows: Record<string, unknown>): Promise<{ error: unknown }> & {
      abortSignal?(signal: AbortSignal): Promise<{ error: unknown }>;
    };
  };
}

/** Long enough for a healthy insert, short enough never to eat a handler budget. */
export const WEBHOOK_HEALTH_TIMEOUT_MS = 1_500;

export const WEBHOOK_HEALTH_TABLE = "webhook_deliveries";

/**
 * Record one delivery. Never throws, never rejects, never blocks meaningfully.
 *
 * Deliberately returns void rather than a success flag: a caller that could
 * branch on the result would be tempted to fail the webhook when logging failed,
 * which is the exact inversion this module exists to prevent.
 */
export async function recordWebhookDelivery(
  supabase: unknown,
  delivery: WebhookDelivery,
): Promise<void> {
  try {
    const client = supabase as InsertableClient;
    if (!client?.from) return;

    const row = {
      platform: delivery.platform,
      outcome: delivery.outcome,
      mode: delivery.mode ?? null,
      // Providers differ wildly in id length; truncate rather than fail the insert.
      event_id: trim(delivery.eventId, 255),
      event_type: trim(delivery.eventType, 128),
      http_status: delivery.httpStatus ?? null,
      failure_code: trim(delivery.failureCode, 128),
      tenant_id: delivery.tenantId ?? null,
      duration_ms:
        typeof delivery.durationMs === "number" && Number.isFinite(delivery.durationMs)
          ? Math.max(0, Math.round(delivery.durationMs))
          : null,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_HEALTH_TIMEOUT_MS);
    try {
      const q = client.from(WEBHOOK_HEALTH_TABLE).insert(row);
      const res = await (typeof q.abortSignal === "function" ? q.abortSignal(controller.signal) : q);
      if (res?.error) {
        // Logged, never thrown. The most likely cause on a fresh database is that
        // the table has not been migrated yet, which must stay survivable.
        console.warn(
          `[webhook-health] could not record ${delivery.platform}/${delivery.outcome}:`,
          describe(res.error),
        );
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[webhook-health] recorder threw and was swallowed:`, describe(err));
  }
}

function trim(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string" || !v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

/** Never echo an error object wholesale: provider errors can carry request fields. */
function describe(err: unknown): string {
  if (!err) return "unknown";
  if (typeof err === "string") return err.slice(0, 200);
  const m = (err as { message?: unknown }).message;
  return typeof m === "string" ? m.slice(0, 200) : "unknown";
}
