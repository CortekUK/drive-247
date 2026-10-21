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
import { Banknote, CircleCheck, FileText, Receipt, Wallet } from 'lucide-react-nw';

import { formatDate, relativeDayLabel } from '@nw/components/portal/format';
import { EmptyState, LoadError, PageHeader, Panel, StatTile, StatusLine } from '@nw/portal-v2/primitives';
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
import { V2_BUTTON_DEFAULT_SM, V2_BUTTON_OUTLINE_SM } from '@portal-v2-shared/button-styles';

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
  const { formatCurrency } = useTenantBranding();

  const [tab, setTab] = useState<Tab>('invoices');
  const [openInvoice, setOpenInvoice] = useState<CustomerInvoice | null>(null);

  // A booking on an instalment plan is collected by the plan, so it gets no Pay
  // button: its plan card says so once, rather than a pay row that shows an
  // amount and then says there is nothing to pay (owner, Oct 22 2026).
  const payableNow = useMemo(() => payableBalances.filter((row) => row.blockedReason === null), [payableBalances]);

  const hasAnything = invoices.length > 0 || payments.length > 0 || activePlans.length > 0 || balance.outstanding > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Finances" />

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
          <BalanceStatus balance={balance} payableNow={payableNow} plans={activePlans} />

          {/* Two figures only: "Next due" said the same as Outstanding whenever
              anything was late. */}
          <div className="grid grid-cols-2 gap-3 sm:w-fit sm:grid-cols-[repeat(2,minmax(13rem,auto))]">
            <StatTile icon={Wallet} label="Outstanding" value={formatCurrency(balance.outstanding)} />
            <StatTile
              icon={CircleCheck}
              label="Paid to date"
              value={formatCurrency(balance.paidToDate)}
              caption="After refunds"
            />
          </div>

          <PayBalances payable={payableNow} unpayable={balance.unpayable} refetch={refetch} />

          <BalanceBreakdown balance={balance} />

          <InstalmentPlans plans={activePlans} />

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

/**
 * The one line at the top: what is owed, whether any of it is late, and the
 * single thing to do — Pay when a booking can be paid here, the plan when an
 * instalment plan collects it, otherwise a person.
 */
function BalanceStatus({
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
    return <StatusLine tone="success">Nothing outstanding. You are all settled.</StatusLine>;
  }

  const overdue = balance.overdue > 0;
  const when = relativeDayLabel(balance.nextDueDate);
  const text = overdue
    ? balance.overdue === balance.outstanding
      ? `${formatCurrency(balance.outstanding)} is overdue`
      : `${formatCurrency(balance.outstanding)} outstanding, ${formatCurrency(balance.overdue)} of it overdue`
    : `${formatCurrency(balance.outstanding)} outstanding${
        balance.nextDueDate ? `, due ${formatDate(balance.nextDueDate)}${when ? ` (${when})` : ''}` : ''
      }`;

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

  return (
    <StatusLine tone={overdue ? 'danger' : 'warning'} action={action}>
      {text}
    </StatusLine>
  );
}

/**
 * What the outstanding figure is made of, as a tight table on the operator's
 * row height: the rental first, then the fees, tax last, then the total.
 */
function BalanceBreakdown({ balance }: { balance: CustomerBalance }) {
  const { formatCurrency } = useTenantBranding();
  if (balance.categories.length === 0) return null;

  const rank = (label: string) =>
    /^rental$/i.test(label) ? 0 : /discount/i.test(label) ? 1 : /^tax/i.test(label) ? 3 : 2;
  const rows = [...balance.categories].sort((a, b) => rank(a.label) - rank(b.label) || b.amount - a.amount);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-pv-fg">Balance breakdown</h2>
      <ListCard className="sm:max-w-[560px]">
        <ListHeaderRow>
          <ListHead className="h-10">Charge</ListHead>
          <ListHead className="h-10 text-right">Amount</ListHead>
        </ListHeaderRow>
        <ListBody>
          {rows.map((row) => (
            <ListRow key={row.label}>
              <ListCell className="py-3 text-pv-fg">{row.label}</ListCell>
              <ListCell className="py-3 text-right tabular-nums text-pv-fg">{formatCurrency(row.amount)}</ListCell>
            </ListRow>
          ))}
          <ListRow className="bg-pv-row">
            <ListCell className="py-3 font-semibold text-pv-fg">Total</ListCell>
            <ListCell
              className={cn(
                'py-3 text-right font-semibold tabular-nums',
                balance.overdue > 0 ? 'text-pv-danger' : 'text-pv-fg',
              )}
            >
              {formatCurrency(balance.outstanding)}
            </ListCell>
          </ListRow>
        </ListBody>
      </ListCard>
      {balance.cancelledCharges > 0 ? (
        <p className="text-[13px] text-pv-muted-fg">
          {formatCurrency(balance.cancelledCharges)} of charges on cancelled bookings is not included.
        </p>
      ) : null}
    </section>
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
