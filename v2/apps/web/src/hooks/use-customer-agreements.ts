'use client';

/**
 * The signed-in customer's rental agreements (BoldSign envelopes).
 *
 * ── THE ISOLATION BOUNDARY ──────────────────────────────────────────────────
 * `rental_agreements` carries `tenant_id` but NOT `customer_id` — the customer
 * is two joins away, through `rentals`. RLS is off on staging and `anon` holds
 * a SELECT grant, so an unscoped read returns every tenant's signing history.
 * The scoping here is therefore load-bearing, and it is two filters:
 *
 *   .eq('tenant_id', tenantId)      — never the bare tenant, but a hard floor
 *   .in('rental_id', rentalIds)     — where rentalIds came from a query that
 *                                     was ITSELF filtered on customer_id AND
 *                                     tenant_id (see `use-customer-rentals`)
 *
 * The rental ids are taken from `useCustomerRentals`, not re-derived here, so
 * there is exactly one place in the portal that decides which rentals belong to
 * the signed-in customer. A second, independently-written `select('id')` on
 * `rentals` is a second chance to forget a filter; v1 has one and it omits
 * `tenant_id`.
 *
 * There is deliberately no `customerId` / `rentalId` parameter on this hook. An
 * id that can be passed in is an id that can be swapped.
 *
 * ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────
 * v1 offers a "Sign" button and an in-page PDF preview of UNSIGNED envelopes.
 * Both go through `/api/esign/sign` and `/api/esign/view`, Next route handlers
 * that hold the BoldSign API key server-side. Neither route exists in v2 and
 * neither can be replaced from the client: the key cannot ship to the browser.
 *
 * The `get-boldsign-document` edge function is NOT a substitute. It takes a
 * caller-supplied `rentalId`, resolves it with the service-role client and
 * performs no ownership check at all — any signed-in customer of any tenant
 * could read any rental's agreement through it. Wiring the portal to it would
 * turn a missing feature into an IDOR.
 *
 * So this hook exposes the SIGNED copy only: `signed_document.file_url`, which
 * the BoldSign webhook files into storage on completion, reached through a row
 * this query already proved belongs to the customer. Everything else is status.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useTenant } from '@/contexts/TenantContext';
import { useCustomer } from '@/hooks/use-customer';
import { useCustomerRentals } from '@/hooks/use-customer-rentals';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

/* ────────────────────────────── row shapes ─────────────────────────────── */

type AgreementRow = Database['public']['Tables']['rental_agreements']['Row'];
type CustomerDocumentRow = Database['public']['Tables']['customer_documents']['Row'];

/**
 * The agreement columns a customer may read.
 *
 * A `Pick` rather than a hand-written interface so a column that does not exist
 * fails to compile here instead of 400-ing at runtime — PostgREST rejects the
 * ENTIRE row for one unknown name, so a single typo does not blank one field,
 * it empties the whole page.
 *
 * Deliberately absent:
 *   • `boldsign_mode` — whether the operator is running BoldSign in sandbox.
 *     A sandbox document is watermarked and auto-deleted after 14 days; that is
 *     the operator's configuration problem, not customer copy, and the honest
 *     way to withhold a field is to never fetch it.
 *   • `email_delivery_status` / `email_delivery_error` / `email_delivered_at` —
 *     bounce diagnostics for the operator's outbox.
 *   • `updated_at` — a row-maintenance timestamp with no customer meaning; the
 *     three `envelope_*` stamps are the ones that describe what happened.
 */
type CustomerAgreementColumns = Pick<
  AgreementRow,
  | 'id'
  | 'rental_id'
  | 'tenant_id'
  | 'agreement_type'
  | 'document_id'
  | 'document_status'
  | 'envelope_created_at'
  | 'envelope_sent_at'
  | 'envelope_completed_at'
  | 'signed_document_id'
  | 'period_start_date'
  | 'period_end_date'
  | 'created_at'
>;

/**
 * The stored signed PDF, embedded through
 * `rental_agreements_signed_document_id_fkey`.
 *
 * Four columns out of thirty-two. `customer_documents` also carries
 * `ai_extracted_data`, `fraud_risk_score`, `review_reasons` and
 * `verification_decision` — the operator's assessment OF this customer. None of
 * it belongs in a select the customer's own browser issues.
 */
type EmbeddedSignedDocument = Pick<
  CustomerDocumentRow,
  'id' | 'file_url' | 'file_name' | 'document_name'
>;

export type CustomerAgreementQueryRow = CustomerAgreementColumns & {
  signed_document: EmbeddedSignedDocument | null;
};

/**
 * `signed_document:customer_documents ( … )` is an alias over a to-ONE embed —
 * `signed_document_id` is a plain FK column, so PostgREST returns an object
 * here, not an array.
 *
 * The order clause on the query is `created_at` on the ROOT table. Do not add
 * `.order(…, { referencedTable: 'signed_document' })`: PostgREST only accepts
 * an order referencing a top-level embed of a to-MANY relationship, and asking
 * it to sort a to-one embed returns 400 PGRST108 and empties the page. There is
 * nothing to sort — there is at most one signed document per agreement.
 */
const AGREEMENT_SELECT = [
  'id',
  'rental_id',
  'tenant_id',
  'agreement_type',
  'document_id',
  'document_status',
  'envelope_created_at',
  'envelope_sent_at',
  'envelope_completed_at',
  'signed_document_id',
  'period_start_date',
  'period_end_date',
  'created_at',
  'signed_document:customer_documents ( id, file_url, file_name, document_name )',
].join(', ');

/* ───────────────────────────── view model ──────────────────────────────── */

/** An original rental agreement, or the addendum that extended one. */
export type AgreementKind = 'original' | 'extension';

/**
 * How an agreement reads on screen.
 *
 * BoldSign's own vocabulary ('sent', 'delivered', 'completed', 'voided') is not
 * shown raw: "delivered" means the customer OPENED it, which is the opposite of
 * what the word suggests in an email context, and "voided" is a word nobody
 * outside e-signature software uses.
 */
export type AgreementState =
  | 'preparing'
  | 'awaiting_signature'
  | 'opened'
  | 'signed'
  | 'declined'
  | 'cancelled'
  | 'expired';

export interface AgreementDocument {
  id: string;
  /** Public storage URL of the signed PDF, or a bare bucket path on old rows. */
  url: string;
  /** Suggested filename for a download. Always non-empty. */
  fileName: string;
}

export interface CustomerAgreement {
  id: string;
  rentalId: string;
  kind: AgreementKind;
  state: AgreementState;
  /** Raw DB value, kept so a support conversation can quote it exactly. */
  statusRaw: string | null;

  /** The BoldSign envelope. Null means no document was ever raised. */
  documentId: string | null;
  createdAt: string | null;
  /** timestamptz — the moment the envelope was sent for signature. */
  sentAt: string | null;
  /** timestamptz — the moment the last signature landed. */
  completedAt: string | null;

  /** DATE-only 'YYYY-MM-DD'. Extensions only; null on an original. */
  periodStartDate: string | null;
  periodEndDate: string | null;

  /** From the rental this agreement belongs to. Null if it is not in the cache. */
  rentalReference: string | null;
  rentalStartDate: string | null;
  rentalEndDate: string | null;
  vehicleLabel: string | null;

  /** The filed signed PDF. Null until the BoldSign webhook stores it. */
  signedDocument: AgreementDocument | null;
  /** The signature process finished. Says nothing about the PDF being filed yet. */
  isSigned: boolean;
  /** Still open and still the customer's move. */
  needsSignature: boolean;
}

export interface CustomerAgreementSummary {
  total: number;
  signed: number;
  awaiting: number;
}

export interface UseCustomerAgreementsResult {
  agreements: CustomerAgreement[];
  summary: CustomerAgreementSummary;
  isLoading: boolean;
  /** True on a background poll or an explicit refresh, false on first load. */
  isRefreshing: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/* ──────────────────────────── normalisation ────────────────────────────── */

const STATE_BY_STATUS: Record<string, AgreementState> = {
  sent: 'awaiting_signature',
  // BoldSign's "delivered" is a READ receipt, not a delivery receipt.
  delivered: 'opened',
  viewed: 'opened',
  signed: 'signed',
  completed: 'signed',
  declined: 'declined',
  voided: 'cancelled',
  revoked: 'cancelled',
  expired: 'expired',
};

/**
 * The five buckets, from the raw status plus what we can see of the document.
 *
 * A row whose status is unrecognised but whose signed PDF is already filed is
 * treated as signed: the artefact outranks the label. The reverse default is
 * 'preparing' rather than 'awaiting_signature', because telling a customer to
 * sign something that has not been sent to them is a dead end.
 */
export function agreementState(
  status: string | null,
  hasSignedDocument: boolean,
): AgreementState {
  const key = (status ?? '').trim().toLowerCase();
  const mapped = STATE_BY_STATUS[key];
  if (mapped) return mapped;
  return hasSignedDocument ? 'signed' : 'preparing';
}

const TERMINAL_STATES: ReadonlySet<AgreementState> = new Set<AgreementState>([
  'signed',
  'declined',
  'cancelled',
  'expired',
]);

function normalizeKind(value: string | null): AgreementKind {
  return (value ?? '').trim().toLowerCase() === 'extension' ? 'extension' : 'original';
}

/** "rental-agreement-R-4f2a91.pdf" — never an empty `download` attribute. */
function fallbackFileName(reference: string | null, agreementId: string): string {
  return `rental-agreement-${reference ?? agreementId.slice(0, 8)}.pdf`;
}

function normalizeAgreement(
  row: CustomerAgreementQueryRow,
  rental: {
    reference: string;
    startDate: string;
    endDate: string | null;
    vehicleLabel: string | null;
  } | null,
): CustomerAgreement {
  const url = row.signed_document?.file_url?.trim() || null;
  const hasSignedDocument = url !== null;
  const state = agreementState(row.document_status, hasSignedDocument);
  const reference = rental?.reference ?? null;

  return {
    id: row.id,
    rentalId: row.rental_id,
    kind: normalizeKind(row.agreement_type),
    state,
    statusRaw: row.document_status,

    documentId: row.document_id,
    createdAt: row.created_at ?? row.envelope_created_at,
    sentAt: row.envelope_sent_at,
    completedAt: row.envelope_completed_at,

    periodStartDate: row.period_start_date,
    periodEndDate: row.period_end_date,

    rentalReference: reference,
    rentalStartDate: rental?.startDate ?? null,
    rentalEndDate: rental?.endDate ?? null,
    vehicleLabel: rental?.vehicleLabel ?? null,

    signedDocument:
      url !== null && row.signed_document
        ? {
            id: row.signed_document.id,
            url,
            fileName:
              row.signed_document.file_name?.trim() ||
              row.signed_document.document_name?.trim() ||
              fallbackFileName(reference, row.id),
          }
        : null,
    isSigned: state === 'signed',
    // An envelope exists, nothing terminal has happened to it, and no signed
    // copy has landed. `document_id` is required: without an envelope there is
    // nothing for the customer to sign yet, whatever the status column says.
    needsSignature:
      row.document_id !== null && !TERMINAL_STATES.has(state) && !hasSignedDocument,
  };
}

export function summariseAgreements(
  agreements: readonly CustomerAgreement[],
): CustomerAgreementSummary {
  let signed = 0;
  let awaiting = 0;
  for (const agreement of agreements) {
    if (agreement.isSigned) signed += 1;
    if (agreement.needsSignature) awaiting += 1;
  }
  return { total: agreements.length, signed, awaiting };
}

/* ─────────────────────────────── the hook ──────────────────────────────── */

/**
 * Every agreement raised against one of the customer's rentals, newest first.
 *
 * Rentals are read through `useCustomerRentals`, which the bookings page and
 * the overview have almost always warmed already, so this usually costs one
 * extra round trip rather than two. It also means the vehicle name and booking
 * reference beside each agreement are the SAME strings the bookings list shows,
 * derived once — v1 re-fetches `vehicles` under `rental_agreements` and can
 * print a registration the tenant's `hide_vehicle_registration` setting says to
 * withhold.
 */
export function useCustomerAgreements(): UseCustomerAgreementsResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { customerId, isLoading: authLoading } = useCustomer();
  const {
    rentals,
    isLoading: rentalsLoading,
    isError: rentalsIsError,
    error: rentalsError,
    refetch: refetchRentals,
  } = useCustomerRentals('all');

  const tenantId = tenant?.id ?? null;

  // Sorted so the query key is stable: React Query hashes the key, and an
  // unsorted list would produce a new key — and a fresh fetch — every time the
  // rentals query returned the same rows in a different order.
  const rentalIds = useMemo(
    () => rentals.map((rental) => rental.id).sort(),
    [rentals],
  );

  const rentalsById = useMemo(
    () =>
      new Map(
        rentals.map((rental) => [
          rental.id,
          {
            reference: rental.reference,
            startDate: rental.startDate,
            endDate: rental.endDate,
            vehicleLabel: rental.vehicle?.displayLabel ?? null,
          },
        ]),
      ),
    [rentals],
  );

  // Not until we know which rentals are the customer's. Running early would
  // fetch with an empty id list and cache an empty result for a customer who
  // has agreements. Computed here rather than read back off the query result so
  // the loading flag below cannot drift from the `enabled` it describes.
  const enabled = !!customerId && !!tenantId && !rentalsLoading && !rentalsIsError;

  const query = useQuery({
    // Both ids are in the key, and so is the rental set: one customer signing
    // out and another signing in on the same browser must not be served the
    // first one's agreements out of cache.
    queryKey: ['customer-agreements', tenantId, customerId, rentalIds],
    queryFn: async (): Promise<CustomerAgreementQueryRow[]> => {
      if (!tenantId || rentalIds.length === 0) return [];

      const { data, error } = await supabase
        .from('rental_agreements')
        .select(AGREEMENT_SELECT)
        // Read the file header before touching either of these.
        .eq('tenant_id', tenantId)
        .in('rental_id', rentalIds)
        // Parity with v1: a row with no envelope is a stub the operator's
        // tooling created and abandoned. There is nothing to show, nothing to
        // sign and nothing to download, so it is not an agreement yet.
        .not('document_id', 'is', null)
        // Root-table order. See the note on AGREEMENT_SELECT for why there is
        // no `referencedTable` order here. Nulls last so a migrated row with no
        // timestamp cannot squat the first slot.
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<CustomerAgreementQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerAgreements] Failed to load agreements', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your agreements');
      }

      return data ?? [];
    },
    enabled,
    // Signing happens OFF this page — the customer follows the link we emailed
    // them, signs in BoldSign, and comes back to this tab. Nothing in that
    // journey touches our client, so without these two the page keeps showing
    // "Awaiting your signature" over a document they have already signed.
    refetchOnWindowFocus: true,
    refetchInterval: (fresh) => {
      const rows = fresh.state.data;
      if (!rows) return false;
      const anyOpen = rows.some(
        (row) =>
          row.document_id !== null &&
          !TERMINAL_STATES.has(
            agreementState(row.document_status, !!row.signed_document?.file_url),
          ),
      );
      return anyOpen ? 30_000 : false;
    },
  });

  const agreements = useMemo(
    () =>
      (query.data ?? []).map((row) =>
        normalizeAgreement(row, rentalsById.get(row.rental_id) ?? null),
      ),
    [query.data, rentalsById],
  );

  const summary = useMemo(() => summariseAgreements(agreements), [agreements]);

  const refetch = useCallback(async () => {
    // Rentals first: an agreement raised against a booking made since this page
    // loaded is invisible until the rental id set includes it.
    await refetchRentals();
    await query.refetch();
  }, [query, refetchRentals]);

  return {
    agreements,
    summary,
    // The tenant, auth and rentals round-trips are all part of this hook's load
    // from the caller's point of view: until they land `enabled` is false and
    // React Query reports idle, so reading `isPending` alone flashes "no
    // agreements" at a customer who has several.
    isLoading:
      tenantLoading ||
      authLoading ||
      rentalsLoading ||
      (enabled && query.isPending && query.fetchStatus !== 'idle'),
    isRefreshing: query.isFetching && !query.isPending,
    isError: query.isError || rentalsIsError,
    error: query.error ?? rentalsError,
    refetch,
  };
}

/* ───────────────────────── downloading a signed PDF ────────────────────── */

const SIGNED_DOCUMENT_BUCKET = 'customer-documents';

/**
 * Pull the signed PDF down as a file rather than navigating to it.
 *
 * The webhook writes a fully-qualified public storage URL, so the common path
 * is `fetch` → blob → a synthetic `<a download>`. That indirection is not
 * decoration: `<a download href="https://…supabase.co/…">` is cross-origin, and
 * browsers IGNORE `download` cross-origin — the link would navigate away from
 * the portal into a PDF viewer instead of saving anything.
 *
 * Rows migrated from before the webhook stored a bare bucket path. Those go
 * through the storage client, which resolves them relative to the bucket.
 *
 * Throws on failure. The caller renders the message inline: there is no
 * `<Toaster>` mounted in this app, so a `toast.error` here would be silent.
 */
export async function downloadSignedAgreement(
  document_: AgreementDocument,
): Promise<void> {
  const blob = document_.url.startsWith('http')
    ? await fetchRemoteBlob(document_.url)
    : await downloadFromStorage(document_.url);

  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = window.document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = document_.fileName;
    anchor.rel = 'noopener';
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // A revoke in the same tick can cancel the download in Safari; one frame is
    // enough for the click to have been consumed.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

async function fetchRemoteBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `We could not fetch your signed agreement (${response.status}). Try opening it instead.`,
    );
  }
  return response.blob();
}

async function downloadFromStorage(path: string): Promise<Blob> {
  const objectPath = path.replace(`${SIGNED_DOCUMENT_BUCKET}/`, '');
  const { data, error } = await supabase.storage
    .from(SIGNED_DOCUMENT_BUCKET)
    .download(objectPath);

  if (error || !data) {
    throw new Error(
      error?.message ?? 'We could not fetch your signed agreement. Try opening it instead.',
    );
  }
  return data;
}
