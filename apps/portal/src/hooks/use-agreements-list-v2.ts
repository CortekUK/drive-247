'use client';

import { useQuery } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import type { AgreementRowV2 } from '@/lib/agreements-v2/types';
import { isMissingTableError, toStatusV2 } from '@/lib/agreements-v2/status';

/**
 * Agreements v2 — every agreement of the tenant, both kinds, in one list.
 *
 *  - Rental agreements: `rental_agreements`, joined to the rental (for its
 *    reference) and the rental's customer (name, email). Read only; how they
 *    are sent, voided and resent does not change.
 *  - Individual agreements: `individual_agreements_v2` (ops/agreements_v2.sql,
 *    NOT YET APPLIED). While that table does not exist it contributes nothing,
 *    and that is not an error: the list is simply the rental agreements.
 *
 * Both map to `AgreementRowV2` through `toStatusV2` (D16). Rows that come out
 * 'hidden' (voided/revoked: superseded by a resend) are dropped. Newest sent
 * first.
 *
 * Only columns that exist in the live schema are selected. In particular NOT
 * `rental_agreements.email_provider_message_id`: it is in the generated types
 * but in neither the live schema snapshot nor any migration, and naming it
 * would fail the whole read.
 *
 * TENANT ISOLATION: RLS is off on the core tables, so both reads carry their
 * own `.eq('tenant_id', …)`.
 */

export const agreementsListV2QueryKey = (tenantId: string | undefined) => ['agreements-list-v2', tenantId] as const;

/** PostgREST caps a response (1000 rows by default), so reads are paged. */
const PAGE = 1000;
const MAX_PAGES = 20;

const RENTAL_SELECT = `
  id,
  rental_id,
  agreement_type,
  document_id,
  document_status,
  envelope_created_at,
  envelope_sent_at,
  envelope_completed_at,
  signed_document_id,
  created_at,
  rentals!rental_agreements_rental_id_fkey(
    id,
    rental_number,
    customers!rentals_customer_id_fkey(name, email)
  )
`;

const INDIVIDUAL_SELECT =
  'id, customer_id, recipient_name, recipient_email, cc_emails, title, message, template_id, document_id, document_status, sent_at, completed_at, resent_from_id, created_at';

type One<T> = T | T[] | null | undefined;
const one = <T,>(value: One<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

export interface RentalAgreementListRow {
  id: string;
  rental_id: string | null;
  agreement_type: string | null;
  document_id: string | null;
  document_status: string | null;
  envelope_created_at: string | null;
  envelope_sent_at: string | null;
  envelope_completed_at: string | null;
  signed_document_id: string | null;
  created_at: string | null;
  rentals?: One<{
    id: string;
    rental_number: string | null;
    customers?: One<{ name: string | null; email: string | null }>;
  }>;
}

export interface IndividualAgreementListRow {
  id: string;
  customer_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  cc_emails: string[] | null;
  title: string | null;
  message: string | null;
  template_id: string | null;
  document_id: string | null;
  document_status: string | null;
  sent_at: string | null;
  completed_at: string | null;
  resent_from_id: string | null;
  created_at: string | null;
}

export function toRentalRowV2(row: RentalAgreementListRow): AgreementRowV2 | null {
  const status = toStatusV2(row.document_status);
  if (status === 'hidden') return null;
  const rental = one(row.rentals);
  const customer = one(rental?.customers);
  const rentalId = row.rental_id ?? rental?.id ?? null;
  return {
    id: row.id,
    kind: 'rental',
    customerName: customer?.name ?? '',
    customerEmail: customer?.email ?? '',
    sentAt: row.envelope_sent_at ?? row.envelope_created_at ?? row.created_at ?? null,
    status,
    rawStatus: row.document_status ?? '',
    rentalId,
    rentalRef: rental?.rental_number || (rentalId ? rentalId.slice(0, 8) : null),
    documentId: row.document_id ?? null,
    templateId: null,
    title: row.agreement_type === 'extension' ? 'Extension agreement' : 'Rental agreement',
    message: null,
    cc: [],
    signedAt: row.envelope_completed_at ?? null,
    signedDocumentId: row.signed_document_id ?? null,
    resentFromId: null,
    hasContentSnapshot: false,
  };
}

export function toIndividualRowV2(row: IndividualAgreementListRow): AgreementRowV2 | null {
  const status = toStatusV2(row.document_status);
  if (status === 'hidden') return null;
  return {
    id: row.id,
    kind: 'individual',
    customerName: row.recipient_name ?? '',
    customerEmail: row.recipient_email ?? '',
    sentAt: row.sent_at ?? row.created_at ?? null,
    status,
    rawStatus: row.document_status ?? '',
    rentalId: null,
    rentalRef: null,
    documentId: row.document_id ?? null,
    templateId: row.template_id ?? null,
    title: row.title ?? null,
    message: row.message ?? null,
    cc: Array.isArray(row.cc_emails) ? row.cc_emails.filter((e): e is string => typeof e === 'string' && e !== '') : [],
    signedAt: row.completed_at ?? null,
    // Individual signed PDFs are fetched from the signing provider by
    // document id; they are not stored as `customer_documents` rows.
    signedDocumentId: null,
    resentFromId: row.resent_from_id ?? null,
    // `content_html` is NOT NULL and non-blank by constraint, so every row has
    // its snapshot. It is not selected here: a list does not need every
    // agreement's full HTML.
    hasContentSnapshot: true,
  };
}

const time = (iso: string | null) => {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** Newest sent first; rows with no time last; ties broken by id so the order is stable. */
export function sortAgreementRowsV2(rows: AgreementRowV2[]): AgreementRowV2[] {
  return [...rows].sort((a, b) => {
    const diff = time(b.sentAt) - time(a.sentAt);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

type QueryResult = PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }>;

/** Read every page of a query, newest first. */
async function readAll<T>(page: (from: number, to: number) => QueryResult): Promise<{ rows: T[]; error: { message?: string; code?: string } | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return { rows, error: null };
}

/**
 * The read itself, outside React so it can be tested against a fake client.
 * A missing `individual_agreements_v2` contributes nothing; any other error
 * from either table is thrown.
 */
export async function fetchAgreementRowsV2(client: any, tenantId: string): Promise<AgreementRowV2[]> {
  const [rental, individual] = await Promise.all([
    readAll<RentalAgreementListRow>((from, to) =>
      client
        .from('rental_agreements')
        .select(RENTAL_SELECT)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    ),
    readAll<IndividualAgreementListRow>((from, to) =>
      client
        .from('individual_agreements_v2')
        .select(INDIVIDUAL_SELECT)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    ),
  ]);

  if (rental.error) throw rental.error;
  if (individual.error && !isMissingTableError(individual.error)) throw individual.error;

  const rows: AgreementRowV2[] = [];
  for (const r of rental.rows) {
    const mapped = toRentalRowV2(r);
    if (mapped) rows.push(mapped);
  }
  if (!individual.error) {
    for (const r of individual.rows) {
      const mapped = toIndividualRowV2(r);
      if (mapped) rows.push(mapped);
    }
  }
  return sortAgreementRowsV2(rows);
}

export function useAgreementsListV2() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;

  const query = useQuery({
    queryKey: agreementsListV2QueryKey(tenantId),
    queryFn: () => fetchAgreementRowsV2(supabaseUntyped, tenantId!),
    enabled: !!tenantId,
  });

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
