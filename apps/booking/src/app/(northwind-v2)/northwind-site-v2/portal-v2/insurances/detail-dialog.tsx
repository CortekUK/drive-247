'use client';

/**
 * One insurance, whole. The table keeps one fact per cell; everything that
 * does not fit there lands here — the full policy number, the rental it is
 * filed with, when it was uploaded or issued, the file, the coverages bought
 * (owner, Oct 22 2026: "if the row gets too wide, move detail into the dialog").
 * Opened by clicking the row or by View in the row menu.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { formatTimestamp } from '@nw/components/portal/format';
import { Button } from '@nw/components/ui/button';
import type { CustomerInsurancePolicy } from '@nw/hooks/use-customer-documents';
import { cn } from '@nw/lib/utils';
import { V2_LIST_TONES } from '@portal-v2-shared/list-styles';

import { PvDialogContent } from './_components/kit';
import { BonzahLogo, shortDate, type InsuranceRow } from './_components/rows';

function formatSize(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 bg-pv-card px-4 py-3', wide && 'sm:col-span-2')}>
      <dt className="text-xs text-pv-muted-fg">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-pv-fg">{children}</dd>
    </div>
  );
}

const Blank = () => <span className="font-normal text-pv-muted-fg">—</span>;

export function InsuranceDetailDialog({
  row,
  onOpenChange,
  onDownloadDocument,
  onDownloadPolicy,
  onDelete,
  downloading,
}: {
  /** Null closes the dialog. */
  row: InsuranceRow | null;
  onOpenChange: (open: boolean) => void;
  onDownloadDocument: () => void;
  onDownloadPolicy: (entry: CustomerInsurancePolicy['pdfIds'][number]) => void;
  onDelete: () => void;
  downloading: boolean;
}) {
  const doc = row?.kind === 'upload' ? row.document : null;
  const policy = row?.kind === 'bonzah' ? row.policy : null;
  const pdfs = policy?.pdfIds ?? [];

  return (
    <DialogPrimitive.Root open={row !== null} onOpenChange={onOpenChange}>
      <PvDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {row ? (
          <>
            <div className="flex flex-col gap-2 pr-10">
              <div className="flex min-w-0 items-center gap-2.5">
                <DialogPrimitive.Title className="min-w-0 truncate text-xl font-semibold tracking-[-0.02em] text-pv-fg">
                  {row.name}
                </DialogPrimitive.Title>
                {row.kind === 'bonzah' ? <BonzahLogo /> : null}
              </div>
              <DialogPrimitive.Description className="text-sm text-pv-muted-fg">
                <span className={cn('font-medium', V2_LIST_TONES[row.status.tone])}>{row.status.label}</span>
                {row.kind === 'upload' ? ' · Uploaded by you' : ' · Bought with your booking'}
              </DialogPrimitive.Description>
            </div>

            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-pv-border ring-1 ring-pv-border sm:grid-cols-2">
              <Fact label="Provider">{row.provider ?? <Blank />}</Fact>
              <Fact label="Policy number">
                {row.policyNumber ? (
                  <span className="break-all tabular-nums">{row.policyNumber}</span>
                ) : row.kind === 'bonzah' ? (
                  <span className="font-normal text-pv-muted-fg">Pending</span>
                ) : (
                  <Blank />
                )}
              </Fact>
              <Fact label="Cover starts">{shortDate(row.start) ?? <Blank />}</Fact>
              <Fact label="Cover ends">{shortDate(row.end) ?? <Blank />}</Fact>
              <Fact label="Rental">
                {row.booking ? (
                  <Link href={`/portal/rentals/${row.booking.id}`} className="text-pv-primary hover:underline">
                    {row.booking.reference}
                  </Link>
                ) : (
                  <span className="font-normal text-pv-muted-fg">Not linked to a rental</span>
                )}
              </Fact>
              <Fact label={row.kind === 'upload' ? 'Uploaded' : 'Issued'}>
                {formatTimestamp(row.addedAt) ?? <Blank />}
              </Fact>
              {doc ? (
                <Fact label="File" wide>
                  {doc.fileName ? (
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate" title={doc.fileName}>
                        {doc.fileName}
                      </span>
                      {formatSize(doc.fileSize) ? (
                        <span className="shrink-0 text-xs font-normal text-pv-muted-fg">{formatSize(doc.fileSize)}</span>
                      ) : null}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </Fact>
              ) : null}
              {policy ? (
                <Fact label="Cover" wide>
                  {policy.coverages.length > 0 ? policy.coverages.join(', ') : <Blank />}
                </Fact>
              ) : null}
            </dl>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {doc?.canDelete ? (
                <Button
                  type="button"
                  variant="brand-ghost"
                  className="h-11 px-5 text-pv-danger hover:bg-pv-danger-light hover:text-pv-danger sm:mr-auto"
                  onClick={onDelete}
                >
                  Delete
                </Button>
              ) : null}
              {doc ? (
                <Button
                  type="button"
                  variant="brand"
                  className="h-11 px-5"
                  disabled={!doc.storagePath || downloading}
                  onClick={onDownloadDocument}
                >
                  {downloading ? 'Downloading…' : 'Download'}
                </Button>
              ) : pdfs.length === 0 ? (
                <p className="self-center text-[13px] text-pv-muted-fg">The policy PDF is not ready yet.</p>
              ) : (
                pdfs.map((entry) => (
                  <Button
                    key={entry.coverage}
                    type="button"
                    variant={pdfs.length === 1 ? 'brand' : 'brand-outline'}
                    className="h-11 px-5"
                    disabled={downloading}
                    onClick={() => onDownloadPolicy(entry)}
                  >
                    {pdfs.length === 1 ? (downloading ? 'Downloading…' : 'Download policy') : `Download ${entry.label}`}
                  </Button>
                ))
              )}
            </div>
          </>
        ) : null}
      </PvDialogContent>
    </DialogPrimitive.Root>
  );
}
