// sweep-booking-emails — the drain half of the booking email outbox.
//
// The webhook only ever WRITES rows (one DB statement, no HTTP, so it can never
// push a Stripe delivery near the ~30s abandon threshold that manufactures
// retries). This function is what actually sends them, and it is called from
// two places:
//
//   * inline, best-effort, by booking-settlement.ts and booking-documents-link,
//     purely so the customer sees the email in seconds rather than at the next
//     sweep. A timeout there is HARMLESS — the row is still queued.
//   * (later) by pg_cron, which is the actual delivery guarantee.
//
// It never throws out of the handler and never returns a non-200 for a send
// failure: a failure is data (the row parks at 'failed' and is re-drained), not
// an exception for the caller to handle.
//
// AUTH: verify_jwt stays TRUE — do NOT add this function to supabase/config.toml.
// Both callers carry the service-role bearer. Nothing anonymous should be able
// to make us send mail.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  claimBookingEmail,
  markBookingEmailSent,
  markBookingEmailFailed,
  type BookingEmailRow,
} from '../_shared/email-outbox.ts';
import { resolveEmailData, renderEmail } from '../_shared/email-template-service.ts';
import { sendResendEmail } from '../_shared/resend-service.ts';

/** How long a row may sit at 'sending' before we assume its worker died. Must
 *  match the default in claimBookingEmail, or the SELECT and the CAS disagree
 *  and rows are picked up only to fail the claim. */
const STALE_CLAIM_MS = 300_000;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** The rental embed notify-booking-pending needs. Copied byte-for-byte from the
 *  shape booking-settlement.ts used inline before the outbox, so the payload
 *  that function receives is unchanged and v1's expectations still hold. */
interface RentalNotificationRow {
  id: string;
  start_date: string;
  end_date: string;
  monthly_amount: number | null;
  tenant_id: string | null;
  customer: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; make: string | null; model: string | null; reg: string | null } | null;
}

type DispatchResult = { ok: true; providerMessageId: string | null } | { ok: false; error: string };

/**
 * 'booking_pending' — REUSE notify-booking-pending, unedited.
 *
 * That function sends the customer email, the customer SMS, the gated operator
 * email and the operator bell, and dedupes per rental on its own. v1's live
 * hosted-checkout path still depends on it exactly as it is, so the CALL moved
 * behind the outbox and the FUNCTION did not change.
 *
 * The Authorization header is mandatory: notify-booking-pending is
 * verify_jwt=true, and a missing bearer 401s at the gateway — silently, from our
 * point of view, since we would just see a non-ok response body we did not write.
 */
async function dispatchBookingPending(
  supabase: SupabaseClient,
  row: BookingEmailRow,
): Promise<DispatchResult> {
  const { data: rentalRow, error: rentalError } = await supabase
    .from('rentals')
    .select(`
      id,
      start_date,
      end_date,
      monthly_amount,
      tenant_id,
      customer:customers(id, name, email, phone),
      vehicle:vehicles(id, make, model, reg)
    `)
    .eq('id', row.rental_id)
    .maybeSingle();

  if (rentalError) return { ok: false, error: `rental lookup failed: ${rentalError.message}` };

  // The to-one embeds really are objects at runtime; supabase-js widens every
  // embed to an array when the client carries no Database generic.
  const rental = rentalRow as unknown as RentalNotificationRow | null;
  if (!rental) return { ok: false, error: 'rental not found' };
  if (!rental.customer || !rental.vehicle) {
    return { ok: false, error: 'rental has no customer or no vehicle' };
  }

  // notify-booking-pending declares paymentId as required but never reads it
  // beyond its interface, so a best-effort lookup is enough and a miss is not
  // worth failing a send over.
  const { data: paymentRow } = await supabase
    .from('payments')
    .select('id')
    .eq('rental_id', row.rental_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const vehicleName = rental.vehicle.make && rental.vehicle.model
    ? `${rental.vehicle.make} ${rental.vehicle.model}`
    : rental.vehicle.reg;

  const notificationData = {
    paymentId: paymentRow?.id ?? null,
    rentalId: rental.id,
    tenantId: rental.tenant_id,
    customerId: rental.customer.id,
    customerName: rental.customer.name,
    customerEmail: rental.customer.email,
    customerPhone: rental.customer.phone,
    vehicleName,
    vehicleMake: rental.vehicle.make,
    vehicleModel: rental.vehicle.model,
    vehicleReg: rental.vehicle.reg,
    pickupDate: new Date(rental.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    returnDate: new Date(rental.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    amount: rental.monthly_amount || 0,
    bookingRef: rental.id.substring(0, 8).toUpperCase(),
    paymentMode: 'auto',
  };

  try {
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-booking-pending`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify(notificationData),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, error: `notify-booking-pending ${response.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true, providerMessageId: null };
  } catch (error) {
    return { ok: false, error: `notify-booking-pending unreachable: ${String(error)}` };
  }
}

/**
 * The two document emails, both through the house template pipeline.
 *
 * sendResendEmail, NOT the 5-arg sendEmail wrapper: only the former forwards
 * Resend's Idempotency-Key header (resend-service.ts:364-371; the wrapper at
 * :405-418 cannot). That is the SECOND layer of dedupe, valid 24h at the
 * provider — so even a torn claim cannot put two copies in an inbox.
 *
 * The idempotency key we hand Resend is the row's own, which is why the resend
 * path's ':resend:<minute>' suffix matters: an intentional re-send must NOT
 * collide with the original at the provider.
 */
async function dispatchDocumentsEmail(
  supabase: SupabaseClient,
  row: BookingEmailRow,
): Promise<DispatchResult> {
  const uploadUrl = String(row.payload?.upload_url ?? '');

  // A documents email whose link is blank is worse than no email: it tells a
  // paying customer to act and gives them nothing to act on. Park it as failed
  // with a legible reason instead.
  if (row.email_key === 'booking_documents_required' && uploadUrl === '') {
    return { ok: false, error: 'payload.upload_url is empty — refusing to send a link-less documents email' };
  }

  const data = await resolveEmailData(supabase, {
    rentalId: row.rental_id,
    tenantId: row.tenant_id,
    // replaceTemplateVariables (email-template-service.ts:820-836) interpolates
    // RAW — no HTML escaping — and then strips any surviving {{...}}. This URL is
    // a server-generated token URL, so it is safe. NEVER route customer-supplied
    // text through here.
    overrides: { verification_url: uploadUrl },
  });

  if (!data.customer_email) return { ok: false, error: 'no customer email on rental' };

  const { subject, html } = await renderEmail(supabase, row.tenant_id, row.email_key, data);

  // AN EMPTY SUBJECT IS THE SIGNATURE OF AN UNKNOWN TEMPLATE KEY.
  // getEmailTemplate fails SILENTLY on a key it does not know
  // (email-template-service.ts:808-819): it returns { subject:'', content:'' }
  // and only console.errors. renderEmail then wraps that empty content in the
  // branded shell, so `html` is NOT empty and cannot be the check — every tenant
  // without a custom row would receive a blank, branded email and the outbox
  // would record it as 'sent'. Refuse instead, and park it as failed so the
  // reason is visible in last_error rather than in a log nobody reads.
  if (!subject.trim()) {
    return {
      ok: false,
      error: `template '${row.email_key}' rendered an empty subject — the key is missing from DEFAULT_EMAIL_TEMPLATES`,
    };
  }

  const result = await sendResendEmail(
    {
      to: data.customer_email,
      subject,
      html,
      tenantId: row.tenant_id,
      idempotencyKey: row.idempotency_key,
    },
    supabase,
  );

  if (!result.success) return { ok: false, error: result.error ?? 'resend reported failure' };
  return { ok: true, providerMessageId: result.messageId ?? null };
}

async function dispatch(supabase: SupabaseClient, row: BookingEmailRow): Promise<DispatchResult> {
  switch (row.email_key) {
    case 'booking_pending':
      return await dispatchBookingPending(supabase, row);
    case 'booking_documents_required':
    case 'booking_documents_received':
      return await dispatchDocumentsEmail(supabase, row);
    default:
      // An unknown key can only mean a row written by code newer than this
      // deploy. Park it — do not drop it, and do not guess a template.
      return { ok: false, error: `unknown email_key: ${row.email_key}` };
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // An empty body is a valid "drain everything" call, e.g. from cron.
      body = {};
    }

    const rentalId = typeof body.rentalId === 'string' && body.rentalId.trim() !== ''
      ? body.rentalId.trim()
      : null;
    const requested = Number(body.limit);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

    let query = supabase
      .from('booking_email_dispatch')
      .select('*')
      // Drainable = never attempted, previously failed, or abandoned mid-flight.
      // 'sent' and 'suppressed' are terminal and are not selected at all.
      .or(`status.in.(pending,failed),and(status.eq.sending,claimed_at.lt.${staleCutoff})`)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (rentalId) query = query.eq('rental_id', rentalId);

    const { data: rows, error: selectError } = await query;
    if (selectError) {
      console.error('[sweep-booking-emails] could not read the outbox:', selectError);
      return errorResponse('Could not read the email outbox', 500);
    }

    let swept = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const candidate of (rows ?? []) as BookingEmailRow[]) {
      swept += 1;

      // Re-assert ownership. The SELECT above is only a shortlist; THIS is the
      // compare-and-swap that decides. Two sweepers racing on one row — the
      // inline drain and a cron pass, say — means exactly one gets a row back.
      const claimed = await claimBookingEmail(supabase, candidate.idempotency_key, STALE_CLAIM_MS);
      if (!claimed) {
        skipped += 1;
        continue;
      }

      let result: DispatchResult;
      try {
        result = await dispatch(supabase, claimed);
      } catch (error) {
        result = { ok: false, error: `dispatch threw: ${String(error)}` };
      }

      if (result.ok) {
        await markBookingEmailSent(supabase, claimed.idempotency_key, result.providerMessageId);
        sent += 1;
        console.log('[sweep-booking-emails] sent', claimed.idempotency_key);
      } else {
        await markBookingEmailFailed(supabase, claimed.idempotency_key, result.error);
        failed += 1;
        console.error('[sweep-booking-emails] failed', claimed.idempotency_key, result.error);
      }
    }

    return jsonResponse({ swept, sent, failed, skipped });
  } catch (error) {
    // Never throw out of the handler: the caller is a webhook that has already
    // taken money, or a cron job. Neither should see a 500 for a send problem.
    console.error('[sweep-booking-emails] unhandled error:', error);
    return jsonResponse({ swept: 0, sent: 0, failed: 0, skipped: 0, error: 'sweep_failed' });
  }
});
