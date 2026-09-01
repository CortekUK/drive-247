'use client';

/**
 * The signed-in customer's paperwork: `customer_documents`, plus the Bonzah
 * policies bought against their bookings.
 *
 * ── THE ISOLATION BOUNDARY IS THIS FILE ─────────────────────────────────────
 * Same rule, same reason, as `use-customer-rentals.ts` — read that header
 * first. `customer_documents` and `bonzah_insurance_policies` were both probed
 * live against staging (ksmreaadhbirzakkxqrq) with nothing but the public anon
 * key and both answered 200. RLS is OFF on them. So the
 * `.eq('customer_id', …).eq('tenant_id', …)` pair on every statement below is
 * the ONLY thing keeping one customer out of another's licence scan, and the
 * ids come from the auth store — never a prop, a URL or a query string.
 *
 * The DELETE carries the same pair for the same reason. A delete narrowed only
 * by `id` is a delete of ANY row whose id you can name.
 *
 * ── WHAT THE SCHEMA ACTUALLY ALLOWS ─────────────────────────────────────────
 * `customer_documents.document_type` is guarded by a CHECK constraint
 * (`customer_documents_document_type_check`) admitting exactly six strings —
 * see `DOCUMENT_TYPES`. Every other value in the codebase 400s. Verified by
 * probing all twelve values that appear across the repo against staging:
 *
 *     201  Insurance Certificate, Driving Licence, National Insurance,
 *          Address Proof, ID Card/Passport, Other
 *     400  Driver's License, Social Security, Agreement, extension_insurance,
 *          driving_license, licence
 *
 * Two consequences worth knowing. The portal's own
 * `add-customer-document-dialog` offers "Driver's License" and
 * "Social Security", neither of which can be written. And "Agreement" cannot
 * be written either, so a SIGNED RENTAL AGREEMENT never lands in this table on
 * this schema — agreements live in `rental_agreements`, which is a different
 * source and is not read here.
 *
 * ── THE STORAGE BUCKET IS THE REAL LIMIT ────────────────────────────────────
 * `customer-documents` caps objects at 5 MB and admits four MIME types, both
 * enforced by the storage layer (a 6 MB PDF comes back 413 EntityTooLarge, a
 * text/plain body 415 InvalidMimeType). v1's upload dialog validates against
 * 10 MB, so a 6 MB certificate passes its check and then dies at the storage
 * layer with a message the customer cannot act on. `MAX_UPLOAD_BYTES` below is
 * the bucket's real number.
 */

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCustomer } from '@/hooks/use-customer';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { parseDateOnly, todayDateString } from '@/lib/domain';
import type { Database } from '@/integrations/supabase/types';

/* ─────────────────────────── storage constraints ───────────────────────── */

export const DOCUMENT_BUCKET = 'customer-documents';

/** The bucket's own `file_size_limit`, not a guess. 5 MB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The bucket's own `allowed_mime_types`. Anything else is rejected with 415. */
export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const;

/** For the file input's `accept` attribute — extensions, not MIME types. */
export const ACCEPTED_FILE_EXTENSIONS = '.pdf,.jpg,.jpeg,.png';

export const ACCEPTED_FORMATS_LABEL = 'PDF, JPG or PNG, up to 5 MB each';

/* ──────────────────────────── document types ───────────────────────────── */

/**
 * The six values the CHECK constraint admits, with customer-facing labels.
 *
 * `Driving Licence` is the schema's spelling. It is not a typo to fix: the
 * constraint rejects `Driver's License`, which is what half the repo sends.
 */
export const DOCUMENT_TYPES = [
  { value: 'Insurance Certificate', label: 'Insurance certificate' },
  { value: 'Driving Licence', label: 'Driving licence' },
  { value: 'ID Card/Passport', label: 'ID card or passport' },
  { value: 'Address Proof', label: 'Proof of address' },
  { value: 'National Insurance', label: 'National Insurance' },
  { value: 'Other', label: 'Something else' },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]['value'];

export const INSURANCE_DOCUMENT_TYPE: DocumentType = 'Insurance Certificate';

/** Which panel a document belongs in. */
export type DocumentCategory = 'insurance' | 'identity' | 'other';

const CATEGORY_OF: Record<DocumentType, DocumentCategory> = {
  'Insurance Certificate': 'insurance',
  'Driving Licence': 'identity',
  'ID Card/Passport': 'identity',
  'Address Proof': 'identity',
  'National Insurance': 'identity',
  Other: 'other',
};

const LABEL_OF: Record<DocumentType, string> = DOCUMENT_TYPES.reduce(
  (acc, entry) => {
    acc[entry.value] = entry.label;
    return acc;
  },
  {} as Record<DocumentType, string>,
);

function isKnownType(value: string): value is DocumentType {
  return Object.prototype.hasOwnProperty.call(CATEGORY_OF, value);
}

/* ────────────────────────────── row shapes ─────────────────────────────── */

type DocumentRow = Database['public']['Tables']['customer_documents']['Row'];

/**
 * The document columns a customer may read.
 *
 * A `Pick` so a column that does not exist fails to compile rather than 400-ing
 * at runtime — PostgREST rejects the WHOLE row for one unknown name, which
 * empties the page rather than blanking a field.
 *
 * Deliberately absent, and they must stay absent: `ai_validation_score` (its
 * own column comment says "admin only"), `fraud_risk_score`, `review_reasons`,
 * `ai_scan_errors`, `ai_extracted_data` and `verification_decision`. Those are
 * the operator's fraud-screening working notes. Telling a customer their own
 * fraud score is both alarming and an invitation to tune an upload against it.
 */
type CustomerDocumentColumns = Pick<
  DocumentRow,
  | 'id'
  | 'customer_id'
  | 'tenant_id'
  | 'rental_id'
  | 'extension_id'
  | 'document_type'
  | 'document_name'
  | 'file_url'
  | 'file_name'
  | 'file_size'
  | 'mime_type'
  | 'insurance_provider'
  | 'policy_number'
  | 'start_date'
  | 'end_date'
  | 'policy_start_date'
  | 'policy_end_date'
  | 'verified'
  | 'created_at'
  | 'uploaded_at'
>;

interface DocumentQueryRow extends CustomerDocumentColumns {
  /**
   * The booking this document was filed against, if any.
   *
   * `rentals` is a DIRECT child of `customer_documents` here (the FK is on this
   * table), which is what makes the embed legal. Note there is no
   * `.order(..., { referencedTable })` anywhere in this file: PostgREST only
   * accepts an order referencing a top-level embed, and the last pass at the
   * portal shipped a two-level one that 400'd every query with PGRST108.
   */
  rental: { id: string; rental_number: string | null; customer_id: string | null } | null;
}

const DOCUMENT_SELECT = `
  id,
  customer_id,
  tenant_id,
  rental_id,
  extension_id,
  document_type,
  document_name,
  file_url,
  file_name,
  file_size,
  mime_type,
  insurance_provider,
  policy_number,
  start_date,
  end_date,
  policy_start_date,
  policy_end_date,
  verified,
  created_at,
  uploaded_at,
  rental:rentals!customer_documents_rental_id_fkey(id, rental_number, customer_id)
`;

/* ───────────────────────────── render model ────────────────────────────── */

/** How close a dated document is to running out. `none` = it carries no date. */
export type DocumentExpiry = 'valid' | 'expiring' | 'expired' | 'none';

/** Within this many days of the end date, a document reads as "expires soon". */
export const EXPIRING_SOON_DAYS = 30;

export interface CustomerDocument {
  id: string;
  /** What the customer called it, or the type when they called it nothing. */
  name: string;
  type: string;
  typeLabel: string;
  category: DocumentCategory;

  /** Path inside `customer-documents`, ready for `.download()`. */
  storagePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;

  insuranceProvider: string | null;
  policyNumber: string | null;
  startDate: string | null;
  endDate: string | null;

  expiry: DocumentExpiry;
  /** Negative once expired. Null when there is no end date. */
  daysUntilExpiry: number | null;

  /** An operator has checked it and accepted it. */
  isVerified: boolean;

  uploadedAt: string | null;
  booking: { id: string; reference: string } | null;

  /**
   * The customer may remove it.
   *
   * False once a document is filed against a booking or an extension: at that
   * point it is part of that rental's compliance record, and the customer
   * deleting it would quietly remove the operator's evidence for a rental that
   * has already been approved. Standalone uploads stay removable, which is
   * v1's behaviour.
   */
  canDelete: boolean;
}

/**
 * Normalise whatever is in `file_url` down to a bucket-relative object path.
 *
 * Three shapes exist in the wild, all of them written by shipped code:
 *   - `insurance/<tenant>/<customer>/<file>` — booking app (v1 and this one)
 *   - `customer-documents/<customer>/<file>` — the operator portal, which
 *     prefixes the bucket name
 *   - an absolute public URL — defensive; nothing writes one to this column
 *     today, but three other tables do store `getPublicUrl()` output.
 *
 * v1 handles this with `file_url.replace('customer-documents/', '')`, which
 * strips the FIRST occurrence anywhere in the string. Anchoring it matters:
 * a customer whose folder is literally named `customer-documents` would
 * otherwise have the wrong segment cut out of the middle of their path.
 */
export function toStoragePath(fileUrl: string | null): string | null {
  if (!fileUrl) return null;

  const trimmed = fileUrl.trim();
  if (trimmed === '') return null;

  const marker = `/${DOCUMENT_BUCKET}/`;
  const markerAt = trimmed.indexOf(marker);
  if (trimmed.startsWith('http') && markerAt !== -1) {
    return trimmed.slice(markerAt + marker.length);
  }

  const prefix = `${DOCUMENT_BUCKET}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/**
 * Whole days from today to `endDate`, both read as DATE-ONLY values.
 *
 * `parseDateOnly`, never `new Date(endDate)`. These are Postgres `date`
 * columns; `new Date('2026-09-20')` is UTC midnight, so west of Greenwich v1
 * tells a customer their cover lapsed a day before it did. Both sides are
 * floored to a calendar day so the answer cannot change mid-afternoon.
 */
function daysUntil(endDate: string | null, today: string): number | null {
  if (!endDate) return null;

  const end = parseDateOnly(endDate);
  const now = parseDateOnly(today);
  if (Number.isNaN(end.getTime()) || Number.isNaN(now.getTime())) return null;

  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((endDay - nowDay) / 86_400_000);
}

/**
 * `customerId` is passed in so the embedded rental can be checked against it.
 * `customer_documents.rental_id` should only ever point at this customer's own
 * booking, but "should" is not a boundary — a mis-stamped row would otherwise
 * print another customer's rental number on this page. Cheap to close, so
 * close it.
 */
function normalizeDocument(
  row: DocumentQueryRow,
  today: string,
  customerId: string,
): CustomerDocument {
  const type = row.document_type;
  const known = isKnownType(type);

  // `start_date`/`end_date` are the columns every current writer fills.
  // `policy_start_date`/`policy_end_date` are the original pair and still hold
  // the dates on older rows; falling back to them is what stops a legacy
  // certificate rendering as though it had no cover period at all.
  const startDate = row.start_date ?? row.policy_start_date;
  const endDate = row.end_date ?? row.policy_end_date;

  const days = daysUntil(endDate, today);
  const expiry: DocumentExpiry =
    days === null
      ? 'none'
      : days < 0
        ? 'expired'
        : days <= EXPIRING_SOON_DAYS
          ? 'expiring'
          : 'valid';

  const name = row.document_name?.trim();

  return {
    id: row.id,
    name: name && name !== '' ? name : known ? LABEL_OF[type] : type,
    type,
    typeLabel: known ? LABEL_OF[type] : type,
    category: known ? CATEGORY_OF[type] : 'other',

    storagePath: toStoragePath(row.file_url),
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,

    insuranceProvider: row.insurance_provider,
    policyNumber: row.policy_number,
    startDate,
    endDate,

    expiry,
    daysUntilExpiry: days,

    isVerified: row.verified,

    uploadedAt: row.uploaded_at ?? row.created_at,
    booking:
      row.rental === null || row.rental.customer_id !== customerId
        ? null
        : {
            id: row.rental.id,
            reference: row.rental.rental_number ?? row.rental.id.slice(0, 8),
          },

    canDelete: row.rental_id === null && row.extension_id === null,
  };
}

export interface DocumentSummary {
  total: number;
  awaitingReview: number;
  verified: number;
  /** Expired or within `EXPIRING_SOON_DAYS` of it, newest deadline first. */
  needsAttention: CustomerDocument[];
}

function summarise(documents: CustomerDocument[]): DocumentSummary {
  const needsAttention = documents
    .filter((doc) => doc.expiry === 'expired' || doc.expiry === 'expiring')
    .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0));

  return {
    total: documents.length,
    awaitingReview: documents.filter((doc) => !doc.isVerified).length,
    verified: documents.filter((doc) => doc.isVerified).length,
    needsAttention,
  };
}

/* ─────────────────────────────── the list ──────────────────────────────── */

export interface UseCustomerDocumentsResult {
  documents: CustomerDocument[];
  byCategory: Record<DocumentCategory, CustomerDocument[]>;
  summary: DocumentSummary;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/** The query key every mutation in this file invalidates. */
function documentsKey(tenantId: string | null, customerId: string | null) {
  return ['customer-documents', tenantId, customerId] as const;
}

export function useCustomerDocuments(): UseCustomerDocumentsResult {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    // Both ids in the key. Without the customer id, one customer signing out
    // and another signing in on the same browser would be served the first
    // one's documents until the stale time elapsed.
    queryKey: documentsKey(tenantId, customerId),
    queryFn: async (): Promise<CustomerDocument[]> => {
      if (!customerId || !tenantId) return [];

      const { data, error } = await supabase
        .from('customer_documents')
        .select(DOCUMENT_SELECT)
        // Read the file header before touching either of these.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        // `uploaded_at` is the column the operator portal sets and it defaults
        // alongside `created_at`, but it is nullable on migrated rows — hence
        // nulls last, so a row with no timestamp cannot squat the top slot.
        .order('uploaded_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<DocumentQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerDocuments] Failed to load documents', {
          tenantId,
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your documents');
      }

      // One `today` for the whole batch, so two documents cannot be measured
      // against different days if the render straddles midnight.
      const today = todayDateString();
      return (data ?? []).map((row) => normalizeDocument(row, today, customerId));
    },
    enabled: !!customerId && !!tenantId,
  });

  const documents = useMemo(() => query.data ?? [], [query.data]);

  const byCategory = useMemo<Record<DocumentCategory, CustomerDocument[]>>(
    () => ({
      insurance: documents.filter((doc) => doc.category === 'insurance'),
      identity: documents.filter((doc) => doc.category === 'identity'),
      other: documents.filter((doc) => doc.category === 'other'),
    }),
    [documents],
  );

  const summary = useMemo(() => summarise(documents), [documents]);

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return {
    documents,
    byCategory,
    summary,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
    refetch,
  };
}

/* ────────────────────────── Bonzah insurance ───────────────────────────── */

export type PolicyStatus = 'active' | 'pending' | 'cancelled' | 'other';

export interface CustomerInsurancePolicy {
  id: string;
  /** "Bonzah insurance" or "Extension insurance". */
  title: string;
  status: PolicyStatus;
  rawStatus: string;
  policyNumber: string | null;
  /** Bonzah's own policy id — the argument `bonzah-download-pdf` needs. */
  policyId: string | null;
  startDate: string;
  endDate: string;
  premium: number;
  /** Cover the customer actually bought, e.g. ["CDW", "RCLI"]. */
  coverages: string[];
  /** Bonzah document ids, keyed by coverage. Empty when none were returned. */
  pdfIds: Array<{ coverage: string; label: string; pdfId: number }>;
  issuedAt: string | null;
  booking: { id: string; reference: string } | null;
}

const COVERAGE_LABELS: Record<string, string> = {
  cdw: 'CDW',
  rcli: 'RCLI',
  sli: 'SLI',
  pai: 'PAI',
};

function coverageLabel(key: string): string {
  return COVERAGE_LABELS[key] ?? key.toUpperCase();
}

/**
 * `coverage_types` is `jsonb` and carries two different kinds of entry: the
 * coverage flags Bonzah quoted (`{cdw: true}`) and a `pdf_ids` map bolted on
 * after the policy issues. Read defensively — this is untyped JSON from a
 * third party, and one unexpected shape must not take the whole page down.
 */
function readCoverage(value: unknown): {
  coverages: string[];
  pdfIds: CustomerInsurancePolicy['pdfIds'];
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { coverages: [], pdfIds: [] };
  }

  const record = value as Record<string, unknown>;

  const coverages = Object.entries(record)
    .filter(([key, flag]) => key !== 'pdf_ids' && flag === true)
    .map(([key]) => coverageLabel(key));

  const rawPdfIds = record.pdf_ids;
  const pdfIds: CustomerInsurancePolicy['pdfIds'] = [];
  if (typeof rawPdfIds === 'object' && rawPdfIds !== null && !Array.isArray(rawPdfIds)) {
    for (const [coverage, id] of Object.entries(rawPdfIds as Record<string, unknown>)) {
      const numeric = typeof id === 'number' ? id : Number(id);
      if (Number.isFinite(numeric)) {
        pdfIds.push({ coverage, label: coverageLabel(coverage), pdfId: numeric });
      }
    }
  }

  return { coverages, pdfIds };
}

function normalizePolicyStatus(status: string): PolicyStatus {
  if (status === 'active') return 'active';
  if (status === 'quoted' || status === 'payment_pending') return 'pending';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'other';
}

interface PolicyQueryRow {
  id: string;
  policy_type: string;
  coverage_types: Database['public']['Tables']['bonzah_insurance_policies']['Row']['coverage_types'];
  trip_start_date: string;
  trip_end_date: string;
  premium_amount: number;
  status: string;
  policy_no: string | null;
  policy_id: string | null;
  policy_issued_at: string | null;
  created_at: string | null;
  rental: { id: string; rental_number: string | null; customer_id: string | null } | null;
}

const POLICY_SELECT = `
  id,
  policy_type,
  coverage_types,
  trip_start_date,
  trip_end_date,
  premium_amount,
  status,
  policy_no,
  policy_id,
  policy_issued_at,
  created_at,
  rental:rentals!bonzah_insurance_policies_rental_id_fkey(id, rental_number, customer_id)
`;

export interface UseCustomerInsurancePoliciesResult {
  policies: CustomerInsurancePolicy[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Bonzah policies bought against this customer's bookings.
 *
 * v1 swallows the error and returns `[]`, which renders "no insurance" over a
 * failed read — the one state in which a customer might buy cover twice. This
 * throws, and the page says the section could not load.
 */
export function useCustomerInsurancePolicies(): UseCustomerInsurancePoliciesResult {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    queryKey: ['customer-insurance-policies', tenantId, customerId],
    queryFn: async (): Promise<CustomerInsurancePolicy[]> => {
      if (!customerId || !tenantId) return [];

      const { data, error } = await supabase
        .from('bonzah_insurance_policies')
        .select(POLICY_SELECT)
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false, nullsFirst: false })
        .overrideTypes<PolicyQueryRow[], { merge: false }>();

      if (error) {
        console.error('[useCustomerInsurancePolicies] Failed to load policies', {
          tenantId,
          message: error.message,
          code: error.code,
        });
        throw new Error(error.message || 'Failed to load your insurance');
      }

      return (data ?? []).map((row) => {
        const { coverages, pdfIds } = readCoverage(row.coverage_types);
        return {
          id: row.id,
          title:
            row.policy_type === 'extension'
              ? 'Extension insurance'
              : 'Bonzah insurance',
          status: normalizePolicyStatus(row.status),
          rawStatus: row.status,
          policyNumber: row.policy_no,
          policyId: row.policy_id,
          startDate: row.trip_start_date,
          endDate: row.trip_end_date,
          premium: row.premium_amount,
          coverages,
          pdfIds,
          issuedAt: row.policy_issued_at,
          // Same check as `normalizeDocument`: never print a rental number
          // that does not belong to the person reading the page.
          booking:
            row.rental === null || row.rental.customer_id !== customerId
              ? null
              : {
                  id: row.rental.id,
                  reference: row.rental.rental_number ?? row.rental.id.slice(0, 8),
                },
        };
      });
    },
    enabled: !!customerId && !!tenantId,
  });

  return {
    policies: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error : null,
  };
}

/* ──────────────────────────────── upload ───────────────────────────────── */

export interface UploadDocumentInput {
  file: File;
  documentType: DocumentType;
  /** Insurance certificates only; ignored for every other type. */
  insuranceProvider?: string;
  policyNumber?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Reject a file BEFORE it reaches the network, against the bucket's own limits.
 *
 * Returns the message to show, or null when the file is fine.
 */
export function validateUploadFile(file: File): string | null {
  const accepted: readonly string[] = ACCEPTED_MIME_TYPES;
  if (!accepted.includes(file.type)) {
    return `“${file.name}” is a ${file.type || 'unknown'} file. Please upload a PDF, JPG or PNG.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `“${file.name}” is ${mb} MB. The limit is 5 MB — try a lower-quality scan.`;
  }
  if (file.size === 0) {
    return `“${file.name}” is empty.`;
  }
  return null;
}

/** Storage object keys are ASCII-safe; a name with a slash in it would nest. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9.-]/g, '_');
  // Keep the tail, which carries the extension, rather than the head.
  return cleaned.length > 120 ? cleaned.slice(cleaned.length - 120) : cleaned;
}

export function useUploadCustomerDocument() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  return useMutation({
    mutationFn: async (input: UploadDocumentInput): Promise<void> => {
      if (!customerId || !tenantId) {
        throw new Error('Please sign in again before uploading.');
      }

      const rejection = validateUploadFile(input.file);
      if (rejection) throw new Error(rejection);

      const isInsurance = input.documentType === INSURANCE_DOCUMENT_TYPE;
      const folder = isInsurance ? 'insurance' : 'documents';
      // The timestamp is what stops a second upload of "licence.jpg" colliding
      // with the first — `upsert: false` below turns a collision into an error
      // rather than silently overwriting the earlier file.
      const path = `${folder}/${tenantId}/${customerId}/${Date.now()}-${safeFileName(input.file.name)}`;

      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(path, input.file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        console.error('[useUploadCustomerDocument] Storage upload failed', uploadError);
        throw new Error(
          `We could not store “${input.file.name}”. ${uploadError.message}`,
        );
      }

      const trimmed = (value: string | undefined): string | null => {
        const next = value?.trim();
        return next && next !== '' ? next : null;
      };

      const { data: inserted, error: insertError } = await supabase
        .from('customer_documents')
        .insert({
          customer_id: customerId,
          tenant_id: tenantId,
          document_type: input.documentType,
          document_name: LABEL_OF[input.documentType],
          file_url: path,
          file_name: input.file.name,
          file_size: input.file.size,
          mime_type: input.file.type,
          verified: false,
          insurance_provider: isInsurance ? trimmed(input.insuranceProvider) : null,
          policy_number: isInsurance ? trimmed(input.policyNumber) : null,
          start_date: isInsurance ? trimmed(input.startDate) : null,
          end_date: isInsurance ? trimmed(input.endDate) : null,
        })
        .select('id')
        .single();

      if (insertError) {
        // The object is already in the bucket. Leaving it there would be an
        // orphan nothing ever points at, so take it back out before failing.
        await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
        console.error('[useUploadCustomerDocument] Insert failed', insertError);
        throw new Error(insertError.message || 'We could not save that document.');
      }

      // Fire-and-forget: the AI scan is the operator's screening step, and a
      // scan that fails must never look to the customer like a failed upload.
      // The document is already saved and visible by this point.
      if (isInsurance && inserted) {
        void supabase.functions
          .invoke('scan-insurance-document', { body: { documentId: inserted.id } })
          // `invoke` RESOLVES with `{ data: null, error }` on a non-2xx — it
          // does not reject — so a `.catch()` alone would swallow every server
          // -side failure silently. Both arms are needed.
          .then(({ error: scanError }) => {
            if (scanError) {
              console.warn('[useUploadCustomerDocument] AI scan rejected', scanError);
            }
          })
          .catch((scanError: unknown) => {
            console.warn('[useUploadCustomerDocument] AI scan not started', scanError);
          });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: documentsKey(tenantId, customerId),
      });
    },
  });
}

/* ──────────────────────────────── delete ───────────────────────────────── */

export function useDeleteCustomerDocument() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const tenantId = tenant?.id ?? null;

  return useMutation({
    mutationFn: async (doc: CustomerDocument): Promise<void> => {
      if (!customerId || !tenantId) {
        throw new Error('Please sign in again before deleting.');
      }

      /*
        The DELETE carries the ownership filters AND re-states the "not filed
        against a booking" rule as `.is('rental_id', null)`. `canDelete` on the
        model decides whether the button renders; this decides whether the row
        actually goes. Putting the rule only in the UI would leave the rule one
        devtools call away from being skipped — and with RLS off on this table,
        the query IS the enforcement.
      */
      const { data: deleted, error } = await supabase
        .from('customer_documents')
        .delete()
        .eq('id', doc.id)
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .is('rental_id', null)
        .is('extension_id', null)
        .select('id');

      if (error) {
        console.error('[useDeleteCustomerDocument] Delete failed', error);
        throw new Error(error.message || 'We could not remove that document.');
      }

      if (!deleted || deleted.length === 0) {
        throw new Error(
          'That document is attached to a booking, so it cannot be removed here. Contact us if you need it changed.',
        );
      }

      // Storage last, and only once the row is definitely gone. The other
      // order leaves a row pointing at a file that no longer exists, which is
      // a broken download button; this order can at worst leave an unreferenced
      // object, which nobody sees.
      if (doc.storagePath) {
        const { error: storageError } = await supabase.storage
          .from(DOCUMENT_BUCKET)
          .remove([doc.storagePath]);
        if (storageError) {
          console.warn(
            '[useDeleteCustomerDocument] Row deleted, file left behind',
            storageError,
          );
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: documentsKey(tenantId, customerId),
      });
    },
  });
}

/* ─────────────────────────────── download ──────────────────────────────── */

export interface UseDocumentDownloadResult {
  /** The id currently downloading, so one row can show a spinner. */
  downloadingId: string | null;
  /** Message from the last failed download, or null. */
  error: string | null;
  download: (doc: CustomerDocument) => Promise<void>;
  clearError: () => void;
}

/**
 * Pull the object down and hand it to the browser as a file.
 *
 * `.download()` rather than a public URL: the bucket is public today, but that
 * is a bucket setting an operator can flip, and a page that breaks the day
 * someone tightens their storage is a page that punishes the right decision.
 * The signed-in client works either way.
 */
export function useDocumentDownload(): UseDocumentDownloadResult {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async (doc: CustomerDocument) => {
    if (!doc.storagePath) {
      setError('That document has no file attached. Please contact us.');
      return;
    }

    setDownloadingId(doc.id);
    setError(null);

    try {
      const { data, error: downloadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .download(doc.storagePath);

      if (downloadError || !data) {
        console.error('[useDocumentDownload] Download failed', downloadError);
        setError(
          `We could not open “${doc.name}”. ${downloadError?.message ?? 'Please try again.'}`,
        );
        return;
      }

      const url = URL.createObjectURL(data);
      // `window.document`, not `document` — `doc` shadows nothing here but the
      // parameter name in v1's copy of this did, which is why it reads oddly.
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = doc.fileName ?? `${doc.typeLabel}.pdf`;
      window.document.body.appendChild(anchor);
      anchor.click();
      window.document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { downloadingId, error, download, clearError };
}

/* ────────────────────────── Bonzah policy PDFs ─────────────────────────── */

export interface UsePolicyPdfResult {
  /** `${policyId}:${coverage}` currently downloading. */
  downloadingKey: string | null;
  error: string | null;
  download: (
    policy: CustomerInsurancePolicy,
    entry: CustomerInsurancePolicy['pdfIds'][number],
  ) => Promise<void>;
  clearError: () => void;
}

interface BonzahPdfResponse {
  documentBase64?: string;
}

/** base64 → Blob without pulling in a dependency. */
function base64ToPdfBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

export function usePolicyPdfDownload(): UsePolicyPdfResult {
  const { tenant } = useTenant();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(
    async (
      policy: CustomerInsurancePolicy,
      entry: CustomerInsurancePolicy['pdfIds'][number],
    ) => {
      const tenantId = tenant?.id ?? null;
      if (!tenantId || !policy.policyId) {
        setError('That policy document is not available yet.');
        return;
      }

      const key = `${policy.id}:${entry.coverage}`;
      setDownloadingKey(key);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          'bonzah-download-pdf',
          {
            body: {
              tenant_id: tenantId,
              pdf_id: String(entry.pdfId),
              policy_id: policy.policyId,
            },
          },
        );

        const payload = data as BonzahPdfResponse | null;

        if (fnError || !payload?.documentBase64) {
          console.error('[usePolicyPdfDownload] Failed', fnError);
          setError(`We could not fetch your ${entry.label} policy. Please try again.`);
          return;
        }

        const url = URL.createObjectURL(base64ToPdfBlob(payload.documentBase64));
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = `${entry.label}-policy-${policy.policyNumber ?? policy.id}.pdf`;
        window.document.body.appendChild(anchor);
        anchor.click();
        window.document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } catch (caught: unknown) {
        console.error('[usePolicyPdfDownload] Threw', caught);
        setError(`We could not fetch your ${entry.label} policy. Please try again.`);
      } finally {
        setDownloadingKey(null);
      }
    },
    [tenant?.id],
  );

  const clearError = useCallback(() => setError(null), []);

  return { downloadingKey, error, download, clearError };
}
