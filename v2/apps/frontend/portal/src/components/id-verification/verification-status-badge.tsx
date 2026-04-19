import { IdVerificationStatus } from '@drive247/shared-types';

const STYLES: Record<string, string> = {
  initiated: 'text-[#737373]',
  in_progress: 'text-[#2563eb]',
  processing: 'text-[#2563eb]',
  approved: 'text-[#16a34a]',
  rejected: 'text-[#dc2626]',
  review_required: 'text-[#d97706]',
  expired: 'text-[#737373] line-through',
  cancelled: 'text-[#737373] line-through',
};

const LABELS: Record<string, string> = {
  initiated: 'Initiated',
  in_progress: 'In progress',
  processing: 'Processing',
  approved: 'Approved',
  rejected: 'Rejected',
  review_required: 'Review required',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

export function VerificationStatusBadge({
  status,
}: {
  status: IdVerificationStatus | string | null;
}) {
  if (!status) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <span className={`text-sm font-medium ${STYLES[status] ?? ''}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
