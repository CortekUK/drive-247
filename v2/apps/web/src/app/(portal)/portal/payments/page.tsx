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
 * ── READ-ONLY, ON PURPOSE ───────────────────────────────────────────────────
 * There is no "Pay now", no "Update card" and no statement download. Each is a
 * write against a live card or a Stripe-hosted redirect, and staging's Stripe
 * webhooks land in the production project — so none of them could be exercised
 * end-to-end before shipping. A payment button that has never been pressed is
 * worse than no button: it invites a customer to try, fails silently, and the
 * money question is still open. The page instead states the balance precisely
 * and points at the operator. The full list is in the handoff notes.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  FileText,
  Receipt,
  TriangleAlert,
} from 'lucide-react';

import { formatDate, relativeDayLabel } from '@/components/portal/format';
import {
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCustomerPayments,
  type CustomerBalance,
  type CustomerInvoice,
  type CustomerPayment,
} from '@/hooks/use-customer-payments';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';

import { InstalmentPlans } from './_components/instalment-plans';
import { InvoiceSheet } from './_components/invoice-sheet';
import { INVOICE_CHIP, PAYMENT_CHIP } from './_components/invoice-state';

type Tab = 'invoices' | 'payments';

export default function PortalPaymentsPage() {
  const {
    balance,
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="What is owed on your account, what you have paid, and every invoice we have raised."
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
          {balance.overdue > 0 ? <OverdueBanner amount={balance.overdue} /> : null}

          <BalancePanel balance={balance} />

          <InstalmentPlans plans={activePlans} next={nextInstallment} />

          <section className="flex flex-col gap-3">
            <div
              role="group"
              aria-label="Choose a list"
              className="flex w-full gap-1 rounded-full border border-brand-border-soft bg-brand-card p-1"
            >
              <TabButton
                active={tab === 'invoices'}
                count={invoices.length}
                onClick={() => setTab('invoices')}
              >
                Invoices
              </TabButton>
              <TabButton
                active={tab === 'payments'}
                count={payments.length}
                onClick={() => setTab('payments')}
              >
                Payments
              </TabButton>
            </div>

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
                <ul className="flex flex-col gap-2">
                  {invoices.map((invoice) => (
                    <li key={invoice.id}>
                      <InvoiceRow
                        invoice={invoice}
                        onOpen={() => setOpenInvoice(invoice)}
                      />
                    </li>
                  ))}
                </ul>
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
              <ul className="flex flex-col gap-2">
                {payments.map((payment) => (
                  <li key={payment.id}>
                    <PaymentRow payment={payment} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <InvoiceSheet
        invoice={openInvoice}
        onOpenChange={(open) => {
          if (!open) setOpenInvoice(null);
        }}
      />
    </div>
  );
}

/* ────────────────────────────── the pieces ─────────────────────────────── */

function BalancePanel({ balance }: { balance: CustomerBalance }) {
  const { formatCurrency } = useTenantBranding();
  const settled = balance.outstanding === 0;
  const when = relativeDayLabel(balance.nextDueDate);

  return (
    <Panel>
      <PanelHeader title="Account balance" />

      <div className="flex flex-col gap-1 px-4 py-5 sm:px-5">
        <p className="text-xs text-brand-text-subtle">
          {settled ? 'Nothing outstanding' : 'Outstanding'}
        </p>
        <p
          className={cn(
            'text-3xl font-medium tabular-nums sm:text-4xl',
            balance.overdue > 0 ? 'text-danger' : 'text-brand-text',
          )}
        >
          {formatCurrency(balance.outstanding)}
        </p>
        <p className="text-sm leading-relaxed text-brand-text-soft">
          {settled ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2
                aria-hidden
                strokeWidth={1.75}
                className="size-4 shrink-0 text-success"
              />
              You are all settled — nothing is due right now.
            </span>
          ) : balance.overdue > 0 ? (
            <>
              {formatCurrency(balance.overdue)} of this is past its due date.
            </>
          ) : balance.nextDueDate ? (
            <>
              Due {formatDate(balance.nextDueDate)}
              {when ? ` (${when})` : ''}.
            </>
          ) : (
            'No due date has been set on these charges.'
          )}
        </p>
      </div>

      {balance.categories.length > 0 ? (
        <dl className="divide-y divide-brand-border-soft border-t border-brand-border-soft">
          {balance.categories.map((category) => (
            <div
              key={category.label}
              className="flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5"
            >
              <dt className="min-w-0 truncate text-sm text-brand-text-soft">
                {category.label}
              </dt>
              <dd className="shrink-0 text-sm tabular-nums text-brand-text">
                {formatCurrency(category.amount)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-col gap-1.5 border-t border-brand-border-soft px-4 py-3.5 sm:px-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-brand-text-soft">Paid to date</span>
          <span className="text-sm font-medium tabular-nums text-brand-text">
            {formatCurrency(balance.paidToDate)}
          </span>
        </div>
        {balance.cancelledCharges > 0 ? (
          <p className="text-xs leading-relaxed text-brand-text-subtle">
            {formatCurrency(balance.cancelledCharges)} of charges on cancelled
            bookings is excluded from this balance.
          </p>
        ) : null}
        {!settled ? (
          <>
            <p className="text-xs leading-relaxed text-brand-text-subtle">
              Paying a balance from this page is not available yet — get in touch
              if you need to settle one, or if something here looks wrong.
            </p>
            {/* Its own row rather than a link inside the sentence: an inline
                link in a 12px paragraph is a 17px-tall tap target. Suppressed
                when the overdue banner is up — that already carries the same
                link forty pixels higher, and two of them read as a dead end
                rather than as help. */}
            {balance.overdue === 0 ? (
              <Link
                href="/contact"
                className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
              >
                Contact us
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function OverdueBanner({ amount }: { amount: number }) {
  const { formatCurrency } = useTenantBranding();
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-danger-subtle bg-danger-light px-4 py-3.5">
      <TriangleAlert
        aria-hidden
        strokeWidth={1.75}
        className="mt-0.5 size-4 shrink-0 text-danger"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-brand-text">
          {formatCurrency(amount)} is overdue
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">
          These charges passed their due date. If you have already paid, it can
          take a day or two to show — otherwise please contact us so it does not
          affect your booking.
        </p>
        <Link
          href="/contact"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
        >
          Contact us
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25',
        active
          ? 'bg-brand-forest font-medium text-white'
          : 'text-brand-text-soft hover:bg-brand-stone hover:text-brand-text',
      )}
    >
      {children}
      <span
        className={cn(
          'tabular-nums',
          active ? 'text-white/70' : 'text-brand-text-subtle',
        )}
      >
        {count}
      </span>
    </button>
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

  // The secondary line: what it is for and when it was raised. The booking
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
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border bg-brand-card px-4 py-3.5 text-left transition-colors',
        'hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25',
        invoice.state === 'overdue'
          ? 'border-danger-subtle'
          : 'border-brand-border-soft',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          invoice.state === 'overdue' ? 'bg-danger-light' : 'bg-brand-stone',
        )}
      >
        <FileText
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'size-4',
            invoice.state === 'overdue' ? 'text-danger' : 'text-brand-text-subtle',
          )}
        />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-brand-text">
          {invoice.number}
        </span>
        <span className="truncate text-xs text-brand-text-subtle">{meta}</span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-medium tabular-nums text-brand-text">
          {formatCurrency(invoice.total)}
        </span>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </span>
    </button>
  );
}

function PaymentRow({ payment }: { payment: CustomerPayment }) {
  const { formatCurrency } = useTenantBranding();
  const chip = PAYMENT_CHIP[payment.state];

  const meta = [
    formatDate(payment.date),
    payment.method,
    payment.rental?.reference,
  ]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');

  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-brand-border-soft bg-brand-card px-4 py-3.5">
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full',
          payment.state === 'received' ? 'bg-success-light' : 'bg-brand-stone',
        )}
      >
        {payment.state === 'hold' ? (
          <CreditCard
            aria-hidden
            strokeWidth={1.75}
            className="size-4 text-brand-text-subtle"
          />
        ) : (
          <Banknote
            aria-hidden
            strokeWidth={1.75}
            className={cn(
              'size-4',
              payment.state === 'received' ? 'text-success' : 'text-brand-text-subtle',
            )}
          />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium text-brand-text">
          {payment.typeLabel}
        </p>
        <p className="truncate text-xs text-brand-text-subtle">{meta}</p>
        {/* A hold reserves money without taking it. Saying so is the whole
            point of showing the row: the customer can see the amount on their
            bank statement and needs to know it is not a charge. */}
        {payment.state === 'hold' ? (
          <p className="text-xs leading-relaxed text-info">
            Reserved on your card, not charged
            {payment.holdExpiresAt
              ? ` — releases ${formatDate(payment.holdExpiresAt.slice(0, 10))}`
              : ''}
            .
          </p>
        ) : null}
        {payment.refunded > 0 ? (
          <p className="text-xs text-brand-text-subtle">
            {formatCurrency(payment.refunded)} refunded
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            'text-sm font-medium tabular-nums',
            payment.state === 'received' ? 'text-success' : 'text-brand-text',
          )}
        >
          {formatCurrency(payment.amount)}
        </span>
        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
      </div>
    </div>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

/** Sized like the balance panel and three list rows, so nothing jumps on load. */
function PaymentsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <div className="rounded-[14px] border border-brand-border-soft bg-brand-card">
        <div className="border-b border-brand-border-soft px-4 py-3 sm:px-5">
          <Skeleton className="h-4 w-32 bg-brand-stone" />
        </div>
        <div className="flex flex-col gap-2 px-4 py-5 sm:px-5">
          <Skeleton className="h-3 w-20 bg-brand-stone" />
          <Skeleton className="h-9 w-40 bg-brand-stone" />
          <Skeleton className="h-4 w-56 bg-brand-stone" />
        </div>
        <div className="flex flex-col gap-3 border-t border-brand-border-soft px-4 py-3.5 sm:px-5">
          <Skeleton className="h-4 w-full bg-brand-stone" />
          <Skeleton className="h-4 w-3/4 bg-brand-stone" />
        </div>
      </div>

      <Skeleton className="h-12 w-full rounded-full bg-brand-stone" />

      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 rounded-[14px] border border-brand-border-soft bg-brand-card px-4 py-3.5"
          >
            <Skeleton className="size-9 shrink-0 rounded-full bg-brand-stone" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-36 bg-brand-stone" />
              <Skeleton className="h-3 w-48 bg-brand-stone" />
            </div>
            <Skeleton className="h-4 w-16 shrink-0 bg-brand-stone" />
          </div>
        ))}
      </div>
    </div>
  );
}
