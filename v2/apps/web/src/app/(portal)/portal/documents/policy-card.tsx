'use client';

/**
 * One Bonzah policy the customer bought with a booking.
 *
 * Read-only by design: the policy is issued by the insurer, not held by us, so
 * there is nothing here to edit or remove. The only action is fetching the
 * per-coverage PDF, and that goes through the `bonzah-download-pdf` edge
 * function because the document lives on Bonzah's side, not in our storage.
 */

import { Download, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { formatDate, formatTimestamp } from '@/components/portal/format';
import { StatusChip } from '@/components/portal/status-chip';
import { Button } from '@/components/ui/button';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import type { CustomerInsurancePolicy, PolicyStatus } from '@/hooks/use-customer-documents';

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
    <article className="flex gap-3.5 border-b border-brand-border-soft p-4 last:border-b-0 sm:gap-4 sm:px-5">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-success-light"
      >
        <ShieldCheck strokeWidth={1.75} className="size-5 text-success" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-brand-text sm:text-base">
            {policy.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-brand-text-subtle">
            {policy.booking
              ? `Booking ${policy.booking.reference}`
              : 'Not linked to a booking'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={chip.tone}>{label}</StatusChip>
          {policy.coverages.map((coverage) => (
            <StatusChip key={coverage} tone="neutral">
              {coverage}
            </StatusChip>
          ))}
        </div>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-brand-text-subtle">Cover</dt>
            <dd className="truncate text-sm text-brand-text">
              {formatDate(policy.startDate)} – {formatDate(policy.endDate)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-brand-text-subtle">Premium</dt>
            <dd className="truncate text-sm tabular-nums text-brand-text">
              {formatCurrency(policy.premium)}
            </dd>
          </div>
          {policy.policyNumber ? (
            <div className="min-w-0">
              <dt className="text-xs text-brand-text-subtle">Policy number</dt>
              <dd className="truncate text-sm text-brand-text">{policy.policyNumber}</dd>
            </div>
          ) : null}
        </dl>

        {issued ? (
          <p className="text-xs text-brand-text-subtle">Issued {issued}</p>
        ) : null}

        {/*
          Actions, all at h-11. The booking link lives here rather than inline
          in the subtitle for the same reason it does on `DocumentCard`: it
          navigates, so it has to be thumb-sized.
        */}
        {policy.pdfIds.length > 0 || policy.booking ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {policy.booking ? (
              <Button asChild variant="brand-ghost" className="h-11">
                <Link href={`/portal/bookings/${policy.booking.id}`}>
                  View booking
                </Link>
              </Button>
            ) : null}
            {policy.pdfIds.map((entry) => {
              const busy = downloadingKey === `${policy.id}:${entry.coverage}`;
              return (
                <Button
                  key={entry.coverage}
                  type="button"
                  variant="brand-outline"
                  className="h-11"
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

        {policy.pdfIds.length === 0 && policy.status === 'active' ? (
          <p className="text-xs text-brand-text-subtle">
            Your policy documents are not available to download yet.
          </p>
        ) : null}
      </div>
    </article>
  );
}
