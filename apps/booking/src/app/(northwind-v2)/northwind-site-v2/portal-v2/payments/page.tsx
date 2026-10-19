'use client';

/**
 * Payments — what the customer owes, what they have paid, and every invoice.
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
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  CircleCheck,
  FileText,
  Receipt,
  TriangleAlert,
  Wallet,
} from 'lucide-react-nw';

import { formatDate, relativeDayLabel } from '@nw/components/portal/format';
import {
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  PanelHeader,
  StatTile,
} from '@nw/portal-v2/primitives';
import { Skeleton } from '@nw/components/ui/skeleton';
import {
  useCustomerPayments,
  type CustomerBalance,
  type CustomerInvoice,
  type CustomerPayment,
} from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

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
  const {
    balance,
    payableBalances,
    invoices,
    payments,
    activePlans,
    nextInstallment,
    isLoading,
    isError,
    error,
    refetch,
  } = useCustomerPayments();

  const [tab, setTab] = useState<Tab>('invoices');
  const [openInvoice, setOpenInvoice] = useState<CustomerInvoice | null>(null);

  const hasAnything =
    invoices.length > 0 ||
    payments.length > 0 ||
    activePlans.length > 0 ||
    balance.outstanding > 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payments"
        description="What you owe, what you have paid, and every invoice for your bookings."
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
        <PaymentsSkeleton />
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
          <div className="flex flex-col gap-4">
            {balance.overdue > 0 ? <OverdueBanner amount={balance.overdue} /> : null}
            <BalanceTiles balance={balance} />
          </div>

          <PayBalances
            payable={payableBalances}
            unpayable={balance.unpayable}
            refetch={refetch}
          />

          <BalanceBreakdown balance={balance} />

          <InstalmentPlans plans={activePlans} next={nextInstallment} />

          {/* Operator list pattern: section title, the filter bar, the table. */}
          <section className="flex flex-col gap-4">
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

/** The operator's stat-card row: three headline figures, nothing else. */
function BalanceTiles({ balance }: { balance: CustomerBalance }) {
  const { formatCurrency } = useTenantBranding();
  const settled = balance.outstanding === 0;
  const when = relativeDayLabel(balance.nextDueDate);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {/* Full width on a phone: the one figure the page is about. */}
      <div className="col-span-2 sm:col-span-1">
        <StatTile
          icon={Wallet}
          label="Outstanding"
          value={formatCurrency(balance.outstanding)}
          caption={
            settled
              ? 'You are all settled'
              : balance.overdue > 0
                ? `${formatCurrency(balance.overdue)} is past its due date`
                : 'Not yet due'
          }
        />
      </div>
      <StatTile
        icon={CircleCheck}
        label="Paid to date"
        value={formatCurrency(balance.paidToDate)}
        caption="After refunds"
      />
      <StatTile
        icon={CalendarClock}
        label="Next due"
        value={
          settled
            ? '—'
            : balance.overdue > 0
              ? 'Overdue'
              : (formatDate(balance.nextDueDate) ?? 'Not set')
        }
        caption={
          settled
            ? 'Nothing due'
            : balance.overdue > 0
              ? 'Past its due date'
              : balance.nextDueDate
              ? (when ?? 'Due date')
              : 'No due date set'
        }
      />
    </div>
  );
}

/**
 * What the outstanding figure is made of. Only drawn when there is something
 * to break down — a settled account has nothing to itemise.
 */
function BalanceBreakdown({ balance }: { balance: CustomerBalance }) {
  const { formatCurrency } = useTenantBranding();
  const settled = balance.outstanding === 0;

  if (balance.categories.length === 0 && balance.cancelledCharges === 0) return null;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader title="What makes up your balance" />

      {balance.categories.length > 0 ? (
        <dl className="divide-y divide-pv-border">
          {balance.categories.map((category) => (
            <div
              key={category.label}
              className="flex items-baseline justify-between gap-4 px-4 py-3 sm:px-5"
            >
              <dt className="min-w-0 truncate text-sm text-pv-muted-fg">{category.label}</dt>
              <dd className="shrink-0 text-sm font-medium tabular-nums text-pv-fg">
                {formatCurrency(category.amount)}
              </dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 bg-pv-row px-4 py-3 sm:px-5">
            <dt className="text-sm font-semibold text-pv-fg">Total outstanding</dt>
            <dd
              className={cn(
                'shrink-0 text-sm font-semibold tabular-nums',
                balance.overdue > 0 ? 'text-pv-danger' : 'text-pv-fg',
              )}
            >
              {formatCurrency(balance.outstanding)}
            </dd>
          </div>
        </dl>
      ) : null}

      {balance.cancelledCharges > 0 || (!settled && balance.overdue === 0) ? (
        <div className="flex flex-col gap-1 border-t border-pv-border px-4 py-3 sm:px-5">
          {balance.cancelledCharges > 0 ? (
            <p className="text-[13px] leading-relaxed text-pv-muted-fg">
              {formatCurrency(balance.cancelledCharges)} of charges on cancelled bookings is
              excluded from this balance.
            </p>
          ) : null}
          {/* The route to a human: some of the balance may not be payable by
              card, and something on this page may simply look wrong. Its own
              row rather than a link inside a sentence, so it is a 44px tap
              target. Suppressed when the overdue banner is up — that already
              carries the same link, and two of them read as a dead end. */}
          {!settled && balance.overdue === 0 ? <ContactLink /> : null}
        </div>
      ) : null}
    </Panel>
  );
}

function ContactLink({ className }: { className?: string }) {
  return (
    <Link
      href="/contact"
      className={cn(
        'inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-pv-link underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none',
        className,
      )}
    >
      Contact us
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function OverdueBanner({ amount }: { amount: number }) {
  const { formatCurrency } = useTenantBranding();
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-pv-danger/20 bg-pv-danger-light px-4 py-3.5 sm:px-5">
      <TriangleAlert
        aria-hidden
        strokeWidth={1.75}
        className="mt-0.5 size-4 shrink-0 text-pv-danger"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-pv-fg">{formatCurrency(amount)} is overdue</p>
        <p className="mt-0.5 text-sm leading-relaxed text-pv-muted-fg">
          These charges passed their due date. If you have already paid, it can take a day or two
          to show — otherwise please contact us so it does not affect your booking.
        </p>
        <ContactLink className="mt-1" />
      </div>
    </div>
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
    <div className="flex flex-col gap-8" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <div key={tile} className={cn('rounded-2xl border border-pv-border bg-pv-card px-4 py-3.5', tile === 0 && 'col-span-2 sm:col-span-1')}>
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
