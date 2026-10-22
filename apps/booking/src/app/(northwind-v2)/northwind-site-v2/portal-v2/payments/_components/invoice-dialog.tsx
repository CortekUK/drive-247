'use client';

/**
 * One invoice, broken down exactly as the operator sees it.
 *
 *   INV-0024
 *   Issued 25 Aug 2026 · Ford Explorer
 *   Part paid · Overdue · 34 days
 *
 *   Line items          Total        Paid       Remaining
 *                    $3,747.05  −  $3,301.65  =   $445.40
 *
 *   ▸ Service Fee                                  $97.50   ← amber: part paid
 *   ▾ Rental                                    $1,950.00
 *   │   Cash · 25 Sep                            +$300.00
 *   │   Bank transfer · 18 Aug                 +$1,343.10
 *   │   Paid                                    $1,643.10
 *   │   Remaining                                 $306.90
 *   ▸ Rental · 10 Sep                           $1,335.00   ← green: paid
 *
 *   Details  Vehicle · Rental · Issued · Due · Status
 *
 * The figures are the operator sheet's (`invoice-detail-sheet.tsx`), computed
 * by `use-customer-invoice-breakdown.ts` from the same ledger rows — so when a
 * customer and the operator discuss a payment, they are reading the same
 * numbers line for line. Nothing operator-only is shown: no provider ids, no
 * channels, no notes, no staff names.
 *
 * A dialog rather than a route: an invoice has no life of its own away from the
 * list, and a `/portal/payments/[invoiceId]` route would put a document id in
 * the URL — the one thing `use-customer-payments.ts` is careful never to trust.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react-nw';
import { V2_LIST_TONES } from '@portal-v2-shared/list-styles';

import { formatDate } from '@nw/components/portal/format';
import { Button } from '@nw/components/ui/button';
import { parseDateOnly } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';
import type { CustomerInvoice } from '@nw/hooks/use-customer-payments';
import {
  EPS,
  useCustomerInvoiceBreakdown,
  type BreakdownCharge,
  type BreakdownPayment,
  type BreakdownTone,
} from '@nw/hooks/use-customer-invoice-breakdown';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';

import { INVOICE_CHIP } from './invoice-state';
import { StatusText } from './list-table';
import { RecordDialog } from './record-dialog';

/** The operator's tone colours, for amounts and status words. */
const TONE_TEXT: Record<BreakdownTone, string> = {
  success: V2_LIST_TONES.success,
  warning: V2_LIST_TONES.warning,
  danger: V2_LIST_TONES.danger,
  info: V2_LIST_TONES.brand,
  muted: 'text-pv-muted-fg',
};

/** The customer portal's StatusText tones. */
const CHIP_TONE: Record<BreakdownTone, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  muted: 'neutral',
};

/** "30 Sep" — a date-only string or a timestamp. */
function shortDate(value: string | null): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function InvoiceDialog({
  invoice,
  onOpenChange,
  footer,
}: {
  invoice: CustomerInvoice | null;
  onOpenChange: (open: boolean) => void;
  /** Rendered at the bottom of the dialog, beside "See rental" — e.g. a Pay button. */
  footer?: React.ReactNode;
}) {
  const { formatCurrency } = useTenantBranding();
  const money = (n: number) => formatCurrency(Math.round(n * 100) / 100);

  // Hold on to the last invoice while the dialog plays its 200ms exit, so the
  // body does not blank out mid-animation when the parent clears its selection.
  const [shown, setShown] = useState<CustomerInvoice | null>(invoice);
  useEffect(() => {
    if (invoice) setShown(invoice);
  }, [invoice]);

  // The ONE charge that is open — opening another closes it. All closed by
  // default, as on the operator's sheet.
  const [openCharge, setOpenCharge] = useState<string | null>(null);
  useEffect(() => {
    setOpenCharge(null);
  }, [shown?.id]);

  const { breakdown, isLoading, error } = useCustomerInvoiceBreakdown(shown);

  // The status the figures below support. Until they load, the list's own.
  const listChip = shown ? INVOICE_CHIP[shown.state] : null;
  const status = breakdown
    ? { label: breakdown.status.label, tone: CHIP_TONE[breakdown.status.tone] }
    : listChip;
  const due = breakdown?.due ?? null;

  const vehicle = shown?.rental?.vehicle
    ? [shown.rental.vehicle.displayName, shown.rental.vehicle.registration].filter(Boolean).join(' · ')
    : null;

  return (
    <RecordDialog
      open={invoice !== null}
      onOpenChange={onOpenChange}
      className="sm:max-w-xl"
      title={<span className="break-all tabular-nums">{shown?.number ?? 'Invoice'}</span>}
      description={
        shown
          ? `Issued ${formatDate(shown.invoiceDate) ?? shown.invoiceDate}${
              shown.rental?.vehicle ? ` · ${shown.rental.vehicle.displayName}` : ''
            }`
          : undefined
      }
      status={
        shown && status ? (
          <>
            <StatusText tone={status.tone}>{status.label}</StatusText>
            {due ? (
              <>
                <span aria-hidden className="text-[13px] text-pv-muted-fg">
                  ·
                </span>
                <StatusText tone={CHIP_TONE[due.tone]}>{due.label}</StatusText>
              </>
            ) : null}
          </>
        ) : null
      }
      footer={
        shown?.rental || footer ? (
          <>
            {shown?.rental ? (
              <Button
                asChild
                variant={footer ? 'brand-outline' : 'brand'}
                className="h-11 px-5"
              >
                <Link href={`/portal/rentals/${shown.rental.id}`}>See rental {shown.rental.reference}</Link>
              </Button>
            ) : null}
            {footer}
          </>
        ) : null
      }
    >
      {shown ? (
        <div className="flex flex-col gap-6">
          {error ? (
            <p className="text-sm text-pv-danger">We could not load this invoice’s breakdown. Please try again.</p>
          ) : isLoading || !breakdown ? (
            <BreakdownSkeleton />
          ) : (
            <section className="flex flex-col gap-3">
              {/* ── The sum: Total − Paid = Remaining ──────────────────────── */}
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 rounded-xl border border-pv-border bg-pv-card px-4 py-3">
                <span className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-pv-muted-fg">
                  Line items
                </span>
                <div
                  className="flex flex-wrap items-end gap-x-2.5"
                  aria-label={`Total ${money(breakdown.total)}, paid ${money(breakdown.paid)}, remaining ${money(breakdown.remaining)}`}
                >
                  <SumTerm label="Total" value={money(breakdown.total)} />
                  <SumOp>−</SumOp>
                  <SumTerm label="Paid" value={money(breakdown.paid)} />
                  <SumOp>=</SumOp>
                  <SumTerm
                    label={breakdown.cancelled && breakdown.remaining > EPS ? 'Not owed' : 'Remaining'}
                    value={money(breakdown.remaining)}
                    className={
                      breakdown.remaining > EPS && !breakdown.cancelled
                        ? TONE_TEXT[due?.tone ?? breakdown.status.tone]
                        : 'text-pv-muted-fg'
                    }
                  />
                </div>
              </div>

              {breakdown.cancelled ? (
                <p className="text-sm leading-relaxed text-pv-muted-fg">
                  This booking was cancelled, so nothing is owed on this invoice. It is kept here as a
                  record of what had been billed.
                </p>
              ) : null}

              {/* ── The charges, each with the payments that paid it ─────────── */}
              {breakdown.charges.length === 0 ? (
                <p className="text-sm text-pv-muted-fg">No charges recorded on this booking yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {breakdown.charges.map((charge) => (
                    <ChargeRow
                      key={charge.id}
                      charge={charge}
                      invoiceDate={shown.invoiceDate}
                      open={openCharge === charge.id}
                      onToggle={() => setOpenCharge((prev) => (prev === charge.id ? null : charge.id))}
                      money={money}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ── Details ─────────────────────────────────────────────────── */}
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-pv-muted-fg">Details</h3>
            <dl className="divide-y divide-pv-border text-sm">
              {vehicle ? <Detail label="Vehicle">{vehicle}</Detail> : null}
              <Detail label="Rental">
                {shown.rental ? (
                  <Link
                    href={`/portal/rentals/${shown.rental.id}`}
                    className="text-pv-link hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {shown.rental.reference}
                  </Link>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Issued">{formatDate(shown.invoiceDate) ?? '—'}</Detail>
              <Detail label="Due">
                {formatDate(breakdown?.dueDate ?? shown.dueDate) ?? 'No due date'}
                {due ? (
                  <>
                    <span className="text-pv-muted-fg"> · </span>
                    <span className={cn('font-medium', TONE_TEXT[due.tone])}>{due.label}</span>
                  </>
                ) : null}
              </Detail>
              <Detail label="Status">
                {status ? <StatusText tone={status.tone}>{status.label}</StatusText> : '—'}
              </Detail>
              {breakdown ? <Detail label="Line items">{breakdown.charges.length}</Detail> : null}
            </dl>
          </section>
        </div>
      ) : null}
    </RecordDialog>
  );
}

/* ─────────────────────────────── pieces ─────────────────────────────────── */

function SumTerm({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-[11px] font-medium text-pv-muted-fg">{label}</span>
      <span className={cn('text-lg font-semibold tabular-nums text-pv-fg', className)}>{value}</span>
    </span>
  );
}

function SumOp({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="pb-0.5 text-lg text-pv-muted-fg/60">
      {children}
    </span>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-2">
      <dt className="text-pv-muted-fg">{label}</dt>
      <dd className="min-w-0 break-words text-pv-fg">{children}</dd>
    </div>
  );
}

/** One line of the bill: closed by default; open, its payments and the sum under them. */
function ChargeRow({
  charge,
  invoiceDate,
  open,
  onToggle,
  money,
}: {
  charge: BreakdownCharge;
  invoiceDate: string;
  open: boolean;
  onToggle: () => void;
  money: (n: number) => string;
}) {
  const day = charge.entryDate?.slice(0, 10) ?? null;
  const showDate = !!day && day !== invoiceDate.slice(0, 10);
  const summary =
    charge.remaining > EPS ? `${charge.state.label} · ${money(charge.remaining)} remaining` : charge.state.label;
  const hasRows = charge.payments.length > 0;

  return (
    <li className="border-b border-pv-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${charge.label}, ${money(charge.amount)}, ${summary}`}
        title={summary}
        onClick={onToggle}
        className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors duration-200 ease-out hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring motion-reduce:transition-none"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-pv-muted-fg transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-pv-fg">
          {charge.label}
          {showDate ? (
            <span className="ml-2 text-xs tabular-nums text-pv-muted-fg">{shortDate(day)}</span>
          ) : null}
        </span>
        <span
          className={cn(
            'w-28 shrink-0 text-right font-medium tabular-nums',
            open && hasRows ? 'text-pv-fg' : TONE_TEXT[charge.state.tone],
          )}
        >
          {money(charge.amount)}
        </span>
      </button>

      {open ? (
        <ul className="mb-3 ml-[13px] border-l border-pv-border pl-4">
          {hasRows ? (
            <>
              {charge.payments.map((p) => (
                <PaymentRow key={p.key} payment={p} money={money} />
              ))}
              <li className="flex h-8 items-center gap-3 pr-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-xs text-pv-muted-fg">
                  Paid
                  {charge.refunded > EPS ? (
                    <span className={V2_LIST_TONES.danger}>{` · ${money(charge.refunded)} refunded`}</span>
                  ) : null}
                </span>
                <span className="w-28 shrink-0 border-t border-pv-fg/30 pt-1 text-right font-medium tabular-nums text-pv-fg">
                  {money(charge.paid)}
                </span>
              </li>
              <li className="flex h-8 items-center gap-3 pr-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-xs text-pv-muted-fg">Remaining</span>
                <span
                  className={cn(
                    'w-28 shrink-0 text-right font-semibold tabular-nums',
                    charge.remaining > EPS ? TONE_TEXT[charge.state.tone] : V2_LIST_TONES.success,
                  )}
                >
                  {money(charge.remaining)}
                </span>
              </li>
            </>
          ) : (
            <li className="flex h-8 items-center gap-3 pr-1.5 text-xs text-pv-muted-fg">
              <span className="min-w-0 flex-1">
                {charge.paid > EPS ? 'Paid' : 'No payments toward this charge yet.'}
              </span>
              {charge.paid > EPS ? (
                <span className="w-28 shrink-0 text-right text-sm font-medium tabular-nums text-pv-fg">
                  {money(charge.paid)}
                </span>
              ) : null}
            </li>
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** A payment applied to a charge, and under it any refund of it. */
function PaymentRow({ payment: p, money }: { payment: BreakdownPayment; money: (n: number) => string }) {
  const when = shortDate(p.paidAt) ?? shortDate(p.paymentDate);
  return (
    <li>
      <div className="flex h-8 items-center gap-3 pr-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate text-pv-muted-fg">
          {p.label}
          {p.split ? ` · of a ${money(p.whole)} payment` : ''}
          {when ? ` · ${when}` : ''}
          {p.statusWord ? (
            <span className={cn('ml-2 text-xs font-medium', V2_LIST_TONES.warning)}>{p.statusWord}</span>
          ) : null}
        </span>
        <span
          className={cn(
            'w-28 shrink-0 text-right font-medium tabular-nums',
            p.landed ? 'text-pv-fg' : 'text-pv-muted-fg',
          )}
        >
          {p.landed ? <span aria-hidden className="mr-0.5 text-pv-muted-fg">+</span> : null}
          {money(p.applied)}
        </span>
      </div>
      {p.refund ? (
        <div className="flex h-7 items-center gap-3 pr-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate pl-3 text-pv-muted-fg">
            {p.refund.toCard ? 'Refund · to card' : 'Refund'}
            {p.split ? ` · of a ${money(p.refund.whole)} refund` : ''}
            {shortDate(p.refund.date) ? ` · ${shortDate(p.refund.date)}` : ''}
            {p.refund.pending ? (
              <span className={cn('ml-2 text-xs font-medium', V2_LIST_TONES.warning)}>Processing</span>
            ) : null}
          </span>
          <span className={cn('w-28 shrink-0 text-right font-medium tabular-nums', V2_LIST_TONES.danger)}>
            <span aria-hidden className="mr-0.5">−</span>
            {money(p.refund.amount)}
            <span className="sr-only"> refunded</span>
          </span>
        </div>
      ) : null}
    </li>
  );
}

function BreakdownSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-3">
      <div className="h-[62px] animate-pulse rounded-xl bg-pv-muted motion-reduce:animate-none" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-11 animate-pulse rounded-md bg-pv-muted/70 motion-reduce:animate-none" />
      ))}
    </div>
  );
}
