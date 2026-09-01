'use client';

/**
 * The signed-in customer's gig-driver proof documents.
 *
 * Ported from `apps/booking/src/hooks/use-gig-driver-images.ts` plus the write
 * paths that v1 keeps inline in its page component. Same table, same bucket,
 * same storage path convention — `${tenantId}/${customerId}/${fileName}` — so
 * a document uploaded by v1 (portal page or checkout step) shows up here and
 * vice versa.
 *
 * ── THE ISOLATION BOUNDARY IS THIS FILE ─────────────────────────────────────
 * Every read and every write is filtered on BOTH `customer_id` AND `tenant_id`,
 * and both ids come from `useCustomer()` / `useTenant()` — never from a prop, a
 * URL or a query string. An id that can be passed in is an id that can be
 * swapped. v1's hook filters on `customer_id` alone; that is one seeding script
 * away from cross-tenant leakage, so the tenant filter is added here rather
 * than carried over as-is.
 *
 * The storage side is scoped the same way, by construction: the listing prefix
 * IS `${tenantId}/${customerId}`, so it cannot address another customer's
 * folder without a different customer id, which this hook does not accept.
 *
 * ── WHY THERE ARE TWO SOURCES ───────────────────────────────────────────────
 * A document is a FILE in the `gig-driver-images` bucket plus a metadata ROW in
 * `gig_driver_images`. v1 reads only the row. That is wrong in both directions:
 *
 *   · A file whose row is missing is invisible, even though the customer
 *     uploaded it and it is sitting in the bucket. This is not hypothetical —
 *     see the RLS note below, where it is the NORMAL case today.
 *   · A row whose file is gone renders as a broken image.
 *
 * So the list is the union, keyed by storage path. The row supplies the id used
 * to delete it and the original file name; the bucket supplies proof the file
 * exists, its size and when it landed. `recordId === null` means "stored, but
 * the operator has no record of it" — a state the page surfaces rather than
 * hides, because the operator reads the TABLE and would otherwise never see a
 * document the customer believes they have submitted.
 *
 * ── RLS, VERIFIED LIVE AGAINST ksmreaadhbirzakkxqrq ─────────────────────────
 * `gig_driver_images` has RLS ON with these policies (see migration
 * `20260225120000_add_gig_driver.sql`):
 *
 *     authenticated  SELECT/INSERT/DELETE  USING tenant_id = get_user_tenant_id()
 *     anon           SELECT/INSERT         USING true
 *
 * `get_user_tenant_id()` resolves through `app_users` — the STAFF table. A
 * signed-in CUSTOMER has no `app_users` row, so it returns NULL and all three
 * `authenticated` policies evaluate false. Probed with a real customer JWT:
 *
 *     SELECT → 200 []      (rows exist; they are invisible)
 *     INSERT → 403 42501   "new row violates row-level security policy"
 *     DELETE → 200 []      (silently matches nothing)
 *
 * Storage is unaffected: its policies are `TO public`, so upload / list /
 * delete on the bucket all succeed for a customer. The feature "works" in v1's
 * guest CHECKOUT flow only because an anonymous visitor is the `anon` role.
 *
 * The consequence is that today this hook renders from the bucket and the
 * metadata row never lands. Nothing here special-cases that: the union query,
 * the `recordId === null` signal and the `unsubmitted` upload outcome are all
 * ordinary code paths that go quiet on their own the moment a customer-side
 * policy is added. Do not delete them when it is — the dangling-row and
 * dangling-file cases are real independently of RLS.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useCustomer } from '@/hooks/use-customer';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

/* ─────────────────────────────── constants ─────────────────────────────── */

/** Matches the bucket's own `file_size_limit`. */
export const GIG_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Matches the bucket's `allowed_mime_types`. Anything else is rejected server-side too. */
export const GIG_ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'] as const;

/** For the file picker. Kept next to the MIME list so the two cannot drift. */
export const GIG_ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,image/jpeg,image/png';

const BUCKET = 'gig-driver-images';

/**
 * One page of the customer's folder. A gig driver proves their status with a
 * handful of screenshots; 100 is far past any real case and keeps this to a
 * single round-trip. `hasMore` tells the page when it has hit the ceiling so it
 * can say so instead of quietly truncating.
 */
const STORAGE_PAGE_SIZE = 100;

/* ────────────────────────────── row shapes ─────────────────────────────── */

type GigDriverImageRow = Database['public']['Tables']['gig_driver_images']['Row'];

/**
 * The columns read back. A `Pick` over the generated Row rather than a
 * hand-written interface, matching `use-customer-rentals.ts`: a column that
 * does not exist fails to compile here instead of 400-ing at runtime, and
 * PostgREST rejects the ENTIRE row for one unknown name — a typo would not
 * blank a field, it would empty the page.
 */
type GigDriverImageSelection = Pick<
  GigDriverImageRow,
  'id' | 'customer_id' | 'tenant_id' | 'image_url' | 'file_name' | 'file_size' | 'created_at'
>;

const IMAGE_SELECT =
  'id, customer_id, tenant_id, image_url, file_name, file_size, created_at';

/* ──────────────────────────── the public shape ─────────────────────────── */

export interface GigDriverDocument {
  /** Storage path — `${tenantId}/${customerId}/${name}`. Unique, and the React key. */
  path: string;
  /** `gig_driver_images.id`, or null when only the file exists. */
  recordId: string | null;
  /** What to show the customer. Falls back to the object name with its upload prefix stripped. */
  fileName: string;
  /** Bytes. Null when neither source knows (a metadata row may omit it). */
  fileSize: number | null;
  /** ISO timestamp, newest-first sort key. Null only if both sources omit it. */
  uploadedAt: string | null;
  /** Public URL for the bucket object. */
  url: string;
}

/** Why one file in a batch did not make it. */
export interface GigUploadRejection {
  fileName: string;
  reason: string;
}

export interface GigUploadOutcome {
  /** Files that reached the bucket. */
  uploaded: number;
  /** Failed client-side validation — wrong type, too large, empty. */
  rejected: GigUploadRejection[];
  /** Reached neither the bucket nor the table. */
  failed: GigUploadRejection[];
  /**
   * Uploaded to the bucket, but the metadata row was refused. The file is safe
   * and the customer can see it; the OPERATOR cannot, because staff tooling
   * reads the table. The page must say so — see the RLS note in the header.
   */
  unsubmitted: string[];
}

export interface GigDeleteOutcome {
  /** The file is gone from the bucket. */
  fileRemoved: boolean;
  /**
   * A metadata row existed and survived the delete — the operator still holds a
   * record pointing at a file that is no longer there.
   */
  recordRemained: boolean;
}

export interface UseCustomerGigDriverResult {
  documents: GigDriverDocument[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;

  /** True when the listing hit `STORAGE_PAGE_SIZE` and more may exist. */
  hasMore: boolean;
  /** How many documents the operator has no record of. Zero in a healthy tenant. */
  unsubmittedCount: number;
  /** The metadata read failed outright (not merely empty). Files may still be listed. */
  metadataUnavailable: boolean;

  upload: (files: File[]) => Promise<GigUploadOutcome>;
  isUploading: boolean;
  remove: (document: GigDriverDocument) => Promise<GigDeleteOutcome>;
  /** The path currently being deleted, so the grid can disable just that tile. */
  removingPath: string | null;
}

/* ─────────────────────────────── helpers ───────────────────────────────── */

/**
 * `1756732800000-2-my_screenshot.png` → `my_screenshot.png`.
 *
 * Only used for storage-only entries, where there is no `file_name` column to
 * read. Three prefix shapes exist in the bucket: this hook's
 * `<epoch>-<index>-`, v1's portal page `<epoch>-`, and none at all for files
 * the checkout step moved into place. The optional group covers all three, and
 * a name that happens to start with digits and a hyphen but is not a prefix
 * loses at most a leading number — cosmetic, and never applied to a name that
 * came from the database.
 */
function displayNameFromObject(objectName: string): string {
  return objectName.replace(/^\d{10,}(-\d+)?-/, '') || objectName;
}

/**
 * The bucket rejects anything outside `allowed_mime_types` and anything over
 * `file_size_limit`, but a server-side rejection arrives as an opaque error
 * after the whole file has been sent. Checking first means the customer is told
 * which file is wrong and why, before waiting on an upload that cannot succeed.
 *
 * The type check falls back to the extension: some browsers hand over an empty
 * `type` for files picked from certain cloud providers, and rejecting those
 * outright would block a legitimate JPEG.
 */
function validate(file: File): string | null {
  if (file.size === 0) return 'the file is empty';
  if (file.size > GIG_MAX_FILE_BYTES) return 'it is larger than 10MB';

  const type = file.type.toLowerCase();
  if (type !== '') {
    return (GIG_ALLOWED_TYPES as readonly string[]).includes(type)
      ? null
      : 'only JPG and PNG images are accepted';
  }

  return /\.(jpe?g|png)$/i.test(file.name)
    ? null
    : 'only JPG and PNG images are accepted';
}

/**
 * A storage-safe object name that still resembles what the customer chose.
 *
 * The character class is v1's, kept verbatim so names stay consistent with the
 * objects already in the bucket. The epoch-plus-index prefix is new: v1 uses
 * the timestamp alone, and two files selected in the same batch land on the
 * same millisecond, which with `upsert: false` fails the second one.
 */
function storageObjectName(file: File, index: number, stamp: number): string {
  const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-120);
  return `${stamp}-${index}-${safe === '' ? 'image' : safe}`;
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value !== '') return new Error(value);
  return new Error(fallback);
}

/* ──────────────────────────────── the hook ─────────────────────────────── */

interface GigDriverListing {
  documents: GigDriverDocument[];
  hasMore: boolean;
  metadataUnavailable: boolean;
}

export function useCustomerGigDriver(): UseCustomerGigDriverResult {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const { customerId, isLoading: authLoading } = useCustomer();
  const queryClient = useQueryClient();

  const tenantId = tenant?.id ?? null;
  const folder = tenantId && customerId ? `${tenantId}/${customerId}` : null;

  // Both ids are in the key. The customer id in particular: without it, one
  // customer signing out and another signing in on the same browser would be
  // served the first one's documents until the stale time elapsed.
  const queryKey = useMemo(
    () => ['customer-gig-driver', tenantId, customerId] as const,
    [tenantId, customerId],
  );

  const query = useQuery<GigDriverListing>({
    queryKey,
    queryFn: async (): Promise<GigDriverListing> => {
      if (!customerId || !tenantId || !folder) {
        return { documents: [], hasMore: false, metadataUnavailable: false };
      }

      // Both sources, concurrently. Neither is allowed to take the other down:
      // the bucket alone still renders the documents, and the table alone still
      // renders them if the storage listing is refused. Only a double failure
      // is a failure.
      const [rowsResult, filesResult] = await Promise.all([
        supabase
          .from('gig_driver_images')
          .select(IMAGE_SELECT)
          // Read the file header before touching either of these.
          .eq('customer_id', customerId)
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false, nullsFirst: false })
          .overrideTypes<GigDriverImageSelection[], { merge: false }>(),
        supabase.storage.from(BUCKET).list(folder, {
          limit: STORAGE_PAGE_SIZE,
          sortBy: { column: 'created_at', order: 'desc' },
        }),
      ]);

      if (rowsResult.error) {
        console.error('[useCustomerGigDriver] metadata read failed', {
          tenantId,
          message: rowsResult.error.message,
          details: rowsResult.error.details,
          hint: rowsResult.error.hint,
          code: rowsResult.error.code,
        });
      }
      if (filesResult.error) {
        console.error('[useCustomerGigDriver] storage listing failed', {
          folder,
          message: filesResult.error.message,
        });
      }
      if (rowsResult.error && filesResult.error) {
        throw new Error(
          rowsResult.error.message || 'Failed to load your gig driver documents',
        );
      }

      const merged = new Map<string, GigDriverDocument>();

      for (const row of rowsResult.data ?? []) {
        merged.set(row.image_url, {
          path: row.image_url,
          recordId: row.id,
          fileName: row.file_name,
          fileSize: row.file_size,
          uploadedAt: row.created_at,
          url: supabase.storage.from(BUCKET).getPublicUrl(row.image_url).data.publicUrl,
        });
      }

      // `list()` returns a placeholder entry for the folder itself, and folder
      // entries carry `id: null`. Neither is a document.
      const files = (filesResult.data ?? []).filter(
        (file) => file.id !== null && file.name !== '.emptyFolderPlaceholder',
      );

      for (const file of files) {
        const path = `${folder}/${file.name}`;
        const existing = merged.get(path);

        if (existing) {
          // The row wins on identity and name; the object is the better source
          // for size and timestamp, which a migrated row may not carry.
          merged.set(path, {
            ...existing,
            fileSize: existing.fileSize ?? file.metadata?.size ?? null,
            uploadedAt: existing.uploadedAt ?? file.created_at,
          });
          continue;
        }

        merged.set(path, {
          path,
          recordId: null,
          fileName: displayNameFromObject(file.name),
          fileSize: file.metadata?.size ?? null,
          uploadedAt: file.created_at,
          url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
        });
      }

      const documents = Array.from(merged.values()).sort((a, b) => {
        // Newest first. A missing timestamp sorts last rather than squatting
        // the first slot, matching how the rentals list handles nulls.
        if (a.uploadedAt === b.uploadedAt) return a.fileName.localeCompare(b.fileName);
        if (a.uploadedAt === null) return 1;
        if (b.uploadedAt === null) return -1;
        return a.uploadedAt < b.uploadedAt ? 1 : -1;
      });

      return {
        documents,
        hasMore: files.length >= STORAGE_PAGE_SIZE,
        metadataUnavailable: rowsResult.error !== null,
      };
    },
    enabled: !!customerId && !!tenantId,
  });

  const listing = query.data;
  const documents = useMemo(() => listing?.documents ?? [], [listing]);

  /* ───────────────────────────── upload ────────────────────────────────── */

  const uploadMutation = useMutation<GigUploadOutcome, Error, File[]>({
    mutationFn: async (files: File[]): Promise<GigUploadOutcome> => {
      if (!customerId || !tenantId || !folder) {
        throw new Error('You are not signed in. Please reload and try again.');
      }

      const outcome: GigUploadOutcome = {
        uploaded: 0,
        rejected: [],
        failed: [],
        unsubmitted: [],
      };

      const accepted: File[] = [];
      for (const file of files) {
        const problem = validate(file);
        if (problem) outcome.rejected.push({ fileName: file.name, reason: problem });
        else accepted.push(file);
      }

      // One stamp for the whole batch so the index alone guarantees uniqueness
      // within it, and the batch stays contiguous when sorted by name.
      const stamp = Date.now();

      // Sequential, not `Promise.all`. Each file is up to 10MB and a phone on a
      // mobile connection uploading six at once times the slowest one out. It
      // also keeps per-file failures isolated: v1's loop aborts the whole batch
      // on the first error, leaving earlier files uploaded and reporting only
      // "Upload failed".
      for (const [index, file] of accepted.entries()) {
        const path = `${folder}/${storageObjectName(file, index, stamp)}`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { cacheControl: '3600', upsert: false });

        if (uploadError) {
          outcome.failed.push({
            fileName: file.name,
            reason: uploadError.message || 'the upload did not complete',
          });
          continue;
        }

        outcome.uploaded += 1;

        const { error: insertError } = await supabase.from('gig_driver_images').insert({
          customer_id: customerId,
          tenant_id: tenantId,
          image_url: path,
          file_name: file.name,
          file_size: file.size,
        });

        if (insertError) {
          // The FILE is in the bucket and will render — the customer has not
          // lost anything. What is missing is the row the operator reads, so
          // this is reported rather than swallowed. The object is deliberately
          // NOT rolled back: deleting the customer's document because we could
          // not write a metadata row would turn a partial success into a total
          // loss.
          console.error('[useCustomerGigDriver] metadata insert refused', {
            path,
            message: insertError.message,
            code: insertError.code,
          });
          outcome.unsubmitted.push(file.name);
        }
      }

      return outcome;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  /* ───────────────────────────── delete ────────────────────────────────── */

  const removeMutation = useMutation<GigDeleteOutcome, Error, GigDriverDocument>({
    mutationFn: async (document: GigDriverDocument): Promise<GigDeleteOutcome> => {
      if (!customerId || !tenantId) {
        throw new Error('You are not signed in. Please reload and try again.');
      }

      // Object first, then row. The reverse order looks safer but is not: if
      // the row goes and the object does not, the file is stranded in the
      // bucket with nothing referencing it and no way for the customer to
      // reach it again. This way the worst case is a row pointing at a missing
      // file, which is visible, reportable and cleanable.
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([document.path]);

      if (storageError) {
        throw toError(storageError.message, 'We could not delete that document.');
      }

      if (document.recordId === null) {
        return { fileRemoved: true, recordRemained: false };
      }

      const { data, error } = await supabase
        .from('gig_driver_images')
        .delete()
        .eq('id', document.recordId)
        // Belt and braces on an id we already own: a delete is irreversible and
        // the scoping columns cost nothing to restate.
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId)
        .select('id');

      if (error) {
        console.error('[useCustomerGigDriver] metadata delete failed', {
          recordId: document.recordId,
          message: error.message,
          code: error.code,
        });
        return { fileRemoved: true, recordRemained: true };
      }

      // No error and no rows means a policy filtered the row out rather than
      // refusing the statement. The file is gone; the operator's record is not.
      return { fileRemoved: true, recordRemained: (data ?? []).length === 0 };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const upload = useCallback(
    (files: File[]) => uploadMutation.mutateAsync(files),
    [uploadMutation],
  );

  const remove = useCallback(
    (document: GigDriverDocument) => removeMutation.mutateAsync(document),
    [removeMutation],
  );

  return {
    documents,
    // The tenant and auth round-trips are part of this hook's load from the
    // caller's point of view: until both land `enabled` is false and React
    // Query reports idle, so reading `isPending` alone flashes an empty state
    // at a customer who has documents.
    isLoading:
      tenantLoading ||
      authLoading ||
      (!!customerId && !!tenantId && query.isPending && query.fetchStatus !== 'idle'),
    isError: query.isError,
    error: query.error,
    refetch,

    hasMore: listing?.hasMore ?? false,
    unsubmittedCount: documents.filter((doc) => doc.recordId === null).length,
    metadataUnavailable: listing?.metadataUnavailable ?? false,

    upload,
    isUploading: uploadMutation.isPending,
    remove,
    removingPath: removeMutation.isPending ? (removeMutation.variables?.path ?? null) : null,
  };
}
