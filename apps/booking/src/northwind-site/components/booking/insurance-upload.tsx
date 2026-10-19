'use client';

/**
 * The screen a customer reaches after paying, and again from the emailed link:
 * SEND US YOUR INSURANCE DOCUMENT.
 *
 * ── WHY THIS IS AN UPLOAD AND NOT A CAMERA FLOW ─────────────────────────────
 * People PHOTOGRAPH a driving licence; they already HAVE an insurance
 * certificate, and it is usually a PDF that arrived by email. So this is a file
 * picker with drag-and-drop, several files at a time, and no `capture`
 * attribute anywhere — pushing a phone camera at someone whose document is a
 * PDF in their inbox is the wrong instrument.
 *
 * Behaviour is v1's insurance dialog
 * (`apps/booking/src/components/insurance-upload-dialog.tsx`): PDF/JPG/PNG,
 * multiple files, name-based dedupe, drag-and-drop, individual remove. Four of
 * its behaviours are deliberately NOT reproduced, each for a reason:
 *
 *  1. It validates 10 MB against a bucket that enforces 5 MB and then swallows
 *     the 413. The limit here is the bucket's real one and every message names
 *     it — see `validateInsuranceFile`.
 *  2. It uploads to a flat, unscoped `insurance/` prefix in a PUBLIC bucket
 *     whose storage policies grant INSERT/UPDATE/DELETE to `public`. The prefix
 *     here is `insurance/<tenantId>/<rentalId>`, and it is issued by the SERVER.
 *  3. It names objects `<Date.now()>-<name>` with `upsert: false`, so every
 *     re-send orphans the previous object forever with nothing pointing at it
 *     and no cleanup anywhere in the repo. Names here are stable and upserted.
 *  4. It reports only the FIRST uploaded path to its caller and clears its
 *     pending-file store every time it opens. All files are reported here.
 *
 * ── THIS IS STEP TWO OF TWO, AND THE OTHER STEP IS NOT IN THIS FILE ─────────
 * The post-payment errand is v1's and collects BOTH things: identity documents
 * and the insurance certificate. The identity capture lives in
 * `identity-capture.tsx`, the shell that sequences the two is
 * `documents-screen.tsx`, and this file is only ever the insurance half.
 *
 * That separation is the whole design, and it is worth stating why, because an
 * earlier build of this screen had them fused and the fusion is what broke:
 *
 *  * The two do not compose into one widget. Identity capture ends in an AI
 *    verdict; an insurance certificate ends in a file sitting in a bucket. One
 *    combined widget served neither.
 *  * They must not share a status column. Identity records its outcome on
 *    `booking_document_links.identity_status`; insurance moves
 *    `rentals.documents_status` / `insurance_status` and nothing else. With one
 *    column and two writers, a rejected licence photo renders "we could not
 *    read your documents" over a perfectly good insurance PDF the customer sent
 *    five minutes earlier.
 *  * The identity session must be minted LAZILY. It caps a customer at ten an
 *    hour and sets `customers.identity_verification_status = 'pending'` as a
 *    side effect, so it is minted when the customer SENDS step one and never on
 *    a page open. Opening this screen still mints nothing at all.
 *
 * ── WHY THE SEND BUTTON IS NO LONGER IN THIS FILE ───────────────────────────
 * The screen now has ONE primary action covering both steps, and it lives in
 * `documents-screen.tsx`. This panel therefore keeps everything about CHOOSING
 * files — the tray, the dedupe, the per-file errors, the progress bar — and
 * gives the shell two things: `onReadyChange` (pushed up, so the one button can
 * be disabled and can say what is missing) and an imperative `submit()` (pulled
 * down when it is pressed). It still owns the mutation, so the ordering rule
 * below is unchanged: `onSubmitted` fires only AFTER the server has come back.
 *
 * ── WHAT THIS SCREEN MAY AND MAY NOT SAY ────────────────────────────────────
 * Uploading does NOT confirm a booking. An operator reviews the document
 * afterwards and can still reject it, and `notify-booking-approved` is the email
 * that carries the word "confirmed". So the words "confirmed" and "complete" do
 * not appear on any success path here. What they say instead is: received,
 * under review, we will confirm shortly.
 */

import { useRef, useState } from 'react';
import { CircleCheck, FileText, Loader2, Upload, X } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { Panel, PanelHeader } from '@nw/components/portal/primitives';
import { StatusChip } from '@nw/components/portal/status-chip';
import { ProblemBox, formatSize } from '@nw/components/booking/documents-shared';
import {
  useInsuranceUpload,
  type InsurancePick as Pick,
  type InsuranceUploadHandle,
} from '@nw/components/booking/use-insurance-upload';
import {
  INSURANCE_ACCEPT_ATTRIBUTE,
  INSURANCE_FORMATS_LABEL,
  type BookingDocumentsSession,
  type InsuranceFileState,
} from '@nw/hooks/use-booking-documents';
import { cn } from '@nw/lib/utils';

/*
  The tray, the dedupe, readiness and the send live in `use-insurance-upload.ts`
  (shared with the v2 panel). This file is the v1 markup only.
*/

/** The handle the shell's single primary button calls. Never throws. */
export type { InsuranceUploadHandle };

/* ──────────────────────────── the upload tray ──────────────────────────── */

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
  /** 'Step 2 of 2' — the OUTER progress, owned by the shell, shown in the header. */
  stepLabel: string;
  /**
   * Told to the shell so the two-step rail and the overall state can move.
   *
   * It is a NOTIFICATION, not the record. The record is what the server wrote:
   * `submit-insurance` files the `customer_documents` rows and stamps
   * `rentals.documents_status`, and this callback fires only after that call
   * has come back. A browser that could mark its own step done is a browser
   * that can be made to lie.
   */
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
    <Panel>
      <PanelHeader
        title={alreadySubmitted ? 'Send another insurance document' : 'Your insurance document'}
        action={
          <StatusChip tone={picks.length > 0 ? 'success' : 'neutral'}>
            {picks.length > 0
              ? `${stepLabel} · ${picks.length} ${picks.length === 1 ? 'file' : 'files'}`
              : stepLabel}
          </StatusChip>
        }
      />

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-brand-text-soft">
          Send your insurance certificate or declarations page. If you can, include
          the page that shows your coverage limits and deductibles — and send more
          than one file if your policy runs to several pages.
        </p>

        {/* ── the drop zone ─────────────────────────────────────────────── */}
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            if (!busy) setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (!busy) add(event.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-8 text-center transition-colors',
            dragActive
              ? 'border-brand-forest bg-brand-stone'
              : 'border-brand-border bg-brand-card',
          )}
        >
          <Upload aria-hidden strokeWidth={1.75} className="size-5 text-brand-text-subtle" />
          <p className="text-sm text-brand-text-soft">
            Drop your files here, or choose them from your device.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INSURANCE_ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              add(event.target.files);
              // Cleared so choosing the SAME file again still fires onChange —
              // which is what "I removed it by mistake" looks like.
              event.target.value = '';
            }}
          />

          <Button
            type="button"
            variant="brand"
            className="mt-1 h-11"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose files
          </Button>

          <p className="text-xs text-brand-text-subtle">{INSURANCE_FORMATS_LABEL}</p>
        </div>

        {/* ── the tray ──────────────────────────────────────────────────── */}
        {picks.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {picks.map((pick) => (
              <FileRow key={pick.key} pick={pick} busy={busy} onRemove={remove} />
            ))}
          </ul>
        ) : null}

        {/*
          A DETERMINATE bar over files, not over bytes. `supabase-js` reports no
          byte progress on an upload, so a percentage would be invented — and the
          percentage is the one number a customer watches. Files sent out of
          files chosen is a number we actually know.
        */}
        {busy ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs text-brand-text-subtle">
              <span>Sending your files</span>
              <span>
                {storedCount} of {picks.length}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={picks.length}
              aria-valuenow={storedCount}
              className="h-1.5 w-full overflow-hidden rounded-full bg-brand-stone"
            >
              <div
                className="h-full rounded-full bg-brand-forest transition-all"
                style={{
                  width: `${picks.length === 0 ? 0 : (storedCount / picks.length) * 100}%`,
                }}
              />
            </div>
            <p className="text-xs leading-relaxed text-brand-text-subtle">
              Please keep this page open until it finishes.
            </p>
          </div>
        ) : null}

        {problem ? <ProblemBox message={problem} /> : null}

        <p className="text-xs leading-relaxed text-brand-text-subtle">
          Your documents are stored against this booking and seen only by{' '}
          {session.tenant.companyName ?? 'the rental company'}.
        </p>
      </div>
    </Panel>
  );
}

/** One chosen file: what it is, how big, where it has got to, and a way out. */
function FileRow({
  pick,
  busy,
  onRemove,
}: {
  pick: Pick;
  busy: boolean;
  onRemove: (key: string) => void;
}) {
  const status: Record<InsuranceFileState, { label: string; className: string }> = {
    queued: { label: formatSize(pick.file.size), className: 'text-brand-text-subtle' },
    uploading: { label: 'Sending…', className: 'text-brand-text-subtle' },
    stored: { label: 'Sent', className: 'text-success' },
    failed: { label: 'Did not send', className: 'text-danger' },
  };
  const shown = status[pick.state];

  return (
    <li className="flex items-center gap-3 rounded-[12px] border border-brand-border-soft px-3 py-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-brand-stone">
        {pick.state === 'uploading' ? (
          <Loader2 aria-hidden strokeWidth={1.75} className="size-4 animate-spin text-brand-text-subtle" />
        ) : pick.state === 'stored' ? (
          <CircleCheck aria-hidden strokeWidth={1.75} className="size-4 text-success" />
        ) : (
          <FileText aria-hidden strokeWidth={1.75} className="size-4 text-brand-text-subtle" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-brand-text">{pick.file.name}</span>
        <span className={cn('block truncate text-xs', shown.className)}>
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
