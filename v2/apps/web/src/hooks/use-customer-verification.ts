'use client';

/**
 * The signed-in customer's identity checks.
 *
 * ── THE ISOLATION BOUNDARY IS THIS FILE ─────────────────────────────────────
 * `identity_verifications` behaves exactly like `rentals` on staging: RLS is
 * effectively off and `anon` holds both SELECT and UPDATE on the whole table.
 * Verified live against ksmreaadhbirzakkxqrq — a request carrying only the
 * public anon key read back a row belonging to nobody in particular and then
 * PATCHed it. So the `.eq('customer_id', …).eq('tenant_id', …)` pair below is
 * the ONLY thing standing between one customer and another customer's passport
 * scan, date of birth and document number. Both filters, every query, always.
 *
 * The customer id comes from the auth store. There is deliberately no
 * `customerId` parameter — an id that can be passed in is an id that can be
 * swapped, and the payload here is identity documents.
 *
 * ── WHY THE COLUMN LIST IS SHORT ────────────────────────────────────────────
 * v1 runs `select('*')`, which hands the browser `qr_session_token`,
 * `verification_token` and `cmd_magic_link` — every one of them a BEARER
 * credential for the capture flow — plus `moderator_comment`, `verified_by`
 * and `rejection_reason`. That last one reads
 * `Blocked identity: <operator's private note>` on one code path in
 * `process-ai-verification`, so rendering it verbatim would leak the
 * operator's blocklist reasoning to the person it is about. None of them are
 * selected here.
 *
 * The list is a `Pick` over the generated Row so a column that does not exist
 * fails to COMPILE rather than 400-ing at runtime — PostgREST rejects the whole
 * row for a single unknown name, so one typo does not blank a field, it empties
 * the page. (v1's hand-written interface claims a `full_name` column. There is
 * no such column.)
 *
 * ── WHY IT POLLS INSTEAD OF SUBSCRIBING ─────────────────────────────────────
 * v1 watches an in-flight check over a Supabase Realtime channel. On staging
 * that channel is silent: `identity_verifications` is not in the
 * `supabase_realtime` publication, which was confirmed by subscribing with the
 * anon key and then updating a row with the service role — SUBSCRIBED, then no
 * event. A progress panel wired to that channel would sit at "Waiting for scan"
 * forever while the check completed behind it. This hook polls instead, and
 * only while something is actually in flight.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useTenant } from '@/contexts/TenantContext';
import { useCustomer } from '@/hooks/use-customer';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type IdentityVerificationRow =
  Database['public']['Tables']['identity_verifications']['Row'];

/** The verification columns a customer may read. See the header for exclusions. */
export type CustomerVerificationRow = Pick<
  IdentityVerificationRow,
  | 'id'
  | 'customer_id'
  | 'tenant_id'
  | 'session_id'
  | 'provider'
  | 'verification_provider'
  | 'status'
  | 'review_status'
  | 'review_result'
  | 'verification_step'
  | 'upload_progress'
  | 'ai_face_match_score'
  | 'ai_face_match_result'
  | 'document_type'
  | 'document_number'
  | 'document_country'
  | 'document_expiry_date'
  | 'document_issuing_date'
  | 'first_name'
  | 'last_name'
  | 'date_of_birth'
  | 'document_front_url'
  | 'document_back_url'
  | 'selfie_image_url'
  | 'face_image_url'
  | 'qr_session_expires_at'
  | 'verification_completed_at'
  | 'created_at'
  | 'updated_at'
>;

const VERIFICATION_SELECT = [
  'id',
  'customer_id',
  'tenant_id',
  'session_id',
  'provider',
  'verification_provider',
  'status',
  'review_status',
  'review_result',
  'verification_step',
  'upload_progress',
  'ai_face_match_score',
  'ai_face_match_result',
  'document_type',
  'document_number',
  'document_country',
  'document_expiry_date',
  'document_issuing_date',
  'first_name',
  'last_name',
  'date_of_birth',
  'document_front_url',
  'document_back_url',
  'selfie_image_url',
  'face_image_url',
  'qr_session_expires_at',
  'verification_completed_at',
  'created_at',
  'updated_at',
] satisfies readonly (keyof CustomerVerificationRow)[];

/**
 * Compile-time proof the select list and the `Pick` cannot drift. `satisfies`
 * above rejects a name that is not on the type; this rejects a name that is on
 * the type but missing from the select, which would leave a field typed as
 * present and `undefined` forever.
 */
type AssertTrue<T extends true> = T;
type _EveryVerificationColumnIsSelected = AssertTrue<
  [
    Exclude<keyof CustomerVerificationRow, (typeof VERIFICATION_SELECT)[number]>,
  ] extends [never]
    ? true
    : false
>;

const VERIFICATION_SELECT_CLAUSE = VERIFICATION_SELECT.join(', ');

/* ───────────────────────────── derived shapes ──────────────────────────── */

/**
 * What the customer is actually looking at.
 *
 * Deliberately NOT a re-export of `status` / `review_result`. Those two carry
 * five vocabularies between them — `init`/`processing`/`completed` from the AI
 * pipeline, `pending` from the Veriff pre-insert, `GREEN`/`RED`/`RETRY` from
 * the AI decision and `GREEN`/`RED`/`YELLOW` from Veriff's webhook — and every
 * screen that branches on the raw pair gets one of them wrong.
 */
export type VerificationOutcome =
  /** Nothing on file, and the operator has not vouched for them either. */
  | 'none'
  /** A check was started and the photos are still being taken or processed. */
  | 'in_progress'
  /** Submitted, and a person has to look at it. Veriff YELLOW / AI RETRY. */
  | 'in_review'
  | 'approved'
  | 'rejected'
  /** The one-time capture link lapsed before the photos were finished. */
  | 'expired';

export type DocumentExpiryState = 'valid' | 'expiring' | 'expired';

/** Where an in-flight check has got to. */
export interface VerificationProgress {
  /** Raw `verification_step`, for the label lookup on the page. */
  step: string;
  documentFront: boolean;
  documentBack: boolean;
  selfie: boolean;
  /** When the capture link stops working. Null when none was recorded. */
  expiresAt: Date | null;
}

export interface UseCustomerVerificationResult {
  /** The most recent attempt, or null when there has never been one. */
  latest: CustomerVerificationRow | null;
  /** Every attempt, newest first. `latest` is `history[0]`. */
  history: CustomerVerificationRow[];

  outcome: VerificationOutcome;
  /**
   * True when `customers.identity_verification_status` says verified but no
   * approved check backs it — i.e. the operator ticked "manually verified"
   * after seeing the documents in person. v1 shows these customers "No
   * verification on file" and asks them to verify again, which is wrong and is
   * the reason this flag exists.
   */
  verifiedByOperator: boolean;

  progress: VerificationProgress | null;
  documentExpiry: DocumentExpiryState | null;

  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

/* ──────────────────────────────── helpers ──────────────────────────────── */

function parseUploadProgress(value: Json | null): {
  documentFront: boolean;
  documentBack: boolean;
  selfie: boolean;
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { documentFront: false, documentBack: false, selfie: false };
  }
  return {
    documentFront: value.document_front === true,
    documentBack: value.document_back === true,
    selfie: value.selfie === true,
  };
}

/**
 * `review_result` first, `status` second.
 *
 * The result column is the DECISION and the status column is only how far the
 * machinery got, so a row can read `status: 'completed'` while the decision is
 * a rejection. Reading status first — which v1's badge helper effectively does
 * for `approved`/`rejected` — would call a rejected check "complete".
 */
function outcomeFromRow(
  row: CustomerVerificationRow,
  now: Date,
): VerificationOutcome {
  const result = row.review_result?.toUpperCase() ?? null;

  if (result === 'GREEN') return 'approved';
  if (result === 'RED') return 'rejected';
  // Veriff's YELLOW and the AI pipeline's RETRY both mean "a human decides".
  if (result === 'YELLOW' || result === 'RETRY') return 'in_review';

  const status = row.status.toLowerCase();
  if (status === 'approved' || status === 'verified') return 'approved';
  if (status === 'rejected' || status === 'declined') return 'rejected';
  if (status === 'expired') return 'expired';

  // No decision yet. Either the capture is still running or its link lapsed.
  const expiresAt = row.qr_session_expires_at
    ? new Date(row.qr_session_expires_at)
    : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= now) {
    return 'expired';
  }

  // `processing` is past the customer's part — the photos are in, the OCR and
  // face match are running — but it is still not a decision.
  if (status === 'processing') return 'in_review';

  return 'in_progress';
}

/**
 * Date-only `document_expiry_date` compared against date-only "today".
 *
 * String comparison rather than `new Date(...)`: 'YYYY-MM-DD' sorts
 * lexicographically in calendar order, and it sidesteps the UTC-midnight trap
 * that makes `new Date('2026-09-01')` render as 31 August west of Greenwich.
 */
function documentExpiryState(
  expiry: string | null,
  now: Date,
): DocumentExpiryState | null {
  if (!expiry) return null;
  const day = expiry.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const todayKey = today.toISOString().slice(0, 10);
  if (day < todayKey) return 'expired';

  const soon = new Date(today.getTime() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return day <= soon ? 'expiring' : 'valid';
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

export function useCustomerVerification(): UseCustomerVerificationResult {
  const { customerId, customer } = useCustomer();
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const isReady = customerId !== null && tenantId !== null;

  const query = useQuery({
    queryKey: ['customer-verification', tenantId, customerId],
    enabled: isReady,
    queryFn: async (): Promise<CustomerVerificationRow[]> => {
      // Re-read rather than close over: `enabled` guarantees both are set by
      // the time this runs, and narrowing here keeps the non-null assertion
      // out of the file entirely.
      if (customerId === null || tenantId === null) return [];

      const { data, error } = await supabase
        .from('identity_verifications')
        .select(VERIFICATION_SELECT_CLAUSE)
        // Read the file header before touching either of these.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        // `created_at` is nullable on this table. Nulls last so a legacy row
        // with no timestamp cannot squat the first slot and be mistaken for the
        // current attempt.
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<CustomerVerificationRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerVerification] Failed to load verifications', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message);
      }

      return data ?? [];
    },
    /*
      A customer starts a check here, walks through it on their phone, then
      comes back to this tab. The global default is `refetchOnWindowFocus:
      false`, which means that returning to a finished check would still show
      "in progress" until something else invalidated the cache. Overridden for
      the same reason the billing queries override it in the portal app.
    */
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    /*
      This is what replaces v1's Realtime channel (see the file header). It runs
      ONLY while something is unfinished, so a customer sitting on a verified
      page issues no traffic at all. Five seconds while the photos are being
      taken — the customer is watching the step list move — and thirty while a
      human review is outstanding, which resolves in hours, not seconds.
    */
    refetchInterval: (query) => {
      const current = query.state.data;
      if (!current || current.length === 0) return false;
      const outcome = outcomeFromRow(current[0], new Date());
      if (outcome === 'in_progress') return 5_000;
      if (outcome === 'in_review') return 30_000;
      return false;
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  return useMemo<UseCustomerVerificationResult>(() => {
    const now = new Date();
    const latest = rows[0] ?? null;

    const customerStatus = customer?.identity_verification_status ?? null;
    const operatorSaysVerified =
      customerStatus === 'verified' || customerStatus === 'manually_verified';

    const rowOutcome = latest ? outcomeFromRow(latest, now) : 'none';

    /*
      Two sources, and only ONE direction of override.

      `customers.identity_verification_status` can say verified when no
      `identity_verifications` row exists at all: the operator took the licence
      across the counter and ticked "manually verified". That customer IS
      verified, and v1 — which reads only the row — tells them they have nothing
      on file and asks them to verify again. So the column may UPGRADE the
      verdict.

      It may not downgrade it. The column is a denormalised cache written by
      four different edge functions (`process-ai-verification`,
      `veriff-webhook`, `create-*-session`, `submit-customer-registration`);
      the row is the record of the check itself. When a cache disagrees with
      its source the honest reading is that the cache is stale, and quietly
      turning an approved check into "being reviewed" on the strength of it
      would invent a problem the customer cannot act on.
    */
    const outcome: VerificationOutcome = operatorSaysVerified
      ? 'approved'
      : rowOutcome;

    const verifiedByOperator = operatorSaysVerified && rowOutcome !== 'approved';

    const progress: VerificationProgress | null =
      latest && outcome === 'in_progress'
        ? {
            step: latest.verification_step ?? 'init',
            ...parseUploadProgress(latest.upload_progress),
            expiresAt: latest.qr_session_expires_at
              ? new Date(latest.qr_session_expires_at)
              : null,
          }
        : null;

    return {
      latest,
      history: rows,
      outcome,
      verifiedByOperator,
      progress,
      documentExpiry: documentExpiryState(
        latest?.document_expiry_date ?? null,
        now,
      ),
      // "We do not know yet" covers BOTH the fetch and the tick before the
      // auth store has produced a customer id — without the second half the
      // page would flash its "nothing on file" empty state on every load.
      isLoading: !isReady || query.isPending,
      isError: query.isError,
      error: query.error instanceof Error ? query.error : null,
      refetch: query.refetch,
    };
  }, [
    rows,
    isReady,
    customer?.identity_verification_status,
    query.isPending,
    query.isError,
    query.error,
    query.refetch,
  ]);
}
