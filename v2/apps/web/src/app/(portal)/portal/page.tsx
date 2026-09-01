'use client';

/**
 * The overview.
 *
 * One question, answered above the fold: WHAT HAPPENS NEXT. A rental in
 * progress outranks an upcoming one (the customer has the car and a return date
 * to meet); an upcoming one outranks the counts; the counts outrank the links.
 * Everything on this page comes from the single `useCustomerRentals` fetch —
 * there is no second query behind the stat tiles, so a number here can never
 * disagree with the list on /portal/bookings.
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  CheckCircle2,
  CreditCard,
  FileText,
  TriangleAlert,
} from 'lucide-react';

import { BookingCard } from '@/components/portal/booking-card';
import { formatDate } from '@/components/portal/format';
import {
  BookingListSkeleton,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  PanelHeader,
  StatTile,
} from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import { useCustomer } from '@/hooks/use-customer';
import { useCustomerRentals } from '@/hooks/use-customer-rentals';
import { useTenantBranding } from '@/hooks/use-tenant-branding';

/**
 * First name only, for the greeting.
 *
 * `displayName` falls back to the email local part when the name is blank, so
 * this can legitimately be "ada" rather than "Ada" — which is still better than
 * greeting somebody as "ada@example.com" or with a bare "Your account".
 */
function useFirstName(): string | null {
  const { displayName } = useCustomer();
  if (!displayName) return null;
  const first = displayName.split(/\s+/)[0];
  return first && first.length > 1 ? first : displayName;
}

export default function PortalOverviewPage() {
  const { rentals, summary, isLoading, isError, error, refetch } = useCustomerRentals();
  const { formatCurrency } = useTenantBranding();
  const firstName = useFirstName();

  // The one booking that leads the page, and the label that explains why.
  const lead = summary.current ?? summary.next;
  const leadHeading = summary.current ? 'Your rental right now' : 'Your next booking';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={firstName ? `Hi, ${firstName}` : 'Your account'}
        description="Your bookings, at a glance."
        action={
          <Button asChild variant="brand" className="h-11 w-full sm:w-auto">
            <Link href="/booking">Book a car</Link>
          </Button>
        }
      />

      {isError ? (
        <LoadError
          title="We could not load your bookings"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      {/*
        The nudge, above everything else it could affect. `awaitingPayment`
        already excludes cancelled and completed rentals — chasing money on a
        booking that no longer exists is how a portal loses trust.
      */}
      {!isLoading && summary.awaitingPayment.length > 0 ? (
        <div className="flex items-start gap-3 rounded-[14px] border border-warning-med bg-warning-light px-4 py-3.5">
          <TriangleAlert
            aria-hidden
            strokeWidth={1.75}
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-brand-text">
              {summary.awaitingPayment.length === 1
                ? 'One booking is waiting for payment'
                : `${summary.awaitingPayment.length} bookings are waiting for payment`}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">
              Your reservation is not confirmed until payment clears. Open the
              booking to see what is outstanding.
            </p>
            <Link
              href={`/portal/bookings/${summary.awaitingPayment[0].id}`}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
            >
              {summary.awaitingPayment[0].reference}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : null}

      {/* ── The lead booking ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-brand-text">{leadHeading}</h2>
          {rentals.length > 0 ? (
            <Link
              href="/portal/bookings"
              className="text-sm text-brand-text-soft underline-offset-4 hover:text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
            >
              See all
            </Link>
          ) : null}
        </div>

        {isLoading ? (
          <BookingListSkeleton rows={1} />
        ) : lead ? (
          <BookingCard rental={lead} featured />
        ) : (
          <Panel>
            <EmptyState
              icon={CarFront}
              title={
                rentals.length === 0
                  ? 'No bookings yet'
                  : 'Nothing coming up'
              }
              description={
                rentals.length === 0
                  ? 'When you book a car it will appear here, with your dates, pickup location and price.'
                  : 'You have no upcoming rentals. Your past bookings are still in My Bookings.'
              }
              action={{ href: '/booking', label: 'Browse the fleet' }}
            />
          </Panel>
        )}
      </section>

      {/* ── Counts ──────────────────────────────────────────────────────── */}
      {!isLoading && summary.total > 0 ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="On rent"
            value={summary.onRent}
            icon={CarFront}
            caption={
              summary.current?.endDate
                ? `Back ${formatDate(summary.current.endDate)}`
                : undefined
            }
          />
          <StatTile label="Upcoming" value={summary.upcoming} icon={CalendarDays} />
          <StatTile label="Completed" value={summary.past} icon={CheckCircle2} />
          <StatTile
            label="Total bookings"
            value={summary.total}
            caption={
              summary.cancelled > 0
                ? `${summary.cancelled} cancelled`
                : undefined
            }
          />
        </section>
      ) : null}

      {/* ── Recent bookings ─────────────────────────────────────────────── */}
      {!isLoading && rentals.length > 1 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-brand-text">Recent bookings</h2>
          <div className="flex flex-col gap-3">
            {rentals
              .filter((rental) => rental.id !== lead?.id)
              .slice(0, 3)
              .map((rental) => (
                <BookingCard key={rental.id} rental={rental} />
              ))}
          </div>
        </section>
      ) : null}

      {/* ── Quick links ─────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader title="Quick links" />
        <div className="grid gap-px bg-brand-border-soft sm:grid-cols-3">
          <QuickLink
            href="/portal/bookings"
            icon={CalendarDays}
            label="My bookings"
            hint={
              summary.total === 1 ? '1 booking' : `${summary.total} bookings`
            }
          />
          <QuickLink
            href="/portal/documents"
            icon={FileText}
            label="Documents"
            hint="Licence, ID and insurance"
          />
          <QuickLink
            href="/portal/payments"
            icon={CreditCard}
            label="Payments"
            hint={
              summary.awaitingPayment.length > 0
                ? `${formatCurrency(
                    summary.awaitingPayment.reduce((sum, r) => sum + r.total, 0),
                  )} outstanding`
                : 'Invoices and receipts'
            }
          />
        </div>
      </Panel>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 bg-brand-card px-4 py-3.5 transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className="size-4 shrink-0 text-brand-text-subtle"
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-brand-text">{label}</span>
        <span className="truncate text-xs text-brand-text-subtle">{hint}</span>
      </span>
      <ArrowRight
        aria-hidden
        strokeWidth={1.75}
        className="ml-auto size-4 shrink-0 text-brand-text-subtle"
      />
    </Link>
  );
}
