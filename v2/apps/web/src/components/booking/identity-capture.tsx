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

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Camera,
  IdCard,
  ImagePlus,
  Loader2,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import { ProblemBox, formatSize } from '@/components/booking/documents-shared';
import {
  IDENTITY_ACCEPT_ATTRIBUTE,
  IDENTITY_FORMATS_LABEL,
  useStartBookingIdentity,
  useSubmitBookingIdentity,
  validateIdentityPhoto,
  type BookingDocumentsSession,
  type IdentitySlot,
} from '@/hooks/use-booking-documents';
import { cn } from '@/lib/utils';

/* ────────────────────────────── the photos ─────────────────────────────── */

interface PhotoSpec {
  slot: IdentitySlot;
  title: string;
  /** The one-line name used in the "still needed" sentence on the send button. */
  shortTitle: string;
  /** What a good photo looks like. Concrete, not "make sure it is clear". */
  guidance: string;
  /** `environment` is the rear camera, `user` the front one. */
  capture: 'environment' | 'user';
  optional: boolean;
  icon: LucideIcon;
}

const PHOTOS: readonly PhotoSpec[] = [
  {
    slot: 'front',
    title: 'Front of your driving licence',
    shortTitle: 'the front of your licence',
    guidance:
      'Lay it flat in good light and fill the frame. All four corners visible, text readable.',
    capture: 'environment',
    optional: false,
    icon: IdCard,
  },
  {
    slot: 'back',
    title: 'Back of your driving licence',
    shortTitle: 'the back of your licence',
    guidance:
      'The same again, turned over. Leave this one out if your document has nothing on the back — a passport, for instance.',
    capture: 'environment',
    optional: true,
    icon: IdCard,
  },
  {
    slot: 'selfie',
    title: 'A photo of you',
    shortTitle: 'a photo of you',
    guidance:
      'Face the camera in even light, with nothing covering your face. We compare this against the photo on your document.',
    capture: 'user',
    optional: false,
    icon: ScanFace,
  },
];

/** The slots a fanned-out multi-file selection fills, in this order. */
const FILL_ORDER: readonly IdentitySlot[] = ['front', 'back', 'selfie'];

interface Shot {
  file: File;
  /** An object URL. Owned by this component and revoked when it is replaced. */
  previewUrl: string;
}

type Shots = Record<IdentitySlot, Shot | null>;

const NO_SHOTS: Shots = { front: null, back: null, selfie: null };

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
export interface IdentityCaptureHandle {
  /**
   * Send the photos. Resolves TRUE only when the server accepted them; false
   * covers both a rejection and a failure, each of which has already been
   * rendered inside this panel. Never throws — the shell's button must not have
   * to know the difference.
   */
  submit: () => Promise<boolean>;
}

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
  const start = useStartBookingIdentity();
  const submit = useSubmitBookingIdentity();

  /**
   * Null until the first send. This IS the lazy-mint gate — see the file
   * header. It is held across a failed attempt so a retry reuses the session
   * rather than spending another of the customer's ten an hour.
   */
  const [uploadPrefix, setUploadPrefix] = useState<string | null>(null);

  const [shots, setShots] = useState<Shots>(NO_SHOTS);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [sending, setSending] = useState<IdentitySlot | null>(null);
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

  /*
    Whether to offer "Take a photo" at all.

    `capture` is honoured by phones and quietly ignored by desktop browsers,
    where the button would open the same file dialog as the one beside it and
    read as a bug. `(pointer: coarse)` is the standard proxy for "this device
    has a camera the OS will hand us". Resolved in an effect and defaulted to
    false so the server and the first client render agree — a hydration mismatch
    here would be a flash of two buttons turning into one.
  */
  const [offerCamera, setOfferCamera] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    setOfferCamera(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /*
    Object URLs are revoked when their shot is replaced and again for whatever
    is left when the component goes away. v1 creates one on every retake and
    revokes none, which on a phone means the browser holds every discarded
    attempt in memory for the life of the tab.

    The ref mirrors the state for two readers: the unmount cleanup (which must
    see the CURRENT shots without listing them as a dependency — depending on
    `shots` would revoke a live preview on every retake) and `fanOut`, which
    must build on the batch before it when two selections land in one tick.
  */
  const shotsRef = useRef<Shots>(shots);
  shotsRef.current = shots;
  useEffect(
    () => () => {
      for (const shot of Object.values(shotsRef.current)) {
        if (shot) URL.revokeObjectURL(shot.previewUrl);
      }
    },
    [],
  );

  /** Both writes go through here so the ref and the state can never disagree. */
  const commit = useCallback((next: Shots) => {
    shotsRef.current = next;
    setShots(next);
  }, []);

  const setShot = useCallback(
    (slot: IdentitySlot, file: File) => {
      const rejection = validateIdentityPhoto(file);
      if (rejection) {
        setProblem(rejection);
        return;
      }
      setProblem(null);
      const previous = shotsRef.current;
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      commit({ ...previous, [slot]: { file, previewUrl: URL.createObjectURL(file) } });
    },
    [commit],
  );

  const clearShot = useCallback(
    (slot: IdentitySlot) => {
      setProblem(null);
      const previous = shotsRef.current;
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      commit({ ...previous, [slot]: null });
    },
    [commit],
  );

  /**
   * Several files at once, spread across the slots that are still empty.
   *
   * THE WHOLE POINT OF THE BOARD. On a phone the natural gesture is to open the
   * camera roll once and tick three photos; the wizard threw two of them away.
   * They fill front → back → selfie, which is the order they were almost
   * certainly taken in, and every one of them is still validated individually —
   * a 7 MB photo in the middle of a good batch is named and refused on its own
   * rather than sinking the batch.
   *
   * `targetSlot` is set when the drop landed on ONE slot: that slot is filled
   * first even if it already had a photo (dropping onto a filled slot means
   * "replace this one"), and any extras spill into the remaining empties.
   *
   * Computed against `shotsRef` rather than inside a `setShots` updater on
   * purpose: this loop has a side effect (it fills `rejections`, which the last
   * line puts in front of the customer), and React runs an updater during the
   * render rather than at the call site. A second batch arriving while a
   * re-render was queued would have found `rejections` empty and the customer's
   * oversized file would have vanished with no explanation — the one case the
   * message exists for.
   */
  const fanOut = useCallback(
    (list: FileList | null, targetSlot?: IdentitySlot) => {
      if (!list || list.length === 0) return;

      const incoming = Array.from(list);
      const rejections: string[] = [];
      const next: Shots = { ...shotsRef.current };

      const queue: IdentitySlot[] = [];
      if (targetSlot) queue.push(targetSlot);
      for (const slot of FILL_ORDER) {
        if (slot !== targetSlot && next[slot] === null) queue.push(slot);
      }

      let filled = 0;
      for (const file of incoming) {
        const rejection = validateIdentityPhoto(file);
        if (rejection) {
          rejections.push(rejection);
          continue;
        }
        const slot = queue.shift();
        if (!slot) {
          rejections.push(
            `“${file.name}” was not added — all three photo slots are already filled. Remove one first if you meant to replace it.`,
          );
          continue;
        }
        const existing = next[slot];
        if (existing) URL.revokeObjectURL(existing.previewUrl);
        next[slot] = { file, previewUrl: URL.createObjectURL(file) };
        filled += 1;
      }

      if (filled > 0) commit(next);
      setProblem(rejections.length > 0 ? rejections.join(' ') : null);
    },
    [commit],
  );

  /** Back to a clean slate. The NEXT send mints a fresh session. */
  const startOver = useCallback(() => {
    setRejected(false);
    setSubmitError(null);
    setProblem(null);
    setUploadPrefix(null);
    const previous = shotsRef.current;
    for (const shot of Object.values(previous)) {
      if (shot) URL.revokeObjectURL(shot.previewUrl);
    }
    commit(NO_SHOTS);
  }, [commit]);

  /* ── readiness, pushed up to the shell ──────────────────────────────── */

  const ready = shots.front !== null && shots.selfie !== null;

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    // Only the REQUIRED slots. The back of the document is genuinely optional
    // at every layer — the hook types it `File | null`, and the server reads it
    // with `readPath(body.documentBackPath, false)` — so naming it here would
    // be inventing a blocker.
    const missing = PHOTOS.filter(
      (spec) => !spec.optional && shots[spec.slot] === null,
    ).map((spec) => spec.shortTitle);
    onMissingChange(missing);
  }, [onMissingChange, shots]);

  /* ── the send, driven by the shell's one button ─────────────────────── */

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    const current = shotsRef.current;
    if (!current.front || !current.selfie) {
      setSubmitError(
        'We still need the front of your document and a photo of you before we can check them.',
      );
      return false;
    }
    setSubmitError(null);

    /*
      THE MINT, AND THE ONLY PLACE IT HAPPENS.

      Reusing the prefix we already hold matters: every mint can spend one of
      the customer's ten sessions an hour, and a customer whose first send
      failed on a flaky connection would otherwise burn one per retry.
    */
    let prefix = uploadPrefix;
    if (prefix === null) {
      try {
        const minted = await start.mutateAsync({ token });
        prefix = minted.uploadPrefix;
        setUploadPrefix(minted.uploadPrefix);
      } catch (caught: unknown) {
        // The hook has already turned every server code — the ten-an-hour cap
        // included — into a sentence written for a customer.
        setSubmitError(
          caught instanceof Error
            ? caught.message
            : 'We could not start the identity check. Please try again in a moment.',
        );
        return false;
      }
    }

    try {
      const result = await submit.mutateAsync({
        token,
        uploadPrefix: prefix,
        front: current.front.file,
        back: current.back?.file ?? null,
        selfie: current.selfie.file,
        onPhotoState: (slot, state) => {
          setSending(state === 'uploading' ? slot : null);
        },
      });
      setSending(null);
      if (result.identityStatus === 'rejected') {
        // A rejected session is spent; the retry must mint a fresh one, and the
        // stale prefix must not be reused or the uploads would land beside a
        // session the server has already judged.
        setUploadPrefix(null);
        setRejected(true);
        return false;
      }
      onSubmitted();
      return true;
    } catch (caught: unknown) {
      setSending(null);
      // Already written for a customer by the hook — including the
      // "we could not check your photos just now" case, which is NOT a
      // rejection and leaves this step exactly where it was.
      setSubmitError(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong sending your photos. Please try again.',
      );
      return false;
    }
  }, [onSubmitted, start, submit, token, uploadPrefix]);

  useImperativeHandle(ref, () => ({ submit: handleSubmit }), [handleSubmit]);

  const busy = submit.isPending || start.isPending;

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
  const chosen = FILL_ORDER.filter((slot) => shots[slot] !== null).length;

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
