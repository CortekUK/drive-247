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
// ── WHAT THIS SCREEN IS: TWO STEPS, TWO STATUSES ────────────────────────────
// The post-payment errand is v1's: the customer sends their IDENTITY DOCUMENTS
// (licence front, licence back, a selfie) *and* their INSURANCE CERTIFICATE.
// They are two steps here, not one widget, because they are genuinely different
// shapes — a licence is photographed, an insurance certificate is a PDF already
// sitting in an inbox — and because they end in different kinds of answer.
//
// They therefore keep SEPARATE STATE, and that separation is load-bearing:
//
//   identity  -> booking_document_links.identity_status  ('pending' ->
//                'submitted' | 'rejected'), written only by `submit-identity`
//   insurance -> rentals.documents_status / insurance_status, written only by
//                `submit-insurance`
//
// One column with two writers is how a rejected licence photo ends up rendering
// "we could not read your documents" over a perfectly good insurance PDF the
// customer sent five minutes earlier. The screen requires both to be in before
// it says it has everything.
//
// Neither step CONFIRMS the booking. `submit-insurance` writes
// documents_status = 'submitted' and insurance_status = 'uploaded' — never
// 'verified' — and `submit-identity` writes at most 'submitted', because an
// operator still reviews all of it and can still reject the booking.
// notify-booking-approved remains the only thing in the product that says
// "confirmed".
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
  /**
   * The identity step's own state, kept HERE and nowhere else.
   *
   * booking_document_links has RLS ON with zero policies and no anon grant of
   * any kind (probed live on staging: only postgres and service_role hold
   * INSERT/SELECT/UPDATE/DELETE), so these four columns are writable by this
   * function and by nothing a browser can reach. That is the whole point —
   * `rentals` has RLS OFF with a full anon DML grant, so a browser trusted to
   * record its own identity completion could simply claim one.
   *
   * They are deliberately NOT `rentals.documents_status`. That column has one
   * meaning already — "the insurance paperwork is with the operator" — and two
   * steps writing one column is how a rejected licence photo ends up erasing a
   * perfectly good insurance PDF. Two facts, two columns.
   */
  identity_session_id: string | null;
  /** null = never started, then 'pending' -> 'submitted' | 'rejected'. */
  identity_status: string | null;
  identity_started_at: string | null;
  identity_completed_at: string | null;
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

/* ═══════════════════════════ the identity step ═══════════════════════════ */

/**
 * Where a booking's three identity photos live.
 *
 * `ai-verification/<sessionId>/<kind>.jpg` IS A CONTRACT, not a naming choice.
 * It is what v1's QR capture page writes
 * (`apps/booking/src/app/verify/[token]/page.tsx:355`) and what the portal's
 * document viewers already read, so an operator opening this booking finds the
 * licence exactly where every other identity flow puts it. Changing any segment
 * makes the operator's copy of the licence disappear.
 *
 * The session id is the scoping segment, and it is minted HERE — the browser is
 * handed one, never asked for one. `customer-documents` is a PUBLIC bucket whose
 * storage policies grant INSERT/UPDATE/DELETE to `public`, so a
 * browser-CHOSEN prefix is a browser-chosen place to put someone else's photos.
 */
function identityPrefix(sessionId: string): string {
  return `ai-verification/${sessionId}`;
}

/** The three objects, exactly. `document-back.jpg` is genuinely optional. */
const IDENTITY_OBJECTS = {
  front: 'document-front.jpg',
  back: 'document-back.jpg',
  selfie: 'selfie.jpg',
} as const;

/**
 * Ask `create-ai-verification-session` for a session, or reuse the live one.
 *
 * ── WHY THIS IS LAZY, AND WHY THAT IS THE WHOLE POINT ───────────────────────
 * The FIRST build of this screen minted a session inside the `open` branch, on
 * every single page load. That was not free:
 *
 *   * create-ai-verification-session caps a customer at TEN sessions an hour
 *     and answers a plain 400 past that, so a customer refreshing their own
 *     paid booking ten times locked themselves out of it;
 *   * its customerId branch also sets
 *     customers.identity_verification_status = 'pending' as a side effect — a
 *     false statement about somebody who has opened a page and done nothing.
 *
 * So nothing is minted until the customer presses the button that starts step
 * one. `open` reports the STATUS of the identity step and never touches it.
 *
 * ── AND WHY IT REUSES ───────────────────────────────────────────────────────
 * A customer who starts, backs out and starts again must not burn two of their
 * ten. The session id is remembered on the link row and handed back as long as
 * the row it points at has not been processed. Once it is `completed` a fresh
 * one is minted, because `process-ai-verification` looks a session up by
 * `session_id` with NO status guard — re-submitting a completed session would
 * re-run OCR and the face match over the top of a verdict that is already
 * written.
 */
async function handleStartIdentity(
  supabase: SupabaseClient,
  link: LinkRow,
  rental: RentalRow,
  tenantSlug: string | null,
): Promise<Response> {
  if (!rental.customer_id) {
    // create-ai-verification-session's customerId branch reads `customers` and
    // 404s without one. Fail with prose rather than a relayed 400.
    console.error('[documents-link] identity start on a rental with no customer:', rental.id);
    return fail(
      409,
      'no_customer',
      'We could not start the identity check for this booking. Please get in touch and we will take it from here.',
    );
  }

  const nowIso = new Date().toISOString();

  // ---- reuse a session that has not been processed yet --------------------
  if (link.identity_session_id) {
    const { data: existing } = await supabase
      .from('identity_verifications')
      .select('id, status')
      .eq('session_id', link.identity_session_id)
      .maybeSingle();

    if (existing && existing.status !== 'completed') {
      await supabase
        .from('booking_document_links')
        .update({
          identity_status: link.identity_status ?? 'pending',
          identity_started_at: link.identity_started_at ?? nowIso,
          updated_at: nowIso,
        })
        .eq('token', link.token);

      return jsonResponse({
        ok: true,
        sessionId: link.identity_session_id,
        uploadPrefix: identityPrefix(link.identity_session_id),
        bucket: DOCUMENT_BUCKET,
        identityStatus: link.identity_status ?? 'pending',
        reused: true,
      });
    }
  }

  // ---- mint a new one ------------------------------------------------------
  let minted: Record<string, unknown> | null = null;
  let mintStatus = 0;
  try {
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/create-ai-verification-session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          customerId: rental.customer_id,
          tenantId: rental.tenant_id,
          // The function REQUIRES a non-empty slug and only uses it to build a
          // QR URL this flow never shows. A tenant with no slug must still be
          // able to start, so a placeholder stands in rather than a 400.
          tenantSlug: tenantSlug && tenantSlug !== '' ? tenantSlug : 'booking',
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    mintStatus = response.status;
    minted = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error('[documents-link] could not reach create-ai-verification-session:', error);
    return fail(
      502,
      'identity_unavailable',
      'We could not start the identity check just now. Nothing about your booking has changed — please try again in a moment.',
    );
  }

  const sessionId = typeof minted?.sessionId === 'string' ? minted.sessionId : '';
  if (minted?.ok !== true || sessionId === '') {
    const detail = typeof minted?.error === 'string' ? minted.error : '';
    console.error('[documents-link] identity session mint refused:', mintStatus, detail);
    // The ten-an-hour cap is the one refusal a customer can act on, and its
    // message is the function's own prose about attempts. Everything else is
    // ours, because the raw text is written for an operator.
    if (/too many/i.test(detail)) {
      return fail(
        429,
        'identity_rate_limited',
        'You have started the identity check several times in the last hour. Please wait a little while and try again — nothing about your booking has changed.',
      );
    }
    return fail(
      502,
      'identity_unavailable',
      'We could not start the identity check just now. Nothing about your booking has changed — please try again in a moment.',
    );
  }

  const { error: rememberError } = await supabase
    .from('booking_document_links')
    .update({
      identity_session_id: sessionId,
      identity_status: 'pending',
      identity_started_at: link.identity_started_at ?? nowIso,
      identity_completed_at: null,
      updated_at: nowIso,
    })
    .eq('token', link.token);

  if (rememberError) {
    // Without the remembered id the submit action has nothing to pin the
    // uploaded paths against, and pinning them is the only authorisation this
    // step has. Refuse rather than hand out an unpinned prefix.
    console.error('[documents-link] could not record identity session:', rememberError);
    return fail(
      500,
      'identity_unavailable',
      'We could not start the identity check just now. Nothing about your booking has changed — please try again in a moment.',
    );
  }

  return jsonResponse({
    ok: true,
    sessionId,
    uploadPrefix: identityPrefix(sessionId),
    bucket: DOCUMENT_BUCKET,
    identityStatus: 'pending',
    reused: false,
  });
}

/**
 * "I have taken my three photos."
 *
 * The browser uploads BYTES under the prefix this function issued and then says
 * so. This function checks the objects are really there, runs the AI pass
 * server-side, and is the only thing that writes what the result MEANS for the
 * booking. A browser that could stamp its own `identity_status` is a browser
 * that can be made to lie, and the column it would be lying about is the one
 * the screen's own gate reads.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TOUCH ─────────────────────────────────────
 * `rentals.documents_status`, `rentals.insurance_status` and
 * `rentals.identity_verification_session_id`. The first two belong to the
 * INSURANCE step and are written only by `submit-insurance`; the identity step
 * having its own column is what stops one step's verdict overwriting the
 * other's. The third is what `process-ai-verification`'s booking gate filters
 * on (index.ts:419-424) — leaving it unset is precisely what keeps that gate
 * matching ZERO rows here, so the AI pass cannot reach in and stamp
 * documents_status = 'verified' on a booking whose insurance nobody has seen.
 *
 * ── AND IT SENDS NO EMAIL ───────────────────────────────────────────────────
 * `booking_documents_received` is keyed canonically per rental
 * (`email-outbox.ts` outboxKey), so sending it here would consume the one row
 * the insurance step needs and the customer would never hear that their
 * insurance arrived. One errand, one email, and it belongs to the step that
 * finishes last.
 */
async function handleSubmitIdentity(
  supabase: SupabaseClient,
  link: LinkRow,
  rental: RentalRow,
  body: Record<string, unknown>,
): Promise<Response> {
  const sessionId = link.identity_session_id ?? '';
  if (sessionId === '') {
    // The customer never pressed "start", or started on a link row that has
    // since been reset. Recoverable: the page starts the step again.
    return fail(
      409,
      'identity_not_started',
      'We could not match these photos to an identity check. Please start the identity step again.',
    );
  }

  const prefix = identityPrefix(sessionId);

  /*
    THE AUTHORISATION CHECK, AND THERE IS ONLY ONE — the same shape as the
    insurance one above. The token is a bearer credential and the bucket is
    world-writable, so an unpinned body could name ANY object in the bucket and
    have it run through OCR and a face match on this booking's behalf.
  */
  const readPath = (value: unknown, required: boolean): string | null | 'bad' => {
    if (value === null || value === undefined || value === '') {
      return required ? 'bad' : null;
    }
    if (typeof value !== 'string') return 'bad';
    const path = value.trim();
    if (!path.startsWith(`${prefix}/`) || path.includes('..')) return 'bad';
    return path;
  };

  const frontPath = readPath(body.documentFrontPath, true);
  const backPath = readPath(body.documentBackPath, false);
  const selfiePath = readPath(body.selfiePath, true);

  if (frontPath === 'bad' || backPath === 'bad' || selfiePath === 'bad') {
    return fail(
      400,
      'bad_files',
      'One of your photos was not stored where we expected. Please take them again.',
    );
  }

  // ---- the objects have to actually be there ------------------------------
  const { data: objects, error: listError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .list(prefix, { limit: 20 });

  if (listError) {
    console.error('[documents-link] could not list identity objects:', listError);
    return fail(
      502,
      'storage_unavailable',
      'We could not read the photos you just sent. Please try again in a moment.',
    );
  }

  const present = new Set((objects ?? []).map((object) => object.name));
  const wanted = [frontPath, selfiePath, backPath].filter(
    (path): path is string => typeof path === 'string',
  );
  const missing = wanted.filter((path) => !present.has(path.slice(prefix.length + 1)));
  if (missing.length > 0) {
    console.error('[documents-link] identity paths not present in storage:', missing);
    return fail(
      409,
      'files_missing',
      'We could not find the photos you sent. Please take them again and re-send.',
    );
  }

  // ---- the AI pass, server-side -------------------------------------------
  let verdictBody: Record<string, unknown> | null = null;
  try {
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/process-ai-verification`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          sessionId,
          // PATHS, not URLs. The function resolves them against the bucket
          // itself (`getStoragePublicUrl`), so a URL would double-resolve.
          documentFrontPath: frontPath,
          documentBackPath: backPath ?? undefined,
          selfiePath,
        }),
        // OCR plus a Rekognition round trip. Generous, and bounded so a hung
        // provider cannot hold the customer's request open forever.
        signal: AbortSignal.timeout(110000),
      },
    );
    verdictBody = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error('[documents-link] process-ai-verification unreachable:', error);
    return fail(
      502,
      'identity_unavailable',
      'We could not check your photos just now. Nothing about your booking has changed — please try again in a moment.',
    );
  }

  const result = typeof verdictBody?.result === 'string' ? verdictBody.result : '';
  if (result !== 'verified' && result !== 'review_required' && result !== 'rejected') {
    console.error('[documents-link] no verdict from process-ai-verification:', verdictBody);
    return fail(
      502,
      'identity_unavailable',
      'We could not check your photos just now. Nothing about your booking has changed — please try again in a moment.',
    );
  }

  /*
    A VERDICT AND AN OUTAGE ARE NOT THE SAME THING, AND `ok` IS WHAT SEPARATES
    THEM.

    process-ai-verification answers HTTP 200 `{ ok: false, result: 'rejected' }`
    from exactly two places, and neither is a judgement about the customer: OCR
    being unusable (index.ts:178-185) and the face matcher being unusable
    (:219-226). A GENUINE no-match answers `{ ok: true, result: 'rejected' }`.

    This is not hypothetical. Probed live on staging on 2026-09-01, a real
    submission came back with
    rejection_reason = "Face matching failed: AWS credentials are invalid or
    expired" — an outage in our own account. Recording that as `rejected` would
    put "we could not read your documents, try again in better light" in front
    of a customer whose photos were fine, and leave a RED-looking identity step
    on a booking for the operator to read. So an `ok: false` answer is reported
    as "we could not check them just now", the step stays 'pending', and the
    customer can try again. It costs one of their ten sessions an hour, which is
    the honest price of a retry.

    The trade is deliberate: an image so poor that OCR gives up also lands here
    and gets "we could not check your photos" rather than "take a better photo".
    That sentence is true in both cases; the alternative sentence is false in
    one of them.
  */
  if (verdictBody?.ok !== true) {
    const detail = typeof verdictBody?.detail === 'string' ? verdictBody.detail : '';
    console.error('[documents-link] identity check could not run:', detail || verdictBody);
    return fail(
      502,
      'identity_unavailable',
      'We could not check your photos just now. Nothing about your booking has changed — please try again in a moment, and get in touch if it keeps happening.',
    );
  }

  /*
    'verified' AND 'review_required' BOTH LAND AS 'submitted', and neither is
    ever reported to the customer as a pass. What is true either way is that we
    have the photos and a person will look at them; whether the face match was
    GREEN or RETRY is the operator's to read off identity_verifications, and
    saying "verified" to a customer an operator can still reject would be a
    false statement made by a screen with no authority to make it.
  */
  const identityStatus = result === 'rejected' ? 'rejected' : 'submitted';
  const nowIso = new Date().toISOString();

  const { error: stampError } = await supabase
    .from('booking_document_links')
    .update({
      identity_status: identityStatus,
      identity_completed_at: identityStatus === 'submitted' ? nowIso : null,
      updated_at: nowIso,
    })
    .eq('token', link.token);

  if (stampError) {
    /*
      FAIL THE REQUEST. This used to log and fall through to `ok: true`, which is
      the one outcome worse than an error: the client only calls `onSubmitted()`
      on a truthy `ok`, so the customer would watch step 1 turn to "Received"
      while the column their own screen gates on stayed 'pending' — and the step
      would silently revert the next time they loaded the page. A customer who
      believes they are finished does not come back, and the booking stalls with
      nobody aware of it.

      Returning 503 instead is honest and costs nothing: the photos and the
      verdict are already safely on identity_verifications, so retrying re-runs
      the stamp against work that is already done, and the operator can see the
      documents either way.
    */
    console.error('[documents-link] could not record identity outcome:', stampError);
    return fail(
      503,
      'identity_not_recorded',
      'Your photos reached us, but we could not finish recording them. Please try again in a moment — nothing has been lost.',
    );
  }

  // Slide the window: a customer who has just engaged never loses their link,
  // and they still have the insurance step in front of them.
  await supabase
    .from('booking_document_links')
    .update({
      expires_at: new Date(Date.now() + DOCUMENTS_LINK_TTL_MS).toISOString(),
      updated_at: nowIso,
    })
    .eq('token', link.token);

  /*
    ONLY THE COARSE OUTCOME CROSSES THE WIRE. `details` on the verdict carries
    the OCR extraction and the face-match score, and its sibling
    `rejection_reason` reads "Blocked identity: <the operator's private note>"
    on one path. None of that is the customer's to read, and the cheapest way to
    guarantee it never reaches a rendered string is for it never to leave here.
  */
  return jsonResponse({ ok: true, identityStatus });
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
    /*
      Four actions, and the two identity ones are ADDITIVE. A server too old to
      know them falls through to `open` and answers a session body, which the
      browser reports as a failure rather than as a phantom success — the same
      contract `submit-insurance` already relies on.
    */
    const KNOWN_ACTIONS = ['resend', 'submit-insurance', 'start-identity', 'submit-identity'];
    const action =
      typeof body.action === 'string' && KNOWN_ACTIONS.includes(body.action)
        ? body.action
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
      // ONE string literal, not a concatenation: supabase-js parses the select
      // at the type level and infers GenericStringError from anything it cannot
      // read statically, which turns the cast below into a TS2352.
      .select('id, tenant_id, rental_id, token, expires_at, consumed_at, identity_session_id, identity_status, identity_started_at, identity_completed_at')
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
      The identity step's two actions sit HERE, behind the same expiry gate as
      the insurance one and for the same reason: accepting work through a dead
      link is accepting it from a credential that is supposed to be over. They
      are separate actions rather than a flag on `open` precisely so that
      opening the page cannot mint anything — see handleStartIdentity.
    */
    if (action === 'start-identity') {
      return await handleStartIdentity(supabase, link, rental, tenantSlug);
    }
    if (action === 'submit-identity') {
      return await handleSubmitIdentity(supabase, link, rental, body);
    }

    /*
      AN AI IDENTITY SESSION IS *NOT* MINTED HERE, AND THAT IS THE POINT.

      The first build of this function minted one on every page open. It cost:

        * create-ai-verification-session caps a customer at 10 sessions per hour
          and answers a plain 400 past that, so a customer refreshing the page
          could lock themselves out of their own paid booking; and
        * its customerId branch sets
          customers.identity_verification_status = 'pending' as a side effect —
          a false statement about somebody who has opened a page and done
          nothing.

      Minting now lives behind the `start-identity` action, which fires when the
      customer actually begins step one. Opening the page only REPORTS
      `identityStatus`, below.

      What `open` does issue is `uploadPrefix`: the tenant- and rental-scoped
      INSURANCE prefix, derived server-side, which is the only place this
      token's holder may put an insurance file. The identity prefix is issued
      separately, by `start-identity`, and is scoped to the session it mints.
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
      /*
        The identity step's state, READ ONLY. Opening the page reports where
        that step has got to and changes nothing about it — no session is
        minted, customers.identity_verification_status is not touched. `null`
        means the customer has not started it.
      */
      identityStatus: link.identity_status,
    });
  } catch (error) {
    console.error('[documents-link] unhandled error:', error);
    return fail(500, 'unexpected', 'We could not open this link. Please try again in a moment.');
  }
});
