'use client';

/**
 * One Bonzah policy the customer bought with a booking.
 *
 * Read-only by design: the policy is issued by the insurer, not held by us, so
 * there is nothing here to edit or remove. The only action is fetching the
 * per-coverage PDF, and that goes through the `bonzah-download-pdf` edge
 * function because the document lives on Bonzah's side, not in our storage.
 */

import { Download, Loader2, ShieldCheck } from 'lucide-react-nw';
import Link from 'next/link';

import { formatDate, formatTimestamp } from '@nw/components/portal/format';
import { StatusChip } from '@nw/portal-v2/status-chip';
import { Button } from '@nw/components/ui/button';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import type { CustomerInsurancePolicy, PolicyStatus } from '@nw/hooks/use-customer-documents';

import { IconTile, Meta } from './_components/kit';

const STATUS_CHIP: Record<
  PolicyStatus,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  active: { label: 'Active', tone: 'success' },
  pending: { label: 'Being issued', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  other: { label: 'Unknown', tone: 'neutral' },
};

export function PolicyCard({
  policy,
  downloadingKey,
  onDownloadPdf,
}: {
  policy: CustomerInsurancePolicy;
  downloadingKey: string | null;
  onDownloadPdf: (entry: CustomerInsurancePolicy['pdfIds'][number]) => void;
}) {
  const { formatCurrency } = useTenantBranding();
  // `other` carries the raw status so an unmapped Bonzah state is still named
  // on screen rather than silently rendering as "Unknown".
  const chip = STATUS_CHIP[policy.status];
  const label = policy.status === 'other' ? policy.rawStatus : chip.label;
  const issued = formatTimestamp(policy.issuedAt);

  return (
    <article className="flex flex-col gap-4 px-5 py-5 last:rounded-b-2xl transition-colors duration-200 ease-out hover:bg-pv-row-hover motion-reduce:transition-none sm:flex-row sm:items-start sm:gap-5 sm:px-6">
      <div className="flex min-w-0 flex-1 gap-4">
        <IconTile icon={ShieldCheck} tone="success" />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-pv-fg">{policy.title}</p>
              <StatusChip tone={chip.tone}>{label}</StatusChip>
            </div>
            <p className="mt-1 truncate text-[13px] text-pv-muted-fg">
              {policy.booking ? `Booking ${policy.booking.reference}` : 'Not linked to a booking'}
              {issued ? ` · issued ${issued}` : ''}
            </p>
          </div>

          {policy.coverages.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {policy.coverages.map((coverage) => (
                <StatusChip key={coverage} tone="neutral">
                  {coverage}
                </StatusChip>
              ))}
            </div>
          ) : null}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Meta label="Cover" value={`${formatDate(policy.startDate)} – ${formatDate(policy.endDate)}`} />
            <Meta label="Premium" value={<span className="tabular-nums">{formatCurrency(policy.premium)}</span>} />
            <Meta label="Policy number" value={policy.policyNumber} />
          </dl>

          {policy.pdfIds.length === 0 && policy.status === 'active' ? (
            <p className="text-xs text-pv-muted-fg">Your policy documents are not available to download yet.</p>
          ) : null}
        </div>
      </div>

      {/*
        Actions, all at h-11. The booking link lives here rather than inline in
        the muted line for the same reason it does on `DocumentCard`: it
        navigates, so it has to be thumb-sized.
      */}
      {policy.pdfIds.length > 0 || policy.booking ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-15 sm:max-w-[40%] sm:justify-end sm:pl-0">
          {policy.booking ? (
            <Button asChild variant="brand-ghost" className="h-11 px-4">
              <Link href={`/portal/bookings/${policy.booking.id}`}>View booking</Link>
            </Button>
          ) : null}
          {policy.pdfIds.map((entry) => {
            const busy = downloadingKey === `${policy.id}:${entry.coverage}`;
            return (
              <Button
                key={entry.coverage}
                type="button"
                variant="brand-outline"
                className="h-11 px-4"
                disabled={busy}
                onClick={() => onDownloadPdf(entry)}
              >
                {busy ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Download aria-hidden className="size-4" />
                )}
                {entry.label} policy
              </Button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
