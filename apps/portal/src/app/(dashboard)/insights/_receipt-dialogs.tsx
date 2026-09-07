'use client';

/**
 * Insights — what is behind each line of the receipt.
 *
 * Every dialog here answers the same question in the same shape: the summary
 * first, the workings second. An operator who opens "money you spent" wants to
 * know WHICH CAR before they want to know which invoice, and a list of forty
 * service records sorted by date answers the second question while hiding the
 * first. So each dialog leads with the breakdown that makes the number mean
 * something, and puts the itemised rows underneath it.
 *
 * ── Where the rows come from ────────────────────────────────────────────────
 *
 * Nowhere new. Every list below is a filter over the arrays `useInsights`
 * already fetched for the receipt — `data.ledger`, `data.refunds`,
 * `data.receivables`. Nothing here re-queries and nothing here re-sums, so a
 * dialog cannot disagree with the row that opened it, and opening one costs no
 * round trip. The single exception is `useCostDescriptions`, which resolves
 * what a cost was FOR, because the ledger genuinely does not record it — see
 * `_receipt-data.ts`.
 *
 * ── The cap ─────────────────────────────────────────────────────────────────
 *
 * Lists are capped at `LIST_CAP` rows and the cap is always STATED. A screen
 * about money may show you part of the answer; it may never show you part of
 * the answer while looking like the whole of it.
 */

import { useMemo, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { EmptyState } from './_kit';
import { classify, toNumber, type Bucket } from './_money-model';
import { vehicleName, type InsightsData, type LedgerRow } from './_data';
import { useCostDescriptions } from './_receipt-data';

/** How many itemised rows any one list renders before it says it stopped. */
const LIST_CAP = 100;

/* ────────────────────────────────────────────────────────────────────────────
 * Formatting
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Dialogs print exact amounts, to the penny.
 *
 * The receipt itself rounds to whole units — that is a headline. This is the
 * evidence for it, and evidence that has been rounded is not evidence. It is
 * also the only place a $0.50 deposit refund is legible at all.
 */
const money = (amount: number, currency: string) => formatCurrency(amount, currency);

/**
 * A `date` column, which carries no time and no zone.
 *
 * Parsed and formatted in UTC on purpose: `new Date('2026-09-06')` is midnight
 * UTC, and rendering that in a timezone west of UTC prints the 5th. The ledger
 * says the 6th, so the screen says the 6th.
 */
function formatDay(value: string | null): string {
  if (!value) return '—';
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A `timestamptz`, which is a real instant and belongs in the reader's zone. */
function formatInstant(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Furniture
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The shell every dialog shares.
 *
 * It owns loading and empty, so no individual dialog can forget one. `isEmpty`
 * is the caller's call rather than an inference — "no rows" and "rows that all
 * sum to nothing" are both empty and only the caller knows which it has.
 */
function ReceiptDialog({
  open,
  onOpenChange,
  title,
  description,
  loading,
  isEmpty,
  emptyMessage,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  loading: boolean;
  isEmpty: boolean;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState message={emptyMessage} className="h-40" />
        ) : (
          <div className="max-h-[58vh] space-y-6 overflow-y-auto pr-1">{children}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A titled block inside a dialog. Used for both the summary and the workings. */
function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <h3 className="font-heading text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {meta ? (
          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** One line: something on the left, an amount on the right, a note under it. */
function Line({
  label,
  sub,
  amount,
  meta,
  strong,
}: {
  label: string;
  sub?: string | null;
  amount: string;
  meta?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-foreground/5 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className={cn('truncate text-sm', strong ? 'font-medium' : undefined)}>{label}</p>
        {/* Wraps rather than truncates: a refund's reason and a service's
            description are the whole reason someone opened this. The label
            above still truncates, so one long name cannot break the column. */}
        {sub ? <p className="mt-0.5 text-xs break-words text-muted-foreground">{sub}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('text-sm tabular-nums', strong ? 'font-medium' : undefined)}>{amount}</p>
        {meta ? <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{meta}</p> : null}
      </div>
    </div>
  );
}

/**
 * The sentence a capped list ends on.
 *
 * Rendered only when something was actually left out. A list that fits says
 * nothing, because "showing 12 of 12" is noise.
 */
function CapNote({
  shown,
  total,
  noun = 'entries',
}: {
  shown: number;
  total: number;
  noun?: string;
}) {
  if (shown >= total) return null;
  return (
    <p className="pt-2 text-xs text-muted-foreground">
      Showing the {shown === 1 ? 'first' : `first ${shown}`} of {total.toLocaleString()} {noun}.
      Narrow the period for a shorter list.
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared derivations
 * ──────────────────────────────────────────────────────────────────────────── */

/** The ledger rows in one bucket, newest first. */
function rowsIn(ledger: LedgerRow[], bucket: Bucket): LedgerRow[] {
  return ledger
    .filter((row) => classify(row) === bucket)
    .sort((a, b) => (b.entry_date ?? '').localeCompare(a.entry_date ?? ''));
}

/** Sum a set of rows by category, biggest first. */
function byCategory(rows: LedgerRow[]): { category: string; amount: number; count: number }[] {
  const totals = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const key = row.category ?? 'Uncategorised';
    const entry = totals.get(key) ?? { amount: 0, count: 0 };
    entry.amount += toNumber(row.amount);
    entry.count += 1;
    totals.set(key, entry);
  }
  return [...totals.entries()]
    .map(([category, t]) => ({ category, ...t }))
    .sort((a, b) => b.amount - a.amount);
}

const sumOf = (rows: LedgerRow[]) => rows.reduce((total, row) => total + toNumber(row.amount), 0);

/** A share of a total, or nothing when the total is zero and a share is a lie. */
function share(amount: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${((amount / total) * 100).toFixed(1)}%`;
}

/** Stable identity, so a dialog rendered before the data lands is not a crash. */
const NO_LABELS: Map<string, string> = new Map();

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
};

/* ────────────────────────────────────────────────────────────────────────────
 * Money you took in
 * ──────────────────────────────────────────────────────────────────────────── */

export function TookInDialog({ open, onOpenChange, data, loading, currency }: DialogProps) {
  // Both revenue buckets: this row is the GROSS top line, tax and deposits
  // included. They come back out on their own line further down the receipt,
  // and taking them out here as well would remove them twice.
  const rows = useMemo(
    () =>
      (data?.ledger ?? [])
        .filter((row) => {
          const bucket = classify(row);
          return bucket === 'operating_revenue' || bucket === 'non_revenue';
        })
        .sort((a, b) => (b.entry_date ?? '').localeCompare(a.entry_date ?? '')),
    [data?.ledger],
  );

  const total = sumOf(rows);
  const categories = byCategory(rows);
  const shown = rows.slice(0, LIST_CAP);

  return (
    <ReceiptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Money you took in"
      description="Everything charged to customers in this period, before anything comes back out."
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="Nothing was charged to a customer in this period."
    >
      <Block title="What it was for" meta={money(total, currency)}>
        {categories.map((c) => (
          <Line
            key={c.category}
            label={c.category}
            sub={`${c.count.toLocaleString()} ${c.count === 1 ? 'entry' : 'entries'}`}
            amount={money(c.amount, currency)}
            meta={share(c.amount, total)}
          />
        ))}
      </Block>

      <Block title="Every entry, newest first">
        {shown.map((row) => (
          <Line
            key={row.id}
            label={row.category ?? 'Uncategorised'}
            sub={
              row.vehicle_id
                ? `${formatDay(row.entry_date)} · ${vehicleName(data?.vehicleLabels ?? NO_LABELS, row.vehicle_id)}`
                : formatDay(row.entry_date)
            }
            amount={money(toNumber(row.amount), currency)}
          />
        ))}
        <CapNote shown={shown.length} total={rows.length} />
      </Block>
    </ReceiptDialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Money you gave back
 * ──────────────────────────────────────────────────────────────────────────── */

export function GaveBackDialog({ open, onOpenChange, data, loading, currency }: DialogProps) {
  const refunds = data?.refunds ?? [];
  const total = refunds.reduce((sum, r) => sum + r.amount, 0);
  const shown = refunds.slice(0, LIST_CAP);

  return (
    <ReceiptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Money you gave back"
      description="Refunds paid to customers in this period. The ledger does not record these, so they are subtracted here."
      loading={loading}
      isEmpty={refunds.length === 0}
      emptyMessage="You did not refund anybody in this period."
    >
      <Block title="Refunds" meta={money(total, currency)}>
        {shown.map((refund) => (
          <Line
            key={refund.id}
            label={refund.customerName ?? 'Customer no longer on record'}
            sub={[
              formatInstant(refund.date),
              vehicleName(data?.vehicleLabels ?? NO_LABELS, refund.vehicleId),
              // A refund with no reason is common and is not an error — it just
              // means nobody typed one. Saying so beats an empty gap.
              // Several refunds against one payment are stored as one string
              // joined with '; ', and some carry embedded newlines. Both are
              // flattened so the line reads as a sentence rather than as raw
              // column content.
              refund.reason?.replace(/\s+/g, ' ').trim().replace(/\s*;\s*/g, ' · ') ||
                'No reason recorded',
            ].join(' · ')}
            amount={money(refund.amount, currency)}
          />
        ))}
        <CapNote shown={shown.length} total={refunds.length} />
      </Block>
    </ReceiptDialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Money that was never yours
 * ──────────────────────────────────────────────────────────────────────────── */

export function NeverYoursDialog({ open, onOpenChange, data, loading, currency }: DialogProps) {
  const rows = useMemo(() => rowsIn(data?.ledger ?? [], 'non_revenue'), [data?.ledger]);

  // Split by what it actually is, not by category name: everything that is not
  // a deposit is tax. A new tax category added next month lands in the tax
  // block on its own, which is where an operator would look for it.
  const deposits = rows.filter((row) => row.category === 'Security Deposit');
  const tax = rows.filter((row) => row.category !== 'Security Deposit');

  const taxTotal = sumOf(tax);
  const depositTotal = sumOf(deposits);

  const shownTax = tax.slice(0, LIST_CAP);
  const shownDeposits = deposits.slice(0, LIST_CAP);

  return (
    <ReceiptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Money that was never yours"
      description="Collected from customers, owed straight back out. Sales tax belongs to the state; a deposit belongs to the customer."
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="You collected no sales tax and held no deposits in this period."
    >
      <Block title="Sales tax collected" meta={money(taxTotal, currency)}>
        {shownTax.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No sales tax was collected in this period.
          </p>
        ) : (
          <>
            {shownTax.map((row) => (
              <Line
                key={row.id}
                label={row.category ?? 'Tax'}
                sub={formatDay(row.entry_date)}
                amount={money(toNumber(row.amount), currency)}
              />
            ))}
            <CapNote shown={shownTax.length} total={tax.length} />
          </>
        )}
      </Block>

      <Block title="Refundable deposits held" meta={money(depositTotal, currency)}>
        {shownDeposits.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            You held no refundable deposits in this period.
          </p>
        ) : (
          <>
            {shownDeposits.map((row) => (
              <Line
                key={row.id}
                label={row.category ?? 'Security Deposit'}
                sub={formatDay(row.entry_date)}
                amount={money(toNumber(row.amount), currency)}
              />
            ))}
            <CapNote shown={shownDeposits.length} total={deposits.length} />
          </>
        )}
      </Block>
    </ReceiptDialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Money you spent
 * ──────────────────────────────────────────────────────────────────────────── */

/** What a cost line was for, once the reference has been resolved — or before. */
function costLabel(row: LedgerRow, descriptions: Map<string, string> | undefined): string {
  const resolved = row.reference ? descriptions?.get(row.reference) : undefined;
  if (resolved) return resolved;
  // The fallback is the category, which is always true and rarely useful.
  // 'Expenses' is what the ledger calls a running cost; the operator does not.
  return row.category === 'Expenses' ? 'Running cost' : (row.category ?? 'Cost');
}

export function SpentDialog({ open, onOpenChange, data, loading, currency }: DialogProps) {
  const rows = useMemo(() => rowsIn(data?.ledger ?? [], 'operating_cost'), [data?.ledger]);

  // Resolved only while the dialog is open — see `_receipt-data.ts`.
  const { data: descriptions, isLoading: descriptionsLoading } = useCostDescriptions(
    rows.map((row) => row.reference),
    open,
  );

  /*
   * Grouped by car, worst first.
   *
   * This is the point of the dialog. "$5,179 of costs" is a number; "$3,400 of
   * it is the one Model 3" is the thing an operator can act on. Costs with no
   * vehicle_id are real — 34 of 54 Expenses rows on production carry none — and
   * get their own group rather than being dropped or spread across cars.
   */
  const groups = useMemo(() => {
    const byVehicle = new Map<string, LedgerRow[]>();
    for (const row of rows) {
      const key = row.vehicle_id ?? '';
      const list = byVehicle.get(key) ?? [];
      list.push(row);
      byVehicle.set(key, list);
    }
    return [...byVehicle.entries()]
      .map(([vehicleId, list]) => ({
        vehicleId,
        label: vehicleName(data?.vehicleLabels ?? NO_LABELS, vehicleId || null),
        amount: sumOf(list),
        rows: list,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [rows, data?.vehicleLabels]);

  const total = sumOf(rows);

  // The cap counts LINES, not groups: a hundred lines is a hundred lines
  // whether they belong to one car or forty.
  let budget = LIST_CAP;
  const shownGroups = groups
    .map((group) => {
      const take = Math.max(0, Math.min(budget, group.rows.length));
      budget -= take;
      return { ...group, shownRows: group.rows.slice(0, take) };
    })
    .filter((group) => group.shownRows.length > 0);

  const shownCount = LIST_CAP - budget;

  return (
    <ReceiptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Money you spent"
      description="What it cost to run the cars in this period. Buying and selling them is not in here — it has its own line."
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="No running costs were recorded in this period."
    >
      <Block title="Which car it went on" meta={money(total, currency)}>
        {groups.slice(0, LIST_CAP).map((group) => (
          <Line
            key={group.vehicleId || 'unassigned'}
            label={group.label}
            sub={`${group.rows.length.toLocaleString()} ${group.rows.length === 1 ? 'entry' : 'entries'}`}
            amount={money(group.amount, currency)}
            meta={share(group.amount, total)}
          />
        ))}
        {/* A fleet bigger than the cap is unlikely and not impossible, and an
            unbounded list is how a dialog freezes a tab. */}
        <CapNote shown={Math.min(groups.length, LIST_CAP)} total={groups.length} noun="cars" />
      </Block>

      {shownGroups.map((group) => (
        <Block
          key={group.vehicleId || 'unassigned'}
          title={group.label}
          meta={money(group.amount, currency)}
        >
          {group.shownRows.map((row) => (
            <Line
              key={row.id}
              label={
                descriptionsLoading && row.reference
                  ? (row.category ?? 'Cost')
                  : costLabel(row, descriptions)
              }
              sub={formatDay(row.entry_date)}
              amount={money(toNumber(row.amount), currency)}
            />
          ))}
        </Block>
      ))}

      <CapNote shown={shownCount} total={rows.length} />
    </ReceiptDialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Still owed to you
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How late a customer's debt is, from the ageing buckets.
 *
 * The oldest bucket carrying anything wins, because that is the part of the
 * debt in trouble. A customer with $50 at 100 days and $2,000 at 10 days is a
 * customer who has stopped paying for something, and reporting them as "under
 * 30 days" because most of the money is recent would hide exactly that.
 */
function overdueLabel(row: { bucket_90_plus: number; bucket_61_90: number; bucket_31_60: number }): string {
  if (row.bucket_90_plus > 0) return 'Over 90 days late';
  if (row.bucket_61_90 > 0) return '61–90 days late';
  if (row.bucket_31_60 > 0) return '31–60 days late';
  return 'Under 30 days';
}

export function OwedDialog({ open, onOpenChange, data, loading, currency }: DialogProps) {
  const receivables = data?.receivables ?? [];
  const aging = data?.aging;
  const shown = receivables.slice(0, LIST_CAP);

  return (
    <ReceiptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Still owed to you"
      description="Everything outstanding as of today, across every invoice. Not limited to the period above — a debt does not disappear because you asked about three months."
      loading={loading}
      isEmpty={receivables.length === 0}
      emptyMessage="Nobody owes you anything. Every invoice is settled."
    >
      {aging ? (
        <Block title="How old the debt is" meta={money(aging.total, currency)}>
          <Line label="Under 30 days" amount={money(aging.bucket_0_30, currency)} />
          <Line label="31–60 days" amount={money(aging.bucket_31_60, currency)} />
          <Line label="61–90 days" amount={money(aging.bucket_61_90, currency)} />
          <Line label="Over 90 days" amount={money(aging.bucket_90_plus, currency)} strong />
        </Block>
      ) : null}

      <Block title="Who owes it, worst first">
        {shown.map((row, i) => (
          <Line
            key={row.customerId ?? `row-${i}`}
            label={row.customerName ?? 'Customer no longer on record'}
            sub={overdueLabel(row)}
            amount={money(row.total, currency)}
            meta={row.bucket_90_plus > 0 ? `${money(row.bucket_90_plus, currency)} over 90d` : undefined}
          />
        ))}
        <CapNote shown={shown.length} total={receivables.length} />
      </Block>
    </ReceiptDialog>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Car purchases
 * ──────────────────────────────────────────────────────────────────────────── */

export function CarPurchasesDialog({ open, onOpenChange, data, loading, currency }: DialogProps) {
  const rows = useMemo(() => rowsIn(data?.ledger ?? [], 'capital_cost'), [data?.ledger]);

  const bought = rows.filter((row) => row.category === 'Acquisition');
  const sold = rows.filter((row) => row.category !== 'Acquisition');
  const shown = rows.slice(0, LIST_CAP);

  return (
    <ReceiptDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buying and selling cars"
      description="Capital, not running cost. You swapped cash for a car you still own, so it sits outside what you kept rather than eating into it."
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="You did not buy or sell a car in this period."
    >
      <Block title="Summary">
        <Line
          label="Cars bought"
          sub={`${bought.length.toLocaleString()} ${bought.length === 1 ? 'purchase' : 'purchases'}`}
          amount={money(sumOf(bought), currency)}
        />
        <Line
          label="Cars taken off the fleet"
          sub={`${sold.length.toLocaleString()} ${sold.length === 1 ? 'disposal' : 'disposals'}`}
          amount={money(sumOf(sold), currency)}
        />
      </Block>

      <Block title="Every car, newest first">
        {shown.map((row) => (
          <Line
            key={row.id}
            label={vehicleName(data?.vehicleLabels ?? NO_LABELS, row.vehicle_id)}
            sub={`${row.category === 'Acquisition' ? 'Bought' : 'Taken off the fleet'} · ${formatDay(row.entry_date)}`}
            amount={money(toNumber(row.amount), currency)}
          />
        ))}
        <CapNote shown={shown.length} total={rows.length} />
      </Block>
    </ReceiptDialog>
  );
}
