'use client';

/**
 * STEP ONE of the post-payment errand: the three identity photos, ALL AT ONCE.
 *
 * The payload and the order the server wants are v1's
 * (`apps/booking/src/app/verify/[token]/page.tsx`); none of its code is ported,
 * and three of its behaviours are deliberately NOT reproduced:
 *
 *  1. v1 writes `verification_step` and `upload_progress` to
 *     `identity_verifications` from the browser, which `anon` can reach. That is
 *     a client writing the state its own gate is judged on. Nothing here writes
 *     anything but the three photos; the outcome is recorded server-side, on a
 *     column (`booking_document_links.identity_status`) that no browser can
 *     touch.
 *  2. v1 opens a `getUserMedia` stream and paints frames onto a canvas. This
 *     uses `<input type="file" capture>` — the OS camera app produces a
 *     better-exposed, correctly-rotated photo, needs no permission prompt to
 *     *render* the page, and cannot leave a live camera track running if the
 *     component unmounts mid-step (which v1's can).
 *  3. v1 validates `image/*` up to 10 MB against a bucket that enforces 5 MB
 *     and four MIME types, then swallows the storage error. Validation here is
 *     the bucket's real limits and every message names the limit that was hit.
 *
 * ── WHY THIS IS A BOARD OF THREE SLOTS AND NOT A WIZARD ─────────────────────
 * The previous build of this file was a four-screen wizard driven by one
 * integer: front → back → selfie → review, with Back, "Skip this" and Continue
 * buttons and a header that read "photo 3 of 3". Three things were wrong with
 * it, and all three are fixed by showing the slots together:
 *
 *  * A customer could not see what was still missing without walking the
 *    wizard. The board answers that at a glance, and marks which slots are
 *    required.
 *  * Choosing three files at once was silently discarded — `accept()` read
 *    `list?.[0]` and neither input carried `multiple`. Picking three photos out
 *    of a camera roll is the single commonest way to do this on a phone. It now
 *    fans out across the empty slots in order (see `fanOut`).
 *  * The optional back of the document was expressed as a "Skip this" BUTTON,
 *    which reads as an instruction rather than a property of the slot. It is
 *    now a label on the slot itself, which is what it always was: a passport
 *    has nothing on the back.
 *
 * Everything the wizard actually protected is kept: per-slot replace and
 * remove, the bucket's 5 MB / JPG-PNG limits, the optional back, and the exact
 * submit payload.
 *
 * ── NOTHING IS MINTED UNTIL THE CUSTOMER PRESSES SEND ───────────────────────
 * The identity session is what the upload paths are scoped by, and asking for
 * one has side effects: `create-ai-verification-session` caps a customer at TEN
 * an hour and sets `customers.identity_verification_status = 'pending'`. An
 * earlier build of this surface asked for one on every page open, so ten
 * refreshes locked a customer out of their own paid booking and left a false
 * status on their record. There is therefore NO `useEffect` in this file that
 * calls the server, and — now that there is no "Start" screen — the mint has
 * moved INTO `submit()`, which runs from the screen's one primary button and
 * from nothing else. Choosing photos costs nothing; sending them mints one
 * session. The server reuses an unprocessed session, so a failed send followed
 * by a retry does not consume a second.
 *
 * ── WHAT THIS STEP MAY AND MAY NOT SAY ──────────────────────────────────────
 * Sending photos does not confirm a booking, and it does not "verify" anyone
 * as far as the customer is concerned: the server collapses the AI's
 * `verified` and `review_required` into one 'submitted', because what is true
 * either way is that we have the photos and a person will look at them. The
 * words "confirmed", "complete" and "verified" do not appear on any success
 * path here.
 *
 * A rejection never states a reason. `process-ai-verification` writes
 * `rejection_reason` values including
 * `Blocked identity: <the operator's private note>`, so the reason is not the
 * customer's to read; the server drops it before it can reach a rendered string.
 */

import { useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { Panel, PanelHeader } from '@nw/components/portal/primitives';
import { StatusChip } from '@nw/components/portal/status-chip';
import { ProblemBox, formatSize } from '@nw/components/booking/documents-shared';
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
import { cn } from '@nw/lib/utils';

/*
  The photos, the fan-out, the lazy mint and the send all live in
  `use-identity-capture.ts` (shared with the v2 panel). This file is the v1
  markup only.
*/

/* ───────────────────────── what the shell drives ───────────────────────── */

/**
 * The handle the shell's single primary button calls.
 *
 * The step owns its own files, its own previews and its own errors — lifting
 * all of that into the shell would have meant the shell owning three object-URL
 * lifecycles it has no other reason to know about. What the shell needs is
 * exactly two things: "are you ready" (pushed up through `onReadyChange`) and
 * "go" (pulled down through this handle).
 */
export type { IdentityCaptureHandle };

/* ──────────────────────────── the component ────────────────────────────── */

export function IdentityCapture({
  token,
  session,
  /** 'Step 1 of 2' — the OUTER progress, passed in so this file owns only its own. */
  stepLabel,
  /** Where the server says this step already stood when the page opened. */
  serverStatus,
  onSubmitted,
  /**
   * Whether the required photos are present. Pushed up on every change so the
   * shell's one button can be disabled — and can SAY what is missing — without
   * reaching into this step's state.
   */
  onReadyChange,
  /** The names of the missing required photos, for the shell's disabled line. */
  onMissingChange,
  ref,
}: {
  token: string;
  session: BookingDocumentsSession;
  stepLabel: string;
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

  /**
   * One input pair PER SLOT, plus one multi-file input for the whole board.
   *
   * The wizard could share a single pair because exactly one photo was ever on
   * screen. Three slots at once cannot: `capture` is an attribute of the
   * element, not of the click, so a shared input would carry the wrong camera
   * for two of the three slots.
   */
  const cameraRefs = useRef<Partial<Record<IdentitySlot, HTMLInputElement | null>>>({});
  const fileRefs = useRef<Partial<Record<IdentitySlot, HTMLInputElement | null>>>({});
  const multiRef = useRef<HTMLInputElement>(null);

  /* ── the retry panel, after a rejection ─────────────────────────────── */

  if (rejected) {
    return (
      <Panel className="px-5 py-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-warning-light">
            <RotateCcw aria-hidden strokeWidth={1.75} className="size-5 text-warning" />
          </span>
          <p className="text-base font-medium text-brand-text">
            We could not read your documents well enough
          </p>
          {/*
            No reason is given, and that is deliberate — see the file header.
            What IS given is the list of things a customer can actually change.
          */}
          <p className="max-w-md text-sm leading-relaxed text-brand-text-soft">
            It is usually the photo rather than the document: a reflection off
            the plastic, a corner cut off, or too little light. Have another go
            in a brighter spot, with the document flat and filling the frame.
          </p>
          <Button type="button" variant="brand" className="mt-1 h-11" onClick={startOver}>
            <Camera aria-hidden className="size-4" />
            Try again
          </Button>
          <p className="max-w-md text-xs leading-relaxed text-brand-text-subtle">
            Your booking and your payment are unaffected, and you can send your
            insurance document in the meantime. If it still will not go through,
            get in touch with {session.tenant.companyName ?? 'the rental company'}{' '}
            and they will take it from here.
          </p>
        </div>
      </Panel>
    );
  }

  /* ── while the photos are in the air ────────────────────────────────── */

  if (busy) {
    return (
      <Panel className="px-5 py-10">
        <div className="flex flex-col items-center gap-3 text-center" aria-live="polite">
          <Loader2
            aria-hidden
            strokeWidth={1.75}
            className="size-6 animate-spin text-brand-text-subtle"
          />
          <p className="text-base font-medium text-brand-text">Checking your documents</p>
          {/*
            One honest sentence rather than a fake stage list. `supabase-js`
            exposes no upload progress, and the OCR and face match happen inside
            one server call, so a "step 2 of 4" here would be invented. The one
            thing we DO know is which photo is currently going up.
          */}
          <p className="max-w-sm text-sm leading-relaxed text-brand-text-soft">
            {sending === null
              ? 'We are reading your photos. This usually takes under a minute — please keep this page open.'
              : 'We are sending your photos. Please keep this page open.'}
          </p>
        </div>
      </Panel>
    );
  }

  /* ── the board ──────────────────────────────────────────────────────── */

  const returning = serverStatus === 'rejected';

  return (
    <Panel>
      <PanelHeader
        title="Your identity documents"
        action={
          <StatusChip tone={ready ? 'success' : 'neutral'}>
            {chosen === 0 ? stepLabel : `${stepLabel} · ${chosen} of 3 added`}
          </StatusChip>
        }
      />

      <div
        /*
          The whole board is a drop target as well as each slot. A customer
          dragging three files from a folder has no reason to aim at a
          particular tile, and `fanOut` with no target slot is exactly the
          "fill the empties in order" behaviour they expect.
        */
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy) setDragSlot('board');
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragSlot((current) => current ?? 'board');
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragSlot(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragSlot(null);
          if (!busy) fanOut(event.dataTransfer.files);
        }}
        className="flex flex-col gap-4 px-4 py-4 sm:px-5"
      >
        <p className="text-sm leading-relaxed text-brand-text-soft">
          {returning
            ? 'The last set of photos could not be read. Have another go — it is usually the lighting rather than the document. Add all three below in any order.'
            : 'Three photos, in any order. Add them all here — you can pick more than one at a time, and replace any of them before you send.'}
        </p>

        {/* ── add several at once ───────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-[14px] border border-dashed border-brand-border bg-brand-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Upload aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-brand-text-subtle" />
            <p className="min-w-0 text-sm leading-relaxed text-brand-text-soft">
              Got them already? Choose all of your photos in one go and we will
              put them in the empty slots below.
            </p>
          </div>

          <input
            ref={multiRef}
            type="file"
            multiple
            accept={IDENTITY_ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              fanOut(event.target.files);
              // Cleared so choosing the SAME files again still fires onChange —
              // which is what "I removed one by mistake" looks like.
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
        </div>

        {/* ── the three slots, together ─────────────────────────────────── */}
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

        <p className="text-xs text-brand-text-subtle">{IDENTITY_FORMATS_LABEL}</p>

        {problem ? <ProblemBox message={problem} /> : null}
        {submitError ? <ProblemBox message={submitError} /> : null}

        <p className="text-xs leading-relaxed text-brand-text-subtle">
          Your photos are stored against this booking and used to check your
          identity. They are not shared with anyone outside{' '}
          {session.tenant.companyName ?? 'the rental company'}.
        </p>
      </div>
    </Panel>
  );
}

/* ──────────────────────────────── one slot ─────────────────────────────── */

/**
 * One of the three photos: what it is, whether it is required, and either the
 * picture that is in it or the two ways to put one there.
 *
 * The required/optional marker is on the SLOT rather than expressed as a "skip"
 * button, because that is what it is — a property of the document, not an
 * action for the customer to take.
 */
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
        'flex flex-col gap-3 rounded-[14px] border p-3 transition-colors',
        dragging
          ? 'border-brand-forest bg-brand-stone'
          : shot
            ? 'border-brand-border-soft bg-brand-card'
            : 'border-dashed border-brand-border bg-brand-card',
      )}
    >
      {/*
        `min-h-10` so a one-line title and a two-line title still put their
        previews on the same baseline. Without it the three tiles' pictures sit
        at three different heights, which reads as a rendering fault.
      */}
      <div className="flex min-h-10 items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium leading-snug text-brand-text">
          {spec.title}
        </p>
        <StatusChip
          tone={spec.optional ? 'neutral' : shot ? 'success' : 'warning'}
          className="shrink-0"
        >
          {spec.optional ? 'Optional' : shot ? 'Added' : 'Required'}
        </StatusChip>
      </div>

      {/*
        A fixed-height frame whether or not there is a photo in it, so adding
        one does not shove the other two slots down the page.
      */}
      <div className="relative h-32 overflow-hidden rounded-[10px] border border-brand-border-soft bg-brand-stone">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.previewUrl}
            alt={`The ${spec.title.toLowerCase()} you chose`}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 px-2 text-center">
            <spec.icon aria-hidden strokeWidth={1.5} className="size-6 text-brand-text-subtle" />
            <span className="text-xs leading-snug text-brand-text-subtle">
              {spec.optional ? 'Add it if your document has a back' : 'Nothing added yet'}
            </span>
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-brand-text-subtle">{spec.guidance}</p>

      {/*
        Two inputs per slot, not one. The `capture` attribute cannot be toggled
        per press, and a single input carrying it would take the gallery away on
        a phone — which is exactly what a customer needs when the photo was
        taken on another device. `multiple` is on both so a batch aimed at one
        slot still spills into the empty ones.
      */}
      <input
        ref={registerCamera}
        type="file"
        accept={IDENTITY_ACCEPT_ATTRIBUTE}
        capture={spec.capture}
        className="sr-only"
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
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div className="mt-auto flex flex-col gap-2">
        {shot ? (
          <>
            <span className="text-xs text-brand-text-subtle">{formatSize(shot.file.size)}</span>
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
              <Button
                type="button"
                variant="brand"
                className="h-11 flex-1 px-2 text-xs"
                onClick={openCamera}
              >
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
 * What the customer is told once their photos are with us.
 *
 * Rendered by the shell, not by the capture flow, because the shell is what
 * knows whether the OTHER step is done. Read the copy before editing it: this
 * is "we have them and someone is looking", never "verified" and never
 * "confirmed".
 */
export function IdentityReceivedPanel({ operator }: { operator: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-light">
        <ShieldCheck aria-hidden strokeWidth={1.75} className="size-4.5 text-success" />
      </span>
      <p className="min-w-0 text-sm leading-relaxed text-brand-text-soft">
        We have your identity documents and they are{' '}
        <span className="font-medium text-brand-text">under review</span> by {operator}.
        There is nothing else for you to do on this step.
      </p>
    </div>
  );
}
