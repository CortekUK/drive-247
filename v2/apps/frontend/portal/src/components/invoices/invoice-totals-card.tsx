'use client';

import { Card, CardContent, CardHeader, CardTitle, Separator } from '@drive247/ui';
import { formatCents } from '@/lib/money';
import type { InvoiceDetail } from '@drive247/shared-types';

export function InvoiceTotalsCard({ invoice }: { invoice: InvoiceDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Totals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row label="Subtotal" value={formatCents(invoice.subtotal)} />
        {invoice.discountAmount > 0 && (
          <Row
            label="Discount"
            value={`− ${formatCents(invoice.discountAmount)}`}
          />
        )}
        <Row
          label={`${invoice.taxLabel} (${Number(invoice.taxRate)}%${invoice.taxInclusive ? ', incl.' : ''})`}
          value={formatCents(invoice.taxAmount)}
        />
        <Separator />
        <Row label="Total" value={formatCents(invoice.totalAmount)} bold />
        <Row label="Paid" value={formatCents(invoice.amountPaid)} />
        <Row
          label="Amount due"
          value={formatCents(invoice.amountDue)}
          bold
        />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? 'font-medium' : undefined}>{value}</span>
    </div>
  );
}
