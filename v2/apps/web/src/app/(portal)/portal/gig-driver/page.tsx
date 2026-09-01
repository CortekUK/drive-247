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
import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  ImageOff,
  Loader2,
  Plus,
  TriangleAlert,
  Trash2,
} from 'lucide-react';

import { formatTimestamp } from '@/components/portal/format';
import { EmptyState, LoadError, PageHeader, Panel } from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenant } from '@/contexts/TenantContext';
import {
  GIG_ACCEPT_ATTRIBUTE,
  useCustomerGigDriver,
  type GigDriverDocument,
} from '@/hooks/use-customer-gig-driver';
import { cn } from '@/lib/utils';

/* ─────────────────────────────── feedback ──────────────────────────────── */

type NoticeTone = 'success' | 'warning' | 'danger';

interface Feedback {
  tone: NoticeTone;
  title: string;
  /** One line per item; rendered as a list when there is more than one. */
  lines: string[];
}

const NOTICE_STYLES: Record<NoticeTone, string> = {
  success: 'border-success-med bg-success-light',
  warning: 'border-warning-med bg-warning-light',
  danger: 'border-danger-subtle bg-danger-light',
};

const NOTICE_ICON_STYLES: Record<NoticeTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** A warning triangle over "2 documents uploaded" reads as a failure. */
const NOTICE_ICONS: Record<NoticeTone, LucideIcon> = {
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
};

function Notice({
  tone,
  title,
  lines,
  children,
}: {
  tone: NoticeTone;
  title: string;
  lines?: string[];
  children?: React.ReactNode;
}) {
  const Icon = NOTICE_ICONS[tone];

  return (
    <div
      // `alert` interrupts a screen reader; `status` waits for a pause. A failed
      // upload is worth the interruption, a successful one is not.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-[14px] border px-4 py-3.5',
        NOTICE_STYLES[tone],
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn('mt-0.5 size-4 shrink-0', NOTICE_ICON_STYLES[tone])}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-brand-text">{title}</p>
        {lines && lines.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-0.5">
            {lines.map((line, index) => (
              // Index keys: two rejected files can share a name, and this list
              // is rebuilt wholesale on every action rather than reordered.
              // eslint-disable-next-line react/no-array-index-key
              <li key={index} className="text-sm leading-relaxed text-brand-text-soft">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {children}
      </div>
    </div>
  );
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
    <li className="flex flex-col overflow-hidden rounded-[14px] border border-brand-border-soft bg-brand-card">
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-brand-stone/50">
        {failedToLoad ? (
          <div className="flex flex-col items-center gap-1 px-4 text-center text-brand-text-subtle">
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

      <div className="flex items-center gap-2 border-t border-brand-border-soft px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-brand-text" title={document.fileName}>
            {document.fileName}
          </p>
          {meta !== '' ? (
            <p className="truncate text-xs text-brand-text-subtle">{meta}</p>
          ) : null}
        </div>

        {!failedToLoad ? (
          <Button
            asChild
            variant="brand-ghost"
            size="icon"
            className="size-11 shrink-0"
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
          className="size-11 shrink-0 text-danger hover:bg-danger-light hover:text-danger"
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
          className="overflow-hidden rounded-[14px] border border-brand-border-soft bg-brand-card"
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none bg-brand-stone" />
          <div className="flex flex-col gap-2 border-t border-brand-border-soft px-3 py-3.5">
            <Skeleton className="h-4 w-2/3 bg-brand-stone" />
            <Skeleton className="h-3 w-1/2 bg-brand-stone" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────── the page ─────────────────────────────── */

const PAGE_TITLE = 'Gig Driver Documents';
const PAGE_DESCRIPTION =
  'Screenshots showing your active gig driver status — your Uber, Lyft, Bolt or delivery app profile.';

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

  const handleFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // Cleared immediately so picking the SAME file twice in a row still fires
      // `change` — the input keeps its value otherwise and the second attempt
      // does nothing at all.
      event.target.value = '';
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
        className="h-11 w-full sm:w-auto"
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
        <PageHeader title={PAGE_TITLE} />
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
        action={uploadButton}
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
        <Panel>
          <EmptyState
            icon={Briefcase}
            title="No documents yet"
            description={`Upload screenshots showing your active gig driver status. ${operator} uses them to confirm you qualify for gig driver rates.`}
          />
          {/*
            `EmptyState`'s own `action` is a Link, and this action opens a file
            picker rather than navigating, so the button sits just below it.
            The negative margin closes the gap `EmptyState`'s `py-12` leaves, so
            the two read as one block instead of a panel with a stray button.
          */}
          <div className="-mt-6 flex justify-center px-6 pb-12">
            <Button
              type="button"
              variant="brand"
              className="h-11"
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
                  Upload documents
                </>
              )}
            </Button>
          </div>
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

          <p className="text-xs text-brand-text-subtle">
            JPG or PNG, up to 10MB each.
            {hasMore
              ? ' Showing your 100 most recent documents — contact us if you need to see older ones.'
              : ''}
          </p>
        </>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isConfirming) setPendingDelete(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `${pendingDelete.fileName} will be removed from your account. This cannot be undone — you can upload it again if you need to.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="brand-outline"
              className="h-11"
              disabled={isConfirming}
              onClick={() => setPendingDelete(null)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 rounded-full"
              disabled={isConfirming}
              onClick={() => {
                void handleConfirmDelete();
              }}
            >
              {isConfirming ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
