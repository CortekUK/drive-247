'use client';

/**
 * One invoice, itemised.
 *
 * A sheet rather than a route: an invoice has no life of its own away from the
 * list, and a `/portal/payments/[invoiceId]` route would put a document id in
 * the URL — the one thing `use-customer-payments.ts` is careful never to trust.
 * Everything shown here came out of a query already scoped to this customer.
 */

import Link from 'next/link';
import { ArrowRight, FileText } from 'lucide-react';

import { formatDate } from '@/components/portal/format';
import { StatusChip } from '@/components/portal/status-chip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CustomerInvoice } from '@/hooks/use-customer-payments';
import { useTenantBranding } from '@/hooks/use-tenant-branding';

import { INVOICE_CHIP } from './invoice-state';

export function InvoiceSheet({
  invoice,
  onOpenChange,
}: {
  invoice: CustomerInvoice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { formatCurrency } = useTenantBranding();

  // The sheet stays mounted with `open={false}` between selections so Radix can
  // play its close animation; the body is skipped when there is nothing to show.
  const chip = invoice ? INVOICE_CHIP[invoice.state] : null;

  return (
    <Sheet open={invoice !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto border-brand-border-soft bg-brand-card p-0 shadow-none sm:max-w-md"
      >
        {invoice && chip ? (
          <>
            <SheetHeader className="gap-1.5 border-b border-brand-border-soft px-5 py-5">
              <SheetTitle className="flex items-center gap-2 pr-8 text-base font-medium text-brand-text">
                <FileText
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-4 shrink-0 text-brand-text-subtle"
                />
                <span className="min-w-0 break-all">{invoice.number}</span>
              </SheetTitle>
              <SheetDescription className="text-sm text-brand-text-soft">
                Issued {formatDate(invoice.invoiceDate) ?? invoice.invoiceDate}
                {invoice.rental?.vehicle
                  ? ` · ${invoice.rental.vehicle.displayName}`
                  : ''}
              </SheetDescription>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                {invoice.dueDate && invoice.state !== 'cancelled' ? (
                  <span
                    className={
                      invoice.state === 'overdue'
                        ? 'text-xs font-medium text-danger'
                        : 'text-xs text-brand-text-subtle'
                    }
                  >
                    {invoice.state === 'paid' ? 'Was due ' : 'Due '}
                    {formatDate(invoice.dueDate)}
                  </span>
                ) : null}
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-5 py-5">
              {/* ── The bill ─────────────────────────────────────────────── */}
              <section className="rounded-[14px] border border-brand-border-soft">
                <div className="flex flex-col gap-2.5 px-4 py-3.5">
                  {invoice.lines.length > 0 ? (
                    invoice.lines.map((line) => (
                      <Row
                        key={line.key}
                        label={line.label}
                        value={formatCurrency(line.amount)}
                      />
                    ))
                  ) : (
                    <Row
                      label="Rental"
                      value={formatCurrency(invoice.subtotal)}
                    />
                  )}
                </div>

                <div className="flex flex-col gap-2.5 border-t border-brand-border-soft px-4 py-3.5">
                  <Row label="Subtotal" value={formatCurrency(invoice.subtotal)} />
                  {invoice.tax > 0 ? (
                    <Row label="Tax" value={formatCurrency(invoice.tax)} />
                  ) : null}
                </div>

                <div className="flex items-baseline justify-between gap-4 border-t border-brand-border-soft px-4 py-3.5">
                  <span className="text-sm font-medium text-brand-text">Total</span>
                  <span className="text-lg font-medium tabular-nums text-brand-text">
                    {formatCurrency(invoice.total)}
                  </span>
                </div>
              </section>

              {/* ── What has been paid against it ────────────────────────── */}
              {invoice.state === 'cancelled' ? (
                <p className="text-sm leading-relaxed text-brand-text-soft">
                  This booking was cancelled, so nothing is owed on this invoice.
                  It is kept here as a record of what had been billed.
                </p>
              ) : (
                <section className="flex flex-col gap-2.5 rounded-[14px] border border-brand-border-soft px-4 py-3.5">
                  <Row label="Paid" value={formatCurrency(invoice.paid)} />
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-brand-text-soft">Outstanding</span>
                    <span
                      className={
                        invoice.outstanding > 0
                          ? 'text-sm font-medium tabular-nums text-brand-text'
                          : 'text-sm font-medium tabular-nums text-success'
                      }
                    >
                      {formatCurrency(invoice.outstanding)}
                    </span>
                  </div>
                </section>
              )}

              {/* ── Back to the booking it bills ─────────────────────────── */}
              {invoice.rental ? (
                <Link
                  href={`/portal/bookings/${invoice.rental.id}`}
                  className="flex min-h-11 items-center gap-3 rounded-[14px] border border-brand-border-soft px-4 py-3 transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-brand-text">
                      {invoice.rental.reference}
                    </span>
                    <span className="truncate text-xs text-brand-text-subtle">
                      See the full booking
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    strokeWidth={1.75}
                    className="ml-auto size-4 shrink-0 text-brand-text-subtle"
                  />
                </Link>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-brand-text-soft">{label}</span>
      <span className="text-sm tabular-nums text-brand-text">{value}</span>
    </div>
  );
}
