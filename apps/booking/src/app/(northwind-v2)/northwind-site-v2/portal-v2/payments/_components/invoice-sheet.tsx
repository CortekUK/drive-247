'use client';

/**
 * One invoice, in a sheet that slides in from the right: the operator's
 * invoice sheet (apps/portal components/finances-v2/invoice-detail-sheet.tsx),
 * line for line, minus everything that is the operator's own:
 *
 *   INV-0024  ⧉                                          [ Pay $445.40 ]
 *   ▸ Details
 *
 *   LINE ITEMS          $3,747.05 − $3,301.65 = $445.40
 *   ├─ ▸ Service Fee                     $97.50    ← amber: part paid
 *   ├─ ▾ Rental                       $1,950.00
 *   │    ├─ Cash · Sep 25               + $300.00
 *   │    ├─ Paid                         $300.00
 *   │    └─ Remaining                  $1,650.00
 *   └─ ▸ Rental · Sep 10              $1,335.00    ← green: paid
 *
 *   [Rental] [Part paid] [Overdue · 34 days]                 Issued Aug 25, 2026
 *
 * Kept from the operator: the header (number, copy, Pay), the folded Details,
 * the white sum card, the charges tree (closed by default, one open at a time,
 * amounts coloured by state), and the pinned pills along the bottom.
 *
 * Left out, on purpose (customer-safe): edit / cancel / delete, "Add payment"
 * rows, credit and debit notes, receipts' provider marks and every provider
 * id, accounting sync marks, notes. How a payment was made is told from its
 * `method` alone (use-customer-invoice-breakdown.ts).
 *
 * Opens for EVERY invoice, cancelled ones included. Pay shows only on an
 * invoice that still owes money and is not cancelled (the operator's rule),
 * and the PayButton itself renders nothing when nothing on the booking is
 * payable here.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ChevronRight, CornerDownRight } from 'lucide-react-nw';

import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@nw/components/ui/sheet';
import { useTenant } from '@nw/contexts/TenantContext';
import type { CustomerInvoice } from '@nw/hooks/use-customer-payments';
import {
  EPS,
  useCustomerInvoiceBreakdown,
  type BreakdownCharge,
  type BreakdownPayment,
  type BreakdownTone,
} from '@nw/hooks/use-customer-invoice-breakdown';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { parseDateOnly } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';
import { PV_DIALOG_CLOSE, PV_DIALOG_WASH } from '@nw/portal-v2/dialog';
import { PayButton } from '@nw/portal-v2/pay/pay-provider';
import { V2_LIST_TONES } from '@portal-v2-shared/list-styles';

import { CopyOnHover } from './copy-on-hover';

/** A charge's state, carried by its amount's colour (operator AMOUNT_TONE). */
const AMOUNT_TONE: Record<BreakdownTone, string> = {
  success: V2_LIST_TONES.success,
  warning: V2_LIST_TONES.warning,
  muted: 'text-pv-muted-fg',
  info: V2_LIST_TONES.info,
  danger: V2_LIST_TONES.danger,
};

/** Operator PILL_TONE: a faint tint of its colour, darker text of the same hue, a hairline border. */
const PILL_TONE: Record<BreakdownTone, string> = {
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
  info: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  muted: 'border-pv-border bg-pv-muted/60 text-pv-muted-fg',
};

function Pill({ tone, children }: { tone: BreakdownTone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', PILL_TONE[tone])}>
      {children}
    </span>
  );
}

/** One row of Details: a quiet label, then its value (operator `Detail`). */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-pv-muted-fg">{label}</dt>
      <dd className="min-w-0 break-words text-pv-fg">{children}</dd>
    </div>
  );
}

/**
 * A tree node, with its connector drawn by the <li> itself (operator `treeNode`):
 * a rail down the left, stopping at the elbow on the last child, and an elbow
 * into the middle of the row. `top` is that middle.
 */
function treeNode(last: boolean, top: '18px' | '16px') {
  return cn(
    'relative pl-5',
    "before:absolute before:left-0 before:top-0 before:border-l before:border-pv-border before:content-['']",
    last ? (top === '18px' ? 'before:h-[18px]' : 'before:h-[16px]') : 'before:h-full',
    "after:absolute after:left-0 after:w-3.5 after:border-t after:border-pv-border after:content-['']",
    top === '18px' ? 'after:top-[18px]' : 'after:top-[16px]',
  );
}

/** A DATE-only string or a timestamp, as a Date. */
function toDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
}

export function InvoiceSheet({
  invoice,
  entity,
  onOpenChange,
}: {
  invoice: CustomerInvoice | null;
  /** "Rental" | "Customer": the table's Entity for this invoice (operator `entityLabel`). */
  entity: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { formatCurrency } = useTenantBranding();
  const { tenant } = useTenant();
  const money = (n: number) => formatCurrency(Math.round(n * 100) / 100);

  // Hold on to the last invoice while the sheet plays its exit, so the body
  // does not blank out mid-animation when the parent clears its selection.
  const [shown, setShown] = useState<CustomerInvoice | null>(invoice);
  useEffect(() => {
    if (invoice) setShown(invoice);
  }, [invoice]);

  // The ONE charge that is open; all closed by default. Details folded.
  const [openCharge, setOpenCharge] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    setOpenCharge(null);
    setDetailsOpen(false);
  }, [shown?.id]);

  const { breakdown, isLoading, error } = useCustomerInvoiceBreakdown(shown);

  const invoiceDay = shown?.invoiceDate.slice(0, 10) ?? null;
  const vehicle = shown?.rental?.vehicle
    ? [shown.rental.vehicle.registration, shown.rental.vehicle.displayName].filter(Boolean).join(' · ')
    : null;
  const owes = breakdown?.remaining ?? 0;
  const cancelled = shown?.statusRaw === 'cancelled';
  const payment = breakdown?.status ?? null;
  const due = breakdown?.due ?? null;

  return (
    <Sheet open={invoice !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // No ✕ from sm up, as on the operator's sheet: it closes on a click
        // outside or on Esc. A phone has no "outside", so it gets the portal's
        // Close pill.
        showCloseButton={false}
        style={{ backgroundImage: PV_DIALOG_WASH }}
        className="max-h-dvh w-full gap-0 overflow-y-auto overscroll-contain border-l border-pv-border bg-pv-card p-0 text-sm text-pv-fg sm:max-w-xl"
      >
        {shown ? (
          <>
            {/* ── Header (operator SheetHeader, p-6) ───────────────────────── */}
            <div className="flex flex-col gap-1.5 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="group/copy flex min-h-8 min-w-0 items-center gap-1">
                  <SheetTitle className="truncate text-lg font-semibold tabular-nums text-pv-fg">{shown.number}</SheetTitle>
                  <CopyOnHover value={shown.number} label="Copy invoice number" />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Pay: on an invoice that still owes money (operator rule). */}
                  {!cancelled && owes > EPS ? <PayButton rentalId={shown.rentalId} /> : null}
                  {/* The portal's Close pill, on a phone only. */}
                  <SheetClose className={cn(PV_DIALOG_CLOSE, 'static sm:hidden')}>Close</SheetClose>
                </div>
              </div>
              <SheetDescription className="sr-only">
                {[tenant?.company_name, vehicle].filter(Boolean).join(' · ')}
                {` · Issued ${format(parseDateOnly(shown.invoiceDate.slice(0, 10)), 'PP')}`}
                {shown.dueDate ? ` · Due ${format(parseDateOnly(shown.dueDate.slice(0, 10)), 'PP')}` : ''}
              </SheetDescription>

              {/* Details: folded away by default so the header stays one line. */}
              <div className="pt-1">
                <div className="flex items-center">
                  <button
                    type="button"
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen((v) => !v)}
                    className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 text-sm text-pv-muted-fg hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        'size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
                        detailsOpen && 'rotate-90',
                      )}
                    />
                    Details
                  </button>
                </div>
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200 motion-reduce:transition-none',
                    detailsOpen ? 'grid-rows-[1fr] ease-out' : 'grid-rows-[0fr] ease-in',
                  )}
                  inert={!detailsOpen ? true : undefined}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      className={cn(
                        'pt-2 [transition:transform_200ms,opacity_200ms] motion-reduce:transition-none',
                        detailsOpen
                          ? 'translate-y-0 opacity-100 [transition-timing-function:ease-out]'
                          : '-translate-y-3 opacity-0 [transition-timing-function:ease-in]',
                      )}
                    >
                      <dl className="divide-y divide-pv-border/60 text-sm">
                        <Detail label="Company">{tenant?.company_name ?? '—'}</Detail>
                        {vehicle ? <Detail label="Vehicle">{vehicle}</Detail> : null}
                        <Detail label="Rental">
                          {shown.rental ? (
                            <Link href={`/portal/rentals/${shown.rental.id}`} className="text-pv-link hover:underline">
                              View rental
                            </Link>
                          ) : (
                            'Not tied to a rental'
                          )}
                        </Detail>
                        <Detail label="Entity">{entity}</Detail>
                        {entity === 'Rental' && shown.rental?.reference ? (
                          <Detail label="Entity ref">{shown.rental.reference}</Detail>
                        ) : null}
                        <Detail label="Issued">{format(parseDateOnly(shown.invoiceDate.slice(0, 10)), 'PPP')}</Detail>
                        <Detail label="Due">
                          {shown.dueDate ? format(parseDateOnly(shown.dueDate.slice(0, 10)), 'PPP') : 'No due date'}
                          {due ? (
                            <>
                              <span className="text-pv-muted-fg"> · </span>
                              <span className={cn('text-sm font-medium', AMOUNT_TONE[due.tone])}>{due.label}</span>
                            </>
                          ) : null}
                        </Detail>
                        <Detail label="Payment">
                          {payment ? (
                            <span className={cn('text-sm font-medium', AMOUNT_TONE[payment.tone])}>{payment.label}</span>
                          ) : (
                            '—'
                          )}
                        </Detail>
                        {breakdown ? <Detail label="Line items">{breakdown.charges.length}</Detail> : null}
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Body: the sum, then the charges as a tree ─────────────────── */}
            <div className="min-h-0 flex-1 space-y-6 px-6 pb-6">
              <div>
                {/* One light white card across the full width: the heading and,
                    on the same line, Total − Paid = Remaining. */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-pv-border/70 bg-pv-card px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-pv-muted-fg">Line items</span>
                  {breakdown ? (
                    <p
                      className="flex flex-wrap items-baseline gap-x-2.5 text-lg font-semibold tabular-nums"
                      aria-label={`Total ${money(breakdown.total)}, paid ${money(breakdown.paid)}, remaining ${money(owes)}`}
                    >
                      <span title="Total">{money(breakdown.total)}</span>
                      <span aria-hidden className="font-normal text-pv-muted-fg/60">
                        −
                      </span>
                      <span title="Paid">{money(breakdown.paid)}</span>
                      <span aria-hidden className="font-normal text-pv-muted-fg/60">
                        =
                      </span>
                      <span
                        title="Remaining"
                        className={owes > EPS ? AMOUNT_TONE[due?.tone ?? breakdown.status.tone] : 'text-pv-muted-fg'}
                      >
                        {money(owes)}
                      </span>
                    </p>
                  ) : (
                    <span className="h-6 w-56 animate-pulse rounded-md bg-pv-muted motion-reduce:animate-none" aria-hidden />
                  )}
                </div>

                {error ? (
                  <p className="text-sm text-pv-danger">We could not load this invoice’s breakdown. Please try again.</p>
                ) : isLoading || !breakdown ? (
                  <div aria-busy className="ml-1.5 flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-9 animate-pulse rounded-md bg-pv-muted/70 motion-reduce:animate-none" />
                    ))}
                  </div>
                ) : breakdown.charges.length === 0 ? (
                  <p className="text-sm text-pv-muted-fg">No charges recorded on this rental yet.</p>
                ) : (
                  <ul className="ml-1.5">
                    {breakdown.charges.map((charge, ci) => (
                      <ChargeNode
                        key={charge.id}
                        charge={charge}
                        last={ci === breakdown.charges.length - 1}
                        invoiceDay={invoiceDay}
                        open={openCharge === charge.id}
                        onToggle={() => setOpenCharge((prev) => (prev === charge.id ? null : charge.id))}
                        money={money}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ── Pinned under the body: the three facts as pills, the date right ── */}
            <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-pv-border bg-pv-card/90 px-6 py-3 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone="muted">{entity}</Pill>
                {payment ? <Pill tone={payment.tone}>{payment.label}</Pill> : null}
                {due ? <Pill tone={due.tone}>{due.label}</Pill> : null}
              </div>
              <span className="shrink-0 text-xs text-pv-muted-fg">
                Issued {format(parseDateOnly(shown.invoiceDate.slice(0, 10)), 'MMM d, yyyy')}
              </span>
            </div>
          </>
        ) : (
          <SheetTitle className="sr-only">Invoice</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** One line of the bill: closed by default; open, its payments and the sum under them. */
function ChargeNode({
  charge,
  last,
  invoiceDay,
  open,
  onToggle,
  money,
}: {
  charge: BreakdownCharge;
  last: boolean;
  invoiceDay: string | null;
  open: boolean;
  onToggle: () => void;
  money: (n: number) => string;
}) {
  const chargeDay = charge.entryDate?.slice(0, 10) ?? null;
  const showDate = !!chargeDay && chargeDay !== invoiceDay;
  const summary =
    charge.remaining > EPS ? `${charge.state.label} · ${money(charge.remaining)} remaining` : charge.state.label;
  const hasPayments = charge.payments.length > 0;
  // Something to add up under the rule: payments, or money settled without one we can show.
  const hasSum = hasPayments || charge.paid > EPS;

  return (
    <li className={treeNode(last, '18px')}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${charge.label}, ${money(charge.amount)}, ${summary}`}
        title={summary}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="group flex h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm outline-none hover:bg-pv-muted/50 focus-visible:ring-2 focus-visible:ring-pv-ring/50"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-pv-muted-fg transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="flex min-w-0 flex-1 items-center">
          <span className="truncate">
            {charge.label}
            {showDate ? (
              <span className="ml-2 text-xs tabular-nums text-pv-muted-fg">{format(parseDateOnly(chargeDay!), 'MMM d')}</span>
            ) : null}
          </span>
        </span>
        <span
          className={cn(
            'w-28 shrink-0 text-right font-medium tabular-nums',
            // Open with payments, the sum's answer (Remaining) carries the
            // colour and this figure is just its first line.
            open && hasSum ? 'text-pv-fg' : AMOUNT_TONE[charge.state.tone],
          )}
        >
          {money(charge.amount)}
        </span>
      </div>

      {open ? (
        <ul className="ml-3.5 pb-5">
          {!hasSum ? (
            <li className={treeNode(true, '16px')}>
              <p className="flex h-8 items-center px-1.5 text-xs text-pv-muted-fg">No payments toward this charge yet.</p>
            </li>
          ) : (
            <>
              {charge.payments.map((p) => (
                <PaymentNode key={p.key} payment={p} money={money} />
              ))}
              {/* Under the rule: what was PAID and kept on this charge, then what REMAINS. */}
              <li className={treeNode(false, '16px')}>
                <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-xs text-pv-muted-fg">
                    Paid
                    {charge.refunded > EPS ? (
                      <span className={V2_LIST_TONES.danger}>{` · ${money(charge.refunded)} refunded`}</span>
                    ) : null}
                  </span>
                  <span className="w-28 shrink-0 border-t border-pv-fg/30 pt-1 text-right font-medium tabular-nums">
                    {money(charge.paid)}
                  </span>
                </div>
              </li>
              <li className={treeNode(true, '16px')}>
                <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-xs text-pv-muted-fg">Remaining</span>
                  <span
                    className={cn(
                      'w-28 shrink-0 text-right font-semibold tabular-nums',
                      charge.remaining > EPS ? AMOUNT_TONE[charge.state.tone] : V2_LIST_TONES.success,
                    )}
                  >
                    {money(charge.remaining)}
                  </span>
                </div>
              </li>
            </>
          )}
        </ul>
      ) : null}
    </li>
  );
}

/** A payment applied to a charge, and under it any refund of it. */
function PaymentNode({ payment: p, money }: { payment: BreakdownPayment; money: (n: number) => string }) {
  const when = p.paidAt ?? p.paymentDate;
  return (
    <li className={treeNode(false, '16px')}>
      <div className="flex h-8 items-center gap-3 px-1.5 text-sm">
        <span className="min-w-0 flex-1 truncate text-pv-muted-fg">
          {p.label}
          {p.split ? ` · of a ${money(p.whole)} payment` : ''}
          {when ? ` · ${format(toDate(when), 'MMM d')}` : ''}
          {p.statusWord ? (
            <span className={cn('ml-2 text-xs font-medium', V2_LIST_TONES.warning)}>{p.statusWord}</span>
          ) : null}
        </span>
        <span
          className={cn('w-28 shrink-0 text-right font-medium tabular-nums', p.landed ? 'text-pv-fg' : 'text-pv-muted-fg')}
        >
          {p.landed ? (
            <span aria-hidden className="mr-1 text-pv-muted-fg">
              +
            </span>
          ) : null}
          {money(p.applied)}
        </span>
      </div>
      {p.refund ? (
        <div className="flex h-7 items-center gap-3 px-1.5 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-3 text-pv-muted-fg">
            <CornerDownRight aria-hidden className="size-3 shrink-0 text-pv-muted-fg/60" />
            <span className="truncate">
              {p.refund.toCard ? 'Refund · to card' : 'Refund'}
              {p.split ? ` · of a ${money(p.refund.whole)} refund` : ''}
              {p.refund.date ? ` · ${format(toDate(p.refund.date), 'MMM d')}` : ''}
              {p.refund.pending ? (
                <span className={cn('ml-2 text-xs font-medium', V2_LIST_TONES.warning)}>Processing</span>
              ) : null}
            </span>
          </span>
          <span className={cn('w-28 shrink-0 text-right font-medium tabular-nums', V2_LIST_TONES.danger)}>
            <span aria-hidden className="mr-1">
              −
            </span>
            {money(p.refund.amount)}
            <span className="sr-only"> refunded</span>
          </span>
        </div>
      ) : null}
    </li>
  );
}
