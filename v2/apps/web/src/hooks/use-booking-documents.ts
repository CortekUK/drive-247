'use client';

/**
 * The post-payment INSURANCE DOCUMENT upload, from the browser's side.
 *
 * A customer who has just paid inside Stripe Elements has NO account — the
 * booking flow writes a `customers` row and nothing else (see
 * `lib/booking/create-booking.ts`), so there is no `auth.users` and no session.
 * The DURABLE TOKEN in the emailed link is therefore the only credential this
 * whole surface has. Everything below is addressed by that token and nothing
 * below depends on being signed in.
 *
 * ── WHAT THIS SCREEN IS ─────────────────────────────────────────────────────
 * An insurance certificate / declarations page upload. PDF, JPG or PNG, several
 * files, drag-and-drop or a file picker. It is NOT the licence-and-selfie
 * identity capture that used to live here: that flow, its AI verdict panel and
 * its `process-ai-verification` call were removed rather than kept alongside —
 * the reasoning is written down at the top of
 * `components/booking/insurance-upload.tsx`.
 *
 * ── THE BROWSER NEVER MARKS ANYTHING DONE ───────────────────────────────────
 * `rentals` has RLS OFF on staging and `anon` holds SELECT/INSERT/UPDATE/DELETE
 * on it, so this file could stamp `documents_status` in one statement. It does
 * not, and must not: that is a client writing the state its own gate is judged
 * on. `customer_documents` — the table every operator screen actually reads —
 * has RLS ON with no anon policy, so the browser could not file the row even if
 * we wanted it to (an anon INSERT answers 401 42501; the "RLS is OFF on
 * customer_documents" note at the top of `use-customer-documents.ts` is wrong,
 * and its evidence is a false negative: RLS answers a SELECT with 200 and an
 * empty array, not an error).
 *
 * What this file writes is BYTES, into a bucket, under a prefix the SERVER
 * issued. `booking-documents-link`'s `submit-insurance` action then verifies
 * every path against a real storage listing before it files anything.
 *
 * ── AND IT NEVER SAYS "CONFIRMED" ───────────────────────────────────────────
 * Uploading does not confirm a booking. The server's terminal state is
 * `documents_status = 'submitted'` and `insurance_status = 'uploaded'`, never
 * `verified`; an operator still reviews the documents and can still reject the
 * booking, and `notify-booking-approved` remains the only thing in the product
 * that says "confirmed".
 *
 * ── WHY THERE IS NO "HAS IT LANDED" POLL ────────────────────────────────────
 * There is nothing asynchronous left to wait for. The submit call returns only
 * after the rows are written and the rental is stamped, so its own response IS
 * the answer. (Staging's `supabase_realtime` publication is empty in any case,
 * so a subscription could not have carried it.)
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';
import {
  ACCEPTED_FILE_EXTENSIONS,
  ACCEPTED_FORMATS_LABEL,
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
   * The storage prefix this token is allowed to write to,
   * `insurance/<tenantId>/<rentalId>`, issued by the server.
   *
   * NEVER derived in the browser. `customer-documents` is a PUBLIC bucket whose
   * storage policies grant INSERT/UPDATE/DELETE to the `public` role, so a
   * browser-chosen prefix is a browser-chosen place to put another customer's
   * documents — and the server pins every submitted path against this exact
   * value before it files anything.
   */
  uploadPrefix: string;
  /** The bucket the prefix belongs to. Diagnostics only. */
  bucket: string;
  /** When the LINK lapses, as the server left it after sliding the window. */
  expiresAt: string | null;
  rental: BookingDocumentsRental;
  tenant: BookingDocumentsTenant;
  /** Raw `rentals.documents_status`. The INSURANCE step's state, and only that. */
  documentsStatus: string | null;
  /**
   * The IDENTITY step's state, from `booking_document_links.identity_status`.
   *
   * `null` = never started, then 'pending' -> 'submitted' | 'rejected'. It is a
   * separate column from `documentsStatus` on purpose: two steps writing one
   * column is how a rejected licence photo ends up rendering "we could not read
   * your documents" over an insurance PDF the customer sent five minutes ago.
   *
   * A server too old to know the identity step omits the field entirely, which
   * parses to `null` — the same as "not started", which is the safe reading.
   */
  identityStatus: string | null;
}

/**
 * Every outcome of asking about a token, as ONE closed union.
 *
 * The server's codes are values, not errors, because each of them is a
 * different true sentence to put in front of the customer — "this link was
 * never valid", "this link has run out", "we already have these" and "this
 * booking is gone" are not interchangeable, and flattening them into a single
 * red box is what makes an expired link feel like a dead end.
 */
export type BookingDocumentsState =
  | { kind: 'ready'; session: BookingDocumentsSession }
  | { kind: 'invalid_token' }
  /**
   * `canResend` is the SERVER's word, never a guess. `booking-documents-link`
   * answers 410 `link_expired` with `canResend: true` and 410
   * `booking_cancelled` with `canResend: false` (index.ts:417-423, :448), so
   * the page can offer the "email me a new link" button ONLY where a resend
   * would actually succeed. A button that always fails is worse than no button.
   */
  | { kind: 'link_expired'; canResend: boolean }
  | { kind: 'already_complete' }
  /**
   * The booking itself is cancelled or rejected, so there is nothing to upload
   * — a different fact from an expired link, and one no resend can fix. The
   * message is the server's own prose, which names the booking rather than the
   * link.
   */
  | { kind: 'booking_cancelled'; message: string }
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

/**
 * The codes this file recognises by name.
 *
 * `booking-documents-link` emits MORE than these — `bad_request`,
 * `lookup_failed`, `no_customer`, `bad_files`, `files_missing`,
 * `storage_unavailable`, `file_failed`, `not_paid`, `resend_rate_limited`,
 * `resend_failed`, `unexpected`. Every one of
 * those carries customer-safe prose in `error`, so the unrecognised ones are
 * surfaced with the SERVER's sentence rather than being forced into one of the
 * four screens below. Guessing is how "we could not find the files you sent"
 * becomes "we already have your documents".
 */
type LinkCode =
  | 'invalid_token'
  | 'link_expired'
  | 'already_complete'
  | 'booking_cancelled';

function asLinkCode(value: unknown): LinkCode | null {
  return value === 'invalid_token' ||
    value === 'link_expired' ||
    value === 'already_complete' ||
    value === 'booking_cancelled'
    ? value
    : null;
}

const BOOKING_GONE_COPY =
  'This booking is no longer active, so there is nothing to upload. Please get ' +
  'in touch if that is unexpected.';

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
 * `uploadPrefix` is the only field the flow genuinely cannot run without —
 * without it there is nowhere to put a file, and guessing a prefix is exactly
 * what the server refuses to accept. Everything else is decoration and is
 * allowed to be absent, so one missing display field cannot take the whole
 * upload screen down.
 */
function parseSession(
  payload: unknown,
): { ok: true; session: BookingDocumentsSession } | { ok: false; reason: string } {
  const body = asRecord(payload);

  const uploadPrefix = asString(body.uploadPrefix);
  if (uploadPrefix === null) {
    // A server still running the OLD identity build answers with `sessionId`
    // and no `uploadPrefix`. Saying which beats "we did not understand".
    return {
      ok: false,
      reason:
        asString(body.sessionId) !== null
          ? 'returned an identity-capture session instead of an upload prefix — the edge function is out of date'
          : 'returned no uploadPrefix',
    };
  }

  const rental = asRecord(body.rental);
  const tenant = asRecord(body.tenant);

  return {
    ok: true,
    session: {
      uploadPrefix,
      bucket: asString(body.bucket) ?? DOCUMENT_BUCKET,
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
      identityStatus: asString(body.identityStatus),
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
    // Only ever sent as a literal `false`; absent means "the server did not say".
    const canResend = body?.canResend !== false;
    const serverMessage = asString(body?.error);

    // The body's own code is authoritative when it is one of the four we know.
    if (code === 'invalid_token') return { kind: 'invalid_token' };
    if (code === 'link_expired') return { kind: 'link_expired', canResend };
    if (code === 'already_complete') return { kind: 'already_complete' };
    if (code === 'booking_cancelled') {
      return { kind: 'booking_cancelled', message: serverMessage ?? BOOKING_GONE_COPY };
    }

    /*
      A code we do not recognise. Its `error` string is written for a customer in
      every branch of the function ("We could not find the files you sent. Please
      choose them again and re-send.", "We could not file these against your
      booking. Please get in touch and we will take it from here."), so it is shown verbatim. That is strictly
      better than the generic copy AND strictly safer than guessing a screen.
    */
    if (code === null && serverMessage !== null) {
      return {
        kind: 'unavailable',
        message: serverMessage,
        detail: `${LINK_FUNCTION} answered ${status ?? '?'} with code ${
          asString(body?.code) ?? 'none'
        }.`,
      };
    }

    /*
      No usable body at all, so all we have is the status.

      410 is the only one still worth mapping: both codes that use it are
      terminal for this link, and `canResend` (false on a cancelled booking) is
      what keeps the button honest either way.

      409 is deliberately NOT mapped any more. FOUR different codes answer 409
      — `already_complete`, `no_customer`, `files_missing` and `not_paid` — and
      telling a customer "we already have your documents" when the truth is "we
      could not find the files you sent" stops them doing the one thing that
      would fix it.

      404 is deliberately NOT mapped to `invalid_token` either. A Supabase
      Functions URL for a function that is not deployed also answers 404, so
      treating a bare 404 as an invalid token would tell a customer holding a
      perfectly good link that it was never valid — when the truth is that the
      backend is missing. A real invalid token always carries
      `code: 'invalid_token'` in the body.
    */
    if (status === 410) return { kind: 'link_expired', canResend };

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
 * deployed function answers (index.ts:255-350, :387-445):
 *
 *     200 { ok: true, resent: true, expiresAt }
 *     404 { ok: false, code: 'invalid_token' }
 *     409 { ok: false, code: 'already_complete' }
 *     409 { ok: false, code: 'not_paid',           canResend: false }
 *     410 { ok: false, code: 'booking_cancelled',  canResend: false }
 *     429 { ok: false, code: 'resend_rate_limited' }   // 5 per rental per hour
 *     500 { ok: false, code: 'resend_failed' }
 *
 * `emailedTo` is NOT among them — the function does not disclose the address —
 * so the success copy must not promise to name it. It is still read below
 * because reading a field the server may add later costs nothing.
 *
 * `action` is additive: a server too old to know the field ignores it and
 * answers 410 for the expired token, which this mutation reports honestly as
 * "we could not send it" rather than claiming a send that did not happen.
 */
const RESEND_ACTION = 'resend';

export interface ResendLinkResult {
  /**
   * A masked address, e.g. `j••••@gmail.com`, IF the server ever volunteers one.
   * Today's function does not, so callers must render a message that reads
   * correctly when this is null — never "sent to " + emailedTo.
   */
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
        if (code === 'booking_cancelled') {
          throw new Error(asString(body?.error) ?? BOOKING_GONE_COPY);
        }

        /*
          `not_paid`, `resend_rate_limited` and `resend_failed` all carry prose
          written for a customer, and each says something different and useful —
          "check your inbox and spam folder, then try again later" is not the
          same instruction as "get in touch". Shown verbatim rather than
          collapsed into the fallback below.
        */
        const serverMessage = asString(body?.error);
        if (serverMessage !== null) throw new Error(serverMessage);

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
 * The bucket's OWN limits, re-exported under insurance-shaped names.
 *
 * All FOUR MIME types, PDF very much included — an insurance declarations page
 * is normally a PDF, and the previous build of this screen deliberately filtered
 * PDF out because a PDF is a useless input to a face match. There is no face
 * match here any more, so the filter would only reject the commonest file a
 * customer has.
 *
 * ── THE 5 MB CAP IS THE BUCKET'S, NOT A PREFERENCE ──────────────────────────
 * v1's insurance dialog validates against 10 MB
 * (`apps/booking/src/components/insurance-upload-dialog.tsx:20`) while
 * `customer-documents` enforces `file_size_limit = 5242880` — confirmed by
 * reading `storage.buckets` on staging, not assumed. So a 6 MB certificate
 * passes v1's check and then dies at the storage layer with a 413 that v1
 * swallows. Copying v1's number would copy that bug. If the product wants 10 MB
 * the BUCKET has to be raised first, on every project, and this constant then
 * follows it.
 */
export const INSURANCE_MIME_TYPES: readonly string[] = ACCEPTED_MIME_TYPES;

export const INSURANCE_MAX_BYTES = MAX_UPLOAD_BYTES;

/** Extensions, not MIME types: what a file input's `accept` wants. */
export const INSURANCE_ACCEPT_ATTRIBUTE = ACCEPTED_FILE_EXTENSIONS;

export const INSURANCE_FORMATS_LABEL = ACCEPTED_FORMATS_LABEL;

/** Matches MAX_INSURANCE_FILES in `booking-documents-link`. Kept in step by hand. */
export const MAX_INSURANCE_FILES = 12;

/**
 * The object name a file will be stored under.
 *
 * Deterministic — the sanitised original name, with NO timestamp. That is the
 * deliberate difference from v1, which prefixes `Date.now()` and uploads with
 * `upsert: false`, so every re-send of the same document leaves the previous
 * object behind forever with nothing pointing at it and no cleanup anywhere in
 * the repo. A stable name means "send policy.pdf again" REPLACES policy.pdf,
 * which is also exactly what the server does with the matching row.
 *
 * It is also the client's identity for a file, so the picker dedupes on this
 * rather than on the display name: two names that sanitise to the same object
 * are the same object, and letting both into the list would silently drop one.
 */
export function insuranceObjectName(fileName: string): string {
  const cleaned = fileName.trim().replace(/[^a-zA-Z0-9.-]/g, '_');
  return cleaned === '' || cleaned === '.' ? 'document' : cleaned;
}

/**
 * Say which limit was hit, before anything is uploaded.
 *
 * Every message names the limit and what to do about it. "Failed to upload
 * document" — v1's single message for all of these — is not something a
 * customer can act on.
 */
export function validateInsuranceFile(file: File): string | null {
  const type = file.type.toLowerCase();

  if (type === 'image/heic' || type === 'image/heif') {
    return (
      `“${file.name}” is in Apple’s HEIC format, which this bucket does not ` +
      'accept. In Settings › Camera › Formats choose “Most Compatible”, or open ' +
      'the file and export it as a PDF or JPG.'
    );
  }

  if (!INSURANCE_MIME_TYPES.includes(type)) {
    return `“${file.name}” is a ${file.type || 'file of unknown type'}. Please send a PDF, JPG or PNG.`;
  }

  if (file.size === 0) {
    return `“${file.name}” came through empty. Please choose it again.`;
  }

  if (file.size > INSURANCE_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const limitMb = Math.round(INSURANCE_MAX_BYTES / 1024 / 1024);
    return `“${file.name}” is ${mb} MB and the limit is ${limitMb} MB per file. Try sending the pages as separate files, or save the PDF at a smaller size.`;
  }

  return null;
}

/* ──────────────────────────── submitting them ──────────────────────────── */

/**
 * The action name on `booking-documents-link`. Additive: a server too old to
 * know it falls through to the `open` branch and answers with a session body,
 * which `submitInsurance` reports as a failure rather than a phantom success.
 */
const SUBMIT_ACTION = 'submit-insurance';

/** Where a single file has got to. Reported per file, in order. */
export type InsuranceFileState = 'queued' | 'uploading' | 'stored' | 'failed';

export interface SubmitBookingInsuranceInput {
  token: string;
  /** Server-issued. NEVER built in the browser — see the function's response. */
  uploadPrefix: string;
  files: readonly File[];
  /**
   * Per-file progress. `supabase-js` exposes no byte-level progress on an
   * upload, so this reports STATE per file rather than a percentage — the
   * screen turns "3 of 5 stored" into a determinate bar. Inventing a percentage
   * would be inventing the one number the customer is watching.
   */
  onFileState?: (index: number, state: InsuranceFileState, error?: string) => void;
}

export interface SubmitBookingInsuranceResult {
  /** How many documents the server filed against the booking. */
  submitted: number;
  /** `rentals.documents_status` as the server left it. Expected: 'submitted'. */
  documentsStatus: string | null;
}

const SUBMIT_FAILED_COPY =
  'Your files were stored, but we could not attach them to your booking. ' +
  'Nothing about your booking or your payment has changed — please try sending ' +
  'them again.';

/**
 * Put the files in the bucket, then ask the server to file them.
 *
 * ── THE BROWSER NEVER MARKS ANYTHING DONE ───────────────────────────────────
 * `rentals` has RLS OFF on staging with a full anon DML grant, so this file
 * could stamp `documents_status` itself in one statement. It does not, and must
 * not: that is a client writing the state its own gate is judged on, i.e. a
 * client that can be made to lie. It uploads bytes and reports paths. The
 * server verifies every path against a real storage listing, writes the
 * `customer_documents` rows the operator portal reads, and moves the rental.
 *
 * ── AND IT NEVER SAYS THE BOOKING IS CONFIRMED ──────────────────────────────
 * The server's terminal state here is `submitted` / `uploaded`, never
 * `verified`. An operator still reviews these and can still reject the booking.
 */
export function useSubmitBookingInsurance() {
  return useMutation<SubmitBookingInsuranceResult, Error, SubmitBookingInsuranceInput>({
    // Never retried automatically: each attempt re-uploads every file. The
    // customer presses the button.
    retry: false,
    mutationFn: async (input): Promise<SubmitBookingInsuranceResult> => {
      if (input.files.length === 0) {
        throw new Error('Please choose at least one file to send.');
      }
      if (input.files.length > MAX_INSURANCE_FILES) {
        throw new Error(`Please send no more than ${MAX_INSURANCE_FILES} files at a time.`);
      }

      const stored: { path: string; name: string; size: number; mimeType: string }[] = [];

      // Sequential, not `Promise.all`. Several concurrent multi-megabyte uploads
      // on a phone connection is how one of them times out, and a per-file
      // progress list would have nothing honest to say about which.
      for (let index = 0; index < input.files.length; index += 1) {
        const file = input.files[index];

        // Re-checked here as well as at selection time: this is the value the
        // bucket will actually judge, and a caller that skipped the picker
        // should still get a sentence rather than a raw 413.
        const rejection = validateInsuranceFile(file);
        if (rejection) {
          input.onFileState?.(index, 'failed', rejection);
          throw new Error(rejection);
        }

        input.onFileState?.(index, 'uploading');
        const path = `${input.uploadPrefix}/${insuranceObjectName(file.name)}`;

        const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, {
          // The REAL content type, unlike the identity flow this replaced, which
          // hardcoded image/jpeg. A PDF stored as image/jpeg is a PDF that will
          // not open for the operator who has to read it.
          contentType: file.type,
          cacheControl: '3600',
          // Re-sending the same document replaces it rather than 409-ing, which
          // is what makes "try again" safe to press twice and is why the object
          // name carries no timestamp.
          upsert: true,
        });

        if (error) {
          // The bucket's own message is kept: the difference between
          // "EntityTooLarge" and "InvalidMimeType" is the difference between two
          // completely different things for the customer to do.
          const message = `We could not store “${file.name}”. ${error.message}`;
          console.error('[useSubmitBookingInsurance] storage upload failed', {
            path,
            message: error.message,
          });
          input.onFileState?.(index, 'failed', message);
          throw new Error(message);
        }

        input.onFileState?.(index, 'stored');
        stored.push({
          path,
          // The ORIGINAL name, not the sanitised one: it is what the operator
          // sees in the portal and what the server matches an existing row on.
          name: file.name,
          size: file.size,
          mimeType: file.type,
        });
      }

      const { data, error } = await supabase.functions.invoke(LINK_FUNCTION, {
        body: { token: input.token, action: SUBMIT_ACTION, files: stored },
      });

      if (error) {
        const body = await readServerBody(error);
        console.error('[useSubmitBookingInsurance] filing failed', {
          status: statusOf(error),
          serverError: body?.error,
          detail: describe(error),
        });
        // Every failure branch of the action carries prose written for a
        // customer — "we could not find the files you sent", "please get in
        // touch" — so it is shown as written rather than flattened.
        const serverMessage = asString(body?.error);
        throw new Error(
          serverMessage ?? (looksOffline() ? OFFLINE_COPY : SUBMIT_FAILED_COPY),
        );
      }

      const body = asRecord(data);
      if (body.ok !== true) {
        // Includes the "server too old to know this action" case: it answers a
        // 200 `open` body, which has no `submitted`, and must not be read as a
        // successful filing.
        console.error('[useSubmitBookingInsurance] unexpected response', body);
        throw new Error(SUBMIT_FAILED_COPY);
      }

      const submitted =
        typeof body.submitted === 'number' && Number.isFinite(body.submitted)
          ? body.submitted
          : stored.length;

      return { submitted, documentsStatus: asString(body.documentsStatus) };
    },
  });
}

/* ═════════════════════════ step one: identity ═════════════════════════════ */

/**
 * What may be sent as an identity photo.
 *
 * PDF IS EXCLUDED HERE AND ONLY HERE. A PDF is a perfectly good insurance
 * certificate and a useless input to a face match — `ai-face-match` hands the
 * bytes to Rekognition, which wants an image. The insurance step keeps all four
 * of the bucket's MIME types; this step takes the three that are pictures.
 */
export const IDENTITY_MIME_TYPES: readonly string[] = ACCEPTED_MIME_TYPES.filter(
  (type) => type !== 'application/pdf',
);

/** The bucket's own 5 MB `file_size_limit`, same as everywhere else. */
export const IDENTITY_MAX_BYTES = MAX_UPLOAD_BYTES;

export const IDENTITY_ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png';

export const IDENTITY_FORMATS_LABEL = 'JPG or PNG, up to 5 MB';

/**
 * Say which limit was hit, before anything is uploaded.
 *
 * Same rule as `validateInsuranceFile`: every message names the limit and what
 * to do about it. "Failed to upload document" is not something a customer can
 * act on.
 */
export function validateIdentityPhoto(file: File): string | null {
  const type = file.type.toLowerCase();

  if (type === 'image/heic' || type === 'image/heif') {
    return (
      'That photo is in Apple’s HEIC format, which this bucket does not accept. ' +
      'In Settings › Camera › Formats choose “Most Compatible”, then take it again.'
    );
  }

  if (type === 'application/pdf') {
    return 'This step needs a photo rather than a PDF. Take a picture of the document itself.';
  }

  if (!IDENTITY_MIME_TYPES.includes(type)) {
    return `That file is a ${file.type || 'file of unknown type'}. Please send a JPG or PNG photo.`;
  }

  if (file.size === 0) {
    return 'That photo came through empty. Please take or choose it again.';
  }

  if (file.size > IDENTITY_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const limitMb = Math.round(IDENTITY_MAX_BYTES / 1024 / 1024);
    return `That photo is ${mb} MB and the limit is ${limitMb} MB. Taking it with the camera button usually produces a smaller file.`;
  }

  return null;
}

/**
 * The three object names, exactly.
 *
 * `ai-verification/<sessionId>/<kind>.jpg` IS A CONTRACT. It is what v1's QR
 * capture writes (`apps/booking/src/app/verify/[token]/page.tsx:355`) and what
 * the portal's document viewers read, and `booking-documents-link` pins every
 * submitted path against the prefix it issued. The session id is never
 * constructed here — it is whatever `start-identity` handed back.
 */
export type IdentitySlot = 'front' | 'back' | 'selfie';

const IDENTITY_OBJECT: Record<IdentitySlot, string> = {
  front: 'document-front.jpg',
  back: 'document-back.jpg',
  selfie: 'selfie.jpg',
};

const IDENTITY_LABEL: Record<IdentitySlot, string> = {
  front: 'the front of your document',
  back: 'the back of your document',
  selfie: 'your photo',
};

const START_IDENTITY_ACTION = 'start-identity';
const SUBMIT_IDENTITY_ACTION = 'submit-identity';

export interface BookingIdentitySession {
  /** Minted server-side. The scoping segment of every upload path below. */
  sessionId: string;
  /** `ai-verification/<sessionId>`. Issued by the server, never derived here. */
  uploadPrefix: string;
}

const IDENTITY_UNAVAILABLE_COPY =
  'We could not start the identity check just now. Nothing about your booking ' +
  'has changed — please try again in a moment.';

/**
 * "I am starting the identity step."
 *
 * ── CALL THIS ON A PRESS, NEVER ON A RENDER ─────────────────────────────────
 * This is the only thing in the flow that mints an `identity_verifications`
 * session, and minting is not free: `create-ai-verification-session` caps a
 * customer at TEN an hour and sets `customers.identity_verification_status =
 * 'pending'` as a side effect. The first build of this screen called the
 * equivalent on every page open, which meant ten refreshes locked a customer
 * out of their own paid booking and left a false status on their record. So
 * there is no `useEffect` anywhere near this hook: the customer presses "Start",
 * and only then does a session exist.
 *
 * The server reuses an unprocessed session rather than minting a second one, so
 * pressing Start, going back and pressing it again costs nothing.
 */
export function useStartBookingIdentity() {
  return useMutation<BookingIdentitySession, Error, { token: string }>({
    // Not retried behind the customer's back: every attempt can consume one of
    // their ten sessions an hour.
    retry: false,
    mutationFn: async ({ token }): Promise<BookingIdentitySession> => {
      const { data, error } = await supabase.functions.invoke(LINK_FUNCTION, {
        body: { token, action: START_IDENTITY_ACTION },
      });

      if (error) {
        const body = await readServerBody(error);
        console.error('[useStartBookingIdentity] start failed', {
          status: statusOf(error),
          serverError: body?.error,
          detail: describe(error),
        });
        // `identity_rate_limited`, `identity_unavailable` and `no_customer` all
        // carry prose written for a customer, and each says something different
        // and useful. Shown as written.
        const serverMessage = asString(body?.error);
        throw new Error(
          serverMessage ?? (looksOffline() ? OFFLINE_COPY : IDENTITY_UNAVAILABLE_COPY),
        );
      }

      const body = asRecord(data);
      const sessionId = asString(body.sessionId);
      const uploadPrefix = asString(body.uploadPrefix);
      if (body.ok !== true || sessionId === null || uploadPrefix === null) {
        // Includes the "server too old to know this action" case: it falls
        // through to `open` and answers a session body with no sessionId, which
        // must not be read as a started identity step.
        console.error('[useStartBookingIdentity] unexpected response', body);
        throw new Error(IDENTITY_UNAVAILABLE_COPY);
      }

      return { sessionId, uploadPrefix };
    },
  });
}

/** Where a single photo has got to. Reported per slot. */
export type IdentityPhotoState = 'queued' | 'uploading' | 'stored' | 'failed';

export interface SubmitBookingIdentityInput {
  token: string;
  /** Server-issued. NEVER built in the browser — see `useStartBookingIdentity`. */
  uploadPrefix: string;
  front: File;
  /** The back of a passport does not exist. Genuinely optional. */
  back: File | null;
  selfie: File;
  onPhotoState?: (slot: IdentitySlot, state: IdentityPhotoState, error?: string) => void;
}

/**
 * What the identity step ends in, as the SERVER recorded it.
 *
 * There is no 'verified' here and there never will be. `process-ai-verification`
 * answers 'verified' or 'review_required' for a pass, and
 * `booking-documents-link` collapses both to 'submitted' before they reach the
 * browser — because what is true either way is that we have the photos and a
 * person will look at them. Whether the face match was GREEN or RETRY is the
 * operator's to read; a screen that told a customer they were "verified" would
 * be making a promise an operator can still take back.
 */
export type BookingIdentityOutcome = 'submitted' | 'rejected';

export interface SubmitBookingIdentityResult {
  identityStatus: BookingIdentityOutcome;
}

const IDENTITY_SUBMIT_FAILED_COPY =
  'Your photos were stored, but we could not finish the check. Nothing about ' +
  'your booking or your payment has changed — please try again.';

/**
 * Put the three photos in the bucket, then ask the server what they mean.
 *
 * ── THE BROWSER NEVER WRITES THE OUTCOME ────────────────────────────────────
 * v1's capture page writes `verification_step` and `upload_progress` straight
 * from the browser (`apps/booking/src/app/verify/[token]/page.tsx:67-90`,
 * `:265-275`), and `anon` can reach `identity_verifications`. That is a client
 * writing the state its own gate is judged on. None of it is ported.
 *
 * It is also why this does NOT call `process-ai-verification` directly, which
 * is what the deleted version of this file did. Going through
 * `booking-documents-link` means the server pins every path against the prefix
 * it issued, runs the AI pass itself, and is the only writer of
 * `booking_document_links.identity_status` — a column no browser can reach.
 *
 * ── AND IT NEVER SAYS THE BOOKING IS CONFIRMED ──────────────────────────────
 * The best answer this returns is 'submitted'. An operator still reviews the
 * booking and can still reject it, and `notify-booking-approved` is the only
 * thing in the product that says "confirmed".
 */
export function useSubmitBookingIdentity() {
  return useMutation<SubmitBookingIdentityResult, Error, SubmitBookingIdentityInput>({
    // Never retried automatically: each attempt re-uploads three objects and
    // re-runs a paid OCR and face-match pass. The customer presses the button.
    retry: false,
    mutationFn: async (input): Promise<SubmitBookingIdentityResult> => {
      const queue: { slot: IdentitySlot; file: File }[] = [
        { slot: 'front', file: input.front },
        ...(input.back ? [{ slot: 'back' as const, file: input.back }] : []),
        { slot: 'selfie', file: input.selfie },
      ];

      const paths: Partial<Record<IdentitySlot, string>> = {};

      // Sequential, not `Promise.all`. Three concurrent multi-megabyte uploads
      // on a phone connection is how one of them times out, and a per-photo
      // status list would have nothing honest to say about which.
      for (const { slot, file } of queue) {
        // Re-checked here as well as at capture time: this is the value the
        // bucket will actually judge.
        const rejection = validateIdentityPhoto(file);
        if (rejection) {
          input.onPhotoState?.(slot, 'failed', rejection);
          throw new Error(rejection);
        }

        input.onPhotoState?.(slot, 'uploading');
        const path = `${input.uploadPrefix}/${IDENTITY_OBJECT[slot]}`;

        const { error } = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, file, {
          /*
            `image/jpeg` and a `.jpg` name regardless of the real bytes, because
            the path is a CONTRACT (see IDENTITY_OBJECT). A PNG therefore travels
            mislabelled — which is v1's behaviour too, and it works because both
            consumers sniff the bytes: `ai-face-match` base64s them for
            Rekognition and `ai-document-ocr` wraps them in a
            `data:image/jpeg;base64,` URI. Worth knowing before anyone "fixes"
            the content type: the FILENAME is the part the portal depends on.
          */
          contentType: 'image/jpeg',
          // A retake must replace the first attempt rather than 409, which is
          // what makes "try again" safe to press twice.
          upsert: true,
        });

        if (error) {
          const message = `We could not store ${IDENTITY_LABEL[slot]}. ${error.message}`;
          console.error('[useSubmitBookingIdentity] storage upload failed', {
            path,
            message: error.message,
          });
          input.onPhotoState?.(slot, 'failed', message);
          throw new Error(message);
        }

        input.onPhotoState?.(slot, 'stored');
        paths[slot] = path;
      }

      const { data, error } = await supabase.functions.invoke(LINK_FUNCTION, {
        body: {
          token: input.token,
          action: SUBMIT_IDENTITY_ACTION,
          // PATHS, not URLs. The server resolves them against the bucket.
          documentFrontPath: paths.front,
          documentBackPath: paths.back ?? null,
          selfiePath: paths.selfie,
        },
      });

      if (error) {
        const body = await readServerBody(error);
        console.error('[useSubmitBookingIdentity] check failed', {
          status: statusOf(error),
          serverError: body?.error,
          detail: describe(error),
        });
        /*
          `identity_unavailable` is the one worth knowing about: the server
          answers it when the AI pass could not RUN (its OCR or face-match
          provider was unusable) rather than when it judged the photos. Its
          prose says "we could not check your photos just now", not "we could
          not read them", and the identity step stays where it was — so it is
          shown verbatim rather than flattened into a rejection.
        */
        const serverMessage = asString(body?.error);
        throw new Error(
          serverMessage ?? (looksOffline() ? OFFLINE_COPY : IDENTITY_SUBMIT_FAILED_COPY),
        );
      }

      const body = asRecord(data);
      const outcome = body.identityStatus;
      if (body.ok !== true || (outcome !== 'submitted' && outcome !== 'rejected')) {
        console.error('[useSubmitBookingIdentity] unexpected response', body);
        throw new Error(IDENTITY_SUBMIT_FAILED_COPY);
      }

      return { identityStatus: outcome };
    },
  });
}
