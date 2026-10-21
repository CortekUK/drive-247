'use client';

/**
 * Customer portal v2 — Home (owner, Oct 22 2026: "density over decoration").
 * Top to bottom:
 *
 *   1. One greeting line: "Hi, Ghulam" and the date.
 *   2. The action strip — one line per thing waiting on the customer (a
 *      payment, a late instalment, ID verification): what it is, the amount or
 *      deadline, the car, the action. Nothing waiting, no strip at all.
 *   3. The current rental, as one card sized to its content; or, with nothing
 *      on rent, a single "No active rental · Book a car" line.
 *   4. Recent rentals, in the Rentals page's table.
 *
 * The three gradient cards and "Where you stand" (a count and a bar that said
 * nothing) are gone.
 *
 * `rentals.payment_status` is NOT read for the strip: it goes stale (the
 * canary's Malibu says 'pending' with every ledger charge settled), so a
 * booking counts as owing only when the ledger says so.
 *
 * Money comes from `useCustomerPayments` — the ledger Finances reads — so the
 * amount here is the amount there. The strip used to quote the rental's base
 * price, which disagreed with Finances whenever there were fees and tax.
 */

import Link from 'next/link';
import { ArrowRight, CalendarClock, CreditCard, ShieldCheck, type LucideIcon } from 'lucide-react-nw';

import { formatClockLabel, normalizeClock } from '@nw/components/booking/time-utils';
import { formatDate } from '@nw/components/portal/format';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerPayments } from '@nw/hooks/use-customer-payments';
import { useCustomerRentals, type CustomerRental } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { parseDateOnly } from '@nw/lib/domain/date-utils';
import { cn } from '@nw/lib/utils';
import { CustomerRentalsTable, CustomerRentalsTableSkeleton } from '@nw/portal-v2/rentals/rentals-table';
import { formatBookingDates } from '@nw/portal-v2/rentals/format';
import { LoadError, Panel } from '@nw/portal-v2/primitives';
import { QuickBookTrigger } from '@nw/site-v2/quick-book/quick-book-dialog';
import { V2_BUTTON_DEFAULT_SM, V2_BUTTON_OUTLINE_SM } from '@portal-v2-shared/button-styles';

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
  const firstName = useFirstName();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const current = summary.current;
  const recent = rentals.filter((rental) => rental.id !== current?.id).slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-heading text-2xl font-bold tracking-normal text-pv-fg sm:text-3xl">
          {firstName ? `Hi, ${firstName}` : 'Welcome back'}
        </h1>
        <p className="text-sm text-pv-muted-fg">{today}</p>
      </div>

      {isError ? (
        <LoadError
          title="We could not load your rentals"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      <ActionStrip />

      {isLoading ? (
        <Skeleton className="h-[104px] w-full rounded-2xl bg-pv-tint sm:w-[640px]" />
      ) : current ? (
        <CurrentRentalCard rental={current} />
      ) : (
        <Panel className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:w-fit">
          <p className="text-[14px] text-pv-muted-fg">No active rental</p>
          <QuickBookTrigger className={V2_BUTTON_DEFAULT_SM}>Book a car</QuickBookTrigger>
        </Panel>
      )}

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

/* ───────────────────────────── action strip ────────────────────────────── */

interface ActionItem {
  key: string;
  icon: LucideIcon;
  tone: 'danger' | 'warning' | 'neutral';
  what: string;
  /** The amount or the deadline. */
  figure: string | null;
  /** The car it is for, or a short reason. */
  about: string | null;
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
    items.push({
      key: `pay-${row.rentalId}`,
      icon: CreditCard,
      tone: row.isOverdue ? 'danger' : 'warning',
      what: row.isOverdue ? 'Payment overdue' : 'Payment due',
      figure: formatCurrency(row.amount),
      about: row.rental?.vehicle?.displayName ?? row.rental?.reference ?? null,
      action: { label: 'Pay now', href: '/portal/payments#pay', primary: true },
    });
  }

  // A plan collects its own instalments; it needs the customer only when one is late.
  for (const plan of activePlans) {
    const late = plan.installments.find((i) => i.state === 'overdue' || i.state === 'failed');
    if (!late) continue;
    items.push({
      key: `plan-${plan.id}`,
      icon: CalendarClock,
      tone: 'danger',
      what: late.state === 'failed' ? 'Instalment failed' : 'Instalment overdue',
      figure: formatCurrency(late.amount),
      about: plan.rental?.vehicle?.displayName ?? plan.rental?.reference ?? null,
      action: { label: 'View plan', href: '/portal/payments#plans' },
    });
  }

  if (!customerLoading && !isIdentityVerified) {
    items.push({
      key: 'verify',
      icon: ShieldCheck,
      tone: 'neutral',
      what: 'Verify your ID',
      figure: 'Before pickup',
      about: 'Driving licence or ID card',
      action: { label: 'Verify', href: '/portal/settings?section=verification', primary: true },
    });
  }

  return { items, isLoading };
}

function ActionStrip() {
  const { items, isLoading } = useActionItems();
  if (isLoading || items.length === 0) return null;

  return (
    <Panel className="overflow-hidden">
      <ul aria-label="Needs you" className="divide-y divide-pv-border">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5">
            <item.icon
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                'size-4 shrink-0',
                item.tone === 'danger' && 'text-pv-danger',
                item.tone === 'warning' && 'text-pv-warning',
                item.tone === 'neutral' && 'text-pv-muted-fg',
              )}
            />
            <p className="min-w-0 flex-1 text-[14px] sm:truncate">
              <span
                className={cn(
                  'font-semibold',
                  item.tone === 'danger' ? 'text-pv-danger' : item.tone === 'warning' ? 'text-pv-warning' : 'text-pv-fg',
                )}
              >
                {item.what}
              </span>
              {item.figure ? <span className="font-semibold tabular-nums text-pv-fg"> · {item.figure}</span> : null}
              {item.about ? <span className="text-pv-muted-fg"> · {item.about}</span> : null}
            </p>
            <Link href={item.action.href} className={item.action.primary ? V2_BUTTON_DEFAULT_SM : V2_BUTTON_OUTLINE_SM}>
              {item.action.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ──────────────────────────── current rental ───────────────────────────── */

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-pv-muted-fg">{label}</dt>
      <dd className="mt-0.5 whitespace-nowrap text-[14px] font-medium tabular-nums text-pv-fg">{value}</dd>
    </div>
  );
}

function CurrentRentalCard({ rental }: { rental: CustomerRental }) {
  const left = daysUntil(rental.endDate);
  const remaining =
    left === null
      ? null
      : left > 1
        ? `${left} days`
        : left === 1
          ? '1 day'
          : left === 0
            ? 'Due back today'
            : `Overdue since ${formatDate(rental.endDate)}`;

  return (
    <Panel className="w-full sm:w-fit">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-pv-muted-fg">On rent now</p>
          <p className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-pv-fg">
            {rental.vehicle?.displayName ?? 'Your vehicle'}
          </p>
          <p className="text-[13px] text-pv-muted-fg">{rental.reference}</p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Fact label="Dates" value={formatBookingDates(rental.startDate, rental.endDate)} />
          <Fact label="Days left" value={remaining} />
          <Fact label="Pick up" value={clock(rental.pickupTime)} />
          <Fact label="Return" value={clock(rental.returnTime)} />
        </dl>
        <Link href={`/portal/rentals/${rental.id}`} className={V2_BUTTON_DEFAULT_SM}>
          View rental
        </Link>
      </div>
    </Panel>
  );
}
