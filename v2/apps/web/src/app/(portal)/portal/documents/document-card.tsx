'use client';

/**
 * One uploaded document.
 *
 * Same flat recipe as `BookingCard` — 1px hairline on `brand-card`, no shadow —
 * but NOT a link: a document has no detail page, it has two actions. So the
 * card is a plain article and the actions are real buttons, sized h-11 so they
 * clear 44px on a phone.
 */

import { Download, FileText, IdCard, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { formatDate, formatTimestamp } from '@/components/portal/format';
import { StatusChip } from '@/components/portal/status-chip';
import { Button } from '@/components/ui/button';
import type { CustomerDocument, DocumentCategory } from '@/hooks/use-customer-documents';

const CATEGORY_ICON = {
  insurance: ShieldCheck,
  identity: IdCard,
  other: FileText,
} as const satisfies Record<DocumentCategory, typeof FileText>;

/** "1.4 MB" / "212 KB". Bytes are never the unit a person wants. */
function formatFileSize(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The expiry chip.
 *
 * "Expired" is danger and "Expires soon" warning because those two are the only
 * states the customer has to do something about. A document that is simply in
 * date gets no chip at all — a green "Valid" badge on every row is decoration
 * that makes the two rows that matter harder to find.
 */
function ExpiryChip({ document: doc }: { document: CustomerDocument }) {
  if (doc.expiry === 'expired') {
    return <StatusChip tone="danger">Expired</StatusChip>;
  }
  if (doc.expiry === 'expiring') {
    const days = doc.daysUntilExpiry ?? 0;
    return (
      <StatusChip tone="warning">
        {days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`}
      </StatusChip>
    );
  }
  return null;
}

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-brand-text-subtle">{label}</dt>
      <dd className="truncate text-sm text-brand-text">{value}</dd>
    </div>
  );
}

export function DocumentCard({
  document: doc,
  onDownload,
  onDelete,
  isDownloading,
  isDeleting,
}: {
  document: CustomerDocument;
  onDownload: () => void;
  onDelete: () => void;
  isDownloading: boolean;
  isDeleting: boolean;
}) {
  const Icon = CATEGORY_ICON[doc.category];
  const size = formatFileSize(doc.fileSize);
  const uploaded = formatTimestamp(doc.uploadedAt);

  const cover =
    doc.startDate && doc.endDate
      ? `${formatDate(doc.startDate)} – ${formatDate(doc.endDate)}`
      : doc.endDate
        ? `Until ${formatDate(doc.endDate)}`
        : null;

  return (
    <article className="flex gap-3.5 border-b border-brand-border-soft p-4 last:border-b-0 sm:gap-4 sm:px-5">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-brand-stone"
      >
        <Icon strokeWidth={1.75} className="size-5 text-brand-text-soft" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-brand-text sm:text-base">
            {doc.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-brand-text-subtle">
            {doc.typeLabel}
            {doc.fileName ? ` · ${doc.fileName}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {doc.isVerified ? (
            <StatusChip tone="success">Verified</StatusChip>
          ) : (
            <StatusChip tone="neutral">Awaiting review</StatusChip>
          )}
          <ExpiryChip document={doc} />
        </div>

        {doc.insuranceProvider || doc.policyNumber || cover ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <Meta label="Insurer" value={doc.insuranceProvider} />
            <Meta label="Policy number" value={doc.policyNumber} />
            <Meta label="Cover" value={cover} />
          </dl>
        ) : null}

        <p className="text-xs text-brand-text-subtle">
          {uploaded ? `Added ${uploaded}` : 'Added'}
          {size ? ` · ${size}` : ''}
        </p>

        {/*
          The booking reference is an ACTION, not metadata, so it sits in the
          action row at the same h-11 as its neighbours. Inline in the line
          above it was a 14px-tall tap target — legible, but not hittable with
          a thumb, and it is the one control on this card that navigates.
        */}
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {doc.storagePath ? (
            <Button
              type="button"
              variant="brand-outline"
              className="h-11"
              onClick={onDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Download aria-hidden className="size-4" />
              )}
              {isDownloading ? 'Opening…' : 'Download'}
            </Button>
          ) : null}

          {doc.booking ? (
            <Button asChild variant="brand-ghost" className="h-11">
              <Link href={`/portal/bookings/${doc.booking.id}`}>
                Booking {doc.booking.reference}
              </Link>
            </Button>
          ) : null}

          {doc.canDelete ? (
            <Button
              type="button"
              variant="brand-ghost"
              className="h-11"
              onClick={onDelete}
              disabled={isDeleting}
            >
              <Trash2 aria-hidden className="size-4" />
              Remove
            </Button>
          ) : (
            // Not a disabled button: a greyed-out control invites the customer
            // to keep pressing it. Say why instead. "a booking" rather than
            // "this booking" — the link beside it is suppressed when the
            // rental does not belong to this customer, and the sentence has to
            // still read correctly on its own.
            <p className="text-xs text-brand-text-subtle">
              Part of a booking, so it cannot be removed here.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
