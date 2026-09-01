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
 */

import { FileSignature, RefreshCw } from 'lucide-react';

import {
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  StatTile,
} from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomer } from '@/hooks/use-customer';
import { useCustomerAgreements } from '@/hooks/use-customer-agreements';
import { useCustomerRentals } from '@/hooks/use-customer-rentals';

import { AgreementCard } from './agreement-card';

/** Matches the shape of one `AgreementCard` so the list does not jump on load. */
function AgreementCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-[14px] border border-brand-border-soft bg-brand-card p-3.5 sm:gap-4 sm:p-4">
      <Skeleton className="size-11 shrink-0 rounded-[10px] bg-brand-stone" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-44 bg-brand-stone" />
            <Skeleton className="h-3.5 w-32 bg-brand-stone" />
          </div>
          <Skeleton className="h-6 w-28 shrink-0 rounded-full bg-brand-stone" />
        </div>
        <Skeleton className="h-3 w-56 bg-brand-stone" />
        <Skeleton className="h-3 w-40 bg-brand-stone" />
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

  const hasBookings = rentalSummary.total > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Agreements"
        description="Your rental agreements, where each one has got to, and your signed copies."
        action={
          <Button
            type="button"
            variant="brand-outline"
            className="h-11 w-full sm:w-auto"
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
        <div className="flex flex-col gap-3" aria-hidden>
          <AgreementCardSkeleton />
          <AgreementCardSkeleton />
        </div>
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
            "1 agreement, 0 signed, 1 awaiting" restates the single card beneath
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

          <div className="flex flex-col gap-3">
            {agreements.map((agreement) => (
              <AgreementCard key={agreement.id} agreement={agreement} email={email} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
