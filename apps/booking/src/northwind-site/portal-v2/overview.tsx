'use client';

/**
 * Customer portal v2 — Home. Laid out like the operator portal v2 dashboard
 * (components/dashboard-v2): a page header, a top row of three cards on one
 * brand ramp — the lead booking on the full gradient, what needs the customer
 * on a lighter print of it, where they stand on the flat accent tint, exactly
 * the three strengths `card-surface.tsx` uses — then recent rentals in the
 * same table as the Rentals page.
 *
 * Everything comes from the single `useCustomerRentals` fetch (scoped by
 * `customer_id` AND `tenant_id` inside the hook), so a number here can never
 * disagree with the bookings list.
 */

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronRight, CreditCard, MapPin, ShieldCheck } from 'lucide-react-nw';

import { relativeDayLabel } from '@nw/components/portal/format';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerRentals, type CustomerRental } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import { CustomerRentalsTable, CustomerRentalsTableSkeleton } from '@nw/portal-v2/rentals/rentals-table';
import { formatBookingDates } from '@nw/portal-v2/rentals/format';
import { LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';

/* ─────────────────────────────── pieces ────────────────────────────────── */

/** A top-row card: the Panel frame (radius, padding rhythm) with the paint behind it. */
const TOP_CARD = 'relative isolate flex min-h-[180px] flex-col overflow-hidden p-5 lg:min-h-[236px]';

/** The card label, as the operator dashboard sets it: 12px, uppercase, wide. */
const CARD_LABEL = 'text-xs font-semibold uppercase tracking-wider';

/** Hover = fade only, 200ms, ease-out on / ease-in off (V2_PLAN §12). */
const HOVER_FADE = 'transition-colors duration-200 ease-in hover:ease-out motion-reduce:transition-none';

type Surface = 'lead' | 'needs-you' | 'where-you-stand';

/**
 * `card-surface.tsx`'s three strengths, on the `--pv-*` set: the full gradient,
 * the gradient at 0.88 under 20% white, and a flat accent at 0.45 under 34%
 * white. Two layers at `-z-10`, so the host needs `relative isolate`.
 */
function CardSurface({ surface }: { surface: Surface }) {
  if (surface === 'where-you-stand') {
    return (
      <>
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-pv-primary opacity-45" />
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-white opacity-[0.34]" />
      </>
    );
  }
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-pv-chart-3 via-pv-primary to-pv-chart-5"
        style={{ opacity: surface === 'lead' ? 1 : 0.88 }}
      />
      {surface === 'needs-you' ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-white opacity-20" />
      ) : null}
    </>
  );
}

function bookingHref(rental: CustomerRental): string {
  return `/portal/rentals/${rental.id}`;
}

function useFirstName(): string | null {
  const { displayName } = useCustomer();
  if (!displayName) return null;
  const first = displayName.split(/\s+/)[0];
  return first && first.length > 1 ? first : displayName;
}

/* ──────────────────────────────── page ─────────────────────────────────── */

export function PortalV2Overview() {
  const { rentals, summary, isLoading, isError, error, refetch } = useCustomerRentals();
  const firstName = useFirstName();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const lead = summary.current ?? summary.next;
  const recent = rentals.filter((rental) => rental.id !== lead?.id).slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={today}
        title={firstName ? `Hi, ${firstName}` : 'Welcome back'}
        description="Your next rental, anything we need from you, and your recent rentals."
      />

      {isError ? (
        <LoadError
          title="We could not load your rentals"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      <section aria-label="At a glance" className="grid gap-5 lg:grid-cols-3">
        {isLoading ? (
          <>
            <Skeleton className="h-[236px] rounded-2xl bg-pv-tint" />
            <Skeleton className="h-[236px] rounded-2xl bg-pv-tint" />
            <Skeleton className="h-[236px] rounded-2xl bg-pv-tint" />
          </>
        ) : (
          <>
            <LeadCard lead={lead} isOnRent={!!summary.current} hasAny={rentals.length > 0} />
            <NeedsYouCard awaitingPayment={summary.awaitingPayment} />
            <WhereYouStandCard
              onRent={summary.onRent}
              upcoming={summary.upcoming}
              completed={summary.past}
              total={summary.total}
              cancelled={summary.cancelled}
            />
          </>
        )}
      </section>

      {isLoading ? (
        <section className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40 bg-pv-tint" />
          <CustomerRentalsTableSkeleton rows={3} />
        </section>
      ) : recent.length > 0 ? (
        <section aria-labelledby="recent-rentals" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 id="recent-rentals" className="text-[18px] font-semibold tracking-[-0.01em] text-pv-fg">
              Recent rentals
            </h2>
            <Link
              href="/portal/rentals"
              className={cn(
                '-mr-2 inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-pv-link hover:bg-pv-hover',
                HOVER_FADE,
              )}
            >
              See all
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </div>
          <CustomerRentalsTable rentals={recent} footer={false} />
        </section>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────── cards ────────────────────────────────── */

const WHITE_BUTTON = cn(
  'inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-pv-primary hover:bg-white/85',
  HOVER_FADE,
);

function LeadCard({ lead, isOnRent, hasAny }: { lead: CustomerRental | null; isOnRent: boolean; hasAny: boolean }) {
  // "Due back in 11 days" while on rent, "Starts tomorrow" before; nothing
  // when the date is far enough out that a countdown stops being useful.
  const countdown = lead ? relativeDayLabel(isOnRent ? lead.endDate : lead.startDate) : null;
  const countdownLabel = countdown ? (isOnRent ? `Due back ${countdown}` : `Starts ${countdown}`) : null;

  return (
    <Panel className={cn(TOP_CARD, 'border-transparent bg-transparent text-white')}>
      <CardSurface surface="lead" />
      <p className={cn(CARD_LABEL, 'text-white/70')}>{isOnRent ? 'On rent now' : 'Your next rental'}</p>

      {lead ? (
        <>
          <h3 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">
            {lead.vehicle?.displayName ?? 'Your vehicle'}
          </h3>
          <div className="mt-3 flex flex-col gap-1.5 text-[13px] text-white/85">
            <span className="flex items-center gap-2">
              <CalendarDays aria-hidden className="size-4 shrink-0" />
              {formatBookingDates(lead.startDate, lead.endDate)}
            </span>
            {lead.deliveryAddress ?? lead.pickupLocation ? (
              <span className="flex items-center gap-2">
                <MapPin aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{lead.deliveryAddress ?? lead.pickupLocation}</span>
              </span>
            ) : null}
          </div>
          <div className="mt-auto flex items-end justify-between gap-3 pt-5">
            <span className="min-w-0">
              {countdownLabel ? (
                <span className="block text-[13px] font-semibold">{countdownLabel}</span>
              ) : null}
              <span className="block text-[12px] text-white/70">{lead.reference}</span>
            </span>
            <Link href={bookingHref(lead)} className={WHITE_BUTTON}>
              View rental
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </div>
        </>
      ) : (
        <>
          <h3 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">
            {hasAny ? 'Nothing coming up' : 'No rentals yet'}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/85">
            {hasAny
              ? 'Your past rentals are still under Rentals.'
              : 'When you book a car it shows here, with your dates and pickup.'}
          </p>
          <div className="mt-auto pt-5">
            <QuickBookTrigger className={WHITE_BUTTON}>
              Book a car
              <ArrowUpRight aria-hidden className="size-4" />
            </QuickBookTrigger>
          </div>
        </>
      )}
    </Panel>
  );
}

function NeedsYouCard({ awaitingPayment }: { awaitingPayment: CustomerRental[] }) {
  const { isIdentityVerified } = useCustomer();
  const { formatCurrency } = useTenantBranding();

  const tasks: Array<{ key: string; href: string; icon: typeof CreditCard; label: string; hint: string }> = [];
  for (const rental of awaitingPayment.slice(0, 2)) {
    tasks.push({
      key: `pay-${rental.id}`,
      href: bookingHref(rental),
      icon: CreditCard,
      label: `Pay for ${rental.reference}`,
      hint: `${formatCurrency(rental.total)} · ${rental.vehicle?.displayName ?? 'Rental'}`,
    });
  }
  if (!isIdentityVerified) {
    tasks.push({
      key: 'verify',
      href: '/portal/verification',
      icon: ShieldCheck,
      label: 'Verify your ID',
      hint: 'Needed before pickup',
    });
  }

  return (
    <Panel className={cn(TOP_CARD, 'border-transparent bg-transparent text-white')}>
      <CardSurface surface="needs-you" />
      <p className={cn(CARD_LABEL, 'flex items-center justify-between gap-2 text-white/70')}>
        Needs you
        {tasks.length > 0 ? <span className="tabular-nums">{tasks.length}</span> : null}
      </p>

      {tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-4 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-white/80 text-pv-success">
            <Check aria-hidden className="size-5" />
          </span>
          <p className="mt-1 text-[15px] font-semibold">You&apos;re all set</p>
          <p className="text-[13px] text-white/75">Nothing to pay and nothing to sign right now.</p>
        </div>
      ) : (
        <ul className="-mx-2 mt-2 flex flex-1 flex-col justify-center gap-0.5">
          {tasks.map((task) => (
            <li key={task.key}>
              <Link
                href={task.href}
                className={cn('group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-white/15', HOVER_FADE)}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20">
                  <task.icon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{task.label}</span>
                  <span className="block truncate text-[12px] text-white/75">{task.hint}</span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-white/50 transition-colors duration-200 ease-in group-hover:text-white group-hover:ease-out motion-reduce:transition-none"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function WhereYouStandCard({
  onRent,
  upcoming,
  completed,
  total,
  cancelled,
}: {
  onRent: number;
  upcoming: number;
  completed: number;
  total: number;
  cancelled: number;
}) {
  // The bar is the operator card's fleet bar: one segment per state that has
  // any bookings, sized by its share, on a faint track when there are none.
  const segments = [
    { key: 'on-rent', label: 'On rent', value: onRent, bar: 'bg-pv-primary', dot: 'bg-pv-primary' },
    { key: 'upcoming', label: 'Upcoming', value: upcoming, bar: 'bg-pv-primary/45', dot: 'bg-pv-primary/45' },
    { key: 'completed', label: 'Completed', value: completed, bar: 'bg-pv-fg/20', dot: 'bg-pv-fg/25' },
  ];
  const counted = onRent + upcoming + completed;

  return (
    <Panel className={cn(TOP_CARD, 'border-transparent bg-transparent')}>
      <CardSurface surface="where-you-stand" />
      <p className={cn(CARD_LABEL, 'text-pv-muted-on-tint')}>Where you stand</p>

      <Link
        href="/portal/rentals"
        className={cn('group -mx-2 my-auto flex flex-col gap-3 rounded-xl px-2 py-2 hover:bg-white/40', HOVER_FADE)}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-[34px] font-semibold leading-none tabular-nums text-pv-fg">{total}</span>
          <span className="text-[13px] text-pv-muted-on-tint">
            {total === 1 ? 'rental' : 'rentals'} in total{cancelled > 0 ? ` · ${cancelled} cancelled` : ''}
          </span>
          <ArrowUpRight
            aria-hidden
            className="ml-auto size-4 shrink-0 self-center text-transparent transition-colors duration-200 ease-in group-hover:text-pv-muted-on-tint group-hover:ease-out motion-reduce:transition-none"
          />
        </span>

        <span className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {counted === 0 ? (
            <span className="flex-1 rounded-full bg-pv-fg/10" />
          ) : (
            segments
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <span key={segment.key} className={cn('rounded-full', segment.bar)} style={{ flexGrow: segment.value }} />
              ))
          )}
        </span>

        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
          {segments.map((segment) => (
            <span key={segment.key} className="flex items-center gap-1.5">
              <span className={cn('size-1.5 rounded-full', segment.dot)} />
              <span className="font-semibold tabular-nums text-pv-fg">{segment.value}</span>
              <span className="text-pv-muted-on-tint">{segment.label}</span>
            </span>
          ))}
        </span>
      </Link>
    </Panel>
  );
}
