'use client';

/**
 * One rental agreement, as a row in the list.
 *
 * The card answers three questions in order, because that is the order a
 * customer asks them: WHICH booking is this, WHERE has it got to, and WHAT do I
 * do now. The third is the one v1 gets wrong — it renders a "Sign" button and a
 * second, contradictory badge that says "Awaiting Signature" even on a
 * completed agreement whose PDF simply has not been filed yet. Here each state
 * carries exactly one chip and one sentence of instruction.
 */

import { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Download, FileText, Loader2, SquareArrowOutUpRight } from 'lucide-react';

import { StatusChip } from '@/components/portal/status-chip';
import { formatDate, formatDateRange, formatTimestamp } from '@/components/portal/format';
import { Button } from '@/components/ui/button';
import {
  downloadSignedAgreement,
  type AgreementState,
  type CustomerAgreement,
} from '@/hooks/use-customer-agreements';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * BoldSign's vocabulary, translated.
 *
 * "delivered" in BoldSign means the recipient OPENED the document — the exact
 * opposite of what the word means about an email — so it is never shown raw.
 */
const STATE_CHIP: Record<AgreementState, { label: string; tone: ChipTone }> = {
  preparing: { label: 'Being prepared', tone: 'neutral' },
  awaiting_signature: { label: 'Needs your signature', tone: 'warning' },
  opened: { label: 'Not signed yet', tone: 'warning' },
  signed: { label: 'Signed', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Link expired', tone: 'danger' },
};

/**
 * What the customer should do, in one sentence.
 *
 * Returns null when the state speaks for itself and the actions below are the
 * whole answer — a signed agreement with its PDF filed needs no instructions.
 */
function guidance(agreement: CustomerAgreement, email: string | null): string | null {
  const inbox = email ? ` to ${email}` : '';

  switch (agreement.state) {
    case 'preparing':
      return 'This document is still being prepared. There is nothing for you to do yet.';
    case 'awaiting_signature':
      return `We have emailed you a signing link${inbox}. Open it to sign — this page updates on its own once you are done.`;
    case 'opened':
      return `You have opened this but not finished signing. Use the link we emailed${inbox} to complete it.`;
    case 'declined':
      return 'This agreement was declined, so it is not in force. Tell us if that was not intended.';
    case 'cancelled':
      return 'This agreement was cancelled and has been replaced or withdrawn.';
    case 'expired':
      return 'The signing link has expired. We can send you a new one.';
    case 'signed':
      return agreement.signedDocument
        ? null
        : 'Signed. Your copy is being filed and will appear here shortly.';
  }
}

/** States where a "Get in touch" link is the genuine next step. */
const NEEDS_CONTACT: ReadonlySet<AgreementState> = new Set<AgreementState>([
  'declined',
  'expired',
]);

function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-brand-text-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-brand-text">{value}</dd>
    </div>
  );
}

export function AgreementCard({
  agreement,
  email,
}: {
  agreement: CustomerAgreement;
  /** Where the signing link was sent. Shown so the customer knows which inbox. */
  email: string | null;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const chip = STATE_CHIP[agreement.state];
  const isExtension = agreement.kind === 'extension';
  const title = isExtension ? 'Extension agreement' : 'Rental agreement';
  const note = guidance(agreement, email);
  const document_ = agreement.signedDocument;

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
    <article className="rounded-[14px] border border-brand-border-soft bg-brand-card p-3.5 sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-brand-stone"
        >
          {isExtension ? (
            <CalendarPlus strokeWidth={1.75} className="size-5 text-brand-text-soft" />
          ) : (
            <FileText strokeWidth={1.75} className="size-5 text-brand-text-soft" />
          )}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-brand-text sm:text-base">
                {title}
                {agreement.rentalReference ? (
                  <span className="ml-1.5 font-normal text-brand-text-subtle">
                    {agreement.rentalReference}
                  </span>
                ) : null}
              </h3>
              {agreement.vehicleLabel ? (
                <p className="mt-0.5 truncate text-sm text-brand-text-soft">
                  {agreement.vehicleLabel}
                </p>
              ) : null}
            </div>
            <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
          </div>

          {/*
            One column until `sm`. At 360px the sidebar is a drawer and this
            card is ~300px wide, which is not enough for two columns of
            "Sent for signature / 12 Mar 2026" without the labels wrapping
            mid-phrase.
          */}
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {isExtension ? (
              <>
                <MetaRow
                  label="Previously ended"
                  value={formatDate(agreement.periodStartDate)}
                />
                <MetaRow label="Extended to" value={formatDate(agreement.periodEndDate)} />
              </>
            ) : (
              <MetaRow
                label="Booking dates"
                value={
                  agreement.rentalStartDate
                    ? formatDateRange(agreement.rentalStartDate, agreement.rentalEndDate)
                    : null
                }
              />
            )}
            <MetaRow label="Sent for signature" value={formatTimestamp(agreement.sentAt)} />
            <MetaRow label="Signed" value={formatTimestamp(agreement.completedAt)} />
          </dl>

          {note ? (
            <p className="text-sm leading-relaxed text-brand-text-soft">{note}</p>
          ) : null}

          {/*
            Every action is a 44px control on its own, never an inline link
            inside the sentence above. A 15px-tall "contact us" in running text
            is the standard way this page would fail a one-handed tap on a
            phone, and the states that need it — declined, expired — are exactly
            the ones where the customer is already stuck.
          */}
          {document_ || NEEDS_CONTACT.has(agreement.state) ? (
            <div className="flex flex-wrap gap-2">
              {/*
                A real <a target="_blank">, not a scripted window.open: the PDF
                lives at a plain storage URL, so long-press, middle-click and
                "open in new tab" all have to keep working. On a phone this
                hands the file to the OS viewer, which is the only thing that
                reliably renders a PDF there — an embedded <iframe> preview
                (what v1 does) is a blank box on iOS Safari.
              */}
              {document_ ? (
                <>
                  <Button asChild variant="brand-outline" className="h-11">
                    <a href={document_.url} target="_blank" rel="noopener noreferrer">
                      <SquareArrowOutUpRight aria-hidden className="size-4" />
                      Open
                      <span className="sr-only"> {title} in a new tab</span>
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="brand-ghost"
                    className="h-11"
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
                </>
              ) : null}

              {NEEDS_CONTACT.has(agreement.state) ? (
                <Button asChild variant="brand-outline" className="h-11">
                  <Link href="/contact">Get in touch</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          {downloadError ? (
            <p role="status" className="text-sm leading-relaxed text-danger">
              {downloadError}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}
