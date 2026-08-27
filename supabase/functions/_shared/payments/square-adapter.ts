/**
 * Square adapter — the only file that knows how Square takes money.
 *
 * Credentials come from `square_connections` via a SECURITY DEFINER RPC that
 * decrypts Vault secret ids, exactly as `accounting_get_tokens` does for Xero and
 * Zoho. Raw tokens are never stored in a column and never logged.
 *
 * ===========================================================================
 * THE CORRELATION CONTRACT — read before changing anything about payment links
 * ===========================================================================
 * Verified against Square's live reference (checked 2026-08-25, Square-Version
 * 2026-08-19), because the answer is counter-intuitive:
 *
 *   - CreatePaymentLink takes EITHER `quick_pay` OR `order` — they are mutually
 *     exclusive. Sending both is a 400.
 *   - The QuickPay object has exactly THREE fields: `name`, `price_money`,
 *     `location_id`. It has NO `reference_id` and NO `metadata`.
 *     (https://developer.squareup.com/reference/square/objects/QuickPay)
 *   - `reference_id` (40 chars) and `metadata` (10 entries, keys <=60 chars of
 *     [a-zA-Z0-9_-], values <=255 chars) exist on the ORDER object only.
 *   - Even on the Order path, Square's own forums have an unresolved, reproduced-
 *     in-production report that `reference_id` does NOT appear in the
 *     `payment.created` / `payment.updated` webhook payloads, despite the docs
 *     saying it propagates to the payment.
 *
 * So: quick_pay genuinely cannot carry structured metadata, and switching to the
 * Order variant would NOT buy reliable webhook correlation — it would only change
 * the buyer-facing order shape (ad-hoc line items, tax/discount surface, an extra
 * failure mode) in exchange for a field the webhook may not echo. We stay on
 * quick_pay, and the correlation ladder is explicit:
 *
 *   PRIMARY (machine-readable, authoritative):
 *     `payment_link.order_id`, returned SYNCHRONOUSLY by CreatePaymentLink and
 *     present as `payment.order_id` / `refund.order_id` on every Square webhook.
 *     square-webhook correlates with `.eq('square_order_id', ...)`, mirroring
 *     stripe-webhook-live's `.eq('stripe_checkout_session_id', ...)`.
 *     >>> THE CALLER MUST PERSIST `squareOrderId` FROM THIS ADAPTER'S RESPONSE
 *     >>> ONTO payments.square_order_id. Without that write there is no local
 *     >>> handle at all: at the moment the buyer pays we do not yet know the
 *     >>> square_payment_id, so order_id is the ONLY column the webhook can
 *     >>> match on, and the collection lands as "no local payments row".
 *
 *   FALLBACK (human-readable, never keyed on):
 *     `payment_note` -> Payment.note. This is a reconciliation aid for a person
 *     staring at the Square dashboard after something else went wrong. It is not
 *     a correlation key: it is free text, it is not indexed, and Square does not
 *     guarantee it survives every payment shape.
 *
 *   LAST RESORT (operator recovery):
 *     top-level `description`, stored on the PaymentLink and readable via
 *     GET /v2/online-checkout/payment-links/{id}. Square documents it as internal
 *     ("useful in your application context. It is not used anywhere").
 */

import { ProviderResolution, servedBySquare, ProviderOutcome, skip, failed, SquareError, SquareMode, PaymentsSupabaseClient } from "./types.ts";
import { squareFetch, squareIdempotencyKey } from "./square-client.ts";
import { mapSquarePaymentStatus, mapSquareRefundStatus } from "./square-status-map.ts";

/** Postgres unique_violation. Here it means "this exact checkout already has a
 *  payments row", which is the retry path, not a failure. */
const PG_UNIQUE_VIOLATION = "23505";

export interface SquareCheckoutSpec {
  amountCents: number;
  /**
   * ISO-4217, case-insensitive (callers pass Stripe's lower-case 'gbp').
   *
   * ADVISORY, NOT AUTHORITATIVE. Square binds currency to the LOCATION and will
   * not convert, so `square_connections.location_currency` decides what we send.
   * This field is validated against it and the request is refused on a mismatch;
   * it is never the value that reaches Square. See resolveMoneyCurrency().
   */
  currency: string;
  description?: string;
  /** Square has redirect_url (success only). There is NO cancel_url analogue. */
  redirectUrl?: string;
  /**
   * Our correlation handle. See THE CORRELATION CONTRACT at the top of this file:
   * this value cannot reach Square as structured data (QuickPay has no
   * reference_id and no metadata), so it goes into the human-readable
   * payment_note and the real correlation is the returned order_id.
   */
  reference: {
    paymentId: string;
  };
  /**
   * OPTIONAL extra identity folded into the idempotency key.
   *
   * The key is (reference, currency, amount). That correctly separates a
   * corrected amount from a true retry, but it CANNOT separate two genuinely
   * different charges that share a reference AND an amount — e.g. two identical
   * weekly PAYG collections on one rental, which is reachable today only because
   * create-checkout-session passes a RENTAL id as `reference.paymentId`. A caller
   * in that position must pass something row-unique here (the payments row id,
   * the accrual id, the installment id). Callers that already pass a real
   * payments-row uuid need nothing: the collision is structurally impossible.
   */
  idempotencyScope?: string;
  /**
   * The `payments` row to create for this checkout, BEFORE Square is called.
   *
   * WHY THIS LIVES IN THE SEAM AND NOT IN THE CALLERS
   *
   * The adapter used to return a `persist: { square_order_id }` block described
   * as "a loud, machine-readable statement of the caller's obligation". No
   * caller honoured it. Nothing wrote square_order_id, so square-webhook's
   * findPaymentByHandles() could never match a row: the buyer paid, the webhook
   * fired, logged "no local payments row", returned 200, and the money was never
   * recorded against the rental.
   *
   * An obligation that five call sites must each remember is a bug waiting to
   * happen, and it happened. Doing the write HERE makes it structural: a caller
   * that supplies this cannot forget the handles, and a caller that omits it
   * gets a link with no row — which is now an explicit, visible choice rather
   * than a silent omission.
   *
   * Omit only for a flow that genuinely manages its own row (send-excess-mileage
   * -payment-link writes one itself, with the handles, after the link exists).
   */
  paymentRow?: Record<string, unknown>;
}

/**
 * CreatePaymentLink.payment_note caps at 500 chars — its OWN limit.
 *
 * An earlier version clamped the note with capabilities.maxReferenceIdChars (40),
 * which is the ORDER.reference_id limit and has nothing to do with this field.
 * Borrowing another field's ceiling silently truncated the only human-readable
 * copy of the reference. There is no capability entry for this because it is a
 * Checkout-API field, not a cross-provider capability.
 */
export const SQUARE_PAYMENT_NOTE_MAX = 500;

/** CreatePaymentLink.description caps at 4096. */
export const SQUARE_DESCRIPTION_MAX = 4096;

/** Prefix that makes the note recognisable to a human in the Square dashboard. */
export const SQUARE_NOTE_PREFIX = "Drive247 ref:";

/**
 * The human-readable fallback note. NOT a correlation key — nothing may parse
 * this to find a payments row. See THE CORRELATION CONTRACT.
 */
export function buildSquarePaymentNote(reference: string): string {
  return `${SQUARE_NOTE_PREFIX} ${reference}`.slice(0, SQUARE_PAYMENT_NOTE_MAX);
}

interface SquareConnection {
  accessToken: string;
  merchantId: string;
  locationId: string;
  /** Square binds currency to the LOCATION and never converts. This is the only
   *  trustworthy currency for money we send — payments has no currency column. */
  locationCurrency: string;
  /** The mode the stored credential actually belongs to. */
  mode: SquareMode;
}

/**
 * Load a tenant's Square credentials for a SPECIFIC mode.
 *
 * p_square_mode is REQUIRED, not optional. square_get_tokens defaults it to NULL,
 * which disables the mode filter and returns whichever connection was connected
 * most recently — while the base URL is chosen independently from
 * tenants.square_mode. uq_square_connections_active is UNIQUE(tenant_id,
 * square_mode) WHERE status='active', so one active TEST and one active LIVE
 * connection can coexist by design. Passing NULL therefore makes it possible to
 * sign a sandbox-intent request with live credentials, or the reverse. The
 * benign outcome is a 401 storm; the malignant one reaches the live merchant.
 *
 * Returns null rather than throwing when there is no active connection, so
 * callers SKIP — a tenant mid-onboarding is not an error.
 */
async function loadConnection(
  supabase: PaymentsSupabaseClient,
  tenantId: string,
  mode: SquareMode,
): Promise<SquareConnection | null> {
  const { data, error } = await supabase.rpc("square_get_tokens", {
    p_tenant_id: tenantId,
    p_square_mode: mode,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.access_token || !row?.location_id) return null;

  // Belt and braces: the RPC echoes the row's mode. If it ever disagrees with the
  // mode we are about to build a base URL from, fail LOUDLY rather than skip —
  // a silent skip here would look like "not connected" and hide a credential mixup.
  const rowMode = (row.square_mode as SquareMode) ?? mode;
  if (rowMode !== mode) {
    throw new Error(
      `square: credential/mode mismatch for tenant ${tenantId} — ` +
        `resolved mode '${mode}' but stored connection is '${rowMode}'. Refusing to proceed.`,
    );
  }

  return {
    accessToken: row.access_token as string,
    merchantId: (row.merchant_id as string) ?? "",
    locationId: row.location_id as string,
    locationCurrency: String(row.location_currency ?? "").toUpperCase(),
    mode: rowMode,
  };
}

/**
 * payments.amount is `numeric` in MAJOR units (dollars/pounds). Square's Money
 * object wants MINOR units (cents/pence).
 *
 * Math.round is load-bearing: 10.1 * 100 === 1009.9999999999999 in IEEE-754, and
 * Square rejects a non-integer amount with EXPECTED_INTEGER. A bare multiply also
 * silently under/over-charges by a penny at scale.
 *
 * Returns null on anything non-finite so callers fail explicitly instead of
 * sending NaN into a money API.
 */
export function majorToMinorUnits(amount: unknown): number | null {
  // Number(null) === 0 and Number('') === 0 and Number([]) === 0. On a money
  // path those must NOT become a zero-amount refund that looks deliberate —
  // reject them as unresolvable so the caller skips explicitly.
  if (amount === null || amount === undefined) return null;
  if (typeof amount === "string" && amount.trim() === "") return null;
  if (typeof amount !== "number" && typeof amount !== "string") return null;

  const n = Number(amount);
  if (!Number.isFinite(n)) return null;

  // A negative amount is rejected for the same reason a null one is, and the
  // omission was an inconsistency rather than a decision: on a REFUND path a
  // negative value inverts the direction of the money, and Square would be asked
  // to take a payment while our ledger records a return. `process-refund` does
  // validate `refundAmount > 0` at its entry, but this helper is shared and
  // cannot assume every present or future caller repeats that check.
  //
  // Zero is rejected too. Square rejects a zero-amount payment link anyway, and
  // a caller that reached here with 0 has computed something wrong upstream —
  // sending it produces a link nobody can pay rather than a visible failure.
  if (n <= 0) return null;

  // Math.round is load-bearing, not defensive styling: 19.99 * 100 is
  // 1998.9999999999998 in IEEE-754, and Square rejects a non-integer amount with
  // EXPECTED_INTEGER. (Not every value is affected — 10.1 * 100 is exactly 1010 —
  // which is precisely why an unrounded multiply passes casual testing and then
  // fails on a real price.)
  return Math.round(n * 100);
}

/**
 * ONE currency policy for BOTH money paths: the connected LOCATION decides.
 *
 * Square binds currency to the location and will not convert, so a location that
 * bills in GBP rejects a USD amount with INVALID_VALUE at money time. The two
 * halves of this adapter used to disagree — refund read conn.locationCurrency,
 * checkout read the caller's spec — which meant a tenant whose settings drifted
 * could refund correctly and fail to charge, or the reverse.
 *
 * The drift is reachable in production even though square-oauth-callback refuses
 * to store a connection whose location currency disagrees with the tenant's
 * currency_code: nothing re-checks that pairing when an operator later edits
 * currency_code in settings, and create-checkout-session derives its currency
 * from exactly that column.
 *
 * Both failure modes return failed(), never skip(). A skip is a success-shaped
 * HTTP 200: it would tell the operator the link was raised, or the refund issued,
 * while no money moved — the precise laundering that types.ts's failed() exists
 * to prevent. 409 because the request conflicts with the tenant's connected
 * location, and no retry of the same request can succeed.
 */
function resolveMoneyCurrency(
  conn: SquareConnection,
  requested?: string,
): { currency: string; outcome?: undefined } | { currency?: undefined; outcome: ProviderOutcome } {
  const locationCurrency = conn.locationCurrency;

  if (!locationCurrency) {
    return {
      outcome: failed("square_location_currency_unknown", 409, {
        locationId: conn.locationId,
        hint:
          "square_connections.location_currency is empty on an ACTIVE connection; reconnect the Square " +
          "account so the location is resolved. Refusing to guess a currency on a money path.",
      }),
    };
  }

  // Callers pass Stripe's lower-case currency ('gbp'), so normalise before
  // comparing — a case difference is not a mismatch.
  const asked = (requested ?? "").trim().toUpperCase();

  // An absent/blank request is not an assertion about currency, so it defers to
  // the location. The refund path takes this branch always: public.payments has
  // no currency column at all.
  if (!asked) return { currency: locationCurrency };

  if (asked !== locationCurrency) {
    return {
      outcome: failed("square_currency_mismatch", 409, {
        requested: asked,
        locationCurrency,
        locationId: conn.locationId,
        hint:
          `This tenant is configured for ${asked} but its connected Square location bills in ` +
          `${locationCurrency}, and Square does not convert. Align the tenant's currency with the ` +
          `location, or connect a location in ${asked}.`,
      }),
    };
  }

  return { currency: locationCurrency };
}

/**
 * The checkout idempotency key's natural identity.
 *
 * WHY AMOUNT AND CURRENCY ARE IN HERE. The key used to be `chk-${paymentId}`,
 * pinned to the reference alone. Square's documented behaviour is that reusing a
 * key with changed request data returns 400 IDEMPOTENCY_KEY_REUSED ("The
 * idempotency key can only be retried with the same request data"), and reusing
 * it with IDENTICAL data returns 200 with the ORIGINAL resource. Both halves of
 * that bit us:
 *
 *   - operator corrects an amount and re-raises the link -> same key, different
 *     data -> a hard 400 that no retry can ever clear, because the key is a pure
 *     function of the reference. That reference is permanently un-chargeable.
 *   - a second, legitimately different charge on the same reference for the same
 *     amount -> same key, same data -> 200 carrying the FIRST link. The operator
 *     sees a valid link; the buyer pays once; the second charge is never
 *     collected. Silently wrong money.
 *
 * Folding the money into the key fixes the first outright and narrows the second
 * to "same reference AND same amount", which `idempotencyScope` exists to break.
 *
 * A missing reference gets a RANDOM key rather than a stable one. Two unrelated
 * charges of equal amount would otherwise share the key `chk--GBP-5000` and
 * collapse into one link. Losing retry de-duplication costs at most a spare
 * unpaid payment link; a collapsed link costs a collection.
 */
function checkoutIdempotencySeed(spec: SquareCheckoutSpec, currency: string): string {
  const reference = spec.reference.paymentId?.trim() ?? "";
  const scope = spec.idempotencyScope?.trim();

  if (!reference && !scope) {
    console.warn(
      "[square-adapter] checkout has no reference and no idempotencyScope; minting a random " +
        "idempotency key. This call is NOT retry-de-duplicated — a network retry raises a second link.",
    );
    return `chk-anon-${crypto.randomUUID()}`;
  }

  return [`chk`, reference, scope ?? "", currency, String(spec.amountCents)]
    .filter((part) => part !== "")
    .join("-");
}

export async function createSquareCheckout(
  supabase: PaymentsSupabaseClient,
  resolution: ProviderResolution,
  spec: SquareCheckoutSpec,
): Promise<ProviderOutcome> {
  const mode = resolution.squareMode ?? "test";
  const conn = await loadConnection(supabase, resolution.tenantId, mode);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  // CURRENCY PRE-FLIGHT, before a single byte reaches Square. A clear refusal
  // naming both currencies beats a Square 400 INVALID_VALUE that names neither.
  const money = resolveMoneyCurrency(conn, spec.currency);
  if (money.outcome) return money.outcome;
  const currency = money.currency;

  const idempotencyKey = await squareIdempotencyKey(checkoutIdempotencySeed(spec, currency));

  // ---- PRE-INSERT ---------------------------------------------------------
  // The payments row is created BEFORE Square is called, and a failed insert
  // ABORTS rather than returning a live URL.
  //
  // The ordering is the whole point. square-webhook can only correlate by
  // square_order_id, and at the moment the buyer pays we do not yet know the
  // square_payment_id. If the row is written after the link — or not at all —
  // then a buyer who pays immediately hits a webhook with nothing to match, and
  // the collection is logged as "no local payments row" and silently lost.
  //
  // Returning a payable link we cannot track is strictly worse than returning
  // an error: the customer is charged either way, but only one of them leaves
  // us able to see it.
  //
  // ONE ROW PER LINK. The row carries the idempotency key and
  // ux_payments_square_idempotency_key makes it unique, so the row is exactly as
  // unique as the link Square will hand back.
  //
  // Without that, a customer clicking "Pay" twice produced ONE link (Square's
  // idempotency working correctly) and TWO Pending rows, both later stamped with
  // the same square_order_id. square-webhook completes the newest and leaves the
  // other Pending forever; recover-pending-square-payments then finds that
  // leftover, sees the order genuinely PAID, and allocates the same collection a
  // second time.
  let paymentRowId: string | null = null;
  if (spec.paymentRow) {
    const { data: inserted, error: insertErr } = await supabase
      .from("payments")
      .insert({
        ...spec.paymentRow,
        payment_provider: "square",
        status: "Pending",
        square_idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();

    if (insertErr) {
      // A unique violation is the RETRY case, not an error: this exact checkout
      // already has a row. Adopt it — Square is about to return that same link.
      if (insertErr.code === PG_UNIQUE_VIOLATION) {
        const { data: existing, error: findErr } = await supabase
          .from("payments")
          .select("id, status")
          .eq("square_idempotency_key", idempotencyKey)
          .maybeSingle();

        if (findErr || !existing?.id) {
          return failed("square_payment_row_conflict_unresolvable", 500, {
            detail: findErr?.message ?? "row conflicted but could not be re-read",
          });
        }

        // Never hand back a fresh link for money that already arrived. The
        // customer would pay twice for one thing, and the second collection
        // would have no charge to allocate against.
        if (existing.status && existing.status !== "Pending") {
          return failed("square_payment_already_settled", 409, {
            paymentRowId: String(existing.id),
            status: existing.status,
            hint: "This checkout has already been paid or closed. Refusing to issue a second payment link for it.",
          });
        }

        paymentRowId = String(existing.id);
      } else {
        return failed("square_payment_row_insert_failed", 500, {
          detail: insertErr.message,
          hint: "Refusing to create a Square payment link that cannot be correlated to a local row.",
        });
      }
    } else if (!inserted?.id) {
      return failed("square_payment_row_insert_failed", 500, {
        detail: "no id returned",
        hint: "Refusing to create a Square payment link that cannot be correlated to a local row.",
      });
    } else {
      paymentRowId = String(inserted.id);
    }
  }

  // The FULL reference, never truncated. The old 40-char clamp borrowed
  // Order.reference_id's limit for a field that is not reference_id, and a
  // silently shortened id is worse than a long one: it still looks like an id.
  //
  // Prefer the row we just created: a payments-row uuid is genuinely unique per
  // charge, whereas the caller's reference is a RENTAL id on some paths and
  // therefore shared between two identical collections.
  const reference = paymentRowId ?? spec.reference.paymentId ?? "";

  try {
    const res = await squareFetch<{ payment_link?: Record<string, unknown> }>({
      mode,
      accessToken: conn.accessToken,
      method: "POST",
      path: "/v2/online-checkout/payment-links",
      idempotencyKey,
      body: {
        quick_pay: {
          // Buyer-facing line-item name. QuickPay.name caps at 255.
          name: spec.description?.slice(0, 255) ?? "Payment",
          price_money: { amount: spec.amountCents, currency },
          location_id: conn.locationId,
        },
        // Square shows its own confirmation page when redirect_url is absent.
        checkout_options: spec.redirectUrl ? { redirect_url: spec.redirectUrl } : undefined,
        // Human-readable fallback only — see THE CORRELATION CONTRACT. Clamped to
        // payment_note's own 500-char limit.
        payment_note: reference ? buildSquarePaymentNote(reference) : undefined,
        // Operator recovery handle: lets a human find this link by reference via
        // GET /v2/online-checkout/payment-links when the local write failed.
        description: reference
          ? `${SQUARE_NOTE_PREFIX} ${reference}`.slice(0, SQUARE_DESCRIPTION_MAX)
          : undefined,
      },
    });

    const link = res.payment_link ?? {};

    // ---- HANDLE WRITE-BACK ------------------------------------------------
    // Without this the row exists but carries no order_id, which is the same
    // un-correlatable state as having no row at all.
    if (paymentRowId) {
      const { error: handleErr } = await supabase
        .from("payments")
        .update({
          square_order_id: link.order_id ?? null,
          square_payment_link_id: link.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentRowId);

      if (handleErr || !link.order_id) {
        // The link is live and payable but we cannot correlate it. Say so loudly
        // rather than handing back a URL: an operator who sees an error will
        // collect another way, whereas a silent success produces a payment that
        // arrives and never settles.
        console.error("[square-adapter] handle write-back failed:", handleErr?.message ?? "no order_id returned");

        // REVOKE IT, do not merely report it. This used to tell the operator to
        // "void it in the Square dashboard" — a manual step, in a system they may
        // not have open, for a link that is payable the whole time they take to
        // do it. Anyone holding the URL could pay against a row we cannot match.
        let voided = false;
        if (link.id) {
          try {
            const v = await voidSquarePaymentLink(supabase, resolution, String(link.id));
            voided = !v.error;
          } catch (voidErr) {
            console.error("[square-adapter] could not revoke the orphan link:", voidErr);
          }
        }

        // Free the key so the operator's next attempt starts clean rather than
        // adopting this dead row.
        if (paymentRowId) {
          await supabase
            .from("payments")
            .update({ status: "Failed", square_idempotency_key: null, updated_at: new Date().toISOString() })
            .eq("id", paymentRowId)
            .eq("status", "Pending");
        }

        return failed("square_handle_persist_failed", 502, {
          paymentRowId,
          paymentLinkId: link.id ?? null,
          linkRevoked: voided,
          hint: voided
            ? "The Square link could not be linked to the local payment row and has been revoked. Nothing is payable."
            : "The Square link was created, could not be linked to the local payment row, and could NOT be revoked automatically. Void it in the Square dashboard now.",
        });
      }
    }

    return servedBySquare({
      paymentId: paymentRowId,
      provider: "square",
      url: link.url,
      paymentLinkId: link.id,
      orderId: link.order_id,
      // Named for the COLUMN the caller must write it to. `orderId` is kept for
      // callers already reading it; this alias is what makes the persistence
      // obligation in THE CORRELATION CONTRACT mechanical rather than a footnote.
      squareOrderId: link.order_id,
      currency,
      amountCents: spec.amountCents,
      referenceId: reference,
      // Loud, machine-readable statement of the caller's obligation. Without this
      // write the buyer can pay and the webhook can never find the row.
      //
      // square_payment_link_id is persisted alongside it because it is the ONLY
      // handle DeletePaymentLink accepts. Without it a voided link stays live and
      // payable while the UI reports it dead — see void-payment-link.
      persist: {
        square_order_id: link.order_id ?? null,
        square_payment_link_id: link.id ?? null,
      },
    });
  } catch (err) {
    // The link was never created, so the pre-inserted row describes money that
    // will never be collected. Left Pending it would be swept by the recovery
    // cron every minute forever, looking for an order that does not exist.
    // Clear the idempotency key as well as failing the row. Leaving it behind
    // would make ux_payments_square_idempotency_key adopt this dead row on the
    // operator's next attempt at the same collection — and the "already settled"
    // guard above would then refuse a checkout that never happened.
    if (paymentRowId) {
      await supabase
        .from("payments")
        .update({
          status: "Failed",
          square_idempotency_key: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", paymentRowId)
        .eq("status", "Pending");
    }

    if (err instanceof SquareError) {
      // NOT a skip. An expired token or an outage must reach the operator as a
      // failure, not as an HTTP 200 with no payment link in it.
      return failed("square_checkout_failed", err.httpStatus >= 500 ? 502 : 400, {
        category: err.category, code: err.code, detail: err.message,
      });
    }
    throw err;
  }
}

export async function refundSquarePayment(
  supabase: PaymentsSupabaseClient,
  resolution: ProviderResolution,
  spec: { paymentRecord: Record<string, unknown>; amountCents?: number; reason?: string },
): Promise<ProviderOutcome> {
  const mode = resolution.squareMode ?? "test";
  const conn = await loadConnection(supabase, resolution.tenantId, mode);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  const squarePaymentId = spec.paymentRecord.square_payment_id as string | undefined;
  if (!squarePaymentId) return skip("square_payment_id_missing");

  // AMOUNT.
  // payments has NO `amount_cents` column — it has `amount numeric` in MAJOR
  // units. An earlier version of this file read `amount_cents`, which is
  // undefined on every real row, so a FULL refund (the common case, where the
  // caller omits amountCents) silently became skip('refund_amount_unknown').
  // That is handled:true, so the operator saw an HTTP 200 success shape while no
  // money moved. Read the real column and convert explicitly.
  const amount = spec.amountCents ?? majorToMinorUnits(spec.paymentRecord.amount);
  if (amount === null || amount === undefined) {
    return skip("refund_amount_unresolvable", {
      hint: "payments.amount was missing or non-numeric; refusing to guess an amount on a money path.",
    });
  }
  if (amount <= 0) return skip("refund_amount_not_positive", { amount });

  // CURRENCY.
  // payments has NO currency column at all, so there is nothing for the caller to
  // assert and resolveMoneyCurrency() is called with no requested value — it
  // returns the location's currency. Identical policy to createSquareCheckout by
  // construction, not by two comments agreeing with each other.
  //
  // The previous `?? 'USD'` default sent USD at a GBP location, which Square
  // rejects with INVALID_VALUE; a hardcoded currency on a money path is worse
  // than a hard failure because it fails differently per tenant.
  //
  // This was a skip() until the currency policy was unified. A skip is
  // handled:true — a success-shaped 200 — so an empty location_currency told the
  // operator the refund had been issued while nothing had been sent to Square at
  // all. An active connection with no location currency is a broken connection,
  // not a tenant mid-onboarding, and the two must not report the same way.
  const money = resolveMoneyCurrency(conn);
  if (money.outcome) return money.outcome;
  const currency = money.currency;

  /**
   * IDEMPOTENCY — this key has to satisfy two OPPOSING requirements.
   *
   *   RETRY of one refund      -> same key, so Square de-dupes and we never
   *                               refund twice for one operation.
   *   SECOND, DISTINCT refund  -> different key, so a genuine second partial
   *                               refund actually reaches Square.
   *
   * Keying on (payment, amount) fails the second: two £10 partial refunds of the
   * same payment collapse into one, Square returns the FIRST refund's object,
   * the adapter reports success, and the customer is short £10.
   * Keying on (payment, rowId, amount) fails it identically, because both
   * refunds belong to the SAME payments row — there is no per-refund row here
   * (process-refund passes the payment record, and refund_row_id does not exist
   * on it: verified, 0 occurrences).
   *
   * So the discriminator is HOW MUCH WAS ALREADY REFUNDED when this call was
   * made. That advances only when a refund actually settles:
   *   1st £10 (nothing banked)     -> seed "0"
   *   retry of it (still nothing)  -> seed "0"      -> de-dupes  ✅
   *   2nd £10 (£10 now banked)     -> seed "1000"   -> proceeds  ✅
   *
   * The failure direction is deliberate: if the settling webhook has not landed
   * yet, a genuine second refund shares the first's key and is REFUSED. Blocking
   * a real refund is recoverable — a retry once the webhook lands succeeds.
   * Double-refunding real money is not.
   */
  const priorRefundedMinor = Math.max(
    0,
    majorToMinorUnits(spec.paymentRecord.refund_amount) ?? 0,
  );
  const refundIdentity =
    (spec.paymentRecord.refund_row_id as string | undefined) ??
    `${spec.paymentRecord.id ?? "norow"}-after${priorRefundedMinor}`;
  const idempotencyKey = await squareIdempotencyKey(
    `rfnd-${squarePaymentId}-${refundIdentity}-${amount}`,
  );

  try {
    const res = await squareFetch<{ refund?: Record<string, unknown> }>({
      mode,
      accessToken: conn.accessToken,
      method: "POST",
      path: "/v2/refunds",
      idempotencyKey,
      body: {
        payment_id: squarePaymentId,
        amount_money: { amount, currency },
        reason: spec.reason?.slice(0, 192),
      },
    });

    const refund = res.refund ?? {};
    // A Square refund is PENDING here and settles later via refund.updated, and
    // can still land REJECTED. Never write Completed off this response.
    return servedBySquare({
      provider: "square",
      refundId: refund.id,
      squareRefundId: refund.id,
      amountCents: amount,
      currency,
      status: mapSquareRefundStatus(String(refund.status ?? "PENDING")),
      settlesAsynchronously: true,
    });
  } catch (err) {
    // Without this, a currency/amount rejection escaped as an unhandled
    // SquareError and the caller returned a 500 instead of a usable message.
    if (err instanceof SquareError) {
      return failed("square_refund_failed", err.httpStatus >= 500 ? 502 : 400, {
        category: err.category,
        code: err.code,
        detail: err.message,
        amountCents: amount,
        currency,
      });
    }
    throw err;
  }
}

export { mapSquarePaymentStatus };

/**
 * Kill an unpaid Square payment link.
 *
 * The Stripe counterpart is `checkout.sessions.expire`. Square's equivalent is a
 * DELETE on the payment link, and it is the reason `square_payment_link_id` is
 * persisted at creation: Square exposes no way to find a link by order id.
 *
 * NOT NOT_FOUND-TOLERANT BY ACCIDENT. A link that Square has already removed
 * returns 404, and that is a SUCCESS for our purposes — the caller's goal is
 * "this link cannot be paid", and a link that does not exist satisfies it. Any
 * other error is a real failure and must reach the operator, because the whole
 * point of the call is a guarantee about money.
 */
export async function voidSquarePaymentLink(
  supabase: PaymentsSupabaseClient,
  resolution: ProviderResolution,
  paymentLinkId: string,
): Promise<ProviderOutcome> {
  const mode = resolution.squareMode ?? "test";
  const conn = await loadConnection(supabase, resolution.tenantId, mode);
  if (!conn) return skip("square_not_connected", { tenantId: resolution.tenantId });

  try {
    await squareFetch({
      mode,
      accessToken: conn.accessToken,
      method: "DELETE",
      path: `/v2/online-checkout/payment-links/${encodeURIComponent(paymentLinkId)}`,
    });
    return servedBySquare({ provider: "square", voided: true, paymentLinkId });
  } catch (err) {
    if (err instanceof SquareError) {
      if (err.httpStatus === 404) {
        // Already gone. The guarantee holds.
        return servedBySquare({
          provider: "square",
          voided: true,
          paymentLinkId,
          note: "Link no longer existed at Square; treated as already voided.",
        });
      }
      return failed("square_void_link_failed", err.httpStatus >= 500 ? 502 : 400, {
        category: err.category,
        code: err.code,
        detail: err.message,
      });
    }
    throw err;
  }
}
