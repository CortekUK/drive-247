/**
 * The booking WRITE path: customer → rental → extras → invoice → ledger.
 *
 * Ported from `apps/booking/src/components/BookingCheckoutStep.tsx`
 * (`proceedWithPayment`, ~L816-1566), which is the ONLY correct implementation
 * in v1. Two other files look more complete and are not:
 *   • `app/booking/checkout/page.tsx` taxes a different base, hardcodes
 *     `extras_total` to 0, and omits `customers.type` (NOT NULL, no default).
 *   • `MultiStepBookingWidget.handleSubmit` is dead code and writes
 *     `rentals.notes` / `rentals.customer_timezone`, columns that do not exist.
 *
 * ── ORDER IS NOT NEGOTIABLE ─────────────────────────────────────────────────
 * customer → rental → extras → invoice → charges. The rental INSERT fires
 * `rental_charges_trigger`, and `generate_first_charge_for_rental` reads the
 * INVOICE to split the ledger by category, so an invoice written after the RPC
 * would be ignored and the whole booking would bill as one undifferentiated
 * "Rental" line. `create-booking-payment-intent` then sums those ledger rows to
 * decide what to charge — so the ledger, not this file, is the amount.
 *
 * ── THE PARTS THAT DELIBERATELY DIVERGE FROM v1 ─────────────────────────────
 * Three, each forced, each about money rather than taste:
 *
 *  1. `payment_mode: 'auto'`. v1 asks the `get-booking-mode` edge function and
 *     defaults to `'manual'` (a pre-auth HOLD) when it errors. v2 has exactly
 *     one payment path — embedded Elements over `create-booking-payment-intent`,
 *     which mints a plain immediate-capture PaymentIntent with no
 *     `capture_method: 'manual'` anywhere. Recording `'manual'` would tell the
 *     portal a hold exists that does not.
 *
 *  2. A `Security Deposit` ledger charge, when the tenant charges deposits
 *     rather than holding them. `computeQuote` puts `chargedSecurityDeposit`
 *     into `grandTotal`, but migration 20260420120500 deliberately removed that
 *     category from `generate_first_charge_for_rental` (deposits normally live
 *     on `rentals.deposit_hold_*` as a Stripe authorisation). On a tenant with
 *     `deposit_charge_enabled = true` the ledger would therefore be SHORT by the
 *     deposit and the customer would be charged less than the page quoted them.
 *
 *  3. An `Unlimited Mileage` ledger charge. This one v1 also writes, for the
 *     same reason — `invoices` has no column for the upgrade, so the RPC cannot
 *     see it. v1 makes the insert non-fatal; here it is fatal, because v2 sends
 *     the quoted figure to the payment endpoint as an integrity check and a
 *     missing line becomes a hard "amount does not match" instead of a silent
 *     undercharge.
 *
 * ── WHAT v1 COLLECTS AND DOES NOT PERSIST (carried over unchanged) ──────────
 * `pickup_time` / `return_time`, `promo_code`, `delivery_option`,
 * `customers.date_of_birth` and `customers.timezone` all have columns and are
 * all left NULL by v1's live path. v2 asks for every one of them. They are NOT
 * written here, because the brief is to mirror v1's column set exactly — but a
 * human should decide whether that is still right, because v2's form makes the
 * omission more visible than v1's did.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { todayDateString } from "@/lib/domain";
import type { PricingTier } from "@/lib/domain";

import type {
  CreateBookingFailure,
  CreateBookingParams,
  CreateBookingResult,
} from "./types";

/* ────────────────────────────── error plumbing ───────────────────────────── */

/**
 * supabase-js can hand back `{}` for a failed write. Flattening every field it
 * might carry is the difference between "Customer create failed" and a message
 * that names the offending column — which is usually a missing `anon` grant.
 */
function describe(error: PostgrestError | null): string {
  if (!error) return "unknown error";
  const parts = [error.message, error.code, error.details, error.hint].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(error);
}

const TAKEN_COPY =
  "This vehicle is no longer available for the selected dates. Please choose " +
  "different dates, or another vehicle from the fleet.";

const PAUSED_COPY =
  "This vehicle is not bookable right now. Please choose another from the fleet.";

function taken(detail: string): CreateBookingResult {
  // Not retryable: pressing the button again re-runs the same overlap check
  // against the same rows and fails identically. The dates have to move.
  return { ok: false, failure: { kind: "vehicle-taken", message: TAKEN_COPY, retryable: false, detail } };
}

function paused(detail: string): CreateBookingResult {
  return { ok: false, failure: { kind: "vehicle-paused", message: PAUSED_COPY, retryable: false, detail } };
}

function writeFailed(what: string, detail: string): CreateBookingResult {
  const failure: CreateBookingFailure = {
    kind: "write-failed",
    message:
      "We could not save your booking, so nothing has been charged. Please " +
      "try again — if it keeps happening, get in touch and we will take your " +
      "booking directly.",
    retryable: true,
    detail: `${what}: ${detail}`,
  };
  return { ok: false, failure };
}

/** A trigger exception surfaces as a message, not a distinguishable code. */
function isOverlapError(error: PostgrestError): boolean {
  return error.code === "23P01" || /vehicle rental overlap/i.test(error.message ?? "");
}

/* ─────────────────────────────── small helpers ───────────────────────────── */

/** `rentals.rental_period_type` is CHECKed against Daily/Weekly/Monthly. */
const PERIOD_TYPE: Readonly<Record<PricingTier, "Daily" | "Weekly" | "Monthly">> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** v1's format: INV-YYYYMMDD-XXXX. */
function generateInvoiceNumber(): string {
  const today = todayDateString().replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `INV-${today}-${random}`;
}

/** `numeric` round-trips as a string over PostgREST; NULL means zero here. */
function money(raw: number | string | null): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Same tolerance the payment endpoint applies to `expectedAmount`. */
function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.005;
}

function nullableText(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/* ══════════════════════════════ the write path ═══════════════════════════ */

export async function createBooking(
  params: CreateBookingParams,
): Promise<CreateBookingResult> {
  const {
    tenantId,
    vehicleId,
    form,
    quote,
    selectedExtras,
    pickupLocation,
    returnLocation,
  } = params;

  // A quote that is not `ready` is all zeroes, and a blocked delivery is a
  // booking the operator cannot fulfil. Either would write a rental for a price
  // nobody agreed to, so neither is allowed past this line.
  if (!quote.ready) {
    return writeFailed("quote", "the quote was not ready — refusing to write a rental at a zeroed price");
  }
  if (quote.deliveryBlocked) {
    return writeFailed("quote", "the chosen address is outside the delivery area");
  }

  /* ── 0. What this booking is worth, decided once ───────────────────────── */

  const grandTotal = quote.grandTotal;
  const periodType = PERIOD_TYPE[quote.pricingTier];
  const unlimitedTotal = quote.unlimitedMileage.amount;
  const unlimitedActive = unlimitedTotal > 0;
  const depositCharged = quote.chargedSecurityDeposit;
  // The SMS opt-in is stamped ONCE so the customer row and the rental row can
  // never disagree about when consent was given (A2P 10DLC evidence).
  const smsConsentAt = form.smsConsent ? new Date().toISOString() : null;

  /* ── 1. The customer ───────────────────────────────────────────────────── */

  const normalizedEmail = form.customerEmail.trim().toLowerCase();
  const customerName = form.customerName.trim();
  const customerPhone = form.customerPhone.trim();

  // v1 looks up within the tenant first (that is where the unique index lives),
  // then falls back to a tenant-less row. Case-insensitively, because the column
  // stores whatever was typed and a casing mismatch would miss the SELECT and
  // then trip the (email, tenant_id) unique index on the INSERT — which
  // supabase-js reports as an empty `{}`.
  const tenantMatch = await supabase
    .from("customers")
    .select("id, tenant_id")
    .ilike("email", normalizedEmail)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let existing: { id: string; tenant_id: string | null } | null = tenantMatch.data;

  if (!existing) {
    const globalMatch = await supabase
      .from("customers")
      .select("id, tenant_id")
      .ilike("email", normalizedEmail)
      .is("tenant_id", null)
      .maybeSingle();
    existing = globalMatch.data;
  }

  let customerId: string;

  if (existing) {
    const update: {
      name: string;
      phone: string;
      status: string;
      tenant_id?: string;
      sms_consent?: boolean;
      sms_consent_at?: string | null;
    } = { name: customerName, phone: customerPhone, status: "Active" };

    if (existing.tenant_id === null) update.tenant_id = tenantId;
    // Never CLEAR an existing consent — an opt-in that was given once stays
    // given until the customer revokes it through the channel that granted it.
    if (form.smsConsent) {
      update.sms_consent = true;
      update.sms_consent_at = smsConsentAt;
    }

    const updated = await supabase
      .from("customers")
      .update(update)
      .eq("id", existing.id)
      .select("id")
      .single();

    if (updated.error) return writeFailed("customer update", describe(updated.error));
    customerId = updated.data.id;
  } else {
    // `tenant_id` is not optional in practice: a trigger on `customers` creates
    // a `chat_channels` row whose `tenant_id` is NOT NULL, so a tenant-less
    // insert fails inside the trigger with a confusing message about a table
    // this file never names.
    const created = await supabase
      .from("customers")
      .insert({
        name: customerName,
        email: normalizedEmail,
        phone: customerPhone,
        // NOT NULL with no default. Omitting it is the bug in
        // app/booking/checkout/page.tsx.
        type: "Individual",
        customer_type: "Individual",
        status: "Active",
        is_blocked: false,
        sms_consent: form.smsConsent,
        sms_consent_at: smsConsentAt,
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (created.error) {
      // 23505 on (email, tenant_id): the SELECT above raced a concurrent insert,
      // or was blocked. Recover by adopting the row that already exists rather
      // than failing a booking for a customer who plainly exists.
      const duplicate =
        created.error.code === "23505" ||
        /duplicate key|unique constraint|already exists/i.test(created.error.message ?? "");
      if (!duplicate) return writeFailed("customer create", describe(created.error));

      const refound = await supabase
        .from("customers")
        .select("id")
        .ilike("email", normalizedEmail)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!refound.data) return writeFailed("customer create", describe(created.error));
      customerId = refound.data.id;
    } else {
      customerId = created.data.id;
    }
  }

  /* ── 2. Is the car still on the road? ──────────────────────────────────── */

  // The fleet list filters paused vehicles, but the choice is persisted to
  // localStorage and survives a tab close, so a returning customer can submit
  // against a car the operator parked yesterday.
  //
  // NEVER `select('*')` on vehicles — that ships lockbox_code, purchase_price
  // and security_notes to anyone holding the anon key.
  const pausedRow = await supabase
    .from("vehicles")
    .select("id, is_paused")
    .eq("id", vehicleId)
    .maybeSingle();

  if (pausedRow.error) return writeFailed("vehicle check", describe(pausedRow.error));
  if (pausedRow.data?.is_paused === true) return paused("vehicles.is_paused is true");

  /* ── 3. The rental row we WOULD write ──────────────────────────────────── */

  const rentalColumns = {
    customer_id: customerId,
    vehicle_id: vehicleId,
    // Already 'YYYY-MM-DD'; handing the string straight to a `date` column is
    // strictly safer than parseDateString()-then-reformat, which is an identity
    // for this input and a timezone round-trip for nothing.
    start_date: form.pickupDate,
    end_date: form.dropoffDate,
    rental_period_type: periodType,
    // The column name is a lie: `monthly_amount` holds the GRAND TOTAL for
    // every period type, and it is what generate_first_charge_for_rental falls
    // back to when no invoice exists.
    monthly_amount: grandTotal,
    status: "Pending",
    // See the header: v2 has one payment path and it captures immediately.
    payment_mode: "auto",
    approval_status: "pending",
    // What the webhook flips to 'fulfilled' on settlement. Anything else here
    // and a paid booking stays looking unpaid forever.
    payment_status: "pending",
    pickup_location: nullableText(pickupLocation.address),
    pickup_location_id: pickupLocation.id,
    return_location: nullableText(returnLocation.address),
    return_location_id: returnLocation.id,
    delivery_fee: quote.pickupDelivery.fee,
    collection_fee: quote.returnDelivery.fee,
    // v2 has no gig-driver flow yet; false is the honest answer, not a guess.
    is_gig_driver: false,
    is_unlimited_mileage: unlimitedActive,
    unlimited_mileage_tier: unlimitedActive ? quote.unlimitedMileage.tier : null,
    unlimited_mileage_total: unlimitedActive ? unlimitedTotal : null,
    sms_consent: form.smsConsent,
    sms_consent_at: smsConsentAt,
    tenant_id: tenantId,
  } as const;

  /* ── 4. Reuse an unpaid draft, or replace it ───────────────────────────── */

  const reuse = await findReusableDraft({
    tenantId,
    vehicleId,
    customerId,
    rentalColumns,
    selectedExtras,
  });
  if (!reuse.ok) return reuse.failure;

  if (reuse.draft !== null && reuse.identical) {
    // Byte-identical booking, already committed, still unpaid. Patch only the
    // consent stamp — everything else about this rental is already correct, and
    // re-running the money steps would be a no-op at best.
    if (form.smsConsent && reuse.draft.sms_consent !== true) {
      await supabase
        .from("rentals")
        .update({ sms_consent: true, sms_consent_at: smsConsentAt })
        .eq("id", reuse.draft.id);
    }
    return {
      ok: true,
      booking: {
        rentalId: reuse.draft.id,
        rentalNumber: reuse.draft.rental_number,
        customerId,
        reused: true,
      },
    };
  }

  if (reuse.draft !== null) {
    // Something material moved. The old draft is CANCELLED rather than edited:
    // its ledger rows are keyed on (rental_id, due_date, type, category) and
    // `generate_first_charge_for_rental` will not overwrite one that already
    // exists, so an in-place edit would leave the customer paying yesterday's
    // price. Cancelling also releases the vehicle — `check_rental_overlap`
    // ignores Cancelled/Rejected/Closed — which is what lets the new row land.
    const cancelled = await supabase
      .from("rentals")
      .update({ status: "Cancelled", cancellation_reason: "customer_requested" })
      .eq("id", reuse.draft.id)
      .eq("payment_status", "pending")
      .select("id");

    if (cancelled.error) {
      return writeFailed("draft cancel", describe(cancelled.error));
    }
    if ((cancelled.data ?? []).length === 0) {
      // The row stopped being an unpaid draft between the read and the write —
      // a webhook settled it. Do not touch it, and do not book a second one.
      return taken("the previous draft was settled while it was being replaced");
    }
  }

  /* ── 5. The rental ─────────────────────────────────────────────────────── */

  // Mirrors the DB trigger, so a clash reads as a sentence rather than a raw
  // Postgres exception. It is a courtesy, not the guard — the trigger is.
  const clash = await supabase
    .from("rentals")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .eq("tenant_id", tenantId)
    .not("status", "in", "(Cancelled,Rejected,Closed)")
    .lte("start_date", form.dropoffDate)
    .or(`end_date.gte.${form.pickupDate},end_date.is.null`)
    .limit(1);

  if (clash.error) return writeFailed("overlap pre-check", describe(clash.error));
  if ((clash.data ?? []).length > 0) return taken("a live rental already covers these dates");

  const inserted = await supabase
    .from("rentals")
    .insert(rentalColumns)
    // `rental_number` is written by a trigger, so it can only be READ BACK.
    .select("id, rental_number")
    .single();

  if (inserted.error) {
    if (isOverlapError(inserted.error)) return taken(describe(inserted.error));
    return writeFailed("rental insert", describe(inserted.error));
  }

  const rentalId = inserted.data.id;
  const rentalNumber = inserted.data.rental_number;

  /* ── 6. Extras ─────────────────────────────────────────────────────────── */

  // Taken from `quote.extraLines` rather than from the raw extras list, so the
  // price and billing type recorded against the booking are the exact ones the
  // customer's bill was built from.
  const extraRows = quote.extraLines
    .filter((line) => (selectedExtras[line.id] ?? 0) > 0)
    .map((line) => ({
      rental_id: rentalId,
      extra_id: line.id,
      quantity: line.quantity,
      price_at_booking: line.unitPrice,
      billing_type_at_booking: line.perDay ? "per_day" : "per_trip",
    }));

  if (extraRows.length > 0) {
    const extrasWrite = await supabase.from("rental_extras_selections").insert(extraRows);
    if (extrasWrite.error) {
      // Fatal, unlike v1: `invoices.extras_total` is already in the amount the
      // customer will be charged, so a booking that takes the money without a
      // record of what was bought is worse than one that fails loudly.
      return writeFailed("extras insert", describe(extrasWrite.error));
    }
  }

  /* ── 7. The invoice ────────────────────────────────────────────────────── */

  // `discount_amount`, `promo_code` and `collection_fee` are passed by v1 and
  // silently dropped — those columns do not exist on `invoices`. They are not
  // sent here. The collection fee is not lost: it lives on `rentals` and the
  // charge RPC reads it from there.
  const invoiceWrite = await supabase
    .from("invoices")
    .insert({
      rental_id: rentalId,
      customer_id: customerId,
      vehicle_id: vehicleId,
      invoice_number: generateInvoiceNumber(),
      invoice_date: todayDateString(),
      due_date: form.pickupDate,
      subtotal: quote.vehicleTotal,
      rental_fee: quote.discountedVehicleTotal,
      protection_fee: 0,
      tax_amount: quote.taxAmount,
      service_fee: quote.serviceFee,
      security_deposit: depositCharged,
      insurance_premium: quote.insurancePremium,
      delivery_fee: quote.pickupDelivery.fee,
      extras_total: quote.extrasTotal,
      total_amount: grandTotal,
      status: "pending",
      tenant_id: tenantId,
    })
    .select("id, invoice_number")
    .single();

  if (invoiceWrite.error) {
    // v1 falls back to a purely local invoice object here. That fallback cannot
    // survive: without a DB invoice the charge RPC bills `monthly_amount` as one
    // undifferentiated "Rental" line, so the portal loses the tax/fee split it
    // needs to reconcile and refund. Fail instead.
    return writeFailed("invoice insert", describe(invoiceWrite.error));
  }

  /* ── 8. The ledger — this is what the customer is actually charged ─────── */

  const charges = await supabase.rpc("generate_first_charge_for_rental", {
    rental_id_param: rentalId,
  });
  if (charges.error) return writeFailed("charge generation", describe(charges.error));

  const topUps = await writeLedgerTopUps({
    rentalId,
    customerId,
    vehicleId,
    tenantId,
    entryDate: form.pickupDate,
    unlimited: unlimitedActive ? unlimitedTotal : 0,
    unlimitedTier: quote.unlimitedMileage.tier,
    deposit: depositCharged,
  });
  if (topUps !== null) return topUps;

  return {
    ok: true,
    booking: { rentalId, rentalNumber, customerId, reused: false },
  };
}

/* ═══════════════════════════ draft reuse ═════════════════════════════════ */

interface DraftRow {
  id: string;
  rental_number: string | null;
  start_date: string;
  end_date: string | null;
  rental_period_type: string | null;
  monthly_amount: number | string;
  pickup_location: string | null;
  pickup_location_id: string | null;
  return_location: string | null;
  return_location_id: string | null;
  delivery_fee: number | string | null;
  collection_fee: number | string | null;
  is_unlimited_mileage: boolean;
  unlimited_mileage_total: number | string | null;
  unlimited_mileage_tier: string | null;
  sms_consent: boolean;
}

/**
 * ONE string literal, deliberately not a concatenation: supabase-js derives the
 * row type from the literal, and a `+` joined string collapses to `string`,
 * which takes the whole select back to `any`.
 */
const DRAFT_COLUMNS =
  "id, rental_number, start_date, end_date, rental_period_type, monthly_amount, pickup_location, pickup_location_id, return_location, return_location_id, delivery_fee, collection_fee, is_unlimited_mileage, unlimited_mileage_total, unlimited_mileage_tier, sms_consent";

type ReuseLookup =
  | { ok: false; failure: CreateBookingResult }
  | { ok: true; draft: DraftRow | null; identical: boolean };

/**
 * Find this customer's in-flight, unpaid booking for this vehicle — if there is
 * one — and say whether it still describes what they are asking for.
 *
 * ── WHY THE DATABASE IS THE MEMORY, NOT A CLIENT STORE ──────────────────────
 * A customer who presses Continue, closes the Stripe dialog and presses it
 * again must not end up with two rentals. Holding the draft id in React state
 * would cover that one path and nothing else: a refresh, a second tab, or a
 * browser restart would all forget it, and the second attempt would then hit
 * `check_rental_overlap` against the customer's OWN abandoned draft and be told
 * the car is taken — a dead end with no way out from inside the page.
 *
 * Keying on `(tenant, vehicle, customer, status='Pending', payment_status='pending')`
 * makes the draft findable from anywhere, forever, with no extra storage. It
 * cannot collide across customers: `customer_id` is resolved from the email, so
 * two people never share one.
 *
 * ── WHAT COUNTS AS "MATERIALLY CHANGED" ─────────────────────────────────────
 * Everything this file WRITES, and nothing it does not:
 *   dates · period tier · grand total · both delivery fees · both locations
 *   (id and address) · the unlimited-mileage upgrade · the set of extras.
 * The grand total alone catches a promo, a tax change, a seasonal surcharge and
 * a deposit-policy change, because all of them move it. Extras are compared
 * ROW BY ROW as well, because swapping one $10 extra for another $10 extra
 * leaves the total untouched and the booking wrong.
 *
 * Deliberately NOT material: the driver's name, phone and SMS consent. They are
 * corrections to a person, not to a booking; they are patched onto the existing
 * rows instead of throwing away a rental over a typo in a surname.
 */
async function findReusableDraft(args: {
  tenantId: string;
  vehicleId: string;
  customerId: string;
  rentalColumns: {
    start_date: string;
    end_date: string;
    rental_period_type: string;
    monthly_amount: number;
    pickup_location: string | null;
    pickup_location_id: string | null;
    return_location: string | null;
    return_location_id: string | null;
    delivery_fee: number;
    collection_fee: number;
    is_unlimited_mileage: boolean;
    unlimited_mileage_total: number | null;
    unlimited_mileage_tier: string | null;
  };
  selectedExtras: Record<string, number>;
}): Promise<ReuseLookup> {
  const { tenantId, vehicleId, customerId, rentalColumns, selectedExtras } = args;

  const found = await supabase
    .from("rentals")
    .select(DRAFT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("customer_id", customerId)
    .eq("status", "Pending")
    .eq("payment_status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (found.error) {
    return { ok: false, failure: writeFailed("draft lookup", describe(found.error)) };
  }
  const draft: DraftRow | null = found.data;
  if (draft === null) return { ok: true, draft: null, identical: false };

  const sameShape =
    draft.start_date === rentalColumns.start_date &&
    draft.end_date === rentalColumns.end_date &&
    draft.rental_period_type === rentalColumns.rental_period_type &&
    sameMoney(money(draft.monthly_amount), rentalColumns.monthly_amount) &&
    draft.pickup_location === rentalColumns.pickup_location &&
    draft.pickup_location_id === rentalColumns.pickup_location_id &&
    draft.return_location === rentalColumns.return_location &&
    draft.return_location_id === rentalColumns.return_location_id &&
    sameMoney(money(draft.delivery_fee), rentalColumns.delivery_fee) &&
    sameMoney(money(draft.collection_fee), rentalColumns.collection_fee) &&
    draft.is_unlimited_mileage === rentalColumns.is_unlimited_mileage &&
    sameMoney(money(draft.unlimited_mileage_total), rentalColumns.unlimited_mileage_total ?? 0) &&
    (draft.unlimited_mileage_tier ?? null) === rentalColumns.unlimited_mileage_tier;

  if (!sameShape) return { ok: true, draft, identical: false };

  const existingExtras = await supabase
    .from("rental_extras_selections")
    .select("extra_id, quantity")
    .eq("rental_id", draft.id);

  if (existingExtras.error) {
    return { ok: false, failure: writeFailed("draft extras lookup", describe(existingExtras.error)) };
  }

  const before = new Map<string, number>();
  for (const row of existingExtras.data ?? []) before.set(row.extra_id, row.quantity);

  const wanted = Object.entries(selectedExtras).filter(([, qty]) => qty > 0);
  const sameExtras =
    before.size === wanted.length &&
    wanted.every(([id, qty]) => before.get(id) === qty);

  return { ok: true, draft, identical: sameExtras };
}

/* ═════════════════════ ledger lines the RPC cannot see ═══════════════════ */

/**
 * The two charges `generate_first_charge_for_rental` will never write.
 *
 * Both are in `quote.grandTotal`, so without them the ledger — which is the
 * only thing `create-booking-payment-intent` looks at — is short, and the
 * customer is charged less than the page told them. Returns null on success, or
 * the failure to hand straight back to the caller.
 *
 * Each insert is guarded by a read, matching the RPC's own `NOT EXISTS` shape,
 * so a retry against a draft that already carries them adds nothing.
 */
async function writeLedgerTopUps(args: {
  rentalId: string;
  customerId: string;
  vehicleId: string;
  tenantId: string;
  entryDate: string;
  unlimited: number;
  unlimitedTier: PricingTier;
  deposit: number;
}): Promise<CreateBookingResult | null> {
  const lines: { category: string; amount: number; reference: string | null }[] = [];

  if (args.unlimited > 0) {
    lines.push({
      category: "Unlimited Mileage",
      amount: args.unlimited,
      reference: `Unlimited mileage (${args.unlimitedTier} tier)`,
    });
  }
  if (args.deposit > 0) {
    lines.push({ category: "Security Deposit", amount: args.deposit, reference: null });
  }

  for (const line of lines) {
    const already = await supabase
      .from("ledger_entries")
      .select("id")
      .eq("rental_id", args.rentalId)
      .eq("type", "Charge")
      .eq("category", line.category)
      .eq("due_date", args.entryDate)
      .limit(1);

    if (already.error) {
      return writeFailed(`${line.category} check`, describe(already.error));
    }
    if ((already.data ?? []).length > 0) continue;

    const written = await supabase.from("ledger_entries").insert({
      customer_id: args.customerId,
      rental_id: args.rentalId,
      vehicle_id: args.vehicleId,
      tenant_id: args.tenantId,
      entry_date: args.entryDate,
      due_date: args.entryDate,
      type: "Charge",
      category: line.category,
      amount: line.amount,
      remaining_amount: line.amount,
      reference: line.reference,
    });

    if (written.error) {
      return writeFailed(`${line.category} charge`, describe(written.error));
    }
  }

  return null;
}
