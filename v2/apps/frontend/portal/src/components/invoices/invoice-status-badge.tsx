import type { InvoiceStatus } from '@drive247/shared-types';

const STYLES: Record<string, string> = {
  draft: 'text-[#737373]',
  partially_paid: 'text-[#d97706]',
  paid: 'text-[#16a34a]',
  overdue: 'text-[#dc2626]',
  void: 'text-[#737373] line-through',
  refunded: 'text-[#2563eb]',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
  refunded: 'Refunded',
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus | string }) {
  return (
    <span className={`text-sm font-medium ${STYLES[status] ?? ''}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
