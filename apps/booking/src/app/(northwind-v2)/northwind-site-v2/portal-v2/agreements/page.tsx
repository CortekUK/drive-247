'use client';

/**
 * Every rental agreement raised against the customer's bookings.
 *
 * The page is a LIST, not a signing surface. Signing happens in BoldSign, via
 * the link the operator emails, and this portal has no server route that could
 * mint an embedded signing session — see the "what is not here" note at the top
 * of `use-customer-agreements`. So each row states where the document has got
 * to, tells the customer whose move it is, and hands over the signed PDF once
 * there is one. Nothing here pretends to an ability the app does not have.
 *
 * Laid out as the operator's lists are: stat cards, a section title, then a
 * tinted-header table whose rows open the record in a dialog.
 */

import { useState } from 'react';
import { ChevronRight, FileSignature, PenLine, RefreshCw } from 'lucide-react-nw';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { formatBookingDates } from '@nw/portal-v2/bookings/format';
import {
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  StatTile,
} from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCustomer } from '@nw/hooks/use-customer';
import {
  useCustomerAgreements,
  type CustomerAgreement,
} from '@nw/hooks/use-customer-agreements';
import { useCustomerRentals } from '@nw/hooks/use-customer-rentals';

import {
  ListBody,
  ListCard,
  ListCell,
  ListHead,
  ListHeaderRow,
  ListRow,
  RowButton,
  SectionTitle,
  StatusText,
} from '../payments/_components/list-table';

import { AgreementDialog, agreementTitle } from './agreement-dialog';
import { STATE_CHIP } from './agreement-state';

/** Sized like the stat row and the table, so the page does not jump on load. */
function AgreementsSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className={`rounded-2xl border border-pv-border bg-pv-card px-4 py-3.5 ${tile === 2 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <Skeleton className="h-3 w-20 bg-pv-tint" />
            <Skeleton className="mt-3 h-7 w-10 bg-pv-tint" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-36 bg-pv-tint" />
        <div className="overflow-hidden rounded-2xl border border-pv-border bg-pv-card">
          <div className="h-11 border-b border-pv-border bg-pv-tint/60" />
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-b border-pv-border px-5 py-4 last:border-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-44 bg-pv-tint" />
                <Skeleton className="h-3 w-32 bg-pv-tint" />
              </div>
              <Skeleton className="h-4 w-24 shrink-0 bg-pv-tint" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function PortalAgreementsPage() {
  const { email } = useCustomer();
  const { agreements, summary, isLoading, isRefreshing, isError, error, refetch } =
    useCustomerAgreements();
  // The same cached query the hook already reads — free here, and it lets the
  // empty state tell a customer with no bookings something different from one
  // whose operator simply has not raised a document yet.
  const { summary: rentalSummary } = useCustomerRentals('all');

  const [openId, setOpenId] = useState<string | null>(null);
  // Looked up by id on every render, so a background poll that moves the
  // agreement on (signed, PDF filed) shows up inside an open dialog too.
  const open = openId ? (agreements.find((row) => row.id === openId) ?? null) : null;

  const hasBookings = rentalSummary.total > 0;
  const awaiting = agreements.filter((row) => row.needsSignature);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Agreements"
        description="Your rental agreements, where each one has got to, and your signed copies."
        action={
          <Button
            type="button"
            variant="brand-outline"
            className="h-11 w-full px-5 sm:w-auto"
            onClick={() => {
              void refetch();
            }}
            disabled={isLoading || isRefreshing}
          >
            <RefreshCw
              aria-hidden
              className={isRefreshing ? 'size-4 animate-spin' : 'size-4'}
            />
            {isRefreshing ? 'Refreshing' : 'Refresh'}
          </Button>
        }
      />

      {isError ? (
        <LoadError
          title="We could not load your agreements"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <AgreementsSkeleton />
      ) : agreements.length === 0 ? (
        <Panel>
          <EmptyState
            icon={FileSignature}
            title={hasBookings ? 'Nothing to sign right now' : 'No agreements yet'}
            description={
              hasBookings
                ? 'None of your bookings has an agreement raised against it yet. If you have just booked, give it a few minutes — it will appear here, and we will email you when it is ready to sign.'
                : 'When you book a car, the rental agreement you need to sign appears here — and your signed copy stays here afterwards.'
            }
            action={
              hasBookings
                ? { href: '/portal/bookings', label: 'View my bookings' }
                : { href: '/booking', label: 'Browse the fleet' }
            }
          />
        </Panel>
      ) : (
        <>
          {/*
            The strip is only worth its space once there is more than one row:
            "1 agreement, 0 signed, 1 awaiting" restates the single row beneath
            it in three tiles.
          */}
          {agreements.length > 1 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Agreements" value={summary.total} />
              <StatTile label="Signed" value={summary.signed} />
              {/* Full width on the two-column phone layout, so the odd tile out
                  is the one carrying the caption rather than a half-empty gap. */}
              <div className="col-span-2 sm:col-span-1">
                <StatTile
                  label="Awaiting you"
                  value={summary.awaiting}
                  caption={
                    summary.awaiting > 0 ? 'Needs your signature' : 'All up to date'
                  }
                />
              </div>
            </div>
          ) : null}

          {/* The one thing to do on this page, when there is one. */}
          {awaiting.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpenId(awaiting[0].id)}
              className="flex w-full items-start gap-3 rounded-2xl border border-pv-warning/25 bg-pv-warning-light px-4 py-3.5 text-left transition-opacity duration-200 ease-out hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none sm:px-5"
            >
              <PenLine aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-pv-warning" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-pv-fg">
                  {awaiting.length === 1
                    ? 'One agreement needs your signature'
                    : `${awaiting.length} agreements need your signature`}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-pv-muted-fg">
                  We emailed you a signing link{email ? ` at ${email}` : ''}. This page updates on
                  its own once you have signed.
                </span>
              </span>
              <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-pv-muted-fg" />
            </button>
          ) : null}

          <section className="flex flex-col gap-4">
            <SectionTitle
              title="All agreements"
              description="Open one to see where it has got to, or to get your signed copy."
            />
            <ListCard>
              <ListHeaderRow>
                <ListHead>Agreement</ListHead>
                <ListHead className="hidden md:table-cell">Vehicle</ListHead>
                <ListHead className="hidden lg:table-cell">Dates</ListHead>
                <ListHead className="hidden md:table-cell">Signed</ListHead>
                <ListHead className="hidden sm:table-cell">Status</ListHead>
                <ListHead className="w-10">
                  <span className="sr-only">Open</span>
                </ListHead>
              </ListHeaderRow>
              <ListBody>
                {agreements.map((agreement) => (
                  <AgreementRow
                    key={agreement.id}
                    agreement={agreement}
                    onOpen={() => setOpenId(agreement.id)}
                  />
                ))}
              </ListBody>
            </ListCard>
          </section>
        </>
      )}

      <AgreementDialog
        agreement={open}
        email={email}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
      />
    </div>
  );
}

function datesOf(agreement: CustomerAgreement): string | null {
  if (agreement.kind === 'extension') {
    const to = formatDate(agreement.periodEndDate);
    return to ? `Extended to ${to}` : null;
  }
  return agreement.rentalStartDate
    ? formatBookingDates(agreement.rentalStartDate, agreement.rentalEndDate)
    : null;
}

function AgreementRow({
  agreement,
  onOpen,
}: {
  agreement: CustomerAgreement;
  onOpen: () => void;
}) {
  const chip = STATE_CHIP[agreement.state];
  const title = agreementTitle(agreement);
  const dates = datesOf(agreement);
  const meta = [agreement.vehicleLabel, dates]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');

  return (
    <ListRow onOpen={onOpen}>
      <ListCell className="max-w-0 w-[60%] sm:w-[40%] md:w-[28%]">
        <RowButton onOpen={onOpen} label={`Open ${title} ${agreement.rentalReference ?? ''}`.trim()}>
          <span className="block truncate font-semibold tracking-tight text-pv-fg">
            {title}
            {agreement.rentalReference ? (
              <span className="ml-1.5 font-medium tabular-nums text-pv-muted-fg">
                {agreement.rentalReference}
              </span>
            ) : null}
          </span>
        </RowButton>
        <span className="mt-0.5 block truncate text-[13px] text-pv-muted-fg md:hidden">{meta}</span>
        <StatusText tone={chip.tone} className="mt-1 block sm:hidden">
          {chip.label}
        </StatusText>
      </ListCell>
      <ListCell className="hidden w-[20%] max-w-0 md:table-cell">
        <span className="block truncate font-medium text-pv-fg">{agreement.vehicleLabel ?? '—'}</span>
      </ListCell>
      <ListCell className="hidden whitespace-nowrap tabular-nums text-pv-fg lg:table-cell">
        {dates ?? '—'}
      </ListCell>
      <ListCell className="hidden whitespace-nowrap tabular-nums text-pv-fg md:table-cell">
        {formatTimestamp(agreement.completedAt) ?? <span className="text-pv-muted-fg">—</span>}
      </ListCell>
      <ListCell className="hidden sm:table-cell">
        <StatusText tone={chip.tone}>{chip.label}</StatusText>
      </ListCell>
      <ListCell className="w-10 text-right">
        <ChevronRight aria-hidden className="ml-auto size-4 text-pv-muted-fg" />
      </ListCell>
    </ListRow>
  );
}
