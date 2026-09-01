'use client';

/**
 * The three-photo capture flow that finishes a paid booking.
 *
 * Front of the document → back of the document (skippable) → a photo of the
 * customer → review → submit. That order and that payload are v1's
 * (`apps/booking/src/app/verify/[token]/page.tsx`); none of its code is ported,
 * and three of its behaviours are deliberately NOT reproduced:
 *
 *  1. v1 writes `verification_step` and `upload_progress` to
 *     `identity_verifications` from the browser. `anon` holds UPDATE on that
 *     table, so that is a client writing the state its own gate is judged on.
 *     Nothing here writes anything but the three photos. See the header of
 *     `hooks/use-booking-documents.ts`.
 *  2. v1 opens a `getUserMedia` stream and paints frames onto a canvas. This
 *     uses `<input type="file" capture>` instead — the OS camera app produces a
 *     better-exposed, correctly-rotated photo than a canvas grab, needs no
 *     permission prompt to *render* the page, and cannot leave a live camera
 *     track running if the component unmounts mid-step (which v1's can).
 *  3. v1 validates `image/*` up to 10 MB against a bucket that enforces 5 MB
 *     and four MIME types, then swallows the storage error. Validation here is
 *     the bucket's real limits and every message names the limit that was hit.
 *
 * ── WHAT THIS SCREEN MAY AND MAY NOT SAY ────────────────────────────────────
 * Uploading documents does NOT confirm a booking. The operator approves it
 * afterwards, and `notify-booking-approved` is the email that says "confirmed".
 * So the words "confirmed" and "complete" do not appear on any success path
 * here — a customer told their booking is confirmed by a screen an operator can
 * still reject has been told something false.
 *
 * A rejection never states a reason. `process-ai-verification` writes
 * `rejection_reason` values including
 * `Blocked identity: <the operator's private note>`, so the reason is not the
 * customer's to read; the hook drops it before it can reach a rendered string.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  Camera,
  CarFront,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  IdCard,
  Link2Off,
  Loader2,
  Mail,
  RefreshCw,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel, PanelHeader } from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import {
  CAPTURE_ACCEPT_ATTRIBUTE,
  CAPTURE_FORMATS_LABEL,
  useBookingDocumentsSession,
  useResendBookingDocumentsLink,
  useSubmitBookingDocuments,
  validateCaptureFile,
  type BookingDocumentsSession,
  type BookingDocumentsVerdict,
} from '@/hooks/use-booking-documents';
import { parseDateOnly } from '@/lib/domain';
import { cn } from '@/lib/utils';

/* ────────────────────────────── the steps ──────────────────────────────── */

type Slot = 'front' | 'back' | 'selfie';

interface StepSpec {
  slot: Slot;
  title: string;
  /** What a good photo looks like. Concrete, not "make sure it is clear". */
  guidance: string;
  /** `environment` is the rear camera, `user` the front one. */
  capture: 'environment' | 'user';
  optional: boolean;
  icon: LucideIcon;
}

const STEPS: readonly StepSpec[] = [
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
      'The same again, turned over. Skip this step if your document has nothing on the back — a passport, for instance.',
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

/** The index after the last capture step: the review-and-submit screen. */
const REVIEW_INDEX = STEPS.length;

interface Shot {
  file: File;
  /** An object URL. Owned by this component and revoked when it is replaced. */
  previewUrl: string;
}

type Shots = Record<Slot, Shot | null>;

const NO_SHOTS: Shots = { front: null, back: null, selfie: null };

/* ─────────────────────────────── helpers ───────────────────────────────── */

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ──────────────────────────── the component ────────────────────────────── */

export function DocumentCapture({ session }: { session: BookingDocumentsSession }) {
  const submit = useSubmitBookingDocuments();

  const [stepIndex, setStepIndex] = useState(0);
  const [shots, setShots] = useState<Shots>(NO_SHOTS);
  const [problem, setProblem] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<BookingDocumentsVerdict | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const setShot = useCallback((slot: Slot, file: File) => {
    const rejection = validateCaptureFile(file);
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

  const clearShot = useCallback((slot: Slot) => {
    setProblem(null);
    setShots((previous) => {
      const existing = previous[slot];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      return { ...previous, [slot]: null };
    });
  }, []);

  const accept = useCallback(
    (slot: Slot, list: FileList | null) => {
      const file = list?.[0];
      if (file) setShot(slot, file);
    },
    [setShot],
  );

  const busy = submit.isPending;
  const step = stepIndex < REVIEW_INDEX ? STEPS[stepIndex] : null;
  const currentShot = step ? shots[step.slot] : null;

  const canSubmit = shots.front !== null && shots.selfie !== null;

  const handleSubmit = useCallback(async () => {
    if (!shots.front || !shots.selfie) {
      setSubmitError(
        'We still need the front of your document and a photo of you before we can check them.',
      );
      return;
    }
    setSubmitError(null);
    try {
      const result = await submit.mutateAsync({
        sessionId: session.sessionId,
        front: shots.front.file,
        back: shots.back?.file ?? null,
        selfie: shots.selfie.file,
      });
      setVerdict(result.verdict);
    } catch (caught: unknown) {
      // The message is already written for a customer — the hook turns storage
      // and transport failures into sentences that name what to do next.
      setSubmitError(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong sending your photos. Please try again.',
      );
    }
  }, [session.sessionId, shots, submit]);

  /** Back to step one with everything cleared, after a rejection. */
  const startOver = useCallback(() => {
    setVerdict(null);
    setSubmitError(null);
    setProblem(null);
    setShots((previous) => {
      for (const shot of Object.values(previous)) {
        if (shot) URL.revokeObjectURL(shot.previewUrl);
      }
      return NO_SHOTS;
    });
    setStepIndex(0);
  }, []);

  const reviewRows = useMemo(
    () =>
      STEPS.map((spec) => ({
        spec,
        shot: shots[spec.slot],
      })),
    [shots],
  );

  /* ── the verdict, once there is one ─────────────────────────────────── */

  if (verdict !== null) {
    return <VerdictPanel verdict={verdict} session={session} onRetry={startOver} />;
  }

  /* ── while the photos are in the air ────────────────────────────────── */

  if (busy) {
    return (
      <Panel className="px-5 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2
            aria-hidden
            strokeWidth={1.75}
            className="size-6 animate-spin text-brand-text-subtle"
          />
          <p className="text-base font-medium text-brand-text">
            Checking your documents
          </p>
          {/*
            One honest sentence rather than a fake stage list. `supabase-js`
            exposes no upload progress, and the OCR and face match happen inside
            one call, so a "step 2 of 4" here would be invented.
          */}
          <p className="max-w-sm text-sm leading-relaxed text-brand-text-soft">
            We are uploading your photos and reading them. This usually takes
            under a minute — please keep this page open.
          </p>
        </div>
      </Panel>
    );
  }

  /* ── review and submit ──────────────────────────────────────────────── */

  if (step === null) {
    return (
      <Panel>
        <PanelHeader
          title="Check these before you send them"
          action={<StatusChip tone="info">Last step</StatusChip>}
        />
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
          {reviewRows.map(({ spec, shot }) => (
            <div
              key={spec.slot}
              className="flex items-center gap-3 rounded-[12px] border border-brand-border-soft px-3 py-2.5"
            >
              {shot ? (
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
                <span className="block truncate text-sm text-brand-text">
                  {spec.title}
                </span>
                <span className="block text-xs text-brand-text-subtle">
                  {shot
                    ? formatSize(shot.file.size)
                    : spec.optional
                      ? 'Skipped'
                      : 'Still needed'}
                </span>
              </span>
              <Button
                type="button"
                variant="brand-ghost"
                className="h-11 shrink-0"
                onClick={() => setStepIndex(STEPS.indexOf(spec))}
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
            className="h-11"
            onClick={() => setStepIndex(STEPS.length - 1)}
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back
          </Button>
          <Button
            type="button"
            variant="brand"
            className="h-11"
            disabled={!canSubmit}
            onClick={() => {
              void handleSubmit();
            }}
          >
            <ShieldCheck aria-hidden className="size-4" />
            Send my documents
          </Button>
        </div>
      </Panel>
    );
  }

  /* ── one capture step ───────────────────────────────────────────────── */

  const isLastCapture = stepIndex === STEPS.length - 1;

  return (
    <Panel>
      <PanelHeader
        title={step.title}
        action={
          <StatusChip tone="neutral">
            Step {stepIndex + 1} of {STEPS.length}
          </StatusChip>
        }
      />

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-brand-text-soft">{step.guidance}</p>

        {currentShot ? (
          <div className="flex flex-col gap-3">
            <img
              src={currentShot.previewUrl}
              alt={`The ${step.title.toLowerCase()} you just chose`}
              className="max-h-72 w-full rounded-[14px] border border-brand-border-soft object-contain"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-brand-text-subtle">
                {formatSize(currentShot.file.size)}
              </span>
              <Button
                type="button"
                variant="brand-outline"
                className="h-11"
                onClick={() => clearShot(step.slot)}
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
              accept(step.slot, event.dataTransfer.files);
            }}
            className={cn(
              'flex flex-col items-center gap-2 rounded-[14px] border border-dashed px-4 py-8 text-center transition-colors',
              dragActive
                ? 'border-brand-forest bg-brand-stone'
                : 'border-brand-border bg-brand-card',
            )}
          >
            <Upload
              aria-hidden
              strokeWidth={1.75}
              className="size-5 text-brand-text-subtle"
            />
            <p className="text-sm text-brand-text-soft">
              {offerCamera
                ? 'Take the photo now, or choose one you already have.'
                : 'Drop the photo here, or choose one from your device.'}
            </p>

            {/*
              Two inputs, not one. The `capture` attribute cannot be toggled per
              press, and a single input carrying it would take the gallery away
              on a phone — which is exactly what a customer needs when the photo
              was taken on another device. `key` forces a fresh element per step
              so the previous step's `capture` value can never linger.
            */}
            <input
              key={`camera-${step.slot}`}
              ref={cameraInputRef}
              type="file"
              accept={CAPTURE_ACCEPT_ATTRIBUTE}
              capture={step.capture}
              className="sr-only"
              onChange={(event) => {
                accept(step.slot, event.target.files);
                // Cleared so choosing the SAME file twice still fires onChange —
                // which is what "take it again, it was blurry" looks like.
                event.target.value = '';
              }}
            />
            <input
              key={`file-${step.slot}`}
              ref={fileInputRef}
              type="file"
              accept={CAPTURE_ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                accept(step.slot, event.target.files);
                event.target.value = '';
              }}
            />

            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
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

            <p className="text-xs text-brand-text-subtle">{CAPTURE_FORMATS_LABEL}</p>
          </div>
        )}

        {problem ? <ProblemBox message={problem} /> : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-brand-border-soft px-4 py-3 sm:flex-row sm:justify-between sm:px-5">
        <Button
          type="button"
          variant="brand-outline"
          className="h-11"
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
          {step.optional && currentShot === null ? (
            <Button
              type="button"
              variant="brand-ghost"
              className="h-11"
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
            className="h-11"
            // Optional steps advance via "Skip this"; the primary button stays
            // honest about needing a photo rather than silently doing nothing.
            disabled={currentShot === null}
            onClick={() => {
              setProblem(null);
              setStepIndex((index) => index + 1);
            }}
          >
            {isLastCapture ? 'Review' : 'Continue'}
            <Check aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ─────────────────────────── shared fragments ──────────────────────────── */

function ProblemBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-[14px] border border-danger-subtle/40 bg-danger-light px-4 py-3"
    >
      <CircleAlert
        aria-hidden
        strokeWidth={1.75}
        className="mt-0.5 size-4 shrink-0 text-danger"
      />
      <p className="min-w-0 text-sm leading-relaxed text-brand-text">{message}</p>
    </div>
  );
}

/**
 * What the customer is told once the check has run.
 *
 * Read the copy carefully before editing it. `verified` and `review_required`
 * are both "we have your documents" and NEITHER is "your booking is confirmed"
 * — the operator's approval is a separate, later event, and
 * `notify-booking-approved` is the email that carries that word. `rejected`
 * offers another go and gives no reason.
 */
function VerdictPanel({
  verdict,
  session,
  onRetry,
}: {
  verdict: BookingDocumentsVerdict;
  session: BookingDocumentsSession;
  onRetry: () => void;
}) {
  const operator = session.tenant.companyName ?? 'the rental company';

  if (verdict === 'rejected') {
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
          <Button type="button" variant="brand" className="mt-1 h-11" onClick={onRetry}>
            <Camera aria-hidden className="size-4" />
            Try again
          </Button>
          <p className="max-w-md text-xs leading-relaxed text-brand-text-subtle">
            Your booking and your payment are unaffected. If it still will not go
            through, get in touch with {operator} and they will take it from
            here.
          </p>
        </div>
      </Panel>
    );
  }

  const isReview = verdict === 'review_required';

  return (
    <Panel className="px-5 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-success-light">
          <ShieldCheck aria-hidden strokeWidth={1.75} className="size-5 text-success" />
        </span>
        <p className="text-base font-medium text-brand-text">
          {isReview ? 'We have everything we need' : 'Your documents are in'}
        </p>
        <p className="max-w-md text-sm leading-relaxed text-brand-text-soft">
          {isReview
            ? `Someone at ${operator} is taking a look at them now.`
            : `They have gone to ${operator} for approval.`}{' '}
          {/*
            THE ONE SENTENCE THIS SCREEN EXISTS TO GET RIGHT. Nothing here says
            confirmed, complete or booked.
          */}
          Your booking is not confirmed yet — we will email you the moment it is,
          and there is nothing else for you to do until then.
        </p>
        {session.rental.rentalNumber ? (
          <StatusChip tone="neutral" className="mt-1">
            Booking {session.rental.rentalNumber}
          </StatusChip>
        ) : null}
        <p className="max-w-md text-xs leading-relaxed text-brand-text-subtle">
          You can close this page. The link in your email will bring you back
          here if you need it.
        </p>
      </div>
    </Panel>
  );
}

/* ═══════════════════════════ the whole screen ═══════════════════════════ */

/**
 * Everything the token-addressed page renders, from the first request onward.
 *
 * The route component above this is a server component whose only job is to
 * await `params` (Next 16) — see the page — so the session query, the branching
 * and the branding all live here, on the client, where they can be one closed
 * `switch` over `BookingDocumentsState`.
 *
 * THIS SURFACE IS PUBLIC. The person reading it has just paid inside Stripe
 * Elements and has NO account: `lib/booking/create-booking.ts` writes a
 * `customers` row and nothing else — no `auth.users`, no `customer_users`, no
 * session. So nothing here may touch `useCustomer`, `useAuth` or the portal auth
 * store, and the route deliberately sits under `(booking)` rather than
 * `(portal)`, whose layout redirects an unauthenticated visitor to /login.
 *
 * ── FIVE SCREENS, NOT ONE ERROR BOX ─────────────────────────────────────────
 * "this link was never valid", "this link has run out", "we already have these",
 * "this booking is gone" and "we could not reach the service" are four different
 * true sentences and one honest admission. A customer who has already been
 * charged and is now looking at a red box that says "Error" has no idea which of
 * those they are in, and two of the five have a button that fixes them.
 */
export function BookingDocumentsScreen({ token }: { token: string }) {
  const { state, isLoading, isRefetching, refetch } = useBookingDocumentsSession(token);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      {/*
        Branding is rendered from what the LINK FUNCTION returned, not from
        `TenantContext`. This page is opened from an email that may land on the
        apex host rather than the tenant's subdomain, so the context's tenant can
        legitimately be the wrong one — or absent. The function resolved the
        tenant from the rental itself, which is the only source that cannot be
        wrong here. (v1's capture page fetches the tenant name and then never
        renders it — `apps/booking/src/app/verify/[token]/page.tsx:590-591`.)
      */}
      <BrandHeader session={state?.kind === 'ready' ? state.session : null} />

      {state === null || isLoading ? (
        <LoadingScreen />
      ) : state.kind === 'ready' ? (
        <ReadyScreen session={state.session} />
      ) : state.kind === 'invalid_token' ? (
        <NoticeScreen
          icon={Link2Off}
          tone="danger"
          title="This link is not valid"
          body="It may have been mistyped, or only part of it was copied across. Open the link straight from your booking email rather than pasting it, and if it still will not work, reply to that email and we will sort it out."
        />
      ) : state.kind === 'link_expired' ? (
        <ExpiredScreen
          token={token}
          canResend={state.canResend}
          onReopened={refetch}
          reopening={isRefetching}
        />
      ) : state.kind === 'already_complete' ? (
        <NoticeScreen
          icon={CircleCheck}
          tone="success"
          title="We already have your documents"
          /*
            NOT "your booking is confirmed". This state means
            `rentals.documents_status = 'verified'` — the operator's approval is
            a separate, later event that this page cannot see, and asserting
            either way would be a guess. So it says what is certainly true: there
            is nothing left for the customer to do HERE.
          */
          body="There is nothing left for you to do on this page. If anything else is needed for your booking, the team will be in touch by email."
        />
      ) : state.kind === 'booking_cancelled' ? (
        <NoticeScreen icon={Ban} tone="danger" title="This booking is closed" body={state.message} />
      ) : (
        <NoticeScreen
          icon={CircleAlert}
          tone="warning"
          title="We could not open your link"
          body={state.message}
          action={
            <Button
              type="button"
              variant="brand"
              className="h-11"
              disabled={isRefetching}
              onClick={() => {
                void refetch();
              }}
            >
              {isRefetching ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden className="size-4" />
              )}
              Try again
            </Button>
          }
        />
      )}
    </div>
  );
}

/* ───────────────────────────── the ready path ──────────────────────────── */

function ReadyScreen({ session }: { session: BookingDocumentsSession }) {
  const operator = session.tenant.companyName ?? 'the rental company';

  return (
    <div className="flex flex-col gap-5">
      {/*
        THE GATE, IN ONE SENTENCE, ABOVE EVERYTHING ELSE.

        Three facts in this order, because that is the order the customer's
        anxiety runs in: the money arrived, the booking is NOT finished, and here
        is the one thing left to do. Getting the middle clause wrong — or leaving
        it out — is how a customer walks away believing they are booked.
      */}
      <Panel className="px-4 py-4 sm:px-5">
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-light">
            <CircleCheck aria-hidden strokeWidth={1.75} className="size-4.5 text-success" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-medium text-brand-text sm:text-lg">
              Your payment has gone through
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
              Your booking is <span className="font-medium text-brand-text">not complete yet</span>.
              We need a photo of your driving licence and a photo of you before{' '}
              {operator} can confirm it — it takes about two minutes.
            </p>
          </div>
        </div>

        <BookingSummary session={session} />
      </Panel>

      <DocumentCapture session={session} />

      <p className="px-1 text-xs leading-relaxed text-brand-text-subtle">
        This page belongs to your booking, so keep the link to yourself. It stays
        open for seven days, and every visit extends it — if it ever does run out,
        the page will offer to email you a fresh one.
      </p>
    </div>
  );
}

/** The three facts that prove the link opened the RIGHT booking. */
function BookingSummary({ session }: { session: BookingDocumentsSession }) {
  const dates = formatDateRange(session.rental.startDate, session.rental.endDate);
  const rows: { icon: LucideIcon; label: string; value: string }[] = [];

  if (session.rental.rentalNumber) {
    rows.push({ icon: ShieldCheck, label: 'Booking', value: session.rental.rentalNumber });
  }
  if (session.rental.vehicleLabel) {
    rows.push({ icon: CarFront, label: 'Vehicle', value: session.rental.vehicleLabel });
  }
  if (dates) {
    rows.push({ icon: CalendarDays, label: 'Dates', value: dates });
  }

  // Nothing to show is a real possibility (every field is nullable server-side),
  // and an empty bordered strip reads as a loading bug. Render nothing instead.
  if (rows.length === 0) return null;

  return (
    <dl className="mt-4 flex flex-col gap-2 border-t border-brand-border-soft pt-4 sm:flex-row sm:gap-6">
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-center gap-2">
          <row.icon
            aria-hidden
            strokeWidth={1.75}
            className="size-4 shrink-0 text-brand-text-subtle"
          />
          <dt className="sr-only">{row.label}</dt>
          <dd className="min-w-0 truncate text-sm text-brand-text-soft">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `start_date` and `end_date` are Postgres DATE columns — confirmed against
 * staging's information_schema, not assumed — so they arrive as bare
 * "YYYY-MM-DD". `new Date()` would read them as UTC midnight and render the day
 * BEFORE for every viewer west of Greenwich. `parseDateOnly` is the one parser
 * in v2 that handles this; see the trap note at the top of `lib/domain/date-utils.ts`.
 */
function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const format = (value: string) =>
    parseDateOnly(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return end ? `${format(start)} — ${format(end)}` : format(start);
}

/* ──────────────────────────── the other screens ────────────────────────── */

function BrandHeader({ session }: { session: BookingDocumentsSession | null }) {
  const name = session?.tenant.companyName ?? null;
  const logo = session?.tenant.logoUrl ?? null;

  if (!name && !logo) return null;

  return (
    <div className="mb-6 flex items-center gap-3">
      {logo ? (
        // A plain <img>, matching `auth-brand.tsx`. next/image is not configured
        // with a remote pattern for tenant logo hosts in this app.
        <img src={logo} alt="" className="h-9 w-auto max-w-[160px] object-contain" />
      ) : null}
      {name ? <span className="text-sm font-medium text-brand-text">{name}</span> : null}
    </div>
  );
}

function LoadingScreen() {
  return (
    <Panel className="flex flex-col gap-3 px-4 py-5 sm:px-5">
      <Skeleton className="h-5 w-56 bg-brand-stone" />
      <Skeleton className="h-4 w-full bg-brand-stone" />
      <Skeleton className="h-4 w-2/3 bg-brand-stone" />
      <Skeleton className="mt-3 h-40 w-full rounded-[14px] bg-brand-stone" />
    </Panel>
  );
}

const NOTICE_TONE = {
  success: { wrap: 'bg-success-light', icon: 'text-success' },
  warning: { wrap: 'bg-warning-light', icon: 'text-warning' },
  danger: { wrap: 'bg-danger-light', icon: 'text-danger' },
} as const;

function NoticeScreen({
  icon: Icon,
  tone,
  title,
  body,
  action,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof NOTICE_TONE;
  title: string;
  body: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const palette = NOTICE_TONE[tone];
  return (
    <Panel className="px-5 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className={cn('grid size-11 place-items-center rounded-full', palette.wrap)}>
          <Icon aria-hidden strokeWidth={1.75} className={cn('size-5', palette.icon)} />
        </span>
        <h1 className="text-base font-medium text-brand-text">{title}</h1>
        <p className="max-w-md text-sm leading-relaxed text-brand-text-soft">{body}</p>
        {action ? <div className="mt-1">{action}</div> : null}
        {children}
      </div>
    </Panel>
  );
}

/**
 * An expired link, with the button that actually fixes it.
 *
 * REQUIRED BEHAVIOUR, not a nicety. v1's expired screen reads "Please request a
 * new verification link" and offers nothing to press
 * (`apps/booking/src/app/verify/[token]/page.tsx:463-477`), and every other
 * re-send path in the product needs operator staff auth — so a customer who let
 * their link lapse was stranded with a paid booking.
 *
 * The button is rendered ONLY when the server said `canResend`. A cancelled
 * booking also answers 410 and sets it false; offering a button there would be
 * offering one that can never succeed.
 *
 * ── WHY A SUCCESSFUL RESEND ALSO REOPENS THIS PAGE ──────────────────────────
 * `handleResend` slides THIS token's `expires_at` forward BEFORE it enqueues the
 * email, and returns 500 if that slide fails (`booking-documents-link/index.ts:296-306`).
 * So a 200 means the link in front of the customer is live again — they do not
 * have to wait for an inbox at all. Refetching is therefore not optimism, it is
 * reading back a change the server has already committed.
 */
function ExpiredScreen({
  token,
  canResend,
  onReopened,
  reopening,
}: {
  token: string;
  canResend: boolean;
  onReopened: () => Promise<unknown>;
  reopening: boolean;
}) {
  const resend = useResendBookingDocumentsLink();

  if (!canResend) {
    return (
      <NoticeScreen
        icon={Clock}
        tone="warning"
        title="This link has expired"
        body="We cannot reopen it from here. Reply to your booking email and the team will send you a new one."
      />
    );
  }

  if (resend.isSuccess) {
    return (
      <NoticeScreen
        icon={Mail}
        tone="success"
        title="A new link is on its way"
        // Deliberately does not name the address: the function does not return
        // one, and inventing "sent to your email" is as much as can be promised.
        body="We have emailed a fresh link to the address on your booking. It can take a minute or two, and it is worth checking your spam folder."
      >
        <div className="mt-1 flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="brand"
            className="h-11"
            disabled={reopening}
            onClick={() => {
              void onReopened();
            }}
          >
            {reopening ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <RefreshCw aria-hidden className="size-4" />
            )}
            Carry on here instead
          </Button>
          <p className="max-w-sm text-xs leading-relaxed text-brand-text-subtle">
            Sending the email reopened this page too, so you can go straight on
            without waiting for it.
          </p>
        </div>
      </NoticeScreen>
    );
  }

  return (
    <NoticeScreen
      icon={Clock}
      tone="warning"
      title="This link has expired"
      body="Links stay open for seven days. Yours has run out, but a new one takes a second — nothing about your booking or your payment has changed."
      action={
        <Button
          type="button"
          variant="brand"
          className="h-11"
          disabled={resend.isPending}
          onClick={() => {
            resend.mutate({ token });
          }}
        >
          {resend.isPending ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Mail aria-hidden className="size-4" />
          )}
          Email me a new link
        </Button>
      }
    >
      {resend.isError ? (
        <div className="mt-3 w-full max-w-md">
          {/* The hook has already turned every server code into a sentence a
              customer can act on — rate limit, unpaid booking, cancelled
              booking — so it is shown as written rather than re-worded here. */}
          <ProblemBox message={resend.error.message} />
        </div>
      ) : null}
    </NoticeScreen>
  );
}
