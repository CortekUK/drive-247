'use client';

/**
 * What Drive247 did for you this month — the last card on the v2 home.
 *
 * Real numbers only, never the demo data the Insights cards fall back to: the
 * point of this card is that the operator can trust it next to their bill.
 * See `useValueSummary` for what each figure counts.
 */

import { useTenant } from '@/contexts/TenantContext';
import { useTenantSubscription } from '@/hooks/use-tenant-subscription';
import { changeLabel, useValueSummary } from '@/hooks/use-value-summary';
import { formatCurrency } from '@/lib/format-utils';
import { Eyebrow } from './ui';

export function ValueSummaryCard() {
  const { tenant } = useTenant();
  const { data, isLoading, isError } = useValueSummary();
  const { subscription } = useTenantSubscription();
  const currency = tenant?.currency_code || 'USD';
  const money = (n: number) => formatCurrency(n, currency, { maximumFractionDigits: 0 });

  if (isError) return null;

  const cur = data?.thisMonth;
  const prev = data?.lastMonthToDate;
  const stats = cur
    ? [
        { label: 'Bookings', value: String(cur.bookings), change: changeLabel(cur.bookings, prev?.bookings ?? 0) },
        { label: 'In rentals', value: money(cur.rentalRevenue), change: changeLabel(cur.rentalRevenue, prev?.rentalRevenue ?? 0, money) },
        { label: 'Repeat customers', value: String(cur.repeatCustomers), change: changeLabel(cur.repeatCustomers, prev?.repeatCustomers ?? 0) },
        { label: 'Messages sent for you', value: String(cur.messagesSent), change: changeLabel(cur.messagesSent, prev?.messagesSent ?? 0) },
      ]
    : [];

  const planCents = subscription?.amount ?? 0;
  const planInterval = subscription?.interval === 'year' ? 'year' : 'month';

  return (
    <div className="rounded-2xl border border-[var(--pv-line)] bg-[var(--pv-paper)] p-6">
      <Eyebrow>{data ? `${data.monthLabel} so far` : 'This month'}</Eyebrow>
      <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--pv-ink)]">What Drive247 did for you</h3>

      {/* One sentence first — the line an operator actually reads. */}
      <p className="mt-1 text-[13px] text-[var(--pv-ink-2)]">
        {cur
          ? `${cur.bookings} booking${cur.bookings === 1 ? '' : 's'} · ${money(cur.rentalRevenue)} in rentals · ${cur.repeatCustomers} repeat customer${
              cur.repeatCustomers === 1 ? '' : 's'
            } · ${cur.messagesSent} message${cur.messagesSent === 1 ? '' : 's'} sent for you.`
          : 'Counting this month…'}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--pv-line)] bg-[var(--pv-line)] lg:grid-cols-4">
        {isLoading || !cur
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-[var(--pv-paper)] p-4">
                <div className="h-3 w-20 animate-pulse rounded bg-[var(--pv-line)]" />
                <div className="mt-3 h-6 w-14 animate-pulse rounded bg-[var(--pv-line)]" />
              </div>
            ))
          : stats.map(({ label, value, change }) => (
              <div key={label} className="bg-[var(--pv-paper)] p-4">
                <Eyebrow>{label}</Eyebrow>
                <p className="mt-2 text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--pv-ink)]">{value}</p>
                {change && <p className="mt-1.5 text-[11px] text-[var(--pv-ink-3)]">{change}</p>}
              </div>
            ))}
      </div>

      {cur && planCents > 0 && (
        <p className="mt-4 text-[13px] text-[var(--pv-ink-2)]">
          Your plan is{' '}
          <span className="font-medium text-[var(--pv-ink)]">
            {formatCurrency(planCents / 100, (subscription?.currency || currency).toUpperCase())}/{planInterval}
          </span>
          {cur.rentalRevenue > 0 && (
            <>
              {' '}— this month you&apos;ve taken <span className="font-medium text-[var(--pv-ink)]">{money(cur.rentalRevenue)}</span> through it.
            </>
          )}
        </p>
      )}
    </div>
  );
}
