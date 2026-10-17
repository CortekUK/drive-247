'use client';

/**
 * Customer portal v2 — Home. Laid out like the operator portal v2 dashboard:
 * a greeting, a top row of three cards on one brand ramp (the lead booking on
 * the full gradient, what needs the customer on a lighter print of it, where
 * they stand on a plain card), then recent bookings.
 *
 * Everything comes from the single `useCustomerRentals` fetch (scoped by
 * `customer_id` AND `tenant_id` inside the hook), so a number here can never
 * disagree with the bookings list.
 */

import Link from 'next/link';
import { ArrowUpRight, CalendarDays, CarFront, CheckCircle2, ChevronRight, CreditCard, MapPin, ShieldCheck } from 'lucide-react-nw';

import { formatDateRange } from '@nw/components/portal/format';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCustomer } from '@nw/hooks/use-customer';
import {
  useCustomerRentals,
  type CustomerRental,
  type RentalLifecycle,
} from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

/* ─────────────────────────────── pieces ────────────────────────────────── */

const CARD = 'rounded-2xl border border-pv-border bg-pv-card';

const LIFECYCLE: Record<RentalLifecycle, { label: string; className: string }> = {
  pending: { label: 'Awaiting confirmation', className: 'text-pv-warning' },
  upcoming: { label: 'Upcoming', className: 'text-pv-primary' },
  on_rent: { label: 'On rent', className: 'text-pv-success' },
  completed: { label: 'Completed', className: 'text-pv-muted-fg' },
  cancelled: { label: 'Cancelled', className: 'text-pv-danger' },
};

/** The brand gradient behind a top-row card. `strength` 1 = full, lower = a lighter print. */
function BrandSurface({ strength }: { strength: number }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-linear-to-br from-pv-chart-3 via-pv-primary to-pv-chart-5"
        style={{ opacity: strength }}
      />
      {strength < 1 ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-white" style={{ opacity: 0.2 }} />
      ) : null}
    </>
  );
}

function bookingHref(rental: CustomerRental): string {
  return `/portal-v2/bookings/${rental.id}`;
}

function useFirstName(): string | null {
  const { displayName } = useCustomer();
  if (!displayName) return null;
  const first = displayName.split(/\s+/)[0];
  return first && first.length > 1 ? first : displayName;
}

/* ──────────────────────────────── page ─────────────────────────────────── */

export function PortalV2Overview() {
  const { rentals, summary, isLoading, isError, refetch } = useCustomerRentals();
  const firstName = useFirstName();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const lead = summary.current ?? summary.next;
  const recent = rentals.filter((rental) => rental.id !== lead?.id).slice(0, 5);

  return (
    <div className="flex flex-col gap-8 pt-1">
      <header>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-pv-muted-fg">{today}</p>
        <h2 className="mt-0.5 text-[28px] font-bold leading-[1.15] tracking-[-0.03em] text-pv-fg md:text-[32px]">
          {firstName ? `Hi, ${firstName}` : 'Welcome back'}
        </h2>
      </header>

      {isError ? (
        <div className={cn(CARD, 'flex items-center justify-between gap-4 px-5 py-4')}>
          <p className="text-sm text-pv-fg">We could not load your bookings.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="h-9 cursor-pointer rounded-lg border border-pv-border px-3 text-[13px] font-medium text-pv-fg hover:bg-pv-tint"
          >
            Try again
          </button>
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        {isLoading ? (
          <>
            <Skeleton className="h-[220px] rounded-2xl bg-pv-tint" />
            <Skeleton className="h-[220px] rounded-2xl bg-pv-tint" />
            <Skeleton className="h-[220px] rounded-2xl bg-pv-tint" />
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

      {!isLoading && recent.length > 0 ? <RecentBookings rentals={recent} /> : null}
    </div>
  );
}

/* ──────────────────────────────── cards ────────────────────────────────── */

function LeadCard({ lead, isOnRent, hasAny }: { lead: CustomerRental | null; isOnRent: boolean; hasAny: boolean }) {
  return (
    <article className="relative isolate flex min-h-[220px] flex-col overflow-hidden rounded-2xl p-5 text-white">
      <BrandSurface strength={1} />
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/75">
        {isOnRent ? 'On rent now' : 'Your next booking'}
      </p>

      {lead ? (
        <>
          <h3 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">
            {lead.vehicle?.displayName ?? 'Your vehicle'}
          </h3>
          <div className="mt-3 flex flex-col gap-1.5 text-[13px] text-white/85">
            <span className="flex items-center gap-2">
              <CalendarDays aria-hidden className="size-4 shrink-0" />
              {formatDateRange(lead.startDate, lead.endDate)}
            </span>
            {lead.pickupLocation ? (
              <span className="flex items-center gap-2">
                <MapPin aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{lead.pickupLocation}</span>
              </span>
            ) : null}
          </div>
          <div className="mt-auto flex items-center justify-between gap-3 pt-5">
            <span className="font-mono text-[12px] text-white/70">{lead.reference}</span>
            <Link
              href={bookingHref(lead)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-pv-primary transition-opacity hover:opacity-90"
            >
              View booking
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </div>
        </>
      ) : (
        <>
          <h3 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">
            {hasAny ? 'Nothing coming up' : 'No bookings yet'}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/85">
            {hasAny
              ? 'Your past bookings are still under Bookings.'
              : 'When you book a car it shows here, with your dates and pickup.'}
          </p>
          <div className="mt-auto pt-5">
            <Link
              href="/booking"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-pv-primary transition-opacity hover:opacity-90"
            >
              Book a car
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </div>
        </>
      )}
    </article>
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
      hint: formatCurrency(rental.total),
    });
  }
  if (!isIdentityVerified) {
    tasks.push({
      key: 'verify',
      href: '/portal-v2/verification',
      icon: ShieldCheck,
      label: 'Verify your ID',
      hint: 'Needed before pickup',
    });
  }

  return (
    <article className="relative isolate flex min-h-[220px] flex-col overflow-hidden rounded-2xl p-5 text-white">
      <BrandSurface strength={0.88} />
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/80">Needs you</p>

      {tasks.length === 0 ? (
        <div className="mt-2 flex flex-1 flex-col">
          <h3 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">You&apos;re all set</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-white/85">Nothing to pay and nothing to sign right now.</p>
          <CheckCircle2 aria-hidden strokeWidth={1.5} className="mt-auto size-9 text-white/70" />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.key}>
              <Link
                href={task.href}
                className="flex items-center gap-3 rounded-xl bg-white/15 px-3 py-2.5 transition-colors hover:bg-white/25"
              >
                <task.icon aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{task.label}</span>
                  <span className="block truncate text-[12px] text-white/75">{task.hint}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-white/70" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
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
  const stats = [
    { label: 'On rent', value: onRent, icon: CarFront },
    { label: 'Upcoming', value: upcoming, icon: CalendarDays },
    { label: 'Completed', value: completed, icon: CheckCircle2 },
  ];

  return (
    <article className={cn(CARD, 'flex min-h-[220px] flex-col p-5')}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-pv-muted-fg">Where you stand</p>
      <p className="mt-2 text-[34px] font-bold leading-none tracking-[-0.03em] text-pv-fg tabular-nums">{total}</p>
      <p className="mt-1 text-[13px] text-pv-muted-fg">
        {total === 1 ? 'booking' : 'bookings'} in total{cancelled > 0 ? ` · ${cancelled} cancelled` : ''}
      </p>
      <div className="mt-auto grid grid-cols-3 gap-2 pt-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-pv-tint px-3 py-2.5">
            <stat.icon aria-hidden className="size-4 text-pv-primary" />
            <p className="mt-1.5 text-lg font-bold leading-none text-pv-fg tabular-nums">{stat.value}</p>
            <p className="mt-1 truncate text-[11px] text-pv-muted-fg">{stat.label}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

/* ─────────────────────────── recent bookings ───────────────────────────── */

function RecentBookings({ rentals }: { rentals: CustomerRental[] }) {
  const { formatCurrency } = useTenantBranding();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-[15px] font-semibold text-pv-fg">Recent bookings</h3>
        <Link href="/portal-v2/bookings" className="text-[13px] font-medium text-pv-primary hover:underline">
          See all
        </Link>
      </div>

      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="hidden grid-cols-[2fr_2fr_1.4fr_1fr_24px] gap-4 bg-pv-tint px-5 py-2.5 text-[12px] font-semibold text-pv-fg/70 md:grid">
          <span>Vehicle</span>
          <span>Dates</span>
          <span>Status</span>
          <span className="text-right">Total</span>
          <span />
        </div>
        <ul className="divide-y divide-pv-border">
          {rentals.map((rental) => {
            const status = LIFECYCLE[rental.lifecycle];
            return (
              <li key={rental.id}>
                <Link
                  href={bookingHref(rental)}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 px-5 py-3.5 transition-colors hover:bg-pv-row md:grid-cols-[2fr_2fr_1.4fr_1fr_24px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-pv-fg">
                      {rental.vehicle?.displayName ?? 'Vehicle'}
                    </span>
                    <span className="block font-mono text-[11px] text-pv-muted-fg">{rental.reference}</span>
                  </span>
                  <span className="order-3 col-span-2 truncate text-[13px] text-pv-muted-fg md:order-none md:col-span-1">
                    {formatDateRange(rental.startDate, rental.endDate)}
                  </span>
                  <span className={cn('hidden text-[13px] font-medium md:block', status.className)}>{status.label}</span>
                  <span className="text-right text-[13px] font-semibold text-pv-fg tabular-nums">
                    {formatCurrency(rental.total)}
                  </span>
                  <ChevronRight aria-hidden className="hidden size-4 text-pv-muted-fg md:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
