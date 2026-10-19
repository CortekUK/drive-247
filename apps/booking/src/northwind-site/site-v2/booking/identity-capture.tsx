'use client';

/**
 * Northwind booking site v2 — STEP ONE of the post-payment errand: the three
 * identity photos, all at once. v2 of `components/booking/identity-capture.tsx`
 * (same exported names and props); the shell is `./documents-screen.tsx`.
 *
 * Markup only. The photos, the multi-file fan-out, the lazy session mint (on
 * send, never on open) and the send itself are `use-identity-capture.ts`,
 * shared with v1 — read v1's header for why each rule is the way it is. Two of
 * them shape this markup: a rejection never states a reason, and no success
 * line says "verified" or "confirmed".
 */

import { useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  Loader2,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import {
  PHOTOS,
  useIdentityCapture,
  type IdentityCaptureHandle,
  type PhotoSpec,
  type Shot,
} from '@nw/components/booking/use-identity-capture';
import {
  IDENTITY_ACCEPT_ATTRIBUTE,
  IDENTITY_FORMATS_LABEL,
  type BookingDocumentsSession,
  type IdentitySlot,
} from '@nw/hooks/use-booking-documents';
import { StatusChip } from '@nw/portal-v2/status-chip';
import { cn } from '@nw/lib/utils';

import { DropPanel, ProblemBox, StepCard, ToneTile, formatSize } from './documents-shared';

export type { IdentityCaptureHandle };

export function IdentityCapture({
  token,
  session,
  stepLabel,
  serverStatus,
  onSubmitted,
  onReadyChange,
  onMissingChange,
  ref,
}: {
  token: string;
  session: BookingDocumentsSession;
  /** 'Step 1 of 2' — the OUTER progress, owned by the shell. */
  stepLabel: string;
  /** Where the server says this step already stood when the page opened. */
  serverStatus: string | null;
  onSubmitted: () => void;
  onReadyChange: (ready: boolean) => void;
  onMissingChange: (missing: readonly string[]) => void;
  ref?: React.Ref<IdentityCaptureHandle>;
}) {
  const {
    shots,
    problem,
    submitError,
    rejected,
    sending,
    busy,
    ready,
    chosen,
    offerCamera,
    clearShot,
    fanOut,
    startOver,
  } = useIdentityCapture({ token, onSubmitted, onReadyChange, onMissingChange, ref });

  const [dragSlot, setDragSlot] = useState<IdentitySlot | 'board' | null>(null);

  // One input pair PER SLOT (`capture` is an attribute of the element, so a
  // shared input would carry the wrong camera), plus one for the whole board.
  const cameraRefs = useRef<Partial<Record<IdentitySlot, HTMLInputElement | null>>>({});
  const fileRefs = useRef<Partial<Record<IdentitySlot, HTMLInputElement | null>>>({});
  const multiRef = useRef<HTMLInputElement>(null);

  const operator = session.tenant.companyName ?? 'the rental company';

  /* ── after a rejection ──────────────────────────────────────────────── */

  if (rejected) {
    return (
      <StepCard
        icon={RotateCcw}
        tone="warning"
        title="We could not read your documents well enough"
        chip={<StatusChip tone="warning">{stepLabel}</StatusChip>}
        // No reason, on purpose: only the things a customer can change.
        description="It is usually the photo rather than the document: a reflection off the plastic, a corner cut off, or too little light. Have another go in a brighter spot, with the document flat and filling the frame."
      >
        <div className="flex flex-col gap-4">
          <Button type="button" variant="brand" className="h-11 w-full sm:w-auto sm:self-start" onClick={startOver}>
            <Camera aria-hidden className="size-4" />
            Try again
          </Button>
          <p className="text-xs leading-relaxed text-pv-muted-fg">
            Your booking and your payment are unaffected, and you can send your insurance document in the
            meantime. If it still will not go through, get in touch with {operator} and they will take it
            from here.
          </p>
        </div>
      </StepCard>
    );
  }

  /* ── while the photos are in the air ────────────────────────────────── */

  if (busy) {
    return (
      <StepCard
        icon={ScanFace}
        title="Checking your documents"
        chip={<StatusChip tone="info">{stepLabel}</StatusChip>}
      >
        <div
          className="flex items-center gap-3 rounded-2xl bg-pv-row/70 px-4 py-4 ring-1 ring-pv-border"
          aria-live="polite"
        >
          <Loader2 aria-hidden strokeWidth={1.75} className="size-5 shrink-0 animate-spin text-pv-primary" />
          {/* One honest sentence: we know which photo is going up, nothing finer. */}
          <p className="text-sm leading-relaxed text-pv-muted-fg">
            {sending === null
              ? 'We are reading your photos. This usually takes under a minute — please keep this page open.'
              : 'We are sending your photos. Please keep this page open.'}
          </p>
        </div>
      </StepCard>
    );
  }

  /* ── the board ──────────────────────────────────────────────────────── */

  const returning = serverStatus === 'rejected';

  return (
    <StepCard
      icon={ScanFace}
      title="Your identity documents"
      description={
        returning
          ? 'The last set of photos could not be read. Have another go — it is usually the lighting rather than the document.'
          : 'Three photos, in any order. You can pick more than one at a time and replace any before you send.'
      }
      chip={
        <StatusChip tone={ready ? 'success' : 'neutral'}>
          {chosen === 0 ? stepLabel : `${stepLabel} · ${chosen} of 3 added`}
        </StatusChip>
      }
    >
      <div className="flex flex-col gap-4">
        {/* The whole board is a drop target too: no need to aim at a tile. */}
        <DropPanel
          active={dragSlot === 'board'}
          disabled={busy}
          onDragState={(active) => setDragSlot((current) => (active ? (current ?? 'board') : null))}
          onFiles={(list) => fanOut(list)}
          className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Upload aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-pv-primary" />
            <p className="min-w-0 text-[13px] leading-relaxed text-pv-muted-fg">
              Got them already? Choose all of your photos in one go and we will put them in the empty slots.
            </p>
          </div>
          <input
            ref={multiRef}
            type="file"
            multiple
            accept={IDENTITY_ACCEPT_ATTRIBUTE}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              fanOut(event.target.files);
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="brand-outline"
            className="h-11 w-full shrink-0 sm:w-auto"
            onClick={() => multiRef.current?.click()}
          >
            <ImagePlus aria-hidden className="size-4" />
            Add photos
          </Button>
        </DropPanel>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PHOTOS.map((spec) => (
            <PhotoSlot
              key={spec.slot}
              spec={spec}
              shot={shots[spec.slot]}
              offerCamera={offerCamera}
              dragging={dragSlot === spec.slot}
              onDragStateChange={(active) => setDragSlot(active ? spec.slot : null)}
              onFiles={(list) => fanOut(list, spec.slot)}
              onClear={() => clearShot(spec.slot)}
              registerCamera={(element) => {
                cameraRefs.current[spec.slot] = element;
              }}
              registerFile={(element) => {
                fileRefs.current[spec.slot] = element;
              }}
              openCamera={() => cameraRefs.current[spec.slot]?.click()}
              openFiles={() => fileRefs.current[spec.slot]?.click()}
            />
          ))}
        </ul>

        <p className="text-xs text-pv-muted-fg">{IDENTITY_FORMATS_LABEL}</p>

        {problem ? <ProblemBox message={problem} /> : null}
        {submitError ? <ProblemBox message={submitError} /> : null}

        <p className="text-xs leading-relaxed text-pv-muted-fg">
          Your photos are stored against this booking and used to check your identity. They are not shared
          with anyone outside {operator}.
        </p>
      </div>
    </StepCard>
  );
}

/* ──────────────────────────────── one slot ─────────────────────────────── */

function PhotoSlot({
  spec,
  shot,
  offerCamera,
  dragging,
  onDragStateChange,
  onFiles,
  onClear,
  registerCamera,
  registerFile,
  openCamera,
  openFiles,
}: {
  spec: PhotoSpec;
  shot: Shot | null;
  offerCamera: boolean;
  dragging: boolean;
  onDragStateChange: (active: boolean) => void;
  onFiles: (list: FileList | null) => void;
  onClear: () => void;
  registerCamera: (element: HTMLInputElement | null) => void;
  registerFile: (element: HTMLInputElement | null) => void;
  openCamera: () => void;
  openFiles: () => void;
}) {
  return (
    <li
      onDragEnter={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStateChange(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStateChange(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) onDragStateChange(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragStateChange(false);
        onFiles(event.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-3',
        '[transition:border-color_200ms_ease-out,background-color_200ms_ease-out] motion-reduce:transition-none',
        dragging
          ? 'border-pv-primary bg-pv-tint'
          : shot
            ? 'border-pv-border bg-pv-card'
            : 'border-dashed border-pv-border bg-pv-card',
      )}
    >
      {/* `min-h-10` keeps the three previews on one baseline. */}
      <div className="flex min-h-10 items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] font-semibold leading-snug text-pv-fg">{spec.title}</p>
        <StatusChip tone={spec.optional ? 'neutral' : shot ? 'success' : 'warning'}>
          {spec.optional ? 'Optional' : shot ? 'Added' : 'Required'}
        </StatusChip>
      </div>

      {/* A fixed-height frame, so adding a photo does not move the others. */}
      <div className="relative h-32 overflow-hidden rounded-xl bg-pv-row ring-1 ring-pv-border">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.previewUrl}
            alt={`The ${spec.title.toLowerCase()} you chose`}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-2 text-center">
            <ToneTile icon={spec.icon} tone="info" />
            <span className="text-xs leading-snug text-pv-muted-fg">
              {spec.optional ? 'Add it if your document has a back' : 'Nothing added yet'}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-pv-muted-fg">{spec.guidance}</p>

      <input
        ref={registerCamera}
        type="file"
        accept={IDENTITY_ACCEPT_ATTRIBUTE}
        capture={spec.capture}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={registerFile}
        type="file"
        multiple
        accept={IDENTITY_ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div className="mt-auto flex flex-col gap-2">
        {shot ? (
          <>
            <span className="text-xs text-pv-muted-fg">{formatSize(shot.file.size)}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="brand-outline"
                className="h-11 flex-1 px-2 text-xs"
                onClick={offerCamera ? openCamera : openFiles}
              >
                <RotateCcw aria-hidden className="size-4" />
                Replace
              </Button>
              <Button
                type="button"
                variant="brand-ghost"
                aria-label={`Remove ${spec.title.toLowerCase()}`}
                className="size-11 shrink-0 p-0"
                onClick={onClear}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            {offerCamera ? (
              <Button type="button" variant="brand" className="h-11 flex-1 px-2 text-xs" onClick={openCamera}>
                <Camera aria-hidden className="size-4" />
                Take
              </Button>
            ) : null}
            <Button
              type="button"
              variant={offerCamera ? 'brand-outline' : 'brand'}
              className="h-11 flex-1 px-2 text-xs"
              onClick={openFiles}
            >
              <ImagePlus aria-hidden className="size-4" />
              {offerCamera ? 'Choose' : 'Choose a file'}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * What the customer is told once their photos are with us. "Under review",
 * never "verified" and never "confirmed".
 */
export function IdentityReceivedPanel({ operator }: { operator: string }) {
  return (
    <div className="flex items-start gap-3">
      <ToneTile icon={ShieldCheck} tone="success" />
      <p className="min-w-0 pt-2 text-sm leading-relaxed text-pv-muted-fg">
        We have your identity documents and they are{' '}
        <span className="font-semibold text-pv-fg">under review</span> by {operator}. There is nothing else
        for you to do on this step.
      </p>
    </div>
  );
}
