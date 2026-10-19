'use client';

/**
 * The tenant page's Subscription card: the billing controls and figures on
 * top (`top`), then the payments trail — every platform invoice, newest
 * first, one line each. The card fills whatever height the page leaves it
 * and the trail scrolls inside it.
 *
 * InvoiceStatusBadge is the one reading of an invoice's state — the Manage
 * Plans dialog's invoice table uses it too.
 */

import type { ReactNode } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export interface TrailInvoice {
  id: string;
  invoice_number: string | null;
  invoice_date?: string | null;
  created_at: string;
  amount_due: number;
  amount_refunded?: number | null;
  currency: string;
  status: string;
  attempt_count?: number | null;
  dispute_status?: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf: string | null;
}

/**
 * Stripe leaves a DECLINED invoice at status 'open', identical to one nobody
 * has attempted yet, so attempt_count is what tells a failed payment from
 * money simply not due.
 */
export function InvoiceStatusBadge({ invoice }: { invoice: TrailInvoice }) {
  const attempts = invoice.attempt_count ?? 0;
  const refunded = (invoice.amount_refunded ?? 0) > 0;
  if (invoice.dispute_status) return <Badge variant="destructive">Disputed</Badge>;
  if (invoice.status === 'paid') {
    return refunded ? <Badge variant="warning">Refunded</Badge> : <Badge variant="success">Paid</Badge>;
  }
  if (invoice.status === 'open') {
    return attempts > 0
      ? <Badge variant="destructive">Payment failed</Badge>
      : <Badge variant="warning">Not yet due</Badge>;
  }
  if (invoice.status === 'uncollectible') return <Badge variant="destructive">Written off</Badge>;
  if (invoice.status === 'void') return <Badge variant="secondary">Voided</Badge>;
  if (invoice.status === 'draft') return <Badge variant="secondary">Draft</Badge>;
  return <Badge variant="secondary" className="capitalize">{invoice.status}</Badge>;
}

const ROW_H = 44;

const MOCK_INVOICES: TrailInvoice[] = [
  ['2026-10-01', 'paid', 0, 0], ['2026-09-01', 'open', 2, 0], ['2026-08-01', 'paid', 0, 0],
  ['2026-07-01', 'paid', 0, 4900], ['2026-06-01', 'paid', 0, 0], ['2026-05-01', 'paid', 0, 0],
  ['2026-04-01', 'void', 0, 0], ['2026-03-01', 'paid', 0, 0], ['2026-02-01', 'paid', 0, 0],
  ['2026-01-01', 'paid', 0, 0], ['2025-12-01', 'paid', 0, 0], ['2025-11-01', 'paid', 0, 0],
].map(([date, status, attempts, refunded], i) => ({
  id: `mock-${i}`,
  invoice_number: `D247-${String(1012 - i).padStart(4, '0')}`,
  invoice_date: date as string,
  created_at: date as string,
  amount_due: 19900,
  amount_refunded: refunded as number,
  currency: 'usd',
  status: status as string,
  attempt_count: attempts as number,
  stripe_hosted_invoice_url: 'https://dashboard.stripe.com/test/invoices',
  stripe_invoice_pdf: 'https://dashboard.stripe.com/test/invoices',
}));

const ROW_ICON =
  'inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors ' +
  'hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-primary/30';

function TrailRow({
  invoice,
  formatCurrency,
  formatDate,
}: {
  invoice: TrailInvoice;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string | null) => string;
}) {
  const refunded = invoice.amount_refunded ?? 0;
  return (
    <tr style={{ height: ROW_H }} className="border-b border-border/60 last:border-b-0">
      <td className="pr-4 tabular-nums text-muted-foreground">{formatDate(invoice.invoice_date || invoice.created_at)}</td>
      <td className="truncate pr-4 text-muted-foreground">{invoice.invoice_number || '\u2014'}</td>
      <td className="pr-6 text-right font-medium tabular-nums text-foreground">
        {refunded > 0 && (
          <span className="mr-1.5 text-xs font-normal text-orange-600">&minus;{formatCurrency(refunded, invoice.currency)}</span>
        )}
        {formatCurrency(invoice.amount_due, invoice.currency)}
      </td>
      <td>
        <InvoiceStatusBadge invoice={invoice} />
      </td>
      <td>
        {/* Always both, so every row ends the same; greyed when Stripe gave
            no link for it. */}
        <div className="-mr-1.5 flex items-center justify-end gap-0.5">
          <InvoiceLink href={invoice.stripe_hosted_invoice_url} label="Open in Stripe">
            <ExternalLink className="size-4" />
          </InvoiceLink>
          <InvoiceLink href={invoice.stripe_invoice_pdf} label="Download invoice">
            <Download className="size-4" />
          </InvoiceLink>
        </div>
      </td>
    </tr>
  );
}

function InvoiceLink({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  if (!href) {
    return (
      <span aria-hidden="true" className={`${ROW_ICON} pointer-events-none opacity-30`}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={ROW_ICON}>
      {children}
    </a>
  );
}

export function SubscriptionTrail({
  invoices,
  top,
  formatCurrency,
  formatDate,
}: {
  invoices: TrailInvoice[];
  /** The billing figures above the trail, inside the card. */
  top: ReactNode;
  formatCurrency: (amount: number, currency: string) => string;
  formatDate: (date: string | null) => string;
}) {
  // MOCK (Ghulam, Oct 18 2026): a tenant with no invoices shows sample lines
  // so the trail can be reviewed. Delete with MOCK_INVOICES once signed off.
  const trail = invoices.length > 0 ? invoices : MOCK_INVOICES;

  return (
    <section className="mt-4 flex min-h-0 flex-1 flex-col gap-1.5">
      <h2 className="shrink-0 px-1 text-base font-semibold tracking-tight">Subscription</h2>
    <Card className="flex min-h-0 flex-1 flex-col p-5 pb-2">
      <div className="shrink-0">{top}</div>
      <div className="mt-3 shrink-0 border-t border-border/60" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {trail.length === 0 ? (
          <p className="pt-3 text-sm text-muted-foreground">No subscription payments yet.</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-32" />
              <col />
              <col className="w-44" />
              <col className="w-36" />
              <col className="w-20" />
            </colgroup>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground [&>th]:h-9 [&>th]:font-medium">
                <th className="pr-4">Date</th>
                <th className="pr-4">Invoice</th>
                <th className="pr-6 text-right">Amount</th>
                <th>Status</th>
                <th><span className="sr-only">Links</span></th>
              </tr>
            </thead>
            <tbody>
              {trail.map((inv) => (
                <TrailRow key={inv.id} invoice={inv} formatCurrency={formatCurrency} formatDate={formatDate} />
              ))}
            </tbody>
          </table>
        )}
      </div>

    </Card>
    </section>
  );
}
