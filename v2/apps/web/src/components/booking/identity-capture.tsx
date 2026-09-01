'use client';

/**
 * STEP ONE of the post-payment errand: the three identity photos.
 *
 * Front of the document → back of the document (skippable) → a photo of the
 * customer → review → send. That order and that payload are v1's
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
 * ── NOTHING IS MINTED UNTIL THE CUSTOMER PRESSES START ──────────────────────
 * The identity session is what the upload paths are scoped by, and asking for
 * one has side effects: `create-ai-verification-session` caps a customer at TEN
 * an hour and sets `customers.identity_verification_status = 'pending'`. An
 * earlier build of this surface asked for one on every page open, so ten
 * refreshes locked a customer out of their own paid booking and left a false
 * status on their record. There is therefore NO `useEffect` in this file that
 * calls the server. `start` runs from a press, and from nothing else.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  IdCard,
  Loader2,
  RotateCcw,
  ScanFace,
  Send,
  ShieldCheck,
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
    guidance:
      'Lay it flat on a dark surface in good light and fill the frame. All four corners need to be visible, and the text has to be readable.',
    capture: 'environment',
    optional: false,
    icon: IdCard,
  },
  {
    slot: 'back',
    title: 'Back of your driving licence',
    guidance:
      'The same again, turned over. Skip this if your document has nothing on the back — a passport, for instance.',
    capture: 'environment',
    optional: true,
    icon: IdCard,
  },
  {
    slot: 'selfie',
    title: 'A photo of you',
    guidance:
      'Face the camera in even light, with nothing covering your face. We compare this against the photo on your document.',
    capture: 'user',
    optional: false,
    icon: ScanFace,
  },
];

/** The index after the last photo: the review-and-send screen. */
const REVIEW_INDEX = PHOTOS.length;

interface Shot {
  file: File;
  /** An object URL. Owned by this component and revoked when it is replaced. */
  previewUrl: string;
}

type Shots = Record<IdentitySlot, Shot | null>;

const NO_SHOTS: Shots = { front: null, back: null, selfie: null };

/* ──────────────────────────── the component ────────────────────────────── */

export function IdentityCapture({
  token,
  session,
  /** 'Step 1 of 2' — the OUTER progress, passed in so this file owns only its own. */
  stepLabel,
  /** Where the server says this step already stood when the page opened. */
  serverStatus,
  onSubmitted,
}: {
  token: string;
  session: BookingDocumentsSession;
  stepLabel: string;
  serverStatus: string | null;
  onSubmitted: () => void;
}) {
  const start = useStartBookingIdentity();
  const submit = useSubmitBookingIdentity();

  /** Null until the customer presses Start. This IS the lazy-mint gate. */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadPrefix, setUploadPrefix] = useState<string | null>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [shots, setShots] = useState<Shots>(NO_SHOTS);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const [sending, setSending] = useState<IdentitySlot | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

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
    Object URLs are revoked when their shot is replaced (in `setShot`) and again
    for whatever is left when the component goes away. v1 creates one on every
    retake and revokes none, which on a phone means the browser holds every
    discarded attempt in memory for the life of the tab.

    The ref mirrors the state so the unmount cleanup can read the CURRENT shots
    without listing them as an effect dependency — depending on `shots` would
    revoke a live preview on every retake.
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

  const setShot = useCallback((slot: IdentitySlot, file: File) => {
    const rejection = validateIdentityPhoto(file);
    if (rejection) {
      setProblem(rejection);
      return;
    }
    setProblem(null);
    setShots((previous) => {
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      return { ...previous, [slot]: { file, previewUrl: URL.createObjectURL(file) } };
    });
  }, []);

  const clearShot = useCallback((slot: IdentitySlot) => {
    setProblem(null);
    setShots((previous) => {
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      return { ...previous, [slot]: null };
    });
  }, []);

  const accept = useCallback(
    (slot: IdentitySlot, list: FileList | null) => {
      const file = list?.[0];
      if (file) setShot(slot, file);
    },
    [setShot],
  );

  /** Back to a clean slate. The NEXT press of Start mints a fresh session. */
  const startOver = useCallback(() => {
    setRejected(false);
    setSubmitError(null);
    setProblem(null);
    setSessionId(null);
    setUploadPrefix(null);
    setStepIndex(0);
    setShots((previous) => {
      for (const shot of Object.values(previous)) {
        if (shot) URL.revokeObjectURL(shot.previewUrl);
      }
      return NO_SHOTS;
    });
  }, []);

  /** The ONLY thing that mints a session, and it runs from a press. */
  const handleStart = useCallback(async () => {
    setProblem(null);
    try {
      const minted = await start.mutateAsync({ token });
      setSessionId(minted.sessionId);
      setUploadPrefix(minted.uploadPrefix);
      setStepIndex(0);
    } catch (caught: unknown) {
      // The hook has already turned every server code — the ten-an-hour cap
      // included — into a sentence written for a customer.
      setProblem(
        caught instanceof Error
          ? caught.message
          : 'We could not start the identity check. Please try again in a moment.',
      );
    }
  }, [start, token]);

  const handleSubmit = useCallback(async () => {
    if (!uploadPrefix || !shots.front || !shots.selfie) {
      setSubmitError(
        'We still need the front of your document and a photo of you before we can check them.',
      );
      return;
    }
    setSubmitError(null);
    try {
      const result = await submit.mutateAsync({
        token,
        uploadPrefix,
        front: shots.front.file,
        back: shots.back?.file ?? null,
        selfie: shots.selfie.file,
        onPhotoState: (slot, state) => {
          setSending(state === 'uploading' ? slot : null);
        },
      });
      setSending(null);
      if (result.identityStatus === 'rejected') {
        setRejected(true);
        return;
      }
      onSubmitted();
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
    }
  }, [onSubmitted, shots, submit, token, uploadPrefix]);

  const reviewRows = useMemo(
    () => PHOTOS.map((spec) => ({ spec, shot: shots[spec.slot] })),
    [shots],
  );

  const busy = submit.isPending;
  const canSubmit = shots.front !== null && shots.selfie !== null;

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

  /* ── before anything is minted: the start gate ──────────────────────── */

  if (sessionId === null || uploadPrefix === null) {
    const returning = serverStatus === 'rejected';
    return (
      <Panel>
        <PanelHeader
          title="Your identity documents"
          action={<StatusChip tone="neutral">{stepLabel}</StatusChip>}
        />
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
          <p className="text-sm leading-relaxed text-brand-text-soft">
            {returning
              ? 'The last set of photos could not be read. Have another go — three photos, a minute or so, and it is usually the lighting rather than the document.'
              : 'Three photos: the front of your driving licence, the back of it, and one of you. It takes about a minute, and your phone’s camera is the easiest way to do it.'}
          </p>

          <ul className="flex flex-col gap-2">
            {PHOTOS.map((spec) => (
              <li
                key={spec.slot}
                className="flex items-center gap-3 rounded-[12px] border border-brand-border-soft px-3 py-2.5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-brand-stone">
                  <spec.icon
                    aria-hidden
                    strokeWidth={1.75}
                    className="size-4 text-brand-text-subtle"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-brand-text">{spec.title}</span>
                  {spec.optional ? (
                    <span className="block text-xs text-brand-text-subtle">
                      Skippable — a passport has nothing on the back
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          {problem ? <ProblemBox message={problem} /> : null}

          <p className="text-xs leading-relaxed text-brand-text-subtle">
            Your photos are stored against this booking and used to check your
            identity. They are not shared with anyone outside{' '}
            {session.tenant.companyName ?? 'the rental company'}.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-brand-border-soft px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Button
            type="button"
            variant="brand"
            className="h-11 w-full sm:w-auto"
            disabled={start.isPending}
            onClick={() => {
              void handleStart();
            }}
          >
            {start.isPending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Camera aria-hidden className="size-4" />
            )}
            {returning ? 'Take them again' : 'Start — take the first photo'}
          </Button>
        </div>
      </Panel>
    );
  }

  /* ── review and send ────────────────────────────────────────────────── */

  if (stepIndex >= REVIEW_INDEX) {
    return (
      <Panel>
        <PanelHeader
          title="Check these before you send them"
          action={<StatusChip tone="info">{stepLabel} · last photo</StatusChip>}
        />
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
          {reviewRows.map(({ spec, shot }) => (
            <div
              key={spec.slot}
              className="flex items-center gap-3 rounded-[12px] border border-brand-border-soft px-3 py-2.5"
            >
              {shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shot.previewUrl}
                  alt=""
                  className="size-14 shrink-0 rounded-[8px] border border-brand-border-soft object-cover"
                />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-[8px] bg-brand-stone">
                  <spec.icon
                    aria-hidden
                    strokeWidth={1.75}
                    className="size-5 text-brand-text-subtle"
                  />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-brand-text">{spec.title}</span>
                <span className="block text-xs text-brand-text-subtle">
                  {shot ? formatSize(shot.file.size) : spec.optional ? 'Skipped' : 'Still needed'}
                </span>
              </span>
              <Button
                type="button"
                variant="brand-ghost"
                className="h-11 shrink-0"
                onClick={() => setStepIndex(PHOTOS.indexOf(spec))}
              >
                {shot ? 'Change' : 'Add'}
              </Button>
            </div>
          ))}

          {submitError ? <ProblemBox message={submitError} /> : null}

          <p className="text-xs leading-relaxed text-brand-text-subtle">
            Your photos are stored against this booking and used to check your
            identity. They are not shared with anyone outside{' '}
            {session.tenant.companyName ?? 'the rental company'}.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-brand-border-soft px-4 py-3 sm:flex-row sm:justify-between sm:px-5">
          <Button
            type="button"
            variant="brand-outline"
            className="h-11 w-full sm:w-auto"
            onClick={() => setStepIndex(PHOTOS.length - 1)}
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </Button>
          <Button
            type="button"
            variant="brand"
            className="h-11 w-full sm:w-auto"
            disabled={!canSubmit}
            onClick={() => {
              void handleSubmit();
            }}
          >
            <Send aria-hidden className="size-4" />
            Send my documents
          </Button>
        </div>
      </Panel>
    );
  }

  /* ── one photo ──────────────────────────────────────────────────────── */

  const spec = PHOTOS[stepIndex];
  const currentShot = shots[spec.slot];
  const isLastPhoto = stepIndex === PHOTOS.length - 1;

  return (
    <Panel>
      <PanelHeader
        title={spec.title}
        action={
          <StatusChip tone="neutral">
            {stepLabel} · photo {stepIndex + 1} of {PHOTOS.length}
          </StatusChip>
        }
      />

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-brand-text-soft">{spec.guidance}</p>

        {currentShot ? (
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentShot.previewUrl}
              alt={`The ${spec.title.toLowerCase()} you just chose`}
              className="max-h-72 w-full rounded-[14px] border border-brand-border-soft object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-brand-text-subtle">
                {formatSize(currentShot.file.size)}
              </span>
              <Button
                type="button"
                variant="brand-outline"
                className="h-11"
                onClick={() => clearShot(spec.slot)}
              >
                <RotateCcw aria-hidden className="size-4" />
                Take it again
              </Button>
            </div>
          </div>
        ) : (
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              accept(spec.slot, event.dataTransfer.files);
            }}
            className={cn(
              'flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-8 text-center transition-colors',
              dragActive ? 'border-brand-forest bg-brand-stone' : 'border-brand-border bg-brand-card',
            )}
          >
            <Upload aria-hidden strokeWidth={1.75} className="size-5 text-brand-text-subtle" />
            <p className="text-sm text-brand-text-soft">
              {offerCamera
                ? 'Take the photo now, or choose one you already have.'
                : 'Drop the photo here, or choose one from your device.'}
            </p>

            {/*
              Two inputs, not one. The `capture` attribute cannot be toggled per
              press, and a single input carrying it would take the gallery away
              on a phone — which is exactly what a customer needs when the photo
              was taken on another device. `key` forces a fresh element per
              photo so the previous one's `capture` value can never linger.
            */}
            <input
              key={`camera-${spec.slot}`}
              ref={cameraInputRef}
              type="file"
              accept={IDENTITY_ACCEPT_ATTRIBUTE}
              capture={spec.capture}
              className="sr-only"
              onChange={(event) => {
                accept(spec.slot, event.target.files);
                // Cleared so choosing the SAME file twice still fires onChange —
                // which is what "take it again, it was blurry" looks like.
                event.target.value = '';
              }}
            />
            <input
              key={`file-${spec.slot}`}
              ref={fileInputRef}
              type="file"
              accept={IDENTITY_ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                accept(spec.slot, event.target.files);
                event.target.value = '';
              }}
            />

            <div className="mt-1 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {offerCamera ? (
                <Button
                  type="button"
                  variant="brand"
                  className="h-11"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera aria-hidden className="size-4" />
                  Take a photo
                </Button>
              ) : null}
              <Button
                type="button"
                variant={offerCamera ? 'brand-outline' : 'brand'}
                className="h-11"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose a file
              </Button>
            </div>

            <p className="text-xs text-brand-text-subtle">{IDENTITY_FORMATS_LABEL}</p>
          </div>
        )}

        {problem ? <ProblemBox message={problem} /> : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-brand-border-soft px-4 py-3 sm:flex-row sm:justify-between sm:px-5">
        <Button
          type="button"
          variant="brand-outline"
          className="h-11 w-full sm:w-auto"
          disabled={stepIndex === 0}
          onClick={() => {
            setProblem(null);
            setStepIndex((index) => Math.max(0, index - 1));
          }}
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </Button>

        <div className="flex flex-col gap-2 sm:flex-row">
          {spec.optional && currentShot === null ? (
            <Button
              type="button"
              variant="brand-ghost"
              className="h-11 w-full sm:w-auto"
              onClick={() => {
                setProblem(null);
                setStepIndex((index) => index + 1);
              }}
            >
              Skip this
            </Button>
          ) : null}
          <Button
            type="button"
            variant="brand"
            className="h-11 w-full sm:w-auto"
            // Optional photos advance via "Skip this"; the primary button stays
            // honest about needing one rather than silently doing nothing.
            disabled={currentShot === null}
            onClick={() => {
              setProblem(null);
              setStepIndex((index) => index + 1);
            }}
          >
            {isLastPhoto ? 'Review' : 'Continue'}
            <Check aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </Panel>
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
