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
 * Pay sits on each invoice row with an amount due, in the invoice dialog, in
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
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import { PvDialogContent } from '@nw/portal-v2/dialog';
import { HeroChartLoading, localDay } from '@nw/portal-v2/hero';
import { PayButton } from '@nw/portal-v2/pay/pay-provider';
import { LoadError, PageHeader } from '@nw/portal-v2/primitives';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { V2_BUTTON_OUTLINE_SM, V2_BUTTON_PRIMARY } from '@portal-v2-shared/button-styles';
import { RentalsOverviewFlip } from '@portal-v2-shared/overview-flip';
import { usePageSearch } from '@portal-v2-shared/page-search-slot';
import { HeroChart, HeroRow, type HeroMetric } from '@portal-v2-shared/hero-chart';
import {
  ListBody,
  ListCell,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from '@portal-v2-shared/list-table';
import { V2_LIST_CLASSES, type V2ListTone } from '@portal-v2-shared/list-styles';
import { ROW_OPEN_CELL, RowOpenIndicator } from '@portal-v2-shared/row-open';

import { CardsFeatured } from './_components/cards';
import {
  FinanceFilterPanel,
  NO_FINANCE_FILTERS,
  countActiveFinanceFilters,
  type FinanceFilters,
} from './_components/finance-filter-panel';
import { InvoiceDialog } from './_components/invoice-dialog';
import { INVOICE_CHIP, PAYMENT_CHIP } from './_components/invoice-state';

/** The chips' tones in the shared list's palette. */
const TONE: Record<string, V2ListTone> = { success: 'success', info: 'info', warning: 'warning', danger: 'danger', neutral: 'muted' };

export default function PortalPaymentsPage() {
  const { balance, payableBalances, invoices, payments, isLoading, isError, error, refetch } = useCustomerPayments();

  const [filters, setFilters] = useState<FinanceFilters>(NO_FINANCE_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [openInvoice, setOpenInvoice] = useState<CustomerInvoice | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const tab = filters.list;

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Finances"
        description="What you owe, what you have paid, and every invoice for your bookings."
        action={
          <button
            type="button"
            onClick={() => (tab === 'invoices' ? exportInvoices(shownInvoices) : exportPayments(shownPayments))}
            disabled={isLoading || (tab === 'invoices' ? shownInvoices.length === 0 : shownPayments.length === 0)}
            className={V2_BUTTON_PRIMARY}
          >
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

      {isLoading ? (
        <>
          <HeroRow
            chart={<HeroChartLoading label="Still to pay" range="Last 3 months" />}
            card={<Skeleton className="min-h-[15rem] rounded-2xl bg-pv-tint" />}
          />
          <Skeleton className="h-64 w-full rounded-2xl bg-pv-tint" />
        </>
      ) : (
        <>
          {/* Phone: the status first, as one row — the card form would take
              half the screen to say "All settled". */}
          <BalanceStatusRow balance={balance} onOpen={() => setDetailOpen(true)} />
          <RentalsOverviewFlip
            flipped={filtersOpen}
            onFlipBack={() => setFiltersOpen(false)}
            front={
              <HeroRow
                chart={<FinancesChart balance={balance} invoices={invoices} payments={payments} />}
                card={<CardsFeatured />}
              />
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

          <section id="invoices" aria-labelledby="money-list-title" className="flex scroll-mt-24 flex-col gap-3">
            <div>
              <h2 id="money-list-title" className="text-[17px] font-semibold tracking-[-0.01em] text-pv-fg">
                {tab === 'invoices' ? 'Invoices' : 'Payments'}
              </h2>
              <p className="text-sm text-pv-muted-fg">
                {tab === 'invoices'
                  ? 'Every invoice raised for your bookings. Open one for the full breakdown.'
                  : 'Every card payment, hold and refund on your account.'}
              </p>
            </div>

            {tab === 'invoices' ? (
              invoices.length === 0 ? (
                <EmptyLine>No invoices yet. One is raised when a booking is confirmed.</EmptyLine>
              ) : shownInvoices.length === 0 ? (
                <EmptyLine>No invoices match your search or filters.</EmptyLine>
              ) : (
                <InvoiceTable invoices={shownInvoices} onOpen={setOpenInvoice} />
              )
            ) : payments.length === 0 ? (
              <EmptyLine>No payments yet. Every card payment and refund will be listed here.</EmptyLine>
            ) : shownPayments.length === 0 ? (
              <EmptyLine>No payments match your search or filters.</EmptyLine>
            ) : (
              <PaymentTable payments={shownPayments} />
            )}
          </section>
        </>
      )}

      <InvoiceDialog
        invoice={openInvoice}
        onOpenChange={(open) => {
          if (!open) setOpenInvoice(null);
        }}
        footer={openInvoice && openInvoice.outstanding > 0 ? <PayButton rentalId={openInvoice.rentalId} /> : null}
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
      <PvDialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-lg sm:p-0">
        <div className="px-7 pb-4 pt-7">
          <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-pv-fg">
            {balance.outstanding === 0 ? 'All settled' : `${formatCurrency(balance.outstanding)} due`}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-sm text-pv-muted-fg">
            {balance.outstanding === 0
              ? `You have paid ${formatCurrency(balance.paidToDate)} in total. Nothing is outstanding.`
              : balance.overdue > 0
                ? `${formatCurrency(balance.overdue)} of it is overdue.`
                : balance.nextDueDate
                  ? `Due ${formatDate(balance.nextDueDate)}.`
                  : 'What it is made of, and what you can pay now.'}
          </DialogPrimitive.Description>
        </div>

        <div className="min-h-0 overflow-y-auto border-t border-pv-border">
          {payable.length > 0 ? (
            <ul className="divide-y divide-pv-border">
              {payable.map((row) => (
                <li key={row.rentalId} className="flex items-center gap-3 px-7 py-3.5">
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
            <dl className="border-t border-pv-border px-7 py-3">
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
            <p className="border-t border-pv-border px-7 py-3 text-[13px] text-pv-muted-fg">
              {formatCurrency(balance.unpayable)} is not linked to a booking, so it cannot be paid here.{' '}
              <Link href="/contact" className="font-medium text-pv-link hover:underline">
                Contact us
              </Link>{' '}
              and we will take it directly.
            </p>
          ) : null}
          {balance.cancelledCharges > 0 ? (
            <p className="border-t border-pv-border px-7 py-3 text-[12px] text-pv-muted-fg">
              {formatCurrency(balance.cancelledCharges)} of charges on cancelled bookings is not included.
            </p>
          ) : null}
        </div>
      </PvDialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────── the lists ──────────────────────────────── */

/** A reference with a copy button at its end: references get copied a lot. */
function CopyableReference({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <span className={cn('truncate', V2_LIST_CLASSES.identifier)}>{value}</span>
      <button
        type="button"
        aria-label={copied ? 'Copied' : `Copy ${value}`}
        title={copied ? 'Copied' : 'Copy'}
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          });
        }}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-pv-muted-fg transition-colors duration-200 hover:bg-pv-hover hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 motion-reduce:transition-none"
      >
        {copied ? (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
            <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
          </svg>
        )}
      </button>
    </span>
  );
}

/**
 * Invoices in the table every other tab uses (shared list-table): reference
 * (with copy), what it is for, the company, due date, total, status, and Pay
 * where something is due. Customer → Company: the customer is the viewer.
 */
function InvoiceTable({ invoices, onOpen }: { invoices: readonly CustomerInvoice[]; onOpen: (invoice: CustomerInvoice) => void }) {
  const { formatCurrency } = useTenantBranding();
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? '—';
  const rows = useProgressiveRows(invoices, 'invoices');

  return (
    <div className="flex flex-col gap-3">
      <ListTable rows={rows} minWidth="min-w-[880px]">
        <ListTableHeader>
          <ListHead className="w-[24%]">Reference</ListHead>
          <ListHead className="w-[11%]">Rental</ListHead>
          <ListHead className="w-[16%]">Company</ListHead>
          <ListHead className="w-[12%]">Due date</ListHead>
          <ListHead className="w-[11%]">Total</ListHead>
          <ListHead className="w-[11%]">Status</ListHead>
          <ListHead className="w-[15%]">
            <span className="sr-only">Pay</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {rows.visible.map((invoice) => {
            const chip = INVOICE_CHIP[invoice.state];
            return (
              <ListRow
                key={invoice.id}
                onOpen={() => onOpen(invoice)}
                tabIndex={0}
                aria-label={`Open invoice ${invoice.number}`}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onOpen(invoice);
                  }
                }}
                className="group/row focus-visible:bg-v2-muted/60 focus-visible:outline-none"
              >
                <ListCell>
                  <CopyableReference value={invoice.number} />
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={V2_LIST_CLASSES.text}>{invoice.rental?.reference ?? '—'}</span>
                </ListCell>
                <ListCell>
                  <span className={cn('block truncate', V2_LIST_CLASSES.text)} title={company}>
                    {company}
                  </span>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={V2_LIST_CLASSES.text}>{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</span>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={V2_LIST_CLASSES.text}>{formatCurrency(invoice.total)}</span>
                </ListCell>
                <ListCell>
                  <ListStatusText tone={TONE[chip.tone]}>{chip.label}</ListStatusText>
                </ListCell>
                <ListCell className={ROW_OPEN_CELL}>
                  {invoice.outstanding > 0 ? <PayButton rentalId={invoice.rentalId} compact /> : null}
                  <RowOpenIndicator />
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter shown={rows.visible.length} total={rows.total} hasMore={rows.hasMore} onMore={rows.showMore} noun="invoice" />
    </div>
  );
}

function PaymentTable({ payments }: { payments: readonly CustomerPayment[] }) {
  const { formatCurrency } = useTenantBranding();
  const rows = useProgressiveRows(payments, 'payments');
  return (
    <div className="flex flex-col gap-3">
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

function exportInvoices(invoices: readonly CustomerInvoice[]) {
  download('invoices.csv', [
    ['Reference', 'Rental', 'Invoice date', 'Due date', 'Total', 'Paid', 'Due', 'Status'],
    ...invoices.map((i) => [
      i.number,
      i.rental?.reference ?? '',
      i.invoiceDate,
      i.dueDate ?? '',
      i.total.toFixed(2),
      i.paid.toFixed(2),
      i.outstanding.toFixed(2),
      INVOICE_CHIP[i.state].label,
    ]),
  ]);
}

function exportPayments(payments: readonly CustomerPayment[]) {
  download('payments.csv', [
    ['Payment', 'Date', 'Rental', 'Amount', 'Refunded', 'Status'],
    ...payments.map((p) => [p.typeLabel, p.date, p.rental?.reference ?? '', p.amount.toFixed(2), p.refunded.toFixed(2), PAYMENT_CHIP[p.state].label]),
  ]);
}
