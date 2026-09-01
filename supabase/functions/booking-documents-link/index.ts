// booking-documents-link
//
// The one endpoint behind the public post-payment screen: it redeems the
// DURABLE documents token, re-sends it when it has lapsed, and files the
// INSURANCE DOCUMENTS a customer uploads through it.
//
// WHY A DURABLE TOKEN — read before changing its shape.
//
// The link goes in an email, and an email is read whenever it is read. v1's
// equivalent credential was a 3-hour AI verification session with no recovery
// path (its expired screen — apps/booking/src/app/verify/[token]/page.tsx:463-477
// — reads "Please request a new verification link" and offers no button, and the
// only re-send in the product needs operator staff auth). Emailing a customer a
// 3-hour link is a broken feature.
//
// So the credential here is a row in booking_document_links: one per rental,
// UNIQUE(rental_id), seven days, and the window SLIDES on every successful visit
// and on every upload. A lapsed link is recoverable BY THE CUSTOMER through the
// `resend` action. The real ceiling is "seven days of silence", not "seven days
// from payment".
//
// ── WHAT THIS SCREEN IS, AND WHAT IT IS NOT ─────────────────────────────────
// It is an INSURANCE DOCUMENT UPLOAD. It is not identity verification: there is
// no OCR pass, no face match, and this function no longer mints an
// identity_verifications session (see the note where that used to happen).
//
// Uploading does NOT confirm the booking. `submit-insurance` writes
// documents_status = 'submitted' and insurance_status = 'uploaded' — never
// 'verified' — because an operator still reviews the documents and can still
// reject the booking. notify-booking-approved remains the only thing in the
// product that says "confirmed".
//
// ── WHY EVERY WRITE IS HERE AND NOT IN THE BROWSER ──────────────────────────
// `rentals` has RLS OFF on staging with a full anon DML grant, so a browser
// trusted to stamp its own documents_status could simply claim to have
// uploaded. `customer_documents` has RLS ON with no anon policy, so a browser
// could not file the row even if we wanted it to (an anon INSERT answers
// 401 42501). The browser puts BYTES in a bucket, under a prefix this function
// hands it; this function decides what those bytes mean.
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
import { enqueueBookingEmail } from '../_shared/email-outbox.ts';

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

/** The bucket every customer document in the product already lives in. */
const DOCUMENT_BUCKET = 'customer-documents';

/**
 * The ONLY document_type the CHECK constraint admits for this flow.
 *
 * customer_documents_document_type_check accepts exactly six strings and this
 * is the one every operator screen filters on — the /insurances list, the
 * rental page's two document queries, the analytics pages and the reminder
 * generator. Writing anything else 400s, and writing a valid-but-different type
 * would make the upload invisible to the people who have to approve it.
 */
const INSURANCE_DOCUMENT_TYPE = 'Insurance Certificate';

/** A sane ceiling. A declarations page is one to three files, never twenty. */
const MAX_INSURANCE_FILES = 12;

/**
 * Where a booking's insurance objects live.
 *
 * v1 writes `insurance/<Date.now()>-<name>` — one flat, unscoped prefix in a
 * PUBLIC bucket whose storage policies grant SELECT/INSERT/UPDATE/DELETE to the
 * `public` role. Two customers can therefore collide, and anyone holding the
 * anon key can enumerate or delete the lot. The `insurance/` root is kept so
 * everything that already greps for it still matches; the tenant and rental
 * segments are the fix. The portal's downloader strips a `customer-documents/`
 * prefix and then calls `.download(path)`, so a deeper path costs it nothing.
 */
function insurancePrefix(tenantId: string, rentalId: string): string {
  return `insurance/${tenantId}/${rentalId}`;
}

interface SubmittedFile {
  path: string;
  name: string;
  size: number | null;
  mimeType: string | null;
}

/** Read the client's file list defensively. Never trust a shape, never trust a path. */
function parseSubmittedFiles(
  value: unknown,
  prefix: string,
): { ok: true; files: SubmittedFile[] } | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, message: 'No files were sent.' };
  }
  if (value.length > MAX_INSURANCE_FILES) {
    return {
      ok: false,
      message: `Please send no more than ${MAX_INSURANCE_FILES} files at a time.`,
    };
  }

  const files: SubmittedFile[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') {
      return { ok: false, message: 'One of the files was not sent correctly.' };
    }
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';

    /*
      THE AUTHORISATION CHECK, AND THERE IS ONLY ONE.

      The token is a bearer credential and the bucket is world-writable, so a
      body could otherwise name ANY object in the bucket — another customer's
      licence scan — and have it filed against this booking under a document
      type an operator will open. Pinning the prefix to the tenant and rental
      this token resolved to is what makes that impossible. `..` is rejected
      outright rather than normalised.
    */
    if (path === '' || !path.startsWith(`${prefix}/`) || path.includes('..')) {
      return { ok: false, message: 'One of the files was not stored where we expected.' };
    }
    if (name === '') {
      return { ok: false, message: 'One of the files arrived without a name.' };
    }

    files.push({
      path,
      name,
      size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : null,
      mimeType: typeof record.mimeType === 'string' && record.mimeType !== '' ? record.mimeType : null,
    });
  }

  return { ok: true, files };
}

/**
 * "I have uploaded my insurance documents."
 *
 * ── WHY THIS IS SERVER-SIDE AT ALL ──────────────────────────────────────────
 * customer_documents has RLS ON with four policies, none of which admit `anon`
 * — an anon INSERT answers 401 42501, probed live against staging. The browser
 * physically cannot file the row, and that is the correct arrangement: `rentals`
 * has RLS OFF with a full anon DML grant, so a browser that were trusted to
 * stamp its own documents_status could simply claim to have uploaded. The
 * browser puts BYTES in a bucket; this function decides what that means.
 *
 * ── AND WHY IT VERIFIES THE OBJECTS EXIST ───────────────────────────────────
 * The body is a list of paths, which is a list of claims. Every one is checked
 * against a real `storage.objects` listing before a row is written, so a
 * fabricated body files nothing.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 * It does NOT write documents_status = 'verified' and it does NOT send an
 * approval email. Uploading is not approval: an operator still reviews these
 * and can still reject the booking, and `notify-booking-approved` remains the
 * only thing in the product that says "confirmed".
 */
async function handleSubmitInsurance(
  supabase: SupabaseClient,
  link: LinkRow,
  rental: RentalRow,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!rental.customer_id) {
    // customer_documents.customer_id is NOT NULL with an FK, while
    // rentals.customer_id is nullable. Fail with prose rather than a 23502.
    console.error('[documents-link] insurance submit on a rental with no customer:', rental.id);
    return fail(
      409,
      'no_customer',
      'We could not file these against your booking. Please get in touch and we will take it from here.',
    );
  }

  const prefix = insurancePrefix(rental.tenant_id, rental.id);
  const parsed = parseSubmittedFiles(body.files, prefix);
  if (!parsed.ok) {
    return fail(400, 'bad_files', parsed.message);
  }

  // ---- the objects have to actually be there ------------------------------
  const { data: objects, error: listError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .list(prefix, { limit: 200 });

  if (listError) {
    console.error('[documents-link] could not list uploaded objects:', listError);
    return fail(
      502,
      'storage_unavailable',
      'We could not read the files you just sent. Please try again in a moment.',
    );
  }

  const stored = new Map<string, { size: number | null; mimeType: string | null }>();
  for (const object of objects ?? []) {
    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    stored.set(object.name, {
      size: typeof metadata.size === 'number' ? metadata.size : null,
      mimeType: typeof metadata.mimetype === 'string' ? metadata.mimetype : null,
    });
  }

  const missing = parsed.files.filter((file) => !stored.has(file.path.slice(prefix.length + 1)));
  if (missing.length > 0) {
    console.error('[documents-link] submitted paths not present in storage:', missing.map((f) => f.path));
    return fail(
      409,
      'files_missing',
      'We could not find the files you sent. Please choose them again and re-send.',
    );
  }

  const nowIso = new Date().toISOString();

  // ---- what is already filed against this booking -------------------------
  /*
    A pre-read rather than an upsert, because the uniqueness that matters is a
    PARTIAL index — idx_customer_documents_unique_rental_insurance, on
    (tenant_id, rental_id, document_type, file_name) WHERE rental_id IS NOT NULL
    AND document_type = 'Insurance Certificate'. PostgREST cannot express the
    index predicate ON CONFLICT needs, so an upsert on those columns would not
    infer that index and a second `scan.pdf` — a re-upload after a rejection, or
    two phone scans with the same name — would raise 23505 and lose the whole
    batch. Matching on file_name and UPDATING is also the behaviour a customer
    expects: re-sending "policy.pdf" replaces it, it does not duplicate it.
  */
  const { data: existingRows, error: existingError } = await supabase
    .from('customer_documents')
    .select('id, file_name')
    .eq('tenant_id', rental.tenant_id)
    .eq('rental_id', rental.id)
    .eq('document_type', INSURANCE_DOCUMENT_TYPE);

  if (existingError) {
    console.error('[documents-link] could not read existing documents:', existingError);
    return fail(
      500,
      'file_failed',
      'We could not file your documents. Please try again in a moment.',
    );
  }

  const existingByName = new Map<string, string>();
  for (const row of existingRows ?? []) {
    if (typeof row.file_name === 'string') existingByName.set(row.file_name, row.id as string);
  }

  let filed = 0;
  for (const file of parsed.files) {
    const objectMeta = stored.get(file.path.slice(prefix.length + 1)) ?? { size: null, mimeType: null };
    // The bucket's own numbers win over the body's. The body is a claim.
    const size = objectMeta.size ?? file.size;
    const mimeType = objectMeta.mimeType ?? file.mimeType;

    const shared = {
      // The BARE storage path, matching what the booking app already writes.
      // The portal's downloader does file_url.replace('customer-documents/','')
      // and then .download(path); a bucket-prefixed value would survive the
      // replace only by luck, and a full public URL would 404.
      file_url: file.path,
      file_name: file.name,
      file_size: size,
      mime_type: mimeType,
      uploaded_at: nowIso,
      updated_at: nowIso,
      // 'Pending' is one of the four values the status CHECK admits and it is
      // the honest one: received, not approved. The operator's approve action
      // is what moves it to 'Active' and sets verified.
      status: 'Pending',
      verified: false,
      ai_scan_status: 'pending',
    };

    const existingId = existingByName.get(file.name);
    const { error: writeError } = existingId
      ? await supabase.from('customer_documents').update(shared).eq('id', existingId)
      : await supabase.from('customer_documents').insert({
          ...shared,
          customer_id: rental.customer_id,
          rental_id: rental.id,
          tenant_id: rental.tenant_id,
          document_type: INSURANCE_DOCUMENT_TYPE,
          document_name: file.name,
        });

    if (writeError) {
      console.error('[documents-link] could not file document:', file.path, writeError);
      return fail(
        500,
        'file_failed',
        'We stored your files but could not attach them to your booking. Please try sending them again.',
      );
    }
    filed += 1;
  }

  // ---- move the booking on -------------------------------------------------
  /*
    'submitted', NOT 'verified'. The documents_status CHECK admits
    ['not_required','pending','submitted','verified','rejected'], and 'verified'
    is what booking-documents-link's own already_complete gate reads — claiming
    it here would tell a returning customer their documents had been CHECKED
    when nobody has looked at them. insurance_status 'uploaded' is the matching
    value on its own CHECK; 'verified' there is likewise the operator's to set.

    Filtered so a booking an operator has already verified cannot be knocked
    back by a late re-send. (Step 2 above already 409s that case; this is the
    same guarantee expressed where the write happens.)
  */
  const { error: stampError } = await supabase
    .from('rentals')
    .update({
      documents_status: 'submitted',
      documents_completed_at: nowIso,
      insurance_status: 'uploaded',
      updated_at: nowIso,
    })
    .eq('id', rental.id)
    .neq('documents_status', 'verified');

  if (stampError) {
    // The rows are filed and the operator can see them, so this is not fatal to
    // the customer — but it IS the thing that takes the booking off the
    // "waiting for documents" list, so it is logged loudly.
    console.error('[documents-link] could not stamp rental after insurance upload:', stampError);
  }

  // ---- tell them, once -----------------------------------------------------
  /*
    The CANONICAL outbox key, so a customer who sends a second batch does not
    get a second "we have your documents" email. Deliberately different from the
    resend path, which needs its own row per press.
  */
  await enqueueBookingEmail(supabase, {
    tenantId: rental.tenant_id,
    rentalId: rental.id,
    emailKey: 'booking_documents_received',
    payload: { documents: filed },
  });

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
    console.warn('[documents-link] inline sweep skipped after insurance upload:', error);
  }

  // Slide the window: a customer who has just engaged never loses their link,
  // and they may well come back to add a page they missed.
  await supabase
    .from('booking_document_links')
    .update({
      expires_at: new Date(Date.now() + DOCUMENTS_LINK_TTL_MS).toISOString(),
      updated_at: nowIso,
    })
    .eq('token', link.token);

  return jsonResponse({
    ok: true,
    submitted: filed,
    documentsStatus: 'submitted',
    insuranceStatus: 'uploaded',
  });
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
    const action =
      body.action === 'resend'
        ? 'resend'
        : body.action === 'submit-insurance'
          ? 'submit-insurance'
          : 'open';
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
          'documents_status, status, payment_status, ' +
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

    // ---- The submit action -------------------------------------------------
    // AFTER the expiry check, unlike `resend`: re-sending an expired link is the
    // whole point of that action, whereas accepting an upload through a dead
    // link would be accepting one from a credential that is supposed to be over.
    if (action === 'submit-insurance') {
      return await handleSubmitInsurance(supabase, link, rental, body);
    }

    /*
      THE AI IDENTITY SESSION MINT USED TO LIVE HERE, AND IT IS GONE ON PURPOSE.

      This screen is an INSURANCE DOCUMENT UPLOAD. There is no OCR pass and no
      face match, so there was nothing left for an identity_verifications row to
      be the key of — and minting one on every open was not free:

        * create-ai-verification-session caps a customer at 10 sessions per hour
          and answers a plain 400 past that, so a customer refreshing the page
          could lock themselves out of their own paid booking;
        * its customerId branch also sets
          customers.identity_verification_status = 'pending', which for an
          insurance upload is simply not true; and
        * it repointed rentals.identity_verification_session_id, a column whose
          only consumer (process-ai-verification) this flow no longer calls.

      What replaced it is `uploadPrefix` below: a tenant- and rental-scoped
      storage prefix, derived server-side, which is the only place this token's
      holder is allowed to put bytes. If identity capture ever comes back it
      belongs behind its own token action, not stapled to every page open —
      see the note in the report accompanying this change.
    */
    const nowIso = new Date().toISOString();

    const { data: stamped } = await supabase
      .from('rentals')
      .update({ documents_status: 'pending', updated_at: nowIso })
      .eq('id', rental.id)
      .in('documents_status', RESTAMPABLE_DOCUMENT_STATUSES)
      .select('documents_status');
    const documentsStatus =
      stamped && stamped.length > 0 ? 'pending' : (rental.documents_status ?? 'pending');

    // ---- 4. Slide the link window ------------------------------------------
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
      /*
        The ONLY prefix this token may write to, and the one the submit action
        pins every claimed path against. Handed to the browser rather than
        derived there, because a browser-derived prefix is a browser-chosen
        prefix.
      */
      uploadPrefix: insurancePrefix(rental.tenant_id, rental.id),
      bucket: DOCUMENT_BUCKET,
      expiresAt: new Date(Date.now() + DOCUMENTS_LINK_TTL_MS).toISOString(),
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
