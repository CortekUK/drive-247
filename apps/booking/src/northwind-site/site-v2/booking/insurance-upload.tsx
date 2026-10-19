'use client';

/**
 * Northwind booking site v2 — STEP TWO of the post-payment errand: the
 * insurance document. v2 of `components/booking/insurance-upload.tsx` (same
 * exported names and props).
 *
 * Markup only. The tray, the dedupe, per-file states, readiness and the send
 * are `use-insurance-upload.ts`, shared with v1. It is a file picker with
 * drag-and-drop and no `capture` anywhere: an insurance certificate is usually
 * a PDF already in the customer's inbox. Nothing on a success path says
 * "confirmed" — an operator still reviews it.
 */

import { useRef, useState } from 'react';
import { CircleCheck, FileText, Loader2, ShieldCheck, Upload, X } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import {
  useInsuranceUpload,
  type InsurancePick,
  type InsuranceUploadHandle,
} from '@nw/components/booking/use-insurance-upload';
import {
  INSURANCE_ACCEPT_ATTRIBUTE,
  INSURANCE_FORMATS_LABEL,
  type BookingDocumentsSession,
  type InsuranceFileState,
} from '@nw/hooks/use-booking-documents';
import { StatusChip } from '@nw/portal-v2/status-chip';
import { cn } from '@nw/lib/utils';

import { DropPanel, ProblemBox, StepCard, ToneTile, formatSize } from './documents-shared';

export type { InsuranceUploadHandle };

export function InsuranceUpload({
  token,
  session,
  alreadySubmitted,
  stepLabel,
  onSubmitted,
  onReadyChange,
  ref,
}: {
  token: string;
  session: BookingDocumentsSession;
  /** True when the server says this booking already has an insurance file. */
  alreadySubmitted: boolean;
  /** 'Step 2 of 2' — the OUTER progress, owned by the shell. */
  stepLabel: string;
  /** Fires only after the server has filed the documents. */
  onSubmitted: (count: number) => void;
  /** Whether there is at least one file to send. Drives the shell's button. */
  onReadyChange: (ready: boolean) => void;
  ref?: React.Ref<InsuranceUploadHandle>;
}) {
  const { picks, problem, busy, storedCount, add, remove } = useInsuranceUpload({
    token,
    session,
    alreadySubmitted,
    onSubmitted,
    onReadyChange,
    ref,
  });

  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <StepCard
      icon={ShieldCheck}
      title={alreadySubmitted ? 'Send another insurance document' : 'Your insurance document'}
      description="Your certificate or declarations page — ideally the page with your coverage limits and deductibles. Send several files if your policy runs to more than one page."
      chip={
        <StatusChip tone={picks.length > 0 ? 'success' : 'neutral'}>
          {picks.length > 0
            ? `${stepLabel} · ${picks.length} ${picks.length === 1 ? 'file' : 'files'}`
            : stepLabel}
        </StatusChip>
      }
    >
      <div className="flex flex-col gap-4">
        <DropPanel
          active={dragActive}
          disabled={busy}
          onDragState={setDragActive}
          onFiles={add}
          className="flex flex-col items-center gap-3 px-6 py-8 text-center"
        >
          <ToneTile icon={Upload} />
          <p className="text-sm text-pv-fg">Drop your files here, or choose them from your device.</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INSURANCE_ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              add(event.target.files);
              // Cleared so choosing the SAME file again still fires onChange.
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="brand"
            className="h-11 px-5"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose files
          </Button>
          <p className="text-xs text-pv-muted-fg">{INSURANCE_FORMATS_LABEL}</p>
        </DropPanel>

        {picks.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {picks.map((pick) => (
              <FileRow key={pick.key} pick={pick} busy={busy} onRemove={remove} />
            ))}
          </ul>
        ) : null}

        {/* Files sent out of files chosen: the one progress number we know. */}
        {busy ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs text-pv-muted-fg">
              <span>Sending your files</span>
              <span className="tabular-nums">
                {storedCount} of {picks.length}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={picks.length}
              aria-valuenow={storedCount}
              className="h-1.5 w-full overflow-hidden rounded-full bg-pv-muted"
            >
              <div
                className="h-full rounded-full bg-pv-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${picks.length === 0 ? 0 : (storedCount / picks.length) * 100}%` }}
              />
            </div>
            <p className="text-xs leading-relaxed text-pv-muted-fg">Please keep this page open until it finishes.</p>
          </div>
        ) : null}

        {problem ? <ProblemBox message={problem} /> : null}

        <p className="text-xs leading-relaxed text-pv-muted-fg">
          Your documents are stored against this booking and seen only by{' '}
          {session.tenant.companyName ?? 'the rental company'}.
        </p>
      </div>
    </StepCard>
  );
}

/** One chosen file: what it is, how big, where it has got to, and a way out. */
function FileRow({
  pick,
  busy,
  onRemove,
}: {
  pick: InsurancePick;
  busy: boolean;
  onRemove: (key: string) => void;
}) {
  const status: Record<InsuranceFileState, { label: string; className: string }> = {
    queued: { label: formatSize(pick.file.size), className: 'text-pv-muted-fg' },
    uploading: { label: 'Sending…', className: 'text-pv-muted-fg' },
    stored: { label: 'Sent', className: 'text-pv-success' },
    failed: { label: 'Did not send', className: 'text-pv-danger' },
  };
  const shown = status[pick.state];

  return (
    <li className="pv2-enter flex items-center gap-3 rounded-2xl border border-pv-border bg-pv-card py-2 pl-3 pr-1.5">
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-xl',
          pick.state === 'stored' ? 'bg-pv-success-light text-pv-success' : 'bg-pv-tint text-pv-primary',
        )}
      >
        {pick.state === 'uploading' ? (
          <Loader2 aria-hidden strokeWidth={1.75} className="size-4 animate-spin" />
        ) : pick.state === 'stored' ? (
          <CircleCheck aria-hidden strokeWidth={1.75} className="size-4" />
        ) : (
          <FileText aria-hidden strokeWidth={1.75} className="size-4" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-pv-fg">{pick.file.name}</span>
        <span className={cn('block truncate text-xs', pick.error ? 'text-pv-danger' : shown.className)}>
          {pick.error ?? shown.label}
        </span>
      </span>

      <Button
        type="button"
        variant="brand-ghost"
        aria-label={`Remove ${pick.file.name}`}
        className="size-11 shrink-0 p-0"
        disabled={busy}
        onClick={() => onRemove(pick.key)}
      >
        <X aria-hidden className="size-4" />
      </Button>
    </li>
  );
}
