import type { BonzahPolicyStatus } from '@drive247/shared-types';

const STYLES: Record<string, string> = {
  quoted: 'text-[#737373]',
  payment_pending: 'text-[#d97706]',
  active: 'text-[#16a34a]',
  insufficient_balance: 'text-[#dc2626]',
  failed: 'text-[#dc2626]',
  cancelled: 'text-[#737373] line-through',
};

const LABELS: Record<string, string> = {
  quoted: 'Quoted',
  payment_pending: 'Payment pending',
  active: 'Active',
  insufficient_balance: 'Insufficient balance',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function PolicyStatusBadge({
  status,
}: {
  status: BonzahPolicyStatus | string;
}) {
  return (
    <span className={`text-sm font-medium ${STYLES[status] ?? ''}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
