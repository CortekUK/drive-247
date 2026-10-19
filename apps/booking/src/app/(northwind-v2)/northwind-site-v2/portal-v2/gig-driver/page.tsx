'use client';

/**
 * Gig-driver proof documents.
 *
 * Ported from `apps/booking/src/app/(customer-portal)/portal/gig-driver/page.tsx`.
 * Same table, same bucket, same rules; the data layer lives in
 * `use-customer-gig-driver.ts` and its header is the file to read before
 * changing anything about what is stored or who can see it.
 *
 * ── WHAT CHANGED FROM v1, AND WHY ───────────────────────────────────────────
 *
 *  1. THE ACTIONS ARE ALWAYS VISIBLE. v1 hides Open and Delete behind
 *     `opacity-0 group-hover:opacity-100`. There is no hover on a phone, so on
 *     the device most likely to be holding these screenshots the controls do
 *     not exist. They are permanent here, and 44px.
 *
 *  2. THE LAST DOCUMENT CAN BE DELETED. v1 renders the delete button only when
 *     `images.length > 1`, so a customer who uploads the wrong file as their
 *     first upload can never remove it. No rule anywhere states that a gig
 *     driver must keep at least one image on file, and trapping somebody's
 *     mis-uploaded document is worse than an empty list they can refill.
 *
 *  3. A BATCH IS NOT ALL-OR-NOTHING. v1 finds the first invalid file and
 *     abandons the whole selection with "Only JPG/PNG images under 10MB are
 *     allowed" — no file named, nothing uploaded. Here the valid files go up,
 *     and every skipped one is listed with its own reason.
 *
 *  4. FAILURES ARE STATED, NOT TOASTED. There is no `<Toaster />` mounted in
 *     this app, so a `toast.error(...)` — which is v1's only failure channel on
 *     this page — renders nowhere at all. Feedback is an inline notice that
 *     stays on screen until the next action.
 *
 *  5. THE PAGE IS TENANT-GATED. `gig_driver_enabled` is read from the tenant
 *     row; an operator who has the feature off gets a plain "not available"
 *     panel rather than a 404, because the route is linkable and a dead link
 *     reads as a broken portal rather than a disabled feature.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  ExternalLink,
  ImageOff,
  ImageUp,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react-nw';

import { formatTimestamp } from '@nw/components/portal/format';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useTenant } from '@nw/contexts/TenantContext';
import {
  GIG_ACCEPT_ATTRIBUTE,
  useCustomerGigDriver,
  type GigDriverDocument,
} from '@nw/hooks/use-customer-gig-driver';

import { ConfirmDialog, IconTile, Notice, UploadZone, type Tone } from '../documents/_components/kit';

/* ─────────────────────────────── feedback ──────────────────────────────── */

interface Feedback {
  tone: Extract<Tone, 'success' | 'warning' | 'danger'>;
  title: string;
  /** One line per item; rendered as a list when there is more than one. */
  lines: string[];
}

/* ─────────────────────────────── formatting ────────────────────────────── */

/** `2411000` → `2.4 MB`. Null when the size is unknown, so the caller can omit it. */
function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/* ──────────────────────────────── the tile ─────────────────────────────── */

/**
 * How many times a thumbnail is re-requested before it is called broken, and
 * how long to wait between tries.
 *
 * This is not defensive padding. Storage serves these through a CDN, and an
 * object requested within a second or two of being uploaded can 404 while the
 * edge catches up — reproduced on staging, where the two files from a fresh
 * upload rendered blank while everything older rendered fine. Without a retry
 * the first `error` latches the tile to "no longer available" for a file that
 * is perfectly fine, and only a full page reload clears it. Two extra tries a
 * second apart cover the lag and cost nothing when the object is already there.
 */
const IMAGE_RETRIES = 2;
const IMAGE_RETRY_DELAY_MS = 1200;

function DocumentTile({
  document,
  isDeleting,
  onDelete,
}: {
  document: GigDriverDocument;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  // A stored object can still fail to load for good — a metadata row may
  // outlive its file. A broken-image glyph tells the customer nothing; this
  // says what happened and keeps the tile deletable so they can clear it.
  const [attempt, setAttempt] = useState(0);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    },
    [],
  );

  const handleImageError = useCallback(() => {
    if (attempt >= IMAGE_RETRIES) {
      setFailedToLoad(true);
      return;
    }
    // A second `error` can arrive before the state update lands; without this
    // the first timer is orphaned and fires an extra, harmless-but-untracked
    // bump that skips a retry slot.
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(
      () => setAttempt((current) => current + 1),
      IMAGE_RETRY_DELAY_MS,
    );
  }, [attempt]);

  // The query string is what forces a re-request: without it the browser serves
  // its own cached failure and `onError` fires again immediately.
  const src = attempt === 0 ? document.url : `${document.url}?retry=${attempt}`;

  const size = formatBytes(document.fileSize);
  const uploaded = formatTimestamp(document.uploadedAt);
  const meta = [uploaded, size].filter((part): part is string => part !== null).join(' · ');

  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-pv-border bg-pv-card">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-pv-muted">
        {failedToLoad ? (
          <div className="flex flex-col items-center gap-1 px-4 text-center text-pv-muted-fg">
            <ImageOff aria-hidden strokeWidth={1.5} className="size-6" />
            <span className="text-xs leading-relaxed">
              This file is no longer available
            </span>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={src}
            src={src}
            alt={document.fileName}
            loading="lazy"
            decoding="async"
            onError={handleImageError}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-pv-border py-2 pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-pv-fg" title={document.fileName}>
            {document.fileName}
          </p>
          {meta !== '' ? (
            <p className="truncate text-xs text-pv-muted-fg">{meta}</p>
          ) : null}
        </div>

        {!failedToLoad ? (
          <Button
            asChild
            variant="brand-ghost"
            size="icon"
            className="size-11 shrink-0 rounded-full! text-pv-muted-fg hover:text-pv-fg"
            aria-label={`Open ${document.fileName} in a new tab`}
          >
            <a href={document.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden strokeWidth={1.75} />
            </a>
          </Button>
        ) : null}

        <Button
          type="button"
          variant="brand-ghost"
          size="icon"
          className="size-11 shrink-0 rounded-full! text-pv-muted-fg hover:bg-pv-danger-light hover:text-pv-danger"
          aria-label={`Delete ${document.fileName}`}
          disabled={isDeleting}
          onClick={onDelete}
        >
          {isDeleting ? (
            <Loader2 aria-hidden strokeWidth={1.75} className="animate-spin" />
          ) : (
            <Trash2 aria-hidden strokeWidth={1.75} />
          )}
        </Button>
      </div>
    </li>
  );
}

function DocumentGridSkeleton() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-2xl border border-pv-border bg-pv-card"
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none bg-pv-tint" />
          <div className="flex flex-col gap-2 border-t border-pv-border px-4 py-4">
            <Skeleton className="h-4 w-2/3 bg-pv-tint" />
            <Skeleton className="h-3 w-1/2 bg-pv-tint" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────── the page ─────────────────────────────── */

const PAGE_TITLE = 'Gig driver documents';
const PAGE_DESCRIPTION =
  'Screenshots of your Uber, Lyft or delivery app profile, for gig driver rates.';

export default function PortalGigDriverPage() {
  const { tenant, isLoading: tenantLoading } = useTenant();
  const {
    documents,
    isLoading,
    isError,
    error,
    refetch,
    hasMore,
    unsubmittedCount,
    metadataUnavailable,
    upload,
    isUploading,
    remove,
    removingPath,
  } = useCustomerGigDriver();

  const inputRef = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GigDriverDocument | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const operator = tenant?.company_name ?? 'the rental company';

  /*
    Only an explicit `false` closes the page. The column is NOT NULL in the
    schema, but a tenant row read before the grant lands, or an operator who has
    simply never touched the setting, must not be told the feature is off — the
    default posture for an undecided flag is "available".
  */
  const featureDisabled = tenant ? tenant.gig_driver_enabled === false : false;

  const handlePick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const [dragActive, setDragActive] = useState(false);

  /** One path for the picker and the drop zone, so a drop is validated the same way. */
  const handleFileList = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setFeedback(null);

      try {
        const outcome = await upload(files);
        const lines: string[] = [];

        for (const item of outcome.rejected) {
          lines.push(`${item.fileName} was skipped — ${item.reason}.`);
        }
        for (const item of outcome.failed) {
          lines.push(`${item.fileName} did not upload — ${item.reason}.`);
        }

        if (outcome.uploaded === 0) {
          setFeedback({
            tone: 'danger',
            title: 'Nothing was uploaded',
            lines:
              lines.length > 0
                ? lines
                : ['We could not upload those files. Please try again.'],
          });
          return;
        }

        /*
          `outcome.unsubmitted` is deliberately NOT reported here. Those files
          are stored, visible, and invisible to the operator — which is exactly
          what the standing banner below already says, derived from
          `unsubmittedCount` over the whole list rather than this one batch.
          Saying it twice, ten pixels apart, reads as two different problems.
        */

        setFeedback({
          tone: lines.length > 0 ? 'warning' : 'success',
          title: `${outcome.uploaded} ${plural(
            outcome.uploaded,
            'document uploaded',
            'documents uploaded',
          )}`,
          lines,
        });
      } catch (cause) {
        setFeedback({
          tone: 'danger',
          title: 'Upload failed',
          lines: [
            cause instanceof Error
              ? cause.message
              : 'Something went wrong. Please try again.',
          ],
        });
      }
    },
    [operator, upload],
  );

  const handleFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Cleared immediately so picking the SAME file twice in a row still fires
      // `change` — the input keeps its value otherwise and the second attempt
      // does nothing at all.
      event.target.value = '';
      return handleFileList(files);
    },
    [handleFileList],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;

    setIsConfirming(true);
    setFeedback(null);

    try {
      const outcome = await remove(target);
      setPendingDelete(null);

      if (outcome.recordRemained) {
        setFeedback({
          tone: 'warning',
          title: `${target.fileName} was deleted`,
          lines: [
            `${operator} may still hold a record of it. Please contact them if you need it removed from your file entirely.`,
          ],
        });
        return;
      }

      setFeedback({
        tone: 'success',
        title: `${target.fileName} was deleted`,
        lines: [],
      });
    } catch (cause) {
      setPendingDelete(null);
      setFeedback({
        tone: 'danger',
        title: 'We could not delete that document',
        lines: [
          cause instanceof Error
            ? cause.message
            : 'Something went wrong. Please try again.',
        ],
      });
    } finally {
      setIsConfirming(false);
    }
  }, [operator, pendingDelete, remove]);

  const uploadButton = useMemo(
    () => (
      <Button
        type="button"
        variant="brand"
        className="h-11 w-full px-5 sm:w-auto"
        disabled={isUploading}
        onClick={handlePick}
      >
        {isUploading ? (
          <>
            <Loader2 aria-hidden className="animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Plus aria-hidden />
            Add documents
          </>
        )}
      </Button>
    ),
    [handlePick, isUploading],
  );

  /* ── tenant still resolving ───────────────────────────────────────────── */

  if (tenantLoading && !tenant) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
        <DocumentGridSkeleton />
      </div>
    );
  }

  /* ── switched off for this operator ───────────────────────────────────── */

  if (featureDisabled) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={PAGE_TITLE}
          description="Proof of gig driver status, for rental companies that offer gig driver rates."
        />
        <Panel>
          <EmptyState
            icon={Briefcase}
            title="Not available here"
            description={`${operator} does not collect gig driver documents, so there is nothing to upload on this page. Everything else about your account is unaffected.`}
            action={{ href: '/portal', label: 'Back to my account' }}
          />
        </Panel>
      </div>
    );
  }

  /* ── the page ─────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        // The empty page is itself the upload target; a second button above it
        // would split the one action in two.
        action={!isLoading && !isError && documents.length === 0 ? undefined : uploadButton}
      />

      {/*
        Outside the button so the picker survives the button being swapped for
        its loading state, and so the empty state can reuse the same input.
        `multiple` matches v1: proof is usually two or three screenshots.
      */}
      <input
        ref={inputRef}
        type="file"
        accept={GIG_ACCEPT_ATTRIBUTE}
        multiple
        onChange={(event) => {
          void handleFiles(event);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      {feedback ? (
        <Notice tone={feedback.tone} title={feedback.title} lines={feedback.lines} />
      ) : null}

      {/*
        The operator reads the metadata table, not the bucket. A document that
        never got a row is one the customer can see and the operator cannot, so
        it is called out here rather than left to look filed.
      */}
      {!isLoading && unsubmittedCount > 0 ? (
        <Notice
          tone="warning"
          title={`${unsubmittedCount} ${plural(
            unsubmittedCount,
            'document has',
            'documents have',
          )} not reached ${operator}`}
          lines={[
            `${plural(
              unsubmittedCount,
              'It is',
              'They are',
            )} saved and visible to you here, but ${plural(
              unsubmittedCount,
              'has',
              'have',
            )} not been attached to your customer file. Please mention this when you contact ${operator} so they can add ${plural(unsubmittedCount, 'it', 'them')}.`,
          ]}
        />
      ) : null}

      {metadataUnavailable ? (
        <Notice
          tone="warning"
          title="Some details could not be loaded"
          lines={[
            'Your documents are shown below, but the upload dates and file details we hold for them are temporarily unavailable.',
          ]}
        />
      ) : null}

      {isError ? (
        <LoadError
          title="We could not load your documents"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <DocumentGridSkeleton />
      ) : documents.length === 0 ? (
        <Panel className="p-3 sm:p-4">
          {/*
            The empty page IS the drop target: the one thing to do here is add
            a screenshot, so the whole panel takes one. The button opens the
            same hidden picker the header uses.
          */}
          <UploadZone
            active={dragActive}
            onDragState={setDragActive}
            onFiles={(list) => {
              void handleFileList(Array.from(list ?? []));
            }}
            className="gap-4 py-14"
          >
            <IconTile icon={ImageUp} className="size-14 rounded-3xl [&>svg]:size-6" />
            <div className="max-w-sm">
              <p className="text-[15px] font-semibold text-pv-fg">No documents yet</p>
              <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">
                Drop screenshots of your active gig driver profile here. {operator} uses them to
                confirm you qualify for gig driver rates.
              </p>
            </div>
            <Button
              type="button"
              variant="brand"
              className="h-11 px-5"
              disabled={isUploading}
              onClick={handlePick}
            >
              {isUploading ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Plus aria-hidden />
                  Upload screenshots
                </>
              )}
            </Button>
            <p className="text-xs text-pv-muted-fg">JPG or PNG, up to 10MB each.</p>
          </UploadZone>
        </Panel>
      ) : (
        <>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((document) => (
              <DocumentTile
                key={document.path}
                document={document}
                isDeleting={removingPath === document.path}
                onDelete={() => setPendingDelete(document)}
              />
            ))}
          </ul>

          <p className="text-[13px] text-pv-muted-fg">
            JPG or PNG, up to 10MB each.
            {hasMore
              ? ' Showing your 100 most recent documents — contact us if you need to see older ones.'
              : ''}
          </p>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        icon={Trash2}
        title="Delete this screenshot?"
        description={
          pendingDelete
            ? `${pendingDelete.fileName} will be removed from your account. You can upload it again if you need to.`
            : ''
        }
        confirmLabel="Delete screenshot"
        busyLabel="Deleting…"
        busy={isConfirming}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
      />
    </div>
  );
}
