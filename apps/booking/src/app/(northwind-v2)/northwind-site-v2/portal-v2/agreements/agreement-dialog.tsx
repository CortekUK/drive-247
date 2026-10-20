'use client';

/**
 * One rental agreement, opened from the list.
 *
 * The dialog answers the three questions a customer asks, in order: WHICH
 * booking is this, WHERE has it got to, and WHAT do I do now. Each state
 * carries exactly one status and one sentence of instruction — v1 renders a
 * "Sign" button beside a contradictory "Awaiting Signature" badge even on a
 * completed agreement whose PDF simply has not been filed yet.
 *
 * Signing itself happens in BoldSign via the emailed link; this portal has no
 * route that could mint an embedded signing session, so nothing here offers one.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Loader2, SquareArrowOutUpRight } from 'lucide-react-nw';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { formatBookingDates } from '@nw/portal-v2/rentals/format';
import { DetailList, DetailRow } from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import {
  downloadSignedAgreement,
  type CustomerAgreement,
} from '@nw/hooks/use-customer-agreements';
import { cn } from '@nw/lib/utils';

import { StatusText } from '../payments/_components/list-table';
import { RecordDialog } from '../payments/_components/record-dialog';

import { NEEDS_CONTACT, STATE_CHIP, guidance } from './agreement-state';

export function agreementTitle(agreement: CustomerAgreement): string {
  return agreement.kind === 'extension' ? 'Extension agreement' : 'Rental agreement';
}

export function AgreementDialog({
  agreement,
  email,
  onOpenChange,
}: {
  agreement: CustomerAgreement | null;
  /** Where the signing link was sent. Shown so the customer knows which inbox. */
  email: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  // Keep the last agreement painted through the 200ms exit.
  const [shown, setShown] = useState<CustomerAgreement | null>(agreement);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (agreement) {
      setShown(agreement);
      setDownloadError(null);
    }
  }, [agreement]);

  const chip = shown ? STATE_CHIP[shown.state] : null;
  const title = shown ? agreementTitle(shown) : 'Agreement';
  const note = shown ? guidance(shown, email) : null;
  const document_ = shown?.signedDocument ?? null;
  const needsContact = shown ? NEEDS_CONTACT.has(shown.state) : false;
  const needsYou = shown?.state === 'awaiting_signature' || shown?.state === 'opened';

  async function handleDownload() {
    if (!document_) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      await downloadSignedAgreement(document_);
    } catch (caught) {
      setDownloadError(
        caught instanceof Error
          ? caught.message
          : 'We could not download your agreement. Try opening it instead.',
      );
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <RecordDialog
      open={agreement !== null}
      onOpenChange={onOpenChange}
      title={
        <>
          {title}
          {shown?.rentalReference ? (
            <span className="ml-1.5 font-normal text-pv-muted-fg">{shown.rentalReference}</span>
          ) : null}
        </>
      }
      description={shown?.vehicleLabel ?? undefined}
      status={chip ? <StatusText tone={chip.tone}>{chip.label}</StatusText> : null}
      footer={
        document_ || needsContact ? (
          <>
            {/*
              A real <a target="_blank">, not a scripted window.open: the PDF
              lives at a plain storage URL, so long-press, middle-click and
              "open in new tab" all keep working. On a phone this hands the file
              to the OS viewer — an embedded <iframe> preview (what v1 does) is
              a blank box on iOS Safari.
            */}
            {document_ ? (
              <>
                <Button
                  type="button"
                  variant="brand-outline"
                  className="h-11 px-5"
                  onClick={() => {
                    void handleDownload();
                  }}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Download aria-hidden className="size-4" />
                  )}
                  {isDownloading ? 'Downloading' : 'Download'}
                  <span className="sr-only"> {title}</span>
                </Button>
                <Button asChild variant="brand" className="h-11 px-5">
                  <a href={document_.url} target="_blank" rel="noopener noreferrer">
                    <SquareArrowOutUpRight aria-hidden className="size-4" />
                    Open signed copy
                    <span className="sr-only"> of the {title} in a new tab</span>
                  </a>
                </Button>
              </>
            ) : null}
            {needsContact ? (
              <Button asChild variant="brand" className="h-11 px-5">
                <Link href="/contact">Get in touch</Link>
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {shown ? (
        <div className="flex flex-col gap-4">
          {note ? (
            <p
              className={cn(
                'rounded-xl px-3.5 py-3 text-sm leading-relaxed',
                needsYou ? 'bg-pv-warning-light text-pv-fg' : 'bg-pv-row text-pv-muted-fg',
              )}
            >
              {note}
            </p>
          ) : null}

          <DetailList className="-my-3">
            {shown.kind === 'extension' ? (
              <>
                <DetailRow label="Previously ended" value={formatDate(shown.periodStartDate)} />
                <DetailRow label="Extended to" value={formatDate(shown.periodEndDate)} />
              </>
            ) : (
              <DetailRow
                label="Booking dates"
                value={
                  shown.rentalStartDate
                    ? formatBookingDates(shown.rentalStartDate, shown.rentalEndDate)
                    : null
                }
              />
            )}
            <DetailRow label="Sent for signature" value={formatTimestamp(shown.sentAt)} />
            <DetailRow label="Signed" value={formatTimestamp(shown.completedAt)} />
          </DetailList>

          {downloadError ? (
            <p role="status" className="text-sm leading-relaxed text-pv-danger">
              {downloadError}
            </p>
          ) : null}
        </div>
      ) : null}
    </RecordDialog>
  );
}
