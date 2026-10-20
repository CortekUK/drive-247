'use client';

/**
 * One invoice, itemised.
 *
 * A dialog rather than a route: an invoice has no life of its own away from the
 * list, and a `/portal/payments/[invoiceId]` route would put a document id in
 * the URL — the one thing `use-customer-payments.ts` is careful never to trust.
 * Everything shown here came out of a query already scoped to this customer.
 * (It was a side sheet; v2 opens records in dialogs.)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react-nw';

import { formatDate } from '@nw/components/portal/format';
import { Button } from '@nw/components/ui/button';
import type { CustomerInvoice } from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';

import { INVOICE_CHIP } from './invoice-state';
import { StatusText } from './list-table';
import { MoneyRow, RecordDialog } from './record-dialog';

export function InvoiceDialog({
  invoice,
  onOpenChange,
}: {
  invoice: CustomerInvoice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { formatCurrency } = useTenantBranding();

  // Hold on to the last invoice while the dialog plays its 200ms exit, so the
  // body does not blank out mid-animation when the parent clears its selection.
  const [shown, setShown] = useState<CustomerInvoice | null>(invoice);
  useEffect(() => {
    if (invoice) setShown(invoice);
  }, [invoice]);

  const chip = shown ? INVOICE_CHIP[shown.state] : null;

  return (
    <RecordDialog
      open={invoice !== null}
      onOpenChange={onOpenChange}
      title={<span className="break-all">{shown?.number ?? 'Invoice'}</span>}
      description={
        shown
          ? `Issued ${formatDate(shown.invoiceDate) ?? shown.invoiceDate}${
              shown.rental?.vehicle ? ` · ${shown.rental.vehicle.displayName}` : ''
            }`
          : undefined
      }
      status={
        shown && chip ? (
          <>
            <StatusText tone={chip.tone}>{chip.label}</StatusText>
            {shown.dueDate && shown.state !== 'cancelled' ? (
              <span className="text-[13px] text-pv-muted-fg">
                · {shown.state === 'paid' ? 'Was due ' : 'Due '}
                {formatDate(shown.dueDate)}
              </span>
            ) : null}
          </>
        ) : null
      }
      footer={
        shown?.rental ? (
          <Button asChild variant="brand" className="h-11 px-5">
            <Link href={`/portal/rentals/${shown.rental.id}`}>
              See rental {shown.rental.reference}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        ) : null
      }
    >
      {shown ? (
        <div className="flex flex-col gap-4">
          {/* ── The bill ─────────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-2xl border border-pv-border">
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              {shown.lines.length > 0 ? (
                shown.lines.map((line) => (
                  <MoneyRow key={line.key} label={line.label} value={formatCurrency(line.amount)} />
                ))
              ) : (
                <MoneyRow label="Rental" value={formatCurrency(shown.subtotal)} />
              )}
            </div>

            <div className="flex flex-col gap-2.5 border-t border-pv-border px-4 py-3.5">
              <MoneyRow label="Subtotal" value={formatCurrency(shown.subtotal)} />
              {shown.tax > 0 ? <MoneyRow label="Tax" value={formatCurrency(shown.tax)} /> : null}
            </div>

            <div className="border-t border-pv-border bg-pv-tint/60 px-4 py-3.5">
              <MoneyRow label="Total" value={formatCurrency(shown.total)} strong />
            </div>
          </section>

          {/* ── What has been paid against it ──────────────────────────────── */}
          {shown.state === 'cancelled' ? (
            <p className="text-sm leading-relaxed text-pv-muted-fg">
              This booking was cancelled, so nothing is owed on this invoice. It is kept here as a
              record of what had been billed.
            </p>
          ) : (
            <section className="flex flex-col gap-2.5 rounded-2xl border border-pv-border px-4 py-3.5">
              <MoneyRow label="Paid" value={formatCurrency(shown.paid)} />
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-pv-muted-fg">Outstanding</span>
                <span
                  className={
                    shown.outstanding > 0
                      ? 'text-sm font-semibold tabular-nums text-pv-fg'
                      : 'text-sm font-semibold tabular-nums text-pv-success'
                  }
                >
                  {formatCurrency(shown.outstanding)}
                </span>
              </div>
            </section>
          )}
        </div>
      ) : null}
    </RecordDialog>
  );
}
