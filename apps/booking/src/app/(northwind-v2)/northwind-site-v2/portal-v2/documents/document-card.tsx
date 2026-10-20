'use client';

/**
 * One uploaded document.
 *
 * The operator's document row (customers-v2 section-documents): a tinted tile,
 * the name, one muted line, the chips, and the actions on the right — pushed
 * under the text on a phone. NOT a link: a document has no detail page, it has
 * two actions, so they are real buttons, h-11 so they clear 44px on a phone.
 */

import { Download, FileText, IdCard, Loader2, ShieldCheck, Trash2 } from 'lucide-react-nw';
import Link from 'next/link';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { StatusChip } from '@nw/portal-v2/status-chip';
import { Button } from '@nw/components/ui/button';
import type { CustomerDocument, DocumentCategory } from '@nw/hooks/use-customer-documents';

import { IconTile, Meta } from './_components/kit';

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
    <article className="flex flex-col gap-4 px-5 py-5 last:rounded-b-2xl transition-colors duration-200 ease-out hover:bg-pv-row-hover motion-reduce:transition-none sm:flex-row sm:items-start sm:gap-5 sm:px-6">
      <div className="flex min-w-0 flex-1 gap-4">
        <IconTile icon={Icon} tone={doc.category === 'insurance' ? 'success' : 'info'} />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-pv-fg">{doc.name}</p>
              {doc.isVerified ? (
                <StatusChip tone="success">Verified</StatusChip>
              ) : (
                <StatusChip tone="neutral">Awaiting review</StatusChip>
              )}
              <ExpiryChip document={doc} />
            </div>
            <p className="mt-1 truncate text-[13px] text-pv-muted-fg">
              {doc.typeLabel}
              {uploaded ? ` · added ${uploaded}` : ''}
              {size ? ` · ${size}` : ''}
            </p>
          </div>

          {doc.insuranceProvider || doc.policyNumber || cover ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Meta label="Insurer" value={doc.insuranceProvider} />
              <Meta label="Policy number" value={doc.policyNumber} />
              <Meta label="Cover" value={cover} />
            </dl>
          ) : null}

          {!doc.canDelete ? (
            // Not a disabled button: a greyed-out control invites the customer
            // to keep pressing it. Say why instead. "a booking" rather than
            // "this booking" — the link beside it is suppressed when the
            // rental does not belong to this customer, and the sentence has to
            // still read correctly on its own.
            <p className="text-xs text-pv-muted-fg">Part of a booking, so it cannot be removed here.</p>
          ) : null}
        </div>
      </div>

      {/*
        The booking reference is an ACTION, not metadata, so it sits with the
        other actions at h-11 rather than inline in the muted line, where it
        would be a 14px-tall tap target.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-15 sm:pl-0">
        {doc.booking ? (
          <Button asChild variant="brand-ghost" className="h-11 px-4">
            <Link href={`/portal/rentals/${doc.booking.id}`}>Rental {doc.booking.reference}</Link>
          </Button>
        ) : null}

        {doc.storagePath ? (
          <Button
            type="button"
            variant="brand-outline"
            className="h-11 px-4"
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

        {doc.canDelete ? (
          <Button
            type="button"
            variant="brand-ghost"
            size="icon"
            className="size-11 text-pv-muted-fg hover:bg-pv-danger-light hover:text-pv-danger"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label={`Remove ${doc.name}`}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}
