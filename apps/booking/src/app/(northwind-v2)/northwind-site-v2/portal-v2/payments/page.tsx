'use client';

/**
 * Finances — what the customer owes, what they have paid, and every invoice.
 *
 * ── THE LAYOUT (owner, Oct 22 2026) ─────────────────────────────────────────
 * The overdue figure used to appear six times. Now, top to bottom: one status
 * line (the amount, whether it is late, the one action); two figures,
 * Outstanding and Paid to date; Pay rows only for bookings that can be paid
 * here; the balance as a tight table; one card per instalment plan with its
 * overdue instalment named inside it; then Invoices / Payments.
 *
 * ── ONE BALANCE, ONE SOURCE ─────────────────────────────────────────────────
 * The headline figure comes from `ledger_entries` and nothing else. The invoice
 * list beneath it carries per-invoice states but deliberately no second
 * aggregate: two totals on one screen that are computed differently WILL
 * disagree eventually, and the customer has no way to tell which one to believe.
 * See the header of `use-customer-payments.ts` for which table answers what.
 *
 * ── WHAT CAN BE PAID FROM HERE, AND WHAT CANNOT ─────────────────────────────
 * An outstanding balance can now be settled by card, one booking at a time —
 * see `_components/pay-balances.tsx` for why a booking is the unit and
 * `settlement-watch.tsx` for how the result is confirmed. This became possible
 * when staging got its OWN Stripe webhook endpoint; before that, staging's
 * webhooks fired into the production project and no payment button could be
 * exercised end to end, which is why this page shipped read-only.
 *
 * Still deliberately absent, because each needs server work that does not
 * exist yet rather than a button:
 *
 *   Update card    — needs a SetupIntent endpoint. There is none: every
 *                    function here mints PAYMENT intents against a rental.
 *                    Stripe's Billing Portal is not a substitute either — the
 *                    tenant-facing portal session is for PLATFORM subscription
 *                    billing on a different Stripe account entirely.
 *   Pay an instalment early / activate a plan — the collections are driven
 *                    server-side off `scheduled_installments`, and paying the
 *                    underlying charge in one go would leave the schedule
 *                    collecting against a zero balance. That is an operator
 *                    action, not a customer one.
 *   Statement download — no endpoint renders one.
 *
 * Each of those states its reason on screen rather than showing a control that
 * does nothing.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Banknote, FileText, Receipt } from 'lucide-react-nw';

import { formatDate } from '@nw/components/portal/format';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { Skeleton } from '@nw/components/ui/skeleton';
import {
  useCustomerPayments,
  type CustomerBalance,
  type CustomerInstallmentPlan,
  type CustomerInvoice,
  type CustomerPayment,
  type PayableBalance,
} from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import { FeaturedLinkCard, HeroChartLoading, ToneAlert, localDay } from '@nw/portal-v2/hero';
import { useCustomerTrax } from '@nw/portal-v2/trax/trax-context';
import { V2_BUTTON_DEFAULT_SM, V2_BUTTON_OUTLINE_SM } from '@portal-v2-shared/button-styles';
import { Card, CardContent, CardHeader, CardTitle } from '@portal-v2-shared/card';
import { HeroChart, HeroRow, type HeroMetric } from '@portal-v2-shared/hero-chart';

import { InstalmentPlans } from './_components/instalment-plans';
import { InvoiceDialog } from './_components/invoice-dialog';
import { INVOICE_CHIP, PAYMENT_CHIP } from './_components/invoice-state';
import {
  ListBody,
  ListCard,
  ListCell,
  ListHead,
  ListHeaderRow,
  ListRow,
  RowButton,
  SectionTitle,
  SegmentedTabs,
  StatusText,
} from './_components/list-table';
import { PayBalances } from './_components/pay-balances';

type Tab = 'invoices' | 'payments';

export default function PortalPaymentsPage() {
  const { balance, payableBalances, invoices, payments, activePlans, isLoading, isError, error, refetch } =
    useCustomerPayments();

  const [tab, setTab] = useState<Tab>('invoices');
  const [openInvoice, setOpenInvoice] = useState<CustomerInvoice | null>(null);

  // A booking on an instalment plan is collected by the plan, so it gets no Pay
  // button: its plan card says so once, rather than a pay row that shows an
  // amount and then says there is nothing to pay (owner, Oct 22 2026).
  const payableNow = useMemo(() => payableBalances.filter((row) => row.blockedReason === null), [payableBalances]);

  const hasAnything = invoices.length > 0 || payments.length > 0 || activePlans.length > 0 || balance.outstanding > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Finances" description="What you owe, what you have paid, and every invoice for your bookings." />

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
          <HeroRow chart={<HeroChartLoading label="Outstanding" range="Last 3 months" />} />
          <PaymentsSkeleton />
        </>
      ) : !hasAnything ? (
        <Panel>
          <EmptyState
            icon={Receipt}
            title="Nothing to pay"
            description="When you book a car, the invoice and every payment taken against it will appear here."
            action={{ href: '/booking', label: 'Browse the fleet' }}
          />
        </Panel>
      ) : (
        <>
          <BalanceAlert balance={balance} payableNow={payableNow} plans={activePlans} />

          {/* The operator's hero row (Finances, Customers, Rentals): the chart
              over three columns, the featured card on the fourth. */}
          <HeroRow
            chart={<FinancesChart balance={balance} invoices={invoices} payments={payments} />}
            card={<AskTraxCard />}
          />

          <PayBalances payable={payableNow} unpayable={balance.unpayable} refetch={refetch} />

          {/* Side by side, so neither is a lone card on an empty row. */}
          <div
            className={cn(
              'grid gap-5 lg:items-start',
              balance.categories.length > 0 && activePlans.length > 0 && 'lg:grid-cols-2',
            )}
          >
            <BalanceBreakdown balance={balance} />
            <InstalmentPlans plans={activePlans} />
          </div>

          {/* Operator list pattern: section title, the filter bar, the table. */}
          <section id="invoices" className="flex scroll-mt-24 flex-col gap-3">
            <SectionTitle
              title={tab === 'invoices' ? 'Invoices' : 'Payments'}
              description={
                tab === 'invoices'
                  ? 'Every invoice raised for your bookings. Open one for the full breakdown.'
                  : 'Every card payment, hold and refund on your account.'
              }
              action={
                <SegmentedTabs
                  label="Choose a list"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'invoices', label: 'Invoices', count: invoices.length },
                    { value: 'payments', label: 'Payments', count: payments.length },
                  ]}
                />
              }
            />

            {tab === 'invoices' ? (
              invoices.length === 0 ? (
                <Panel>
                  <EmptyState
                    icon={FileText}
                    title="No invoices yet"
                    description="An invoice is raised when a booking is confirmed. Yours will show up here with a full breakdown."
                  />
                </Panel>
              ) : (
                <InvoiceTable invoices={invoices} onOpen={setOpenInvoice} />
              )
            ) : payments.length === 0 ? (
              <Panel>
                <EmptyState
                  icon={Banknote}
                  title="No payments yet"
                  description="Every card payment and refund on your account will be listed here once one has been taken."
                />
              </Panel>
            ) : (
              <PaymentTable payments={payments} />
            )}
          </section>
        </>
      )}

      <InvoiceDialog
        invoice={openInvoice}
        onOpenChange={(open) => {
          if (!open) setOpenInvoice(null);
        }}
      />
    </div>
  );
}

/* ────────────────────────────── the pieces ─────────────────────────────── */

/**
 * The operator's hero chart, on the customer's own money (owner, Oct 22 2026:
 * "a chart of what the customer has paid over time, with the outstanding
 * amount as the headline figure").
 *
 *   Outstanding — the headline, a level: today's point IS the ledger balance
 *     the rest of the page quotes, and each earlier day is worked back from it
 *     by the invoices raised and the payments taken since. Its second line is
 *     what has been paid to date, so the two read against each other.
 *   Paid — the other metric in the label's menu: money paid per day, week or
 *     month, with what was invoiced as the second line, as the operator's
 *     Finances tab draws Invoiced against Collected.
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
    const paid = payments
      .filter((payment) => payment.net !== 0)
      .map((payment) => ({ at: localDay(payment.date), amount: payment.net }));
    const invoiced = invoices
      .filter((invoice) => invoice.state !== 'cancelled')
      .map((invoice) => ({ at: localDay(invoice.invoiceDate), amount: invoice.total }));

    const after = (events: readonly { at: Date; amount: number }[], day: Date) => {
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      return events.reduce((sum, event) => (event.at.getTime() >= end ? sum + event.amount : sum), 0);
    };
    const upTo = (events: readonly { at: Date; amount: number }[], day: Date) => {
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      return events.reduce((sum, event) => (event.at.getTime() < end ? sum + event.amount : sum), 0);
    };
    const round = (value: number) => Math.round(value * 100) / 100;

    const days = [...paid, ...invoiced].map((event) => event.at.getTime());
    const historyStart = days.length > 0 ? new Date(Math.min(...days)) : undefined;

    return [
      {
        key: 'outstanding',
        kind: 'stock',
        label: 'Outstanding',
        description: 'What you owe today, and what you owed on each day before it.',
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

/** The featured card: Trax, which knows this account, for a question about a charge. */
function AskTraxCard() {
  const { setOpen } = useCustomerTrax();
  return <FeaturedLinkCard title="Ask Trax" subtitle="Questions about a charge or a payment" onClick={() => setOpen(true)} />;
}

/**
 * The one alert at the top: what is owed, whether any of it is late, and the
 * single thing to do — Pay when a booking can be paid here, the plan when an
 * instalment plan collects it, otherwise a person.
 */
function BalanceAlert({
  balance,
  payableNow,
  plans,
}: {
  balance: CustomerBalance;
  payableNow: readonly PayableBalance[];
  plans: readonly CustomerInstallmentPlan[];
}) {
  const { formatCurrency } = useTenantBranding();

  if (balance.outstanding === 0) {
    return <ToneAlert tone="success" title="You are all settled" description="Nothing is outstanding on your account." />;
  }

  // The amount is the chart's headline right below, so the alert names the
  // state rather than quoting the figure again.
  const overdue = balance.overdue > 0;
  const title = overdue
    ? balance.overdue === balance.outstanding
      ? 'Your balance is overdue'
      : `${formatCurrency(balance.overdue)} of your balance is overdue`
    : `Your balance is due${balance.nextDueDate ? ` by ${formatDate(balance.nextDueDate)}` : ''}`;

  const description =
    payableNow.length > 0
      ? 'You can pay it by card below.'
      : plans.length > 0
        ? 'Your instalment plan collects it from your card on each due date.'
        : 'This cannot be paid by card here. Get in touch and we will take it directly.';

  const action =
    payableNow.length > 0 ? (
      <a href="#pay" className={V2_BUTTON_DEFAULT_SM}>
        Pay now
      </a>
    ) : plans.length > 0 ? (
      <a href="#plans" className={V2_BUTTON_OUTLINE_SM}>
        View plan
      </a>
    ) : (
      <Link href="/contact" className={V2_BUTTON_OUTLINE_SM}>
        Contact us
      </Link>
    );

  return <ToneAlert tone={overdue ? 'danger' : 'warning'} title={title} description={description} action={action} />;
}

/**
 * What the outstanding figure is made of, in the operator's card: the rental
 * first, then the fees, tax last, then the total, at the table's row height.
 */
function BalanceBreakdown({ balance }: { balance: CustomerBalance }) {
  const { formatCurrency } = useTenantBranding();
  if (balance.categories.length === 0) return null;

  const rank = (label: string) =>
    /^rental$/i.test(label) ? 0 : /discount/i.test(label) ? 1 : /^tax/i.test(label) ? 3 : 2;
  const rows = [...balance.categories].sort((a, b) => rank(a.label) - rank(b.label) || b.amount - a.amount);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-pv-border py-4">
        <CardTitle>Balance breakdown</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <dl>
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 border-b border-pv-border px-6 py-3">
              <dt className="text-sm text-pv-fg">{row.label}</dt>
              <dd className="text-sm tabular-nums text-pv-fg">{formatCurrency(row.amount)}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 bg-pv-row px-6 py-3.5">
            <dt className="text-sm font-semibold text-pv-fg">Total outstanding</dt>
            <dd
              className={cn('text-base font-semibold tabular-nums', balance.overdue > 0 ? 'text-pv-danger' : 'text-pv-fg')}
            >
              {formatCurrency(balance.outstanding)}
            </dd>
          </div>
        </dl>
        {balance.cancelledCharges > 0 ? (
          <p className="border-t border-pv-border px-6 py-3 text-[12px] text-pv-muted-fg">
            {formatCurrency(balance.cancelledCharges)} of charges on cancelled bookings is not included.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────── the lists ──────────────────────────────── */

function InvoiceTable({
  invoices,
  onOpen,
}: {
  invoices: readonly CustomerInvoice[];
  onOpen: (invoice: CustomerInvoice) => void;
}) {
  return (
    <ListCard>
      <ListHeaderRow>
        <ListHead>Invoice</ListHead>
        <ListHead className="hidden md:table-cell">Booking</ListHead>
        <ListHead className="hidden md:table-cell">Issued</ListHead>
        <ListHead className="hidden sm:table-cell">Status</ListHead>
        <ListHead className="text-right">Amount</ListHead>
      </ListHeaderRow>
      <ListBody>
        {invoices.map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice} onOpen={() => onOpen(invoice)} />
        ))}
      </ListBody>
    </ListCard>
  );
}

function InvoiceRow({
  invoice,
  onOpen,
}: {
  invoice: CustomerInvoice;
  onOpen: () => void;
}) {
  const { formatCurrency } = useTenantBranding();
  const chip = INVOICE_CHIP[invoice.state];

  // The phone's second line: what it is for and when it was raised. The booking
  // reference is included because it is the string a customer quotes on the
  // phone — the invoice number means nothing to them until support asks.
  const meta = useMemo(() => {
    const parts = [
      invoice.rental?.vehicle?.displayName,
      invoice.rental?.reference,
      formatDate(invoice.invoiceDate),
    ].filter((part): part is string => typeof part === 'string' && part !== '');
    return parts.join(' · ');
  }, [invoice]);

  return (
    <ListRow onOpen={onOpen}>
      <ListCell className="max-w-0 w-[68%] sm:w-[40%] md:w-[24%]">
        <RowButton onOpen={onOpen} label={`Open invoice ${invoice.number}`}>
          <span className="block truncate font-semibold tabular-nums tracking-tight text-pv-fg">
            {invoice.number}
          </span>
        </RowButton>
        <span className="mt-0.5 block truncate text-[13px] text-pv-muted-fg md:hidden">{meta}</span>
      </ListCell>
      <ListCell className="hidden max-w-0 md:table-cell">
        <span className="block truncate font-medium text-pv-fg">
          {invoice.rental?.vehicle?.displayName ?? '—'}
        </span>
        {invoice.rental?.reference ? (
          <span className="block truncate text-[13px] text-pv-muted-fg">{invoice.rental.reference}</span>
        ) : null}
      </ListCell>
      <ListCell className="hidden whitespace-nowrap tabular-nums text-pv-fg md:table-cell">
        {formatDate(invoice.invoiceDate)}
      </ListCell>
      <ListCell className="hidden sm:table-cell">
        <StatusText tone={chip.tone}>{chip.label}</StatusText>
      </ListCell>
      <ListCell className="text-right">
        <span className="block whitespace-nowrap font-semibold tabular-nums text-pv-fg">
          {formatCurrency(invoice.total)}
        </span>
        <StatusText tone={chip.tone} className="sm:hidden">
          {chip.label}
        </StatusText>
      </ListCell>
    </ListRow>
  );
}

function PaymentTable({ payments }: { payments: readonly CustomerPayment[] }) {
  return (
    <ListCard>
      <ListHeaderRow>
        <ListHead>Payment</ListHead>
        <ListHead className="hidden md:table-cell">Date</ListHead>
        <ListHead className="hidden md:table-cell">Booking</ListHead>
        <ListHead className="hidden sm:table-cell">Status</ListHead>
        <ListHead className="text-right">Amount</ListHead>
      </ListHeaderRow>
      <ListBody>
        {payments.map((payment) => (
          <PaymentRow key={payment.id} payment={payment} />
        ))}
      </ListBody>
    </ListCard>
  );
}

function PaymentRow({ payment }: { payment: CustomerPayment }) {
  const { formatCurrency } = useTenantBranding();
  const chip = PAYMENT_CHIP[payment.state];

  const meta = [formatDate(payment.date), payment.method, payment.rental?.reference]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');

  return (
    <ListRow>
      <ListCell className="max-w-0 w-[68%] sm:w-[46%] md:w-[38%]">
        <span className="block truncate font-semibold tracking-tight text-pv-fg">
          {payment.typeLabel}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-pv-muted-fg md:hidden">{meta}</span>
        <span className="hidden truncate text-[13px] text-pv-muted-fg md:block">
          {payment.method ?? ''}
        </span>
        {/* A hold reserves money without taking it. Saying so is the whole
            point of showing the row: the customer can see the amount on their
            bank statement and needs to know it is not a charge. */}
        {payment.state === 'hold' ? (
          <span className="mt-0.5 block whitespace-normal text-[13px] leading-relaxed text-pv-primary">
            Reserved on your card, not charged
            {payment.holdExpiresAt
              ? ` — releases ${formatDate(payment.holdExpiresAt.slice(0, 10))}`
              : ''}
            .
          </span>
        ) : null}
        {payment.refunded > 0 ? (
          <span className="mt-0.5 block text-[13px] text-pv-muted-fg">
            {formatCurrency(payment.refunded)} refunded
          </span>
        ) : null}
      </ListCell>
      <ListCell className="hidden whitespace-nowrap tabular-nums text-pv-fg md:table-cell">
        {formatDate(payment.date)}
      </ListCell>
      <ListCell className="hidden max-w-0 md:table-cell">
        <span className="block truncate font-medium text-pv-fg">
          {payment.rental?.reference ?? '—'}
        </span>
      </ListCell>
      <ListCell className="hidden sm:table-cell">
        <StatusText tone={chip.tone}>{chip.label}</StatusText>
      </ListCell>
      <ListCell className="text-right">
        <span
          className={cn(
            'block whitespace-nowrap font-semibold tabular-nums',
            payment.state === 'received' ? 'text-pv-success' : 'text-pv-fg',
          )}
        >
          {formatCurrency(payment.amount)}
        </span>
        <StatusText tone={chip.tone} className="sm:hidden">
          {chip.label}
        </StatusText>
      </ListCell>
    </ListRow>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

/** Sized like the stat row, the pay panel and the list, so nothing jumps on load. */
function PaymentsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="h-12 w-full rounded-xl bg-pv-tint" />
      <div className="grid grid-cols-2 gap-3 sm:w-fit sm:grid-cols-[repeat(2,minmax(13rem,auto))]">
        {[0, 1].map((tile) => (
          <div key={tile} className="rounded-2xl border border-pv-border bg-pv-card px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Skeleton className="size-7 rounded-lg bg-pv-tint" />
              <Skeleton className="h-3 w-20 bg-pv-tint" />
            </div>
            <Skeleton className="mt-3 h-7 w-28 bg-pv-tint" />
            <Skeleton className="mt-2 h-3 w-36 bg-pv-tint" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-pv-border bg-pv-card">
        <div className="rounded-t-2xl border-b border-pv-border bg-pv-tint/60 px-4 py-3 sm:px-5">
          <Skeleton className="h-4 w-32 bg-pv-tint" />
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-48 bg-pv-tint" />
          <Skeleton className="h-11 w-full rounded-full bg-pv-tint" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <Skeleton className="h-5 w-28 bg-pv-tint" />
          <Skeleton className="h-11 w-56 rounded-full bg-pv-tint" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-pv-border bg-pv-card">
          <div className="h-11 border-b border-pv-border bg-pv-tint/60" />
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 border-b border-pv-border px-5 py-4 last:border-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-36 bg-pv-tint" />
                <Skeleton className="h-3 w-48 bg-pv-tint" />
              </div>
              <Skeleton className="h-4 w-16 shrink-0 bg-pv-tint" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
