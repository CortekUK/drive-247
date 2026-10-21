'use client';

/**
 * Customer portal v2 — Home, on the operator's page structure (owner, Oct 22
 * 2026: "take their structure directly ... import the components"):
 *
 *   1. The page header: "Hi, Ghulam" and the date.
 *   2. What needs the customer, as the operator's tinted alerts — a payment, a
 *      late instalment, ID verification — each with its one action. Nothing
 *      waiting, nothing drawn.
 *   3. The operator's hero row: the Rentals tab's chart on the customer's own
 *      rentals (booked value with what was picked up as the second line, the
 *      same series math as the operator's, shared/portal-v2/rentals-metrics.ts)
 *      and, as the featured card, the rental on now — dates, days left, times
 *      and, on a plan, the instalments. Nothing on rent, "Book a car".
 *   4. Recent rentals, in the Rentals page's table.
 *
 * Money comes from `useCustomerPayments` — the ledger Finances reads — never
 * from `rentals.payment_status`, which goes stale (the canary's Malibu says
 * 'pending' with every ledger charge settled).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CreditCard, ShieldCheck } from 'lucide-react-nw';

import { formatClockLabel, normalizeClock } from '@nw/components/booking/time-utils';
import { formatDate } from '@nw/components/portal/format';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerPayments } from '@nw/hooks/use-customer-payments';
import { useCustomerRentals, type CustomerRental } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { parseDateOnly } from '@nw/lib/domain/date-utils';
import { cn } from '@nw/lib/utils';
import { FeaturedLinkCard, HeroChartLoading, ToneAlert } from '@nw/portal-v2/hero';
import { InstalmentTrack } from '@nw/portal-v2/instalment-track';
import { CustomerRentalsTable, CustomerRentalsTableSkeleton, customerRentalStatus } from '@nw/portal-v2/rentals/rentals-table';
import { formatBookingDates } from '@nw/portal-v2/rentals/format';
import { LoadError, PageHeader } from '@nw/portal-v2/primitives';
import { V2_BUTTON_DEFAULT_SM, V2_BUTTON_OUTLINE_SM } from '@portal-v2-shared/button-styles';
import { HeroChart, HeroRow } from '@portal-v2-shared/hero-chart';
import { formatCurrency as formatMoney } from '@portal-v2-shared/money';
import { rentalsHeroMetrics } from '@portal-v2-shared/rentals-metrics';

/** Hover = fade only, 200ms, ease-out on / ease-in off (V2_PLAN §12). */
const HOVER_FADE = 'transition-colors duration-200 ease-in hover:ease-out motion-reduce:transition-none';

function useFirstName(): string | null {
  const { displayName } = useCustomer();
  if (!displayName) return null;
  const first = displayName.split(/\s+/)[0];
  return first && first.length > 1 ? first : displayName;
}

/** Whole days from today to a DATE-only string; negative once it has passed. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = parseDateOnly(iso);
  const now = new Date();
  const a = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86_400_000);
}

function clock(raw: string | null): string | null {
  const normalized = normalizeClock(raw);
  return normalized ? formatClockLabel(normalized) : null;
}

/* ──────────────────────────────── page ─────────────────────────────────── */

export function PortalV2Overview() {
  const { rentals, summary, isLoading, isError, error, refetch } = useCustomerRentals();
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const firstName = useFirstName();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const current = summary.current;
  const recent = rentals.filter((rental) => rental.id !== current?.id).slice(0, 6);

  const metrics = useMemo(
    () =>
      rentalsHeroMetrics(
        rentals.map((r) => ({ createdAt: r.createdAt, start: r.startDate, status: customerRentalStatus(r), amount: r.total })),
        { format: (v) => formatMoney(v, currencyCode), countLabel: 'Rentals booked' },
      ),
    [rentals, currencyCode],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={firstName ? `Hi, ${firstName}` : 'Welcome back'} description={today} />

      {isError ? (
        <LoadError
          title="We could not load your rentals"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      <NeedsYou />

      <HeroRow
        chart={isLoading ? <HeroChartLoading label="Booked value" /> : <HeroChart metrics={metrics} defaultRange="12m" />}
        card={
          isLoading ? (
            <Skeleton className="min-h-[15rem] rounded-2xl bg-pv-tint" />
          ) : current ? (
            <CurrentRentalCard rental={current} />
          ) : (
            <FeaturedLinkCard title="Book a car" subtitle="No rental on right now" href="/booking" />
          )
        }
      />

      {isLoading ? (
        <section className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40 bg-pv-tint" />
          <CustomerRentalsTableSkeleton rows={3} />
        </section>
      ) : recent.length > 0 ? (
        <section aria-labelledby="recent-rentals" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-rentals" className="text-[17px] font-semibold tracking-[-0.01em] text-pv-fg">
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

/* ──────────────────────────────── needs you ────────────────────────────── */

interface ActionItem {
  key: string;
  icon: typeof CreditCard;
  tone: 'danger' | 'warning' | 'neutral';
  title: string;
  description: string;
  action: { label: string; href: string; primary?: boolean };
}

function useActionItems(): { items: ActionItem[]; isLoading: boolean } {
  const { formatCurrency } = useTenantBranding();
  const { isIdentityVerified, isLoading: customerLoading } = useCustomer();
  const { payableBalances, activePlans, isLoading } = useCustomerPayments();

  const items: ActionItem[] = [];

  // Balances that can be paid by card from Finances.
  for (const row of payableBalances) {
    if (row.blockedReason !== null) continue;
    const car = row.rental?.vehicle?.displayName ?? row.rental?.reference ?? 'your booking';
    items.push({
      key: `pay-${row.rentalId}`,
      icon: CreditCard,
      tone: row.isOverdue ? 'danger' : 'warning',
      title: `${formatCurrency(row.amount)} ${row.isOverdue ? 'overdue' : 'due'} on the ${car}`,
      description: row.nextDueDate
        ? `${row.isOverdue ? 'Was due' : 'Due'} ${formatDate(row.nextDueDate)}. Pay it by card.`
        : 'Pay it by card.',
      action: { label: 'Pay now', href: '/portal/payments#pay', primary: true },
    });
  }

  // A plan collects its own instalments; it needs the customer only when one is late.
  for (const plan of activePlans) {
    const late = plan.installments.filter((i) => i.state === 'overdue' || i.state === 'failed');
    if (late.length === 0) continue;
    const first = late[0];
    const car = plan.rental?.vehicle?.displayName ?? plan.rental?.reference ?? 'your booking';
    items.push({
      key: `plan-${plan.id}`,
      icon: CalendarClock,
      tone: 'danger',
      title: `Instalment ${first.number} of ${plan.count} on the ${car} ${first.state === 'failed' ? 'failed' : 'is overdue'}`,
      description: `${formatCurrency(first.amount)}, due ${formatDate(first.dueDate)}${
        late.length > 1 ? `, and ${late.length - 1} more after it` : ''
      }. Check the card on file.`,
      action: { label: 'View plan', href: '/portal/payments#plans' },
    });
  }

  if (!customerLoading && !isIdentityVerified) {
    items.push({
      key: 'verify',
      icon: ShieldCheck,
      tone: 'neutral',
      title: 'Verify your ID before pickup',
      description: 'Your driving licence or ID card, and a selfie. It takes about two minutes.',
      action: { label: 'Verify', href: '/portal/settings?section=verification', primary: true },
    });
  }

  return { items, isLoading };
}

function NeedsYou() {
  const { items, isLoading } = useActionItems();
  if (isLoading || items.length === 0) return null;

  // Two to a row when there are several; an odd last one takes the full row,
  // so no alert sits alone beside empty space.
  return (
    <div aria-label="Needs you" className={cn('grid gap-3', items.length > 1 && 'lg:grid-cols-2')}>
      {items.map((item, index) => (
        <ToneAlert
          key={item.key}
          tone={item.tone}
          title={item.title}
          description={item.description}
          action={
            <Link href={item.action.href} className={item.action.primary ? V2_BUTTON_DEFAULT_SM : V2_BUTTON_OUTLINE_SM}>
              {item.action.label}
            </Link>
          }
          className={items.length > 1 && items.length % 2 === 1 && index === items.length - 1 ? 'lg:col-span-2' : undefined}
        />
      ))}
    </div>
  );
}

/* ──────────────────────────── current rental ───────────────────────────── */

/**
 * The featured card, on the rental the customer has right now: the car as the
 * card's title, its dates, days left and times under it, and on an instalment
 * plan the instalments as the segmented bar. The whole card opens the rental.
 */
function CurrentRentalCard({ rental }: { rental: CustomerRental }) {
  const { activePlans } = useCustomerPayments();
  const plan = activePlans.find((candidate) => candidate.rentalId === rental.id) ?? null;

  const left = daysUntil(rental.endDate);
  const remaining =
    left === null
      ? null
      : left > 1
        ? `${left} days left`
        : left === 1
          ? '1 day left'
          : left === 0
            ? 'Due back today'
            : `Overdue since ${formatDate(rental.endDate)}`;
  const pickup = clock(rental.pickupTime);
  const dropoff = clock(rental.returnTime);

  return (
    <FeaturedLinkCard
      title={rental.vehicle?.displayName ?? 'Your rental'}
      subtitle={`On rent now · ${rental.reference}`}
      href={`/portal/rentals/${rental.id}`}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <div className="col-span-2">
          <dt className="text-neutral-500 dark:text-neutral-400">Dates</dt>
          <dd className="font-medium tabular-nums text-neutral-900 dark:text-white">
            {formatBookingDates(rental.startDate, rental.endDate)}
            {remaining ? <span className="text-pv-primary"> · {remaining}</span> : null}
          </dd>
        </div>
        {pickup ? (
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Pick up</dt>
            <dd className="font-medium tabular-nums text-neutral-900 dark:text-white">{pickup}</dd>
          </div>
        ) : null}
        {dropoff ? (
          <div>
            <dt className="text-neutral-500 dark:text-neutral-400">Return</dt>
            <dd className="font-medium tabular-nums text-neutral-900 dark:text-white">{dropoff}</dd>
          </div>
        ) : null}
      </dl>
      {plan ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
            Instalments · {plan.paidCount} of {plan.count} paid
          </p>
          <InstalmentTrack plan={plan} compact />
        </div>
      ) : null}
    </FeaturedLinkCard>
  );
}
