'use client';

/**
 * Finances — what the customer owes, what they have paid, every invoice, and
 * the card we charge.
 *
 * ── THE LAYOUT (owner, Oct 22 2026, second pass) ────────────────────────────
 * Top to bottom: the page header (and the alert bar under it, as on every
 * page); the one graph in the portal — the balance, what is still to pay and
 * what has been paid — beside a simple status: "All settled", or the amount
 * due and nothing more. The status opens the detail (what the balance is made
 * of, and a Pay button per booking). Then the card on file, then Invoices /
 * Payments in the same table the other tabs use.
 *
 * Gone on purpose: the help card (Ask Trax is in the top bar), the elaborate
 * balance panel, and the instalment plan / pay-as-you-go / auto-extension UI,
 * which will be designed on their own later.
 *
 * ── PAYING ──────────────────────────────────────────────────────────────────
 * The customer pays for every rental, including ones the operator created.
 * Pay sits on each invoice row with an amount due, in the invoice sheet, in
 * the status detail, on the rental page and in the alert bar — all through
 * the shell's PayProvider (northwind-site/portal-v2/pay), one booking at a
 * time because that is the unit `create-booking-payment-intent` prices.
 *
 * ── ONE BALANCE, ONE SOURCE ─────────────────────────────────────────────────
 * The headline figure comes from `ledger_entries` and nothing else. See the
 * header of `use-customer-payments.ts` for which table answers what.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { Download } from 'lucide-react-nw';

import { formatDate } from '@nw/components/portal/format';
import { Skeleton } from '@nw/components/ui/skeleton';
import { Dialog } from '@nw/components/ui/dialog';
import { useTenant } from '@nw/contexts/TenantContext';
import {
  useCustomerPayments,
  type CustomerBalance,
  type CustomerInvoice,
  type CustomerPayment,
  type PayableBalance,
} from '@nw/hooks/use-customer-payments';
import {
  EPS,
  useCustomerInvoiceFigures,
  type BreakdownState,
  type InvoiceRowFigures,
} from '@nw/hooks/use-customer-invoice-breakdown';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { parseDateOnly } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';
import { PvDialogContent, PvDialogHeader, PvStatus } from '@nw/portal-v2/dialog';
import { HeroChartLoading, localDay } from '@nw/portal-v2/hero';
import { PayButton } from '@nw/portal-v2/pay/pay-provider';
import { LoadError, PageHeader } from '@nw/portal-v2/primitives';
import { V2_BUTTON_OUTLINE_SM, V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from '@portal-v2-shared/header';
import { PhoneCarousel } from '@nw/portal-v2/phone-carousel';
import { PhoneList, PhoneRow } from '@nw/portal-v2/phone-list';
import { MOTION_FLOATING } from '@portal-v2-shared/menu';
import { RentalsOverviewFlip } from '@portal-v2-shared/overview-flip';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';
import { HeroChart, HeroRow, type HeroMetric } from '@portal-v2-shared/hero-chart';
import {
  ListBody,
  ListCell,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES, V2_LIST_TONES, type V2ListTone } from '@portal-v2-shared/list-styles';
import { ROW_OPEN_CELL, RowOpenIndicator } from '@portal-v2-shared/row-open';

import { CardsFeatured } from './_components/cards';
import {
  FinanceFilterPanel,
  NO_FINANCE_FILTERS,
  countActiveFinanceFilters,
  type FinanceFilters,
} from './_components/finance-filter-panel';
import { CopyOnHover } from './_components/copy-on-hover';
import { InvoiceSheet } from './_components/invoice-sheet';
import { PAYMENT_CHIP } from './_components/invoice-state';

/** The chips' tones in the shared list's palette. */
const TONE: Record<string, V2ListTone> = { success: 'success', info: 'info', warning: 'warning', danger: 'danger', neutral: 'muted' };

export default function PortalPaymentsPage() {
  const { balance, payableBalances, invoices, payments, isLoading, isError, error, refetch } = useCustomerPayments();
  // Every row's Entity, Total − Paid = Remaining and due date, figured as the
  // operator's table figures them (from the rentals' charges).
  const { figures, isLoading: figuresLoading } = useCustomerInvoiceFigures(invoices);
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? '';

  const [filters, setFilters] = useState<FinanceFilters>(NO_FINANCE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const tab = filters.list;
  // Looked up by id, so the sheet shows fresh figures after a refetch.
  const openInvoice = openId ? invoices.find((i) => i.id === openId) ?? null : null;

  // What the list shows: the chosen list, its status, and the top bar's search.
  const q = term.trim().toLowerCase();
  const shownInvoices = useMemo(
    () =>
      invoices.filter(
        (i) =>
          (filters.invoiceState === 'all' || i.state === filters.invoiceState) &&
          (!q || [i.number, i.rental?.reference, i.rental?.vehicle?.displayName].some((v) => v?.toLowerCase().includes(q))),
      ),
    [filters.invoiceState, invoices, q],
  );
  const shownPayments = useMemo(
    () =>
      payments.filter(
        (p) =>
          (filters.paymentState === 'all' || p.state === filters.paymentState) &&
          (!q || [p.typeLabel, p.rental?.reference, p.method].some((v) => v?.toLowerCase().includes(q))),
      ),
    [filters.paymentState, payments, q],
  );

  // The top bar's field and filter button, as Rentals lends them: the button
  // turns the hero row over to the filter panel (shared overview-flip).
  usePageSearch({
    placeholder: tab === 'invoices' ? 'Search invoices…' : 'Search payments…',
    value: term,
    onChange: setTerm,
    scopeLabel: 'Finances',
    resultCount: isLoading ? undefined : tab === 'invoices' ? shownInvoices.length : shownPayments.length,
    filters: { open: filtersOpen, onOpenChange: setFiltersOpen, activeCount: countActiveFinanceFilters(filters) },
  });

  const listLoading = isLoading || (tab === 'invoices' && figuresLoading && invoices.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* The operator's Finances header (finances-view.tsx): the actions sit on
          the SUBTITLE line (HEADER_ACTIONS_V2), not level with the heading. */}
      <PageHeader
        title="Finances"
        description="What you owe, what you have paid, and every invoice for your bookings."
        actionClassName={HEADER_ACTIONS_V2}
        action={
          <button
            type="button"
            onClick={() =>
              tab === 'invoices' ? exportInvoices(shownInvoices, figures, company) : exportPayments(shownPayments)
            }
            disabled={listLoading || (tab === 'invoices' ? shownInvoices.length === 0 : shownPayments.length === 0)}
            className={HEADER_EXPORT}
          >
            <Download aria-hidden />
            Export CSV
          </button>
        }
      />

      {isError ? (
        <LoadError
          title="We could not load your payments"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}

      {/* The hero row, then the list, 16px apart: the operator's Finances body
          (invoices-tab.tsx: `space-y-4` around FinancesOverview and the table).
          No heading over the list; the filter says which list it is. */}
      <div className="flex flex-col gap-4">
        {isLoading ? (
          <HeroRow
            chart={<HeroChartLoading label="Still to pay" range="Last 3 months" />}
            card={<Skeleton className="min-h-[15rem] rounded-2xl bg-pv-tint lg:min-h-0" />}
          />
        ) : (
          <>
            {/* Phone: the status first, as one row — the card form would take
                half the screen to say "All settled". */}
            <BalanceStatusRow balance={balance} onOpen={() => setDetailOpen(true)} />
            <RentalsOverviewFlip
              flipped={filtersOpen}
              onFlipBack={() => setFiltersOpen(false)}
              front={
                // Phone: the graph and the card swipe as a pair, the next one
                // peeking, with page dots (the operator Home's carousel).
                <PhoneCarousel count={2}>
                  <HeroRow
                    chart={<FinancesChart balance={balance} invoices={invoices} payments={payments} />}
                    card={<CardsFeatured />}
                  />
                </PhoneCarousel>
              }
              back={
                <FinanceFilterPanel
                  filters={filters}
                  counts={{ invoices: invoices.length, payments: payments.length }}
                  onChange={setFilters}
                  onClose={() => setFiltersOpen(false)}
                />
              }
            />
          </>
        )}

        <section id="invoices" aria-label={tab === 'invoices' ? 'Invoices' : 'Payments'} className="scroll-mt-24">
          {listLoading ? (
            <Skeleton className="h-64 w-full rounded-2xl bg-pv-tint" />
          ) : tab === 'invoices' ? (
            invoices.length === 0 ? (
              <EmptyLine>No invoices yet. One is raised when a booking is confirmed.</EmptyLine>
            ) : shownInvoices.length === 0 ? (
              <EmptyLine>No invoices match your search or filters.</EmptyLine>
            ) : (
              <InvoiceTable
                invoices={shownInvoices}
                figures={figures}
                company={company}
                resetKey={`${q}|${filters.invoiceState}`}
                onOpen={(invoice) => setOpenId(invoice.id)}
              />
            )
          ) : payments.length === 0 ? (
            <EmptyLine>No payments yet. Every card payment and refund will be listed here.</EmptyLine>
          ) : shownPayments.length === 0 ? (
            <EmptyLine>No payments match your search or filters.</EmptyLine>
          ) : (
            <PaymentTable payments={shownPayments} />
          )}
        </section>
      </div>

      {/* A SHEET, as on the operator's Finances (invoice-detail-sheet.tsx) —
          for every invoice, cancelled ones included. */}
      <InvoiceSheet
        invoice={openInvoice}
        entity={openInvoice ? figures.get(openInvoice.id)?.entity ?? 'Rental' : 'Rental'}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
      <BalanceDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        balance={balance}
        payable={payableBalances}
      />
    </div>
  );
}

/**
 * Export CSV on the header line (admin's HEADER_ACTIONS_V2 alignment), in the
 * rail's Book a car colour — the owner asked for that colour (Oct 22 2026).
 */
const HEADER_EXPORT = cn(V2_BUTTON_PRIMARY, HEADER_PRIMARY_V2, 'flex-1 sm:flex-none');

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-pv-border bg-pv-card px-5 py-8 text-center text-sm text-pv-muted-fg">{children}</p>;
}

/* ─────────────────────────────── the graph ──────────────────────────────── */

/**
 * The balance over time (owner, Oct 22 2026: "a graph showing the balance, how
 * much is still to pay, and how much has been paid").
 *
 *   Still to pay — a level: today's point IS the ledger balance, each earlier
 *     day worked back from it by the invoices raised and payments taken since;
 *     its second line is what has been paid to date.
 *   Paid — money paid per period, with what was invoiced as the second line.
 */
function FinancesChart({
  balance,
  invoices,
  payments,
}: {
  balance: CustomerBalance;
  invoices: readonly CustomerInvoice[];
  payments: readonly CustomerPayment[];
}) {
  const { formatCurrency } = useTenantBranding();

  const metrics = useMemo<HeroMetric[]>(() => {
    const paid = payments.filter((p) => p.net !== 0).map((p) => ({ at: localDay(p.date), amount: p.net }));
    const invoiced = invoices
      .filter((invoice) => invoice.state !== 'cancelled')
      .map((invoice) => ({ at: localDay(invoice.invoiceDate), amount: invoice.total }));

    const endOf = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const after = (events: readonly { at: Date; amount: number }[], day: Date) =>
      events.reduce((sum, e) => (e.at.getTime() >= endOf(day) ? sum + e.amount : sum), 0);
    const upTo = (events: readonly { at: Date; amount: number }[], day: Date) =>
      events.reduce((sum, e) => (e.at.getTime() < endOf(day) ? sum + e.amount : sum), 0);
    const round = (value: number) => Math.round(value * 100) / 100;

    const days = [...paid, ...invoiced].map((e) => e.at.getTime());
    const historyStart = days.length > 0 ? new Date(Math.min(...days)) : undefined;

    return [
      {
        key: 'outstanding',
        kind: 'stock',
        label: 'Still to pay',
        description: 'Your balance: what you owe today, and on each day before it.',
        lowerIsBetter: true,
        format: formatCurrency,
        valueOn: (day: Date) => Math.max(0, round(balance.outstanding - after(invoiced, day) + after(paid, day))),
        secondary: { label: 'Paid to date', valueOn: (day: Date) => round(upTo(paid, day)) },
        historyStart,
      },
      {
        key: 'paid',
        kind: 'flow',
        label: 'Paid',
        description: 'Money you paid in each period, refunds taken off.',
        format: formatCurrency,
        events: paid,
        secondary: { label: 'Invoiced', events: invoiced },
      },
    ];
  }, [balance.outstanding, formatCurrency, invoices, payments]);

  return <HeroChart metrics={metrics} defaultRange="3m" />;
}

/* ─────────────────────────────── the status ─────────────────────────────── */

/** The status on a phone: one tappable row, the same words as the card. */
function BalanceStatusRow({ balance, onOpen }: { balance: CustomerBalance; onOpen: () => void }) {
  const { formatCurrency } = useTenantBranding();
  const settled = balance.outstanding === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-pv-border bg-pv-card px-4 py-3.5 text-left active:bg-pv-hover lg:hidden"
    >
      <span className="min-w-0">
        <span className={cn('block text-[17px] font-semibold tracking-[-0.01em]', settled ? 'text-pv-fg' : balance.overdue > 0 ? 'text-pv-danger' : 'text-pv-fg')}>
          {settled ? 'All settled' : `${formatCurrency(balance.outstanding)} due`}
        </span>
        <span className="block truncate text-[13px] text-pv-muted-fg">
          {settled
            ? 'Nothing is due on your account'
            : balance.overdue > 0
              ? `${formatCurrency(balance.overdue)} overdue`
              : balance.nextDueDate
                ? `Due ${formatDate(balance.nextDueDate)}`
                : 'See what it is made of'}
        </span>
      </span>
      <span aria-hidden className="text-[13px] font-semibold text-pv-link">
        Details
      </span>
    </button>
  );
}

/**
 * Behind the status: what the balance is made of, then each booking with
 * money open on it and its Pay button.
 */
function BalanceDetailDialog({
  open,
  onOpenChange,
  balance,
  payable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: CustomerBalance;
  payable: readonly PayableBalance[];
}) {
  const { formatCurrency } = useTenantBranding();
  const rank = (label: string) => (/^rental$/i.test(label) ? 0 : /discount/i.test(label) ? 1 : /^tax/i.test(label) ? 3 : 2);
  const categories = [...balance.categories].sort((a, b) => rank(a.label) - rank(b.label) || b.amount - a.amount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PvDialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl sm:p-0">
        <PvDialogHeader
          className="px-8 pb-5 pt-8"
          title={balance.outstanding === 0 ? 'All settled' : `${formatCurrency(balance.outstanding)} due`}
          description={
            balance.outstanding === 0
              ? `You have paid ${formatCurrency(balance.paidToDate)} in total. Nothing is outstanding.`
              : balance.overdue > 0
                ? `${formatCurrency(balance.overdue)} of it is overdue.`
                : balance.nextDueDate
                  ? `Due ${formatDate(balance.nextDueDate)}.`
                  : 'What it is made of, and what you can pay now.'
          }
          status={
            balance.outstanding === 0 ? (
              <PvStatus tone="success">Settled</PvStatus>
            ) : balance.overdue > 0 ? (
              <PvStatus tone="danger">Overdue</PvStatus>
            ) : (
              <PvStatus tone="warning">Due</PvStatus>
            )
          }
        />

        <div className="min-h-0 overflow-y-auto border-t border-pv-border">
          {payable.length > 0 ? (
            <ul className="divide-y divide-pv-border">
              {payable.map((row) => (
                <li key={row.rentalId} className="flex items-center gap-3 px-8 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-pv-fg">{row.rental?.vehicle?.displayName ?? 'Booking'}</p>
                    <p className="truncate text-[12px] text-pv-muted-fg">
                      {[
                        row.rental?.reference,
                        row.nextDueDate ? `${row.isOverdue ? 'was due' : 'due'} ${formatDate(row.nextDueDate)}` : null,
                        row.blockedReason ? 'collected by your instalment plan' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-sm font-semibold tabular-nums', row.isOverdue ? 'text-pv-danger' : 'text-pv-fg')}>
                    {formatCurrency(row.amount)}
                  </span>
                  <PayButton rentalId={row.rentalId} compact />
                </li>
              ))}
            </ul>
          ) : null}

          {categories.length > 0 ? (
            <dl className="border-t border-pv-border px-8 py-3">
              {categories.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-1.5">
                  <dt className="text-sm text-pv-muted-fg">{row.label}</dt>
                  <dd className="text-sm tabular-nums text-pv-fg">{formatCurrency(row.amount)}</dd>
                </div>
              ))}
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-pv-border pt-2.5">
                <dt className="text-sm font-semibold text-pv-fg">Total</dt>
                <dd className="text-sm font-semibold tabular-nums text-pv-fg">{formatCurrency(balance.outstanding)}</dd>
              </div>
            </dl>
          ) : null}

          {balance.unpayable > 0 ? (
            <p className="border-t border-pv-border px-8 py-3 text-[13px] text-pv-muted-fg">
              {formatCurrency(balance.unpayable)} is not linked to a booking, so it cannot be paid here.{' '}
              <Link href="/contact" className="font-medium text-pv-link hover:underline">
                Contact us
              </Link>{' '}
              and we will take it directly.
            </p>
          ) : null}
          {balance.cancelledCharges > 0 ? (
            <p className="border-t border-pv-border px-8 py-3 text-[12px] text-pv-muted-fg">
              {formatCurrency(balance.cancelledCharges)} of charges on cancelled bookings is not included.
            </p>
          ) : null}
        </div>
      </PvDialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────── the lists ──────────────────────────────── */

const Blank = () => <span className="text-pv-muted-fg">—</span>;

/** The operator's `Op`: a quiet sign between the figures, hidden from screen readers. */
const Op = ({ children }: { children: string }) => (
  <span aria-hidden className="mx-1.5 text-pv-muted-fg/50">
    {children}
  </span>
);

/** How wide each figure's slot is, in `ch` (operator `SumWidths`). */
type SumWidths = { total: number; paid: number; remaining: number };

/** Why the remaining figure is the colour it is (operator `SUM_TONE`). */
const SUM_TONE: Record<string, string> = {
  Paid: V2_LIST_TONES.success,
  'Part paid': V2_LIST_TONES.warning,
  Unpaid: 'text-pv-muted-fg',
  // The row's red line says cancelled; the figure itself stays quiet.
  Cancelled: 'text-pv-muted-fg',
};

/** The operator's list tones for a breakdown state. */
const STATE_TONE: Record<BreakdownState['tone'], V2ListTone> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  muted: 'muted',
};

/**
 * Total − Paid = Remaining, as ONE cell that reads as a sum — the operator's
 * `AmountSum` (invoice-payments-table.tsx): the two inputs quiet, the answer
 * the figure that stands out and coloured by the payment status (there is no
 * status column), one red line through the sum when the invoice is cancelled,
 * and "How this adds up" on hover.
 */
function AmountSum({
  figures: f,
  money,
  widths,
}: {
  figures: InvoiceRowFigures;
  money: (n: number) => string;
  widths: SumWidths;
}) {
  const settled = f.owes <= EPS;
  const spoken = `${f.status.label}. Total ${money(f.total)}, paid ${money(f.settled)}, remaining ${money(f.owes)}`;
  const tone = SUM_TONE[f.status.label] ?? 'text-pv-fg';

  return (
    <HoverCardPrimitive.Root openDelay={150} closeDelay={80}>
      <HoverCardPrimitive.Trigger asChild>
        <span
          tabIndex={0}
          aria-label={spoken}
          className="relative inline-flex cursor-pointer items-baseline whitespace-nowrap rounded tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50"
        >
          {f.cancelled ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -right-2 left-0 top-1/2 h-px -translate-y-px bg-red-500 dark:bg-red-400"
            />
          ) : null}
          <span className="inline-block text-right text-[13px] text-pv-muted-fg" style={{ minWidth: `${widths.total}ch` }}>
            {money(f.total)}
          </span>
          <Op>−</Op>
          <span className="inline-block text-right text-[13px] text-pv-muted-fg" style={{ minWidth: `${widths.paid}ch` }}>
            {money(f.settled)}
          </span>
          <Op>=</Op>
          <span
            className={cn('inline-block text-right text-[15px]', settled ? 'font-medium' : 'font-semibold', tone)}
            style={{ minWidth: `${widths.remaining}ch` }}
          >
            {money(f.owes)}
          </span>
        </span>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'z-50 w-72 rounded-3xl bg-pv-card p-4 text-sm text-pv-fg shadow-lg ring-1 ring-pv-fg/5 outline-none dark:ring-pv-fg/10',
            MOTION_FLOATING,
          )}
        >
          <div className="flex items-center justify-between pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-pv-muted-fg">How this adds up</span>
            <ListStatusText tone={STATE_TONE[f.status.tone]}>{f.status.label}</ListStatusText>
          </div>
          <div className="space-y-2 text-sm tabular-nums">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="font-medium">Total</div>
                <div className="text-xs text-pv-muted-fg">
                  {f.chargeCount === 0
                    ? "The invoice's own total"
                    : `Sum of ${f.chargeCount} ${f.chargeCount === 1 ? 'charge' : 'charges'}`}
                </div>
              </div>
              <span>{money(f.total)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="font-medium">Paid</div>
                <div className="text-xs text-pv-muted-fg">
                  {f.paymentCount === 0
                    ? 'No payments yet'
                    : `From ${f.paymentCount} ${f.paymentCount === 1 ? 'payment' : 'payments'}`}
                </div>
              </div>
              <span>− {money(f.paid)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-pv-border pt-2">
              <div>
                <div className="font-semibold">Remaining</div>
                <div className="text-xs text-pv-muted-fg">
                  {f.cancelled ? 'Cancelled: nothing is collected' : settled ? 'Nothing left to pay' : 'Still to pay'}
                </div>
              </div>
              <span className={cn('font-semibold', tone, f.cancelled && 'line-through')}>{money(f.owes)}</span>
            </div>
          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

/**
 * Invoices: the operator's Finances table (invoice-payments-table.tsx),
 * column for column — Invoice #, Entity, Entity ref, Company (the operator's
 * Customer: the customer is the viewer), Due date (red when overdue, grey when
 * cancelled), Total − Paid = Remaining, and the row's action (Pay). No status
 * column: the payment status is the remaining figure's colour, the time
 * status the due date's. A row opens the invoice sheet.
 */
function InvoiceTable({
  invoices,
  figures,
  company,
  resetKey,
  onOpen,
}: {
  invoices: readonly CustomerInvoice[];
  figures: ReadonlyMap<string, InvoiceRowFigures>;
  company: string;
  resetKey: string;
  onOpen: (invoice: CustomerInvoice) => void;
}) {
  const { formatCurrency } = useTenantBranding();
  const money = (n: number) => formatCurrency(Math.round(n * 100) / 100);
  const rows = useProgressiveRows(invoices, `invoices|${resetKey}`);

  /** A row's figures; the invoice's own while the charges are not read (never shown: the page waits). */
  const figuresOf = (invoice: CustomerInvoice): InvoiceRowFigures =>
    figures.get(invoice.id) ?? {
      entity: 'Rental',
      total: invoice.total,
      paid: invoice.paid,
      settled: invoice.paid,
      owes: invoice.outstanding,
      cancelled: invoice.statusRaw === 'cancelled',
      status: { label: 'Unpaid', tone: 'muted' },
      due: null,
      dueDate: invoice.dueDate,
      chargeCount: 0,
      paymentCount: 0,
    };

  // Slot widths for the sum column, from every invoice in the list (not only
  // the rows on screen), so the columns do not shift as more rows load.
  const sumWidths = useMemo<SumWidths>(() => {
    const w = { total: 0, paid: 0, remaining: 0 };
    for (const invoice of invoices) {
      const f = figuresOf(invoice);
      w.total = Math.max(w.total, money(f.total).length);
      w.paid = Math.max(w.paid, money(f.settled).length);
      w.remaining = Math.max(w.remaining, money(f.owes).length);
    }
    return w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, figures, formatCurrency]);

  return (
    <div className="flex flex-col gap-3">
      {/* Phone: one line per invoice — number and due date, what is left to
          pay, and Pay. The table, with its sum column, from md up. */}
      <PhoneList>
        {rows.visible.map((invoice) => {
          const f = figuresOf(invoice);
          const overdue = f.due?.tone === 'danger';
          return (
            <PhoneRow
              key={invoice.id}
              muted={f.cancelled}
              onOpen={() => onOpen(invoice)}
              title={invoice.number}
              detail={
                <>
                  {invoice.rental?.reference ?? f.entity}
                  {f.dueDate ? (
                    <>
                      {' · '}
                      <span className={cn(!f.cancelled && overdue && V2_LIST_TONES.danger)}>
                        Due {format(parseDateOnly(f.dueDate.slice(0, 10)), 'MMM d')}
                      </span>
                    </>
                  ) : null}
                </>
              }
              value={money(f.owes)}
              valueClassName={!f.cancelled && f.owes > EPS ? (overdue ? V2_LIST_TONES.danger : undefined) : V2_LIST_TONES.success}
              valueDetail={f.cancelled ? 'Cancelled' : `of ${money(f.total)}`}
              trailing={!f.cancelled && f.owes > EPS ? <PayButton rentalId={invoice.rentalId} compact className="h-8 px-3 text-xs" /> : null}
            />
          );
        })}
      </PhoneList>
      <div className="max-md:hidden">
      <ListTable rows={rows} minWidth="min-w-[960px]">
        <ListTableHeader>
          <ListHead className="w-[20%]">Invoice #</ListHead>
          {/* What the invoice is FOR, and WHICH one: the rental (R-1041). */}
          <ListHead className="w-[8%]">Entity</ListHead>
          <ListHead className="w-[9%]">Entity ref</ListHead>
          <ListHead className="w-[13%]">Company</ListHead>
          <ListHead className="w-[11%]">Due date</ListHead>
          {/* The sum sits at the very right: the last thing the eye reaches. */}
          <ListHead className="w-[29%] text-right">
            {/* The same slots as the cells, restated for this 11px heading. */}
            <span className="inline-flex items-baseline whitespace-nowrap">
              <span className="inline-block text-right" style={{ minWidth: `${(sumWidths.total * 13) / 11}ch` }}>
                Total
              </span>
              <Op>−</Op>
              <span className="inline-block text-right" style={{ minWidth: `${(sumWidths.paid * 13) / 11}ch` }}>
                Paid
              </span>
              <Op>=</Op>
              <span className="inline-block text-right" style={{ minWidth: `${(sumWidths.remaining * 15) / 11}ch` }}>
                Remaining
              </span>
            </span>
          </ListHead>
          <ListHead className="w-[10%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {rows.visible.map((invoice) => {
            const f = figuresOf(invoice);
            const overdue = f.due?.tone === 'danger';
            const ref = f.entity === 'Rental' ? invoice.rental?.reference ?? null : null;
            return (
              <ListRow
                key={invoice.id}
                onOpen={() => onOpen(invoice)}
                tabIndex={0}
                aria-label={f.cancelled ? `Invoice ${invoice.number}, cancelled` : `Open invoice ${invoice.number}`}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onOpen(invoice);
                  }
                }}
                className="group/row group/copy focus-visible:bg-v2-muted/60 focus-visible:outline-none"
              >
                <ListCell>
                  {/* The number, and a copy button that appears on row hover. */}
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={cn('truncate', V2_LIST_CLASSES.identifier)} title={invoice.number}>
                      {invoice.number}
                    </span>
                    <CopyOnHover value={invoice.number} label="Copy invoice number" />
                  </span>
                </ListCell>
                <ListCell>
                  <ListMetaChip>{f.entity}</ListMetaChip>
                </ListCell>
                <ListCell>
                  {ref ? (
                    <span className={cn('block truncate tabular-nums', V2_LIST_CLASSES.text)} title={ref}>
                      {ref}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {company ? (
                    <span className={cn('block truncate', V2_LIST_CLASSES.text)} title={company}>
                      {company}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  {f.dueDate ? (
                    <span
                      className={cn(
                        'font-medium',
                        f.cancelled ? 'text-pv-muted-fg' : overdue ? V2_LIST_TONES.danger : 'text-pv-fg',
                      )}
                      title={f.due?.label}
                    >
                      {format(parseDateOnly(f.dueDate.slice(0, 10)), 'PP')}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="text-right">
                  <AmountSum figures={f} money={money} widths={sumWidths} />
                </ListCell>
                <ListCell className={cn(ROW_OPEN_CELL, 'text-right')}>
                  {/* Pay — on every invoice that still owes money (not cancelled).
                      It renders nothing when nothing on the booking is payable here. */}
                  {!f.cancelled && f.owes > EPS ? (
                    <PayButton rentalId={invoice.rentalId} compact className="-my-1 h-7 px-3 text-xs" />
                  ) : null}
                  <RowOpenIndicator />
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      </div>
      <ListFooter shown={rows.visible.length} total={rows.total} hasMore={rows.hasMore} onMore={rows.showMore} noun="invoice" />
    </div>
  );
}

function PaymentTable({ payments }: { payments: readonly CustomerPayment[] }) {
  const { formatCurrency } = useTenantBranding();
  const rows = useProgressiveRows(payments, 'payments');
  return (
    <div className="flex flex-col gap-3">
      <PhoneList>
        {rows.visible.map((payment) => {
          const chip = PAYMENT_CHIP[payment.state];
          return (
            <PhoneRow
              key={payment.id}
              title={payment.typeLabel}
              detail={[formatDate(payment.date), payment.rental?.reference].filter(Boolean).join(' · ')}
              value={formatCurrency(payment.amount)}
              valueDetail={<span className={V2_LIST_TONES[TONE[chip.tone]]}>{chip.label}</span>}
            />
          );
        })}
      </PhoneList>
      <div className="max-md:hidden">
      <ListTable rows={rows} minWidth="min-w-[760px]">
        <ListTableHeader>
          <ListHead className="w-[26%]">Payment</ListHead>
          <ListHead className="w-[16%]">Date</ListHead>
          <ListHead className="w-[16%]">Rental</ListHead>
          <ListHead className="w-[16%]">Amount</ListHead>
          <ListHead className="w-[26%]">Status</ListHead>
        </ListTableHeader>
        <ListBody>
          {rows.visible.map((payment) => {
            const chip = PAYMENT_CHIP[payment.state];
            return (
              <ListRow key={payment.id}>
                <ListCell>
                  <span className={cn('block truncate', V2_LIST_CLASSES.identifier)}>{payment.typeLabel}</span>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={V2_LIST_CLASSES.text}>{formatDate(payment.date)}</span>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={V2_LIST_CLASSES.text}>{payment.rental?.reference ?? '—'}</span>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={V2_LIST_CLASSES.text}>{formatCurrency(payment.amount)}</span>
                </ListCell>
                <ListCell>
                  <ListStatusText tone={TONE[chip.tone]}>{chip.label}</ListStatusText>
                  {/* A hold reserves money without taking it; a refund is part of the row. */}
                  {payment.state === 'hold' ? (
                    <span className="ml-2 text-[13px] text-pv-muted-fg">
                      not charged{payment.holdExpiresAt ? `, releases ${formatDate(payment.holdExpiresAt.slice(0, 10))}` : ''}
                    </span>
                  ) : payment.refunded > 0 && payment.state !== 'refunded' ? (
                    <span className="ml-2 text-[13px] text-pv-muted-fg">{formatCurrency(payment.refunded)} refunded</span>
                  ) : null}
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      </div>
      <ListFooter shown={rows.visible.length} total={rows.total} hasMore={rows.hasMore} onMore={rows.showMore} noun="payment" />
    </div>
  );
}

function ListFooter({
  shown,
  total,
  hasMore,
  onMore,
  noun,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  onMore: () => void;
  noun: string;
}) {
  return (
    <div className={V2_LIST_CLASSES.footer}>
      <span>{hasMore ? `Showing ${shown} of ${total} ${noun}s` : `All ${total} ${total === 1 ? noun : `${noun}s`} shown`}</span>
      {hasMore ? (
        <button type="button" onClick={onMore} className={cn(V2_BUTTON_OUTLINE_SM, V2_LIST_CLASSES.showMore)}>
          Show more
        </button>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── CSV export ─────────────────────────────── */

function download(name: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}

/** The table's columns, then the invoice date and the payment status the table carries as colour. */
function exportInvoices(
  invoices: readonly CustomerInvoice[],
  figures: ReadonlyMap<string, InvoiceRowFigures>,
  company: string,
) {
  download('invoices.csv', [
    ['Invoice #', 'Entity', 'Entity ref', 'Company', 'Invoice date', 'Due date', 'Total', 'Paid', 'Remaining', 'Status'],
    ...invoices.map((i) => {
      const f = figures.get(i.id);
      const entity = f?.entity ?? 'Rental';
      return [
        i.number,
        entity,
        entity === 'Rental' ? i.rental?.reference ?? '' : '',
        company,
        i.invoiceDate,
        f?.dueDate ?? i.dueDate ?? '',
        (f?.total ?? i.total).toFixed(2),
        (f?.settled ?? i.paid).toFixed(2),
        (f?.owes ?? i.outstanding).toFixed(2),
        f?.status.label ?? '',
      ];
    }),
  ]);
}

function exportPayments(payments: readonly CustomerPayment[]) {
  download('payments.csv', [
    ['Payment', 'Date', 'Rental', 'Amount', 'Refunded', 'Status'],
    ...payments.map((p) => [p.typeLabel, p.date, p.rental?.reference ?? '', p.amount.toFixed(2), p.refunded.toFixed(2), PAYMENT_CHIP[p.state].label]),
  ]);
}
