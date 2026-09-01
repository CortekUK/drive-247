// booking-documents-link
//
// Redeems the DURABLE post-payment documents token into a PERISHABLE AI
// verification session, and is the only surface the public upload page talks to.
//
// WHY THIS FUNCTION EXISTS AT ALL — read before changing its shape.
//
// The AI verification session is hardcoded to a 3-hour TTL, twice
// (create-ai-verification-session/index.ts:133 and :219), enforced in exactly one
// place (validate-ai-session/index.ts:83-94, HTTP 410) and with no recovery path:
// v1's expired screen (apps/booking/src/app/verify/[token]/page.tsx:463-477) just
// reads "Please request a new verification link" and offers no button, and the
// only re-send in the product needs operator staff auth
// (send-additional-driver-invite/index.ts:88-102). Emailing a customer a 3-hour
// link is therefore a broken feature.
//
// The fix is a split credential. The DURABLE token (booking_document_links, one
// row per rental, UNIQUE(rental_id)) is what goes in the email. The perishable
// 3-hour session is minted HERE, on arrival, and never leaves the building. A
// customer who opens the email on day six gets a session that is three hours old,
// not a link that expired five and a half days ago.
//
// Do NOT call validate-ai-session from this path. This function already returns
// everything validate-ai-session would, and validate-ai-session's own 410 is the
// precise failure mode we are routing around. It stays untouched for v1's QR flow.
//
// AUTH: verify_jwt stays TRUE (the default — do not add this function to
// supabase/config.toml). The browser calls it with the public anon key, which
// satisfies the gateway. The REAL credential is the durable token in the body,
// which is why every lookup below is keyed on it and why the client is
// service-role: booking_document_links has RLS on with deliberately ZERO
// policies, so only service_role can read it.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { deriveBookingOrigin, buildDocumentsUrl } from '../_shared/booking-origin.ts';

/**
 * How long a documents link stays usable.
 *
 * SEVEN days, not thirty — an explicit product decision. The link is a bearer
 * credential for a paid booking, so its lifetime is its exposure. The window
 * SLIDES on every successful visit (step 7 below) and an expired link can be
 * re-sent (the `resend` action), so the real ceiling is "seven days of silence",
 * not "seven days from payment".
 *
 * Kept in step with DOCUMENTS_LINK_TTL_MS in create-booking-payment-intent/index.ts.
 */
const DOCUMENTS_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Ceiling on "email me a new link" presses, per rental per hour.
 *
 * Whoever holds the token can press that button, and the email goes to the
 * customer, not to the presser — so without a cap a leaked token is a mail-bomb
 * against the customer. Five is generous for a real person and useless for abuse.
 */
const MAX_RESENDS_PER_HOUR = 5;

/** rentals.status values that mean the booking is gone. Do not invite an upload. */
const DEAD_RENTAL_STATUSES = new Set(['Cancelled', 'Rejected']);

/**
 * rentals.documents_status values this function is allowed to move to 'pending'.
 *
 * Deliberately NOT 'submitted' or 'verified': a customer refreshing the page
 * after a successful upload must not knock their own booking back a step. The
 * list is applied as a FILTER on the UPDATE, not read-then-written, so it is
 * atomic against process-ai-verification writing the verdict at the same moment.
 */
const RESTAMPABLE_DOCUMENT_STATUSES = ['not_required', 'rejected'];

interface LinkRow {
  id: string;
  tenant_id: string;
  rental_id: string;
  token: string;
  expires_at: string;
  consumed_at: string | null;
}

interface RentalRow {
  id: string;
  rental_number: string | null;
  start_date: string | null;
  end_date: string | null;
  tenant_id: string;
  customer_id: string | null;
  documents_status: string | null;
  identity_verification_session_id: string | null;
  status: string | null;
  payment_status: string | null;
  vehicle: { make: string | null; model: string | null } | null;
}

/** A failure the page is expected to render as its own screen, not as an error. */
function fail(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return jsonResponse({ ok: false, code, error: message, ...(extra ?? {}) }, status);
}

function vehicleLabel(vehicle: RentalRow['vehicle']): string | null {
  if (!vehicle) return null;
  const label = [vehicle.make, vehicle.model].filter(Boolean).join(' ').trim();
  return label === '' ? null : label;
}

/**
 * Reuse an unexpired session rather than minting another.
 *
 * THIS IS THE RATE-LIMIT DEFENCE. create-ai-verification-session caps a customer
 * at 10 sessions per hour (index.ts:53-91) and answers a plain 400 past that, so
 * a customer who refreshes the upload page eleven times would otherwise lock
 * themselves out of their own booking for an hour.
 *
 * `.limit(1).maybeSingle()` rather than `.single()`: identity_verifications.session_id
 * carries no uniqueness constraint, and `.single()` on a duplicate throws — the
 * same latent fragility process-ai-verification/index.ts:115-119 already lives with.
 */
async function findReusableSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ sessionId: string; qrToken: string; expiresAt: string } | null> {
  const { data, error } = await supabase
    .from('identity_verifications')
    .select('id, session_id, qr_session_token, qr_session_expires_at, status')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[documents-link] could not read existing verification:', error);
    return null;
  }
  if (!data) return null;

  // process-ai-verification nulls qr_session_token when it completes
  // (index.ts:275), so a completed session fails the token check anyway — the
  // status check is belt and braces, and it is cheap.
  if (data.status === 'completed') return null;
  if (!data.qr_session_token) return null;
  if (!data.qr_session_expires_at) return null;
  if (new Date(data.qr_session_expires_at).getTime() <= Date.now()) return null;

  return {
    sessionId,
    qrToken: data.qr_session_token as string,
    expiresAt: data.qr_session_expires_at as string,
  };
}

/**
 * Mint a fresh AI verification session for this rental's customer.
 *
 * USE THE customerId BRANCH, NOT customerDetails. Its rate-limit filter is
 * `.eq('customer_id', customerId)` (create-ai-verification-session/index.ts:66-67);
 * the customerDetails branch filters with
 * `.like('external_user_id', '%'+email+'%')` (:69-73), where '_' is a single-char
 * LIKE wildcard, so one customer's attempts can be counted against another's.
 *
 * The returned `qrUrl` is IGNORED on purpose: buildQRUrl (:44-48) builds it from
 * BOOKING_APP_URL or `{slug}.drive-247.com`, which on staging points at v1
 * PRODUCTION. Only sessionId / qrToken / expiresAt are taken.
 *
 * KNOWN AND ACCEPTED SIDE EFFECT: that branch also sets
 * customers.identity_verification_status = 'pending' (:167-171). It is true at
 * this moment — the customer has just been sent to upload — and
 * process-ai-verification mirrors the final verdict back over it (:314-335).
 */
async function mintSession(
  customerId: string,
  tenantId: string,
  tenantSlug: string,
): Promise<
  | { ok: true; sessionId: string; qrToken: string; expiresAt: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  let payload: Record<string, unknown> = {};
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/create-ai-verification-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ customerId, tenantId, tenantSlug }),
      signal: AbortSignal.timeout(15000),
    });
    payload = await response.json();
  } catch (error) {
    console.error('[documents-link] create-ai-verification-session unreachable:', error);
    return {
      ok: false,
      status: 502,
      code: 'session_mint_failed',
      message: 'We could not start the document check. Please try again in a moment.',
    };
  }

  if (payload?.ok === true && payload.sessionId && payload.qrToken && payload.expiresAt) {
    return {
      ok: true,
      sessionId: String(payload.sessionId),
      qrToken: String(payload.qrToken),
      expiresAt: String(payload.expiresAt),
    };
  }

  // The rate limiter answers a plain 400 with a prose message, so it has to be
  // recognised by its text. Surfacing it as 429 lets the page say "wait an
  // hour" instead of "something went wrong".
  const detail = String(payload?.error ?? payload?.detail ?? 'unknown error');
  console.error('[documents-link] session mint refused:', detail);
  if (/too many/i.test(detail)) {
    return {
      ok: false,
      status: 429,
      code: 'session_rate_limited',
      message: 'Too many document check attempts. Please try again in an hour.',
    };
  }
  return {
    ok: false,
    status: 502,
    code: 'session_mint_failed',
    message: 'We could not start the document check. Please try again in a moment.',
  };
}

/**
 * "Email me a new link."
 *
 * Required behaviour, not a nicety: an expired link must be recoverable by the
 * customer alone, because every other re-send path in the product needs operator
 * staff auth.
 *
 * It works by writing a row into the SAME outbox the settlement path uses, so
 * the send, the retry and the provider-level dedupe are all inherited — but with
 * a DELIBERATELY NON-CANONICAL idempotency key. The canonical key is
 * `booking_documents_required:<rentalId>` (email-outbox.ts `outboxKey`); reusing
 * it would be swallowed by that row's UNIQUE constraint and nothing would send,
 * and REWRITING that row would break the duplicate defence against a Stripe
 * webhook redelivery. So a resend gets its own row, keyed to the minute — which
 * is also what makes a double-click send exactly one email, since the second
 * insert loses to the unique index.
 */
async function handleResend(
  supabase: SupabaseClient,
  link: LinkRow,
  rental: RentalRow,
  tenantSlug: string | null,
  req: Request,
): Promise<Response> {
  // The email this queues states plainly that PAYMENT HAS BEEN RECEIVED, so it
  // must not be sent for a booking that has not been paid or has been refunded.
  //
  // Note the deliberate asymmetry with the OPEN path, which does NOT check this:
  // the browser is routed to the upload screen the instant Stripe reports
  // success, which is BEFORE the webhook has flipped payment_status to
  // 'fulfilled'. Blocking there would break the primary flow on a race. Nothing
  // races here — a link only expires after seven days of silence, long after
  // settlement.
  if (rental.payment_status !== 'fulfilled') {
    return fail(
      409,
      'not_paid',
      'We have no completed payment on this booking, so there is nothing to send yet. Please get in touch if that is unexpected.',
      { canResend: false },
    );
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { count: recentResends } = await supabase
    .from('booking_email_dispatch')
    .select('id', { count: 'exact', head: true })
    .eq('rental_id', rental.id)
    .eq('email_key', 'booking_documents_required')
    .like('idempotency_key', '%:resend:%')
    .gte('created_at', new Date(nowMs - 60 * 60 * 1000).toISOString());

  if ((recentResends ?? 0) >= MAX_RESENDS_PER_HOUR) {
    return fail(
      429,
      'resend_rate_limited',
      'We have already sent several links in the last hour. Please check your inbox and spam folder, then try again later.',
    );
  }

  // Slide the window FIRST. If the enqueue or the sweep fails, the customer
  // still has a link that works when they click the one already in their inbox.
  const expiresAt = new Date(nowMs + DOCUMENTS_LINK_TTL_MS).toISOString();
  const { error: slideError } = await supabase
    .from('booking_document_links')
    .update({ expires_at: expiresAt, updated_at: nowIso })
    .eq('token', link.token);
  if (slideError) {
    console.error('[documents-link] could not extend link on resend:', slideError);
    return fail(500, 'resend_failed', 'We could not send a new link. Please try again in a moment.');
  }

  const uploadUrl = buildDocumentsUrl(deriveBookingOrigin(tenantSlug, req), link.token);
  // Bucketed to the minute: a double-click collides on UNIQUE(idempotency_key)
  // and inserts nothing, so it cannot send twice.
  const minuteBucket = Math.floor(nowMs / 60000);
  const idempotencyKey = `booking_documents_required:${rental.id}:resend:${minuteBucket}`;

  const { error: enqueueError } = await supabase
    .from('booking_email_dispatch')
    .upsert(
      {
        tenant_id: rental.tenant_id,
        rental_id: rental.id,
        email_key: 'booking_documents_required',
        idempotency_key: idempotencyKey,
        payload: { upload_url: uploadUrl, resend: true },
        // No trigger maintains updated_at on this table, so writers set it.
        updated_at: nowIso,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
  if (enqueueError) {
    console.error('[documents-link] resend enqueue failed:', enqueueError);
    return fail(500, 'resend_failed', 'We could not send a new link. Please try again in a moment.');
  }

  // Best-effort inline drain so the customer sees the email in seconds rather
  // than at the next sweep. The outbox row is the guarantee; this is latency
  // only, so a timeout here is harmless.
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sweep-booking-emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ rentalId: rental.id }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.warn('[documents-link] inline sweep skipped:', error);
  }

  return jsonResponse({ ok: true, resent: true, expiresAt });
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return fail(400, 'bad_request', 'A JSON body with a token is required.');
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const action = body.action === 'resend' ? 'resend' : 'open';
    if (token === '') {
      return fail(400, 'bad_request', 'A token is required.');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // ---- 1. The token ------------------------------------------------------
    const { data: linkRow, error: linkError } = await supabase
      .from('booking_document_links')
      .select('id, tenant_id, rental_id, token, expires_at, consumed_at')
      .eq('token', token)
      .maybeSingle();

    if (linkError) {
      console.error('[documents-link] link lookup failed:', linkError);
      return fail(500, 'lookup_failed', 'We could not open this link. Please try again in a moment.');
    }
    if (!linkRow) {
      return fail(404, 'invalid_token', 'This link is not valid.');
    }
    const link = linkRow as LinkRow;
    const expired = new Date(link.expires_at).getTime() <= Date.now();

    // ---- 2. The rental -----------------------------------------------------
    const { data: rentalRow, error: rentalError } = await supabase
      .from('rentals')
      .select(
        'id, rental_number, start_date, end_date, tenant_id, customer_id, ' +
          'documents_status, identity_verification_session_id, status, payment_status, ' +
          'vehicle:vehicles(make, model)',
      )
      .eq('id', link.rental_id)
      .maybeSingle();

    if (rentalError || !rentalRow) {
      console.error('[documents-link] rental lookup failed:', rentalError);
      return fail(404, 'invalid_token', 'This link is not valid.');
    }
    // The embed is to-ONE (rentals.vehicle_id), so PostgREST returns an object.
    // The cast states that; supabase-js widens every embed to an array when the
    // client carries no Database generic.
    const rental = rentalRow as unknown as RentalRow;

    // A booking that is gone must never invite an upload — not on the open path
    // and not on the resend path, which would otherwise email a live-looking
    // link for a dead booking. `canResend: false` tells the page to render this
    // WITHOUT the "email me a new link" button.
    if (DEAD_RENTAL_STATUSES.has(String(rental.status))) {
      return fail(
        410,
        'booking_cancelled',
        'This booking is no longer active, so there is nothing to upload. Please get in touch if that is unexpected.',
        { canResend: false },
      );
    }

    if (rental.documents_status === 'verified') {
      return fail(409, 'already_complete', 'Your documents have already been checked.', {
        documentsStatus: 'verified',
      });
    }

    // ---- 3. The tenant, for branding --------------------------------------
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('slug, company_name, logo_url')
      .eq('id', rental.tenant_id)
      .maybeSingle();
    const tenantSlug: string | null = (tenantRow?.slug as string | null) ?? null;

    // ---- The resend action -------------------------------------------------
    // Handled AFTER the cancelled/verified guards and BEFORE the expiry check,
    // because re-sending an EXPIRED link is the entire point of the action.
    if (action === 'resend') {
      return await handleResend(supabase, link, rental, tenantSlug, req);
    }

    if (expired) {
      // Not a dead end: `canResend` is what the page uses to render a working
      // "email me a new link" button, which posts back here with action:'resend'.
      return fail(410, 'link_expired', 'This link has expired.', { canResend: true });
    }

    // ---- 4. Reuse an unexpired session before minting another --------------
    let session: { sessionId: string; qrToken: string; expiresAt: string } | null = null;
    let minted = false;
    if (rental.identity_verification_session_id) {
      session = await findReusableSession(supabase, rental.identity_verification_session_id);
    }

    // ---- 5. Otherwise mint a fresh one -------------------------------------
    if (!session) {
      if (!rental.customer_id) {
        // The customerId branch is the only one safe to use here (see mintSession),
        // and it needs a customer row. Every rental this flow creates has one.
        console.error('[documents-link] rental has no customer_id:', rental.id);
        return fail(
          409,
          'no_customer',
          'We could not start the document check for this booking. Please get in touch.',
        );
      }
      if (!tenantSlug) {
        // create-ai-verification-session hard-requires tenantSlug (index.ts:294-299).
        console.error('[documents-link] tenant has no slug:', rental.tenant_id);
        return fail(500, 'session_mint_failed', 'We could not start the document check.');
      }
      const result = await mintSession(rental.customer_id, rental.tenant_id, tenantSlug);
      if (!result.ok) {
        return fail(result.status, result.code, result.message);
      }
      session = { sessionId: result.sessionId, qrToken: result.qrToken, expiresAt: result.expiresAt };
      minted = true;
    }

    const nowIso = new Date().toISOString();

    // ---- 6. Stamp the rental -----------------------------------------------
    // Two statements on purpose: the session pointer and the documents_status
    // move have different safety conditions, and neither may clobber the other.
    if (minted) {
      // COMPARE-AND-SWAP, not a blind write. rentals.identity_verification_session_id
      // is the ONLY thing that connects an upload back to this booking
      // (process-ai-verification filters on it), and it holds exactly one value.
      // Two concurrent opens — two tabs, a phone and a laptop, a double-fetch —
      // would each mint a session and the second blind write would orphan the
      // first. Whichever customer then uploaded through the losing tab would
      // match ZERO rows in the gate and their PAID booking would sit at
      // 'pending' forever, with nothing in the product to catch it.
      const previous = rental.identity_verification_session_id;
      const { data: stampedRows, error: stampError } = await supabase
        .from('rentals')
        .update({ identity_verification_session_id: session.sessionId, updated_at: nowIso })
        .eq('id', rental.id)
        .or(
          previous
            ? `identity_verification_session_id.is.null,identity_verification_session_id.eq.${previous}`
            : 'identity_verification_session_id.is.null',
        )
        .select('id');

      if (stampError) {
        console.error('[documents-link] could not stamp session on rental:', stampError);
      } else if (!stampedRows || stampedRows.length === 0) {
        // We lost the swap. Adopt the winner's session and let ours be an
        // orphaned identity_verifications row — unused rows are harmless, a
        // rental pointing at the wrong session is not.
        const { data: fresh } = await supabase
          .from('rentals')
          .select('identity_verification_session_id')
          .eq('id', rental.id)
          .maybeSingle();
        const winner = (fresh?.identity_verification_session_id as string | null) ?? null;
        const winnerSession = winner ? await findReusableSession(supabase, winner) : null;
        if (winnerSession) {
          console.log('[documents-link] lost the session swap, adopting', winner);
          session = winnerSession;
        } else {
          // The winner's session is not usable either, so nothing is lost by
          // forcing ours on. Without this the rental would point at a dead
          // session and the gate could never fire.
          console.warn('[documents-link] lost the swap to an unusable session, forcing ours on');
          await supabase
            .from('rentals')
            .update({ identity_verification_session_id: session.sessionId, updated_at: nowIso })
            .eq('id', rental.id);
        }
      }
    }

    const { data: stamped } = await supabase
      .from('rentals')
      .update({ documents_status: 'pending', updated_at: nowIso })
      .eq('id', rental.id)
      .in('documents_status', RESTAMPABLE_DOCUMENT_STATUSES)
      .select('documents_status');
    const documentsStatus =
      stamped && stamped.length > 0 ? 'pending' : (rental.documents_status ?? 'pending');

    // ---- 7. Slide the link window ------------------------------------------
    // A customer who keeps engaging never loses their link. Best-effort: failing
    // to extend must not deny a customer who is standing in front of us.
    const { error: slideError } = await supabase
      .from('booking_document_links')
      .update({
        expires_at: new Date(Date.now() + DOCUMENTS_LINK_TTL_MS).toISOString(),
        updated_at: nowIso,
      })
      .eq('token', token);
    if (slideError) console.error('[documents-link] could not extend link window:', slideError);

    return jsonResponse({
      ok: true,
      sessionId: session.sessionId,
      qrToken: session.qrToken,
      expiresAt: session.expiresAt,
      rental: {
        rentalNumber: rental.rental_number,
        startDate: rental.start_date,
        endDate: rental.end_date,
        vehicleLabel: vehicleLabel(rental.vehicle),
      },
      tenant: {
        slug: tenantSlug,
        companyName: (tenantRow?.company_name as string | null) ?? null,
        logoUrl: (tenantRow?.logo_url as string | null) ?? null,
      },
      documentsStatus,
    });
  } catch (error) {
    console.error('[documents-link] unhandled error:', error);
    return fail(500, 'unexpected', 'We could not open this link. Please try again in a moment.');
  }
});
