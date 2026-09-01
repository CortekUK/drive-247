'use client';

/**
 * The post-payment document gate, from the browser's side.
 *
 * A customer who has just paid inside Stripe Elements has NO account — the
 * booking flow writes a `customers` row and nothing else (see
 * `lib/booking/create-booking.ts`), so there is no `auth.users` and no session.
 * The DURABLE TOKEN in the emailed link is therefore the only credential this
 * whole surface has. Everything below is addressed by that token and nothing
 * below depends on being signed in.
 *
 * ── THE BROWSER NEVER WRITES A VERDICT ──────────────────────────────────────
 * `identity_verifications` has RLS off and `anon` holds SELECT *and UPDATE* on
 * it — probed live against staging, and written down at the top of
 * `use-customer-verification.ts`. v1's capture page writes
 * `verification_step` and `upload_progress` straight from the browser
 * (`apps/booking/src/app/verify/[token]/page.tsx:67-90` and `:265-275`). That
 * is a client writing the state its own gate is judged on, i.e. a client that
 * can be made to lie, so none of it is ported here.
 *
 * The consequence is deliberate and worth stating: there is no live
 * "step 2 of 3" panel mirrored to a second device, because building one would
 * require exactly those client writes. Nothing is lost — staging's
 * `supabase_realtime` publication is EMPTY, so the panel v1 renders could not
 * update there anyway.
 *
 * The two things this file DOES write are the three photos (into a storage
 * bucket, under a path derived from a server-minted session id) and nothing
 * else. Every status transition is made server-side by
 * `process-ai-verification`.
 *
 * ── WHY THERE IS NO "HAS IT LANDED" POLL ────────────────────────────────────
 * The obvious follow-up to a `verified` verdict is to watch for
 * `rentals.documents_status` flipping, the way `settlement-watch.tsx` watches a
 * balance drop. It is NOT done here, and the reason is a side effect rather
 * than a preference.
 *
 * The only endpoint this surface can reach is `booking-documents-link`, and
 * that function MINTS OR REUSES an AI verification session on every call: once
 * the session it reused is `status = 'completed'` the reuse branch stops
 * matching, so each further call mints a fresh session AND repoints
 * `rentals.identity_verification_session_id` at it. Polling it every three
 * seconds would therefore (a) burn `create-ai-verification-session`'s 10-per-
 * hour cap in half a minute, (b) litter `identity_verifications` with empty
 * rows, and (c) — the serious one — move the rental's session pointer away from
 * the session whose verdict we are waiting for, so
 * `process-ai-verification`'s gate write would match zero rows and the booking
 * would silently never complete.
 *
 * That is: the failure mode of the safety check would CAUSE the failure it is
 * checking for. So there is no poll. If a read-only probe is ever added to
 * `booking-documents-link` (a `probe: true` body flag that skips steps 4-7),
 * this is the file that should grow the watcher, shaped like `useSettlementWatch`
 * — poll 3s, give up at 30s, three named states, never guess.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';
import {
  ACCEPTED_MIME_TYPES,
  DOCUMENT_BUCKET,
  MAX_UPLOAD_BYTES,
} from '@/hooks/use-customer-documents';

/* ──────────────────────────── the two endpoints ────────────────────────── */

/**
 * Mints/redeems the durable link. `verify_jwt` is on, and the anon key
 * satisfies the gateway; the TOKEN is the real credential, not the JWT.
 */
const LINK_FUNCTION = 'booking-documents-link';

/** Runs the OCR + face match and writes the verdict. Service-role only, inside. */
const VERIFY_FUNCTION = 'process-ai-verification';

/* ─────────────────────── what the link function returns ────────────────── */

export interface BookingDocumentsRental {
  rentalNumber: string | null;
  /** Date-only strings, `YYYY-MM-DD`. Never parsed with `new Date()` here. */
  startDate: string | null;
  endDate: string | null;
  vehicleLabel: string | null;
}

export interface BookingDocumentsTenant {
  slug: string | null;
  companyName: string | null;
  logoUrl: string | null;
}

export interface BookingDocumentsSession {
  /**
   * `identity_verifications.session_id` — the string the storage path and
   * `process-ai-verification` are both keyed on. NOT the row's `id`.
   */
  sessionId: string;
  expiresAt: string | null;
  rental: BookingDocumentsRental;
  tenant: BookingDocumentsTenant;
  /** Raw `rentals.documents_status`, for display only. Never branched on here. */
  documentsStatus: string | null;
}

/**
 * Every outcome of asking about a token, as ONE closed union.
 *
 * The three server codes are values, not errors, because each of them is a
 * different true sentence to put in front of the customer — "this link was
 * never valid", "this link has run out" and "we already have these" are not
 * interchangeable, and flattening them into a single red box is what makes an
 * expired link feel like a dead end.
 */
export type BookingDocumentsState =
  | { kind: 'ready'; session: BookingDocumentsSession }
  | { kind: 'invalid_token' }
  | { kind: 'link_expired' }
  | { kind: 'already_complete' }
  /** We could not get an answer at all. Distinct from any answer we got. */
  | { kind: 'unavailable'; message: string; detail: string | null };

/* ─────────────────────────── error narrowing ───────────────────────────── */

/**
 * Pull the HTTP status off a Supabase Functions error.
 *
 * Same shape as `lib/stripe/create-balance-payment-intent.ts:86` — the SDK
 * types `context` as `any`, and this app is `strict: true` with no `any`, so it
 * is narrowed through `unknown` rather than asserted.
 */
function statusOf(error: unknown): number | null {
  if (
    !(error instanceof FunctionsHttpError) &&
    !(error instanceof FunctionsRelayError)
  ) {
    return null;
  }
  const context: unknown = error.context;
  return context instanceof Response ? context.status : null;
}

/** The function's own JSON body, when there is one we can read. */
async function readServerBody(error: unknown): Promise<Record<string, unknown> | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const context: unknown = error.context;
  if (!(context instanceof Response)) return null;
  try {
    // `.clone()` — invoke() throws before reading the body, but cloning keeps
    // this correct if that ever changes.
    const body: unknown = await context.clone().json();
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
      return { ...body };
    }
  } catch {
    // Not JSON, or already consumed.
  }
  return null;
}

function describe(error: unknown): string | null {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  return null;
}

/** `navigator.onLine` is trusted only in the negative; true means very little. */
function looksOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

const UNREACHABLE_COPY =
  'We could not reach the service that checks your link. Nothing about your ' +
  'booking has changed. Please try again in a moment.';

const OFFLINE_COPY =
  'You appear to be offline, so we could not check your link. Nothing about ' +
  'your booking has changed — reconnect and try again.';

/* ─────────────────────── reading the link function ─────────────────────── */

type LinkCode = 'invalid_token' | 'link_expired' | 'already_complete';

function asLinkCode(value: unknown): LinkCode | null {
  return value === 'invalid_token' ||
    value === 'link_expired' ||
    value === 'already_complete'
    ? value
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * Turn a 200 body into a session, or say what was missing.
 *
 * `sessionId` is the only field the flow genuinely cannot run without: it is
 * both the storage path segment and the key `process-ai-verification` looks the
 * row up by. Everything else is decoration and is allowed to be absent, so one
 * missing display field cannot take the whole upload screen down.
 */
function parseSession(
  payload: unknown,
): { ok: true; session: BookingDocumentsSession } | { ok: false; reason: string } {
  const body = asRecord(payload);

  const sessionId = asString(body.sessionId);
  if (sessionId === null) return { ok: false, reason: 'no sessionId in the response' };

  const rental = asRecord(body.rental);
  const tenant = asRecord(body.tenant);

  return {
    ok: true,
    session: {
      sessionId,
      expiresAt: asString(body.expiresAt),
      rental: {
        rentalNumber: asString(rental.rentalNumber),
        startDate: asString(rental.startDate),
        endDate: asString(rental.endDate),
        vehicleLabel: asString(rental.vehicleLabel),
      },
      tenant: {
        slug: asString(tenant.slug),
        companyName: asString(tenant.companyName),
        logoUrl: asString(tenant.logoUrl),
      },
      documentsStatus: asString(body.documentsStatus),
      // `qrToken` is deliberately NOT carried through. It is a bearer credential
      // for v1's QR capture route and nothing on this screen needs it; holding
      // it in browser memory and React Query's cache would be storing a secret
      // for no purpose.
    },
  };
}

async function loadState(token: string): Promise<BookingDocumentsState> {
  if (token.trim() === '') return { kind: 'invalid_token' };

  const { data, error } = await supabase.functions.invoke(LINK_FUNCTION, {
    body: { token },
  });

  if (error) {
    const status = statusOf(error);
    const body = await readServerBody(error);
    const code = asLinkCode(body?.code);

    // The body's own code is authoritative when it is one of the three we know.
    if (code !== null) return { kind: code };

    /*
      Falling back to the STATUS is only safe for 410 and 409. Nothing else in
      this app answers either of those, so they are unambiguous.

      404 is deliberately NOT mapped to `invalid_token`. A Supabase Functions URL
      for a function that is not deployed also answers 404, so treating a bare
      404 as an invalid token would tell a customer holding a perfectly good link
      that it was never valid — when the truth is that the backend is missing.
      A real invalid token always carries `code: 'invalid_token'` in the body.
    */
    if (status === 410) return { kind: 'link_expired' };
    if (status === 409) return { kind: 'already_complete' };

    if (status === 404) {
      return {
        kind: 'unavailable',
        message: UNREACHABLE_COPY,
        detail:
          `${LINK_FUNCTION} answered 404 with no recognisable code — the edge ` +
          'function is most likely not deployed. Do NOT read this as a bad token.',
      };
    }

    if (status === null) {
      return {
        kind: 'unavailable',
        message: looksOffline() ? OFFLINE_COPY : UNREACHABLE_COPY,
        detail:
          `${LINK_FUNCTION} could not be reached (${describe(error) ?? 'no detail'}). ` +
          'A CORS-blocked 404 and a dead connection are indistinguishable here.',
      };
    }

    return { kind: 'unavailable', message: UNREACHABLE_COPY, detail: describe(error) };
  }

  const parsed = parseSession(data);
  if (!parsed.ok) {
    return {
      kind: 'unavailable',
      message:
        'The service that checks your link answered in a way we did not ' +
        'understand. Nothing about your booking has changed.',
      detail: `${LINK_FUNCTION} responded but ${parsed.reason}.`,
    };
  }

  return { kind: 'ready', session: parsed.session };
}

export interface UseBookingDocumentsSessionResult {
  /** Null ONLY while the very first load is in flight. */
  state: BookingDocumentsState | null;
  isLoading: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * Resolve a durable documents token into a usable capture session.
 *
 * `staleTime: 0` and `retry: false` are both from the brief and both earn their
 * place: the answer is a one-shot server decision that must never be served
 * from cache, and a failed call must not be retried behind the customer's back
 * because a retry re-enters the mint/reuse path on the server.
 *
 * `refetchOnWindowFocus` is left at the app default (false) ON PURPOSE. A
 * refetch after the customer has submitted would return `already_complete` (or,
 * after a rejection, mint a brand-new session) and yank the result screen out
 * from under them mid-read. The query therefore runs on mount and on an
 * explicit retry, and at no other time.
 *
 * The query function NEVER throws: every outcome, including "we could not get
 * an answer", is a value in `BookingDocumentsState`. That is what lets the page
 * render four honest screens instead of one generic error box.
 */
export function useBookingDocumentsSession(
  token: string,
): UseBookingDocumentsSessionResult {
  const query = useQuery({
    queryKey: ['booking-documents', token],
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<BookingDocumentsState> => {
      try {
        return await loadState(token);
      } catch (caught: unknown) {
        // A throw here is a bug in this file, not a server answer. Keep the
        // union's promise that it covers everything rather than letting React
        // Query's error path become a fifth, undocumented screen.
        console.error('[useBookingDocumentsSession] unexpected failure', caught);
        return {
          kind: 'unavailable',
          message: UNREACHABLE_COPY,
          detail: describe(caught),
        };
      }
    },
  });

  const refetch = useCallback(() => query.refetch(), [query]);

  return useMemo(
    () => ({
      state: query.data ?? null,
      isLoading: query.isPending,
      isRefetching: query.isFetching && !query.isPending,
      refetch,
    }),
    [query.data, query.isPending, query.isFetching, refetch],
  );
}

/* ──────────────────────── re-sending an expired link ───────────────────── */

/**
 * What the "email me a new link" button calls.
 *
 * ── THIS IS A CONTRACT THE SERVER MUST HONOUR ───────────────────────────────
 * The product decision is that a lapsed link is recoverable BY THE CUSTOMER: an
 * expired-link screen that only apologises is the exact dead end this whole
 * feature exists to remove (v1's expired screen reads "Please request a new
 * verification link" and offers no button —
 * `apps/booking/src/app/verify/[token]/page.tsx:463-477` — and the only resend
 * path in the product needs operator staff auth).
 *
 * The call is `POST booking-documents-link { token, action: 'resend' }`, and the
 * answer we expect is:
 *
 *     200 { ok: true, resent: true, emailedTo?: string }   // masked address
 *     404 { ok: false, code: 'invalid_token' }
 *     409 { ok: false, code: 'already_complete' }
 *
 * `action` is additive: a server that does not know the field ignores it and
 * answers 410 for the expired token, which this mutation reports honestly as
 * "we could not send it" rather than claiming a send that did not happen.
 */
const RESEND_ACTION = 'resend';

export interface ResendLinkResult {
  /** A masked address, e.g. `j••••@gmail.com`, when the server tells us one. */
  emailedTo: string | null;
}

export function useResendBookingDocumentsLink() {
  return useMutation<ResendLinkResult, Error, { token: string }>({
    // A resend is not idempotent and is not free — the token is a bearer
    // credential, so anyone holding a lapsed link could otherwise sit on the
    // button and post to the customer's inbox. Retrying it automatically would
    // do the same thing by accident.
    retry: false,
    mutationFn: async ({ token }): Promise<ResendLinkResult> => {
      const { data, error } = await supabase.functions.invoke(LINK_FUNCTION, {
        body: { token, action: RESEND_ACTION },
      });

      if (error) {
        const body = await readServerBody(error);
        const code = asLinkCode(body?.code);

        if (code === 'invalid_token') {
          throw new Error(
            'This link does not match any booking, so there is nothing to send. ' +
              'Please get in touch and we will sort it out.',
          );
        }
        if (code === 'already_complete') {
          throw new Error(
            'We already have your documents — there is no new link to send.',
          );
        }
        throw new Error(
          'We could not send a new link just now. Please try again in a ' +
            'moment, or reply to your booking email and we will send one.',
        );
      }

      const body = asRecord(data);
      // Presence of `ok: true` is required. A server that ignored `action` and
      // answered something else must not be reported as a successful send.
      if (body.ok !== true) {
        throw new Error(
          'We could not send a new link just now. Please try again in a ' +
            'moment, or reply to your booking email and we will send one.',
        );
      }

      return { emailedTo: asString(body.emailedTo) };
    },
  });
}

/* ───────────────────────── what may be uploaded ────────────────────────── */

/**
 * The capture flow's own accept list: the bucket's types MINUS `application/pdf`.
 *
 * Derived rather than retyped, so a change to the bucket's real limits in
 * `use-customer-documents.ts` cannot drift away from this one. A PDF is a
 * perfectly valid `customer-documents` object and a perfectly useless input to
 * a face match, so it is excluded here and nowhere else.
 */
export const CAPTURE_MIME_TYPES: readonly string[] = ACCEPTED_MIME_TYPES.filter(
  (type) => type !== 'application/pdf',
);

/** The bucket's real `file_size_limit`, not a guess. See the source constant. */
export const CAPTURE_MAX_BYTES = MAX_UPLOAD_BYTES;

/**
 * For the `accept` attribute. Naming the two MIME types (rather than `image/*`)
 * is what makes iOS hand back a JPEG instead of a HEIC from the photo library.
 */
export const CAPTURE_ACCEPT_ATTRIBUTE = 'image/jpeg,image/png';

export const CAPTURE_FORMATS_LABEL = 'JPG or PNG, up to 5 MB';

/**
 * Say which limit was hit, before anything is uploaded.
 *
 * v1 validates `image/*` up to 10 MB (`page.tsx:326-334`) against a bucket that
 * enforces 5 MB and four MIME types, then swallows the storage error and shows
 * "Failed to upload document" (`uploadImage` returns null at `:353-364`). A
 * phone photo is routinely over 5 MB, so that is not an edge case — it is the
 * common path, and the customer is given nothing to act on.
 */
export function validateCaptureFile(file: File): string | null {
  const type = file.type.toLowerCase();

  if (type === 'image/heic' || type === 'image/heif') {
    return (
      'That photo is in Apple’s HEIC format, which we cannot read. In Settings › ' +
      'Camera › Formats choose “Most Compatible”, or take the photo with the ' +
      'button above instead.'
    );
  }

  if (!CAPTURE_MIME_TYPES.includes(type)) {
    return `That is a ${file.type || 'file of unknown type'}. Please use a JPG or PNG photo.`;
  }

  if (file.size === 0) {
    return 'That photo came through empty. Please take or choose it again.';
  }

  if (file.size > CAPTURE_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `That photo is ${mb} MB and the limit is 5 MB. Try taking it with the button above, which produces a smaller file.`;
  }

  return null;
}

/* ──────────────────────────── submitting them ──────────────────────────── */

/**
 * The three object names, exactly.
 *
 * THIS IS A CONTRACT, not a naming choice. `ai-verification/<sessionId>/<kind>.jpg`
 * is what v1 writes (`apps/booking/src/app/verify/[token]/page.tsx:355`) and
 * what the portal's document viewers already read. Changing any part of it
 * makes the operator's copy of the licence disappear.
 */
type CaptureKind = 'document-front' | 'document-back' | 'selfie';

function capturePath(sessionId: string, kind: CaptureKind): string {
  return `ai-verification/${sessionId}/${kind}.jpg`;
}

const KIND_LABEL: Record<CaptureKind, string> = {
  'document-front': 'the front of your document',
  'document-back': 'the back of your document',
  selfie: 'your photo',
};

async function uploadCapture(
  sessionId: string,
  kind: CaptureKind,
  blob: Blob,
): Promise<string> {
  /*
    Re-checked here as well as at selection time. The component validates a
    `File` (which carries a name, so the message can be specific); this checks
    the `Blob` that actually goes over the wire, because that is the value the
    bucket will judge. Cheap, and it closes the gap if a future caller skips the
    component.
  */
  if (blob.size === 0) {
    throw new Error(`We could not read ${KIND_LABEL[kind]}. Please take it again.`);
  }
  if (blob.size > CAPTURE_MAX_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `${KIND_LABEL[kind]} is ${mb} MB and the limit is 5 MB. Please take it again with the camera button.`,
    );
  }

  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(capturePath(sessionId, kind), blob, {
      /*
        `image/jpeg` and a `.jpg` name regardless of the real bytes, because that
        is the contract above. A PNG therefore travels mislabelled — which is
        v1's behaviour too, and it works because both consumers sniff the bytes:
        `ai-face-match` base64s them for Rekognition, and `ai-document-ocr`
        wraps them in a `data:image/jpeg;base64,` URI for OpenAI's vision model
        (`ai-document-ocr/index.ts:137-141`). Worth knowing before anyone
        "fixes" the content type: the FILENAME is the part the portal depends on.
      */
      contentType: 'image/jpeg',
      // The customer may retake a photo and submit again; the second upload must
      // replace the first rather than 409. This is also what makes "try again"
      // after a rejection safe to press twice.
      upsert: true,
    });

  if (error) {
    console.error('[useSubmitBookingDocuments] storage upload failed', {
      kind,
      message: error.message,
    });
    // The bucket's own message is shown. It is the difference between "413
    // EntityTooLarge" and "415 InvalidMimeType", which is the difference
    // between two completely different things for the customer to do.
    throw new Error(
      `We could not store ${KIND_LABEL[kind]}. ${error.message}`,
    );
  }

  return data.path;
}

/** The only three verdicts `process-ai-verification` produces. */
export type BookingDocumentsVerdict = 'verified' | 'review_required' | 'rejected';

function asVerdict(value: unknown): BookingDocumentsVerdict | null {
  return value === 'verified' || value === 'review_required' || value === 'rejected'
    ? value
    : null;
}

export interface SubmitBookingDocumentsInput {
  sessionId: string;
  front: Blob;
  /** The back of a passport does not exist. Skippable, and genuinely optional. */
  back: Blob | null;
  selfie: Blob;
}

export interface SubmitBookingDocumentsResult {
  verdict: BookingDocumentsVerdict;
}

const SUBMIT_FAILED_COPY =
  'Your photos were saved, but we could not finish the check. Nothing about ' +
  'your booking has changed — please try submitting again.';

export function useSubmitBookingDocuments() {
  return useMutation<SubmitBookingDocumentsResult, Error, SubmitBookingDocumentsInput>({
    // Never retried automatically: each attempt re-uploads three objects and
    // re-runs a paid OCR + face-match pass. The customer presses the button.
    retry: false,
    mutationFn: async (input): Promise<SubmitBookingDocumentsResult> => {
      // Sequential, not `Promise.all`. Three concurrent multi-megabyte uploads
      // on a phone connection is how you get one of them timing out, and the
      // progress copy would have nothing honest to say about which.
      const documentFrontPath = await uploadCapture(
        input.sessionId,
        'document-front',
        input.front,
      );

      const documentBackPath = input.back
        ? await uploadCapture(input.sessionId, 'document-back', input.back)
        : undefined;

      const selfiePath = await uploadCapture(input.sessionId, 'selfie', input.selfie);

      const { data, error } = await supabase.functions.invoke(VERIFY_FUNCTION, {
        // PATHS, not URLs. The function resolves them against the bucket itself
        // (`getStoragePublicUrl`), so handing it a URL would double-resolve.
        body: {
          sessionId: input.sessionId,
          documentFrontPath,
          documentBackPath,
          selfiePath,
        },
      });

      if (error) {
        /*
          Only the transport failed. Note what did NOT happen: no verdict was
          written, so the rental's `documents_status` is untouched and pressing
          submit again is safe — the three uploads are `upsert: true` and the
          function is keyed on the same session.
        */
        const body = await readServerBody(error);
        console.error('[useSubmitBookingDocuments] verification call failed', {
          status: statusOf(error),
          serverError: body?.error,
          detail: describe(error),
        });
        throw new Error(looksOffline() ? OFFLINE_COPY : SUBMIT_FAILED_COPY);
      }

      /*
        The success path is NOT `data.ok`. Two real code paths answer HTTP 200
        with `{ ok: false, result: 'rejected' }` — an OCR failure
        (`process-ai-verification/index.ts:174-181`) and a face-match failure
        (`:216-223`) — and both have already written `review_result: 'RED'` to
        the row. Those ARE verdicts; treating them as transport errors would show
        a "try again" that silently disagreed with what the operator sees.

        So the VERDICT is what is read, and `ok` is ignored when a verdict is
        present.
      */
      const body = asRecord(data);
      const verdict = asVerdict(body.result);
      if (verdict === null) {
        console.error('[useSubmitBookingDocuments] no verdict in response', body);
        throw new Error(SUBMIT_FAILED_COPY);
      }

      /*
        `details` is deliberately dropped on the floor and never returned to the
        caller. It carries the OCR extraction and the face-match score, and its
        sibling `rejection_reason` on one code path reads
        "Blocked identity: <the operator's private note>". None of that is the
        customer's to see, and the cheapest way to guarantee it never leaks into
        a rendered string is for it never to leave this function.
      */
      return { verdict };
    },
  });
}
