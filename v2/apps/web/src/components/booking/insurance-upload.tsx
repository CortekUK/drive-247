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
 * ── WHERE THE LICENCE-AND-SELFIE CAPTURE WENT ───────────────────────────────
 * It was removed from this screen, and `components/booking/document-capture.tsx`
 * was deleted with it. Not hidden, not left dead — deleted, and recorded here so
 * nobody thinks it was lost by accident. The reasoning, in full:
 *
 *  * The ask was insurance. The identity capture was a misreading of
 *    "documents", so keeping it as a second step would keep shipping the
 *    misreading and make a post-payment errand four steps instead of one.
 *  * The two do not compose. Identity capture ends in an AI VERDICT
 *    (`verified` / `review_required` / `rejected`) from `process-ai-verification`,
 *    which also owns `documents_status = 'verified'`. On a shared screen a
 *    `rejected` licence photo would render "we could not read your documents"
 *    over a perfectly good insurance PDF the customer had just sent, and the
 *    booking's single `documents_status` column would have two writers
 *    disagreeing about what it meant.
 *  * It was not free to keep. Every page open minted or reused an
 *    `identity_verifications` session, which caps a customer at ten per hour and
 *    sets `customers.identity_verification_status = 'pending'` as a side effect
 *    — a false statement about a customer who is uploading an insurance policy.
 *
 * If identity verification is wanted back, it belongs behind its OWN token
 * action and its own screen, with its own status column — not stapled to this
 * one. The deleted component is one `git show` away and its edge functions
 * (`create-ai-verification-session`, `process-ai-verification`,
 * `validate-ai-session`) are all still deployed and untouched; v1's QR flow
 * still uses them.
 *
 * ── WHAT THIS SCREEN MAY AND MAY NOT SAY ────────────────────────────────────
 * Uploading does NOT confirm a booking. An operator reviews the document
 * afterwards and can still reject it, and `notify-booking-approved` is the email
 * that carries the word "confirmed". So the words "confirmed" and "complete" do
 * not appear on any success path here. What they say instead is: received,
 * under review, we will confirm shortly.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Ban,
  CalendarDays,
  CarFront,
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  Link2Off,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel, PanelHeader } from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import {
  INSURANCE_ACCEPT_ATTRIBUTE,
  INSURANCE_FORMATS_LABEL,
  MAX_INSURANCE_FILES,
  insuranceObjectName,
  useBookingDocumentsSession,
  useResendBookingDocumentsLink,
  useSubmitBookingInsurance,
  validateInsuranceFile,
  type BookingDocumentsSession,
  type InsuranceFileState,
} from '@/hooks/use-booking-documents';
import { parseDateOnly } from '@/lib/domain';
import { cn } from '@/lib/utils';

/* ─────────────────────────────── helpers ───────────────────────────────── */

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** One file in the tray, with where it has got to. */
interface Pick {
  file: File;
  /** The object name it will be stored under. Also this list's identity key. */
  key: string;
  state: InsuranceFileState;
  error: string | null;
}

/* ──────────────────────────── the upload tray ──────────────────────────── */

function InsuranceUpload({
  token,
  session,
  alreadySubmitted,
}: {
  token: string;
  session: BookingDocumentsSession;
  /** True when the server says this booking already has documents on file. */
  alreadySubmitted: boolean;
}) {
  const submit = useSubmitBookingInsurance();

  const [picks, setPicks] = useState<Pick[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /*
    `picks` has to be readable from inside the mutation's per-file callback,
    which is created once per submit and would otherwise close over a stale
    array. The ref mirrors it; the state is what renders.
  */
  const picksRef = useRef<Pick[]>(picks);
  picksRef.current = picks;

  const busy = submit.isPending;

  const add = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;

      const incoming = Array.from(list);
      const rejections: string[] = [];

      /*
        COMPUTED OUT HERE, NOT INSIDE A setPicks UPDATER, AND THAT MATTERS.

        This loop has a side effect: it fills `rejections`, which is read on the
        last line to tell the customer what was refused. A state updater is not
        the place for that. React calls an updater during the RENDER, not at the
        call site, and only runs it early via an eager-state optimisation it
        skips whenever the fiber already has pending work. So the moment a
        second batch arrives while a re-render is still queued, `rejections`
        would still be empty when `setProblem` read it and the customer's
        oversized or wrong-type file would disappear with no explanation at all
        — the one case this message exists for. Reading the ref and setting a
        plain value keeps the message and the list derived from the same base.
      */
      const previous = picksRef.current;
      const seen = new Set(previous.map((pick) => pick.key));
      const next = [...previous];
      let duplicates = 0;

      for (const file of incoming) {
        const rejection = validateInsuranceFile(file);
        if (rejection) {
          rejections.push(rejection);
          continue;
        }
        // Deduped on the OBJECT name rather than the display name: two names
        // that sanitise to the same object ARE the same object, and letting
        // both in would silently overwrite one with the other.
        const key = insuranceObjectName(file.name);
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        if (next.length >= MAX_INSURANCE_FILES) {
          rejections.push(
            `We can take ${MAX_INSURANCE_FILES} files at a time. “${file.name}” was not added.`,
          );
          continue;
        }
        seen.add(key);
        next.push({ file, key, state: 'queued', error: null });
      }

      if (duplicates > 0) {
        rejections.push(
          duplicates === 1
            ? 'One file was already in the list, so it was not added twice.'
            : `${duplicates} files were already in the list, so they were not added twice.`,
        );
      }

      // Kept in step immediately so two drops in the same tick build on each
      // other rather than the second discarding the first.
      picksRef.current = next;
      setPicks(next);

      // Every rejected file is named, with the limit it hit. A single "some
      // files were rejected" leaves a customer nothing to change.
      setProblem(rejections.length > 0 ? rejections.join(' ') : null);
    },
    [],
  );

  const remove = useCallback((key: string) => {
    setProblem(null);
    // Ref kept in step for the same reason as `add`: a removal followed by a
    // drop in the same tick must not resurrect the file that was just removed.
    const next = picksRef.current.filter((pick) => pick.key !== key);
    picksRef.current = next;
    setPicks(next);
  }, []);

  const handleSubmit = useCallback(async () => {
    const files = picksRef.current.map((pick) => pick.file);
    if (files.length === 0) {
      setProblem('Please choose at least one file to send.');
      return;
    }
    setProblem(null);
    setPicks((previous) =>
      previous.map((pick) => ({ ...pick, state: 'queued' as const, error: null })),
    );

    try {
      const result = await submit.mutateAsync({
        token,
        uploadPrefix: session.uploadPrefix,
        files,
        onFileState: (index, state, error) => {
          setPicks((previous) =>
            previous.map((pick, position) =>
              position === index ? { ...pick, state, error: error ?? null } : pick,
            ),
          );
        },
      });
      setSentCount(result.submitted);
      setPicks([]);
    } catch (caught: unknown) {
      // The hook has already turned storage and transport failures into
      // sentences that name the file and what to do next.
      setProblem(
        caught instanceof Error
          ? caught.message
          : 'Something went wrong sending your files. Please try again.',
      );
    }
  }, [session.uploadPrefix, submit, token]);

  /* ── the receipt, once something has been sent ─────────────────────── */

  if (sentCount !== null) {
    return (
      <ReceivedPanel
        session={session}
        count={sentCount}
        onAddMore={() => {
          setSentCount(null);
          setProblem(null);
        }}
      />
    );
  }

  const storedCount = picks.filter((pick) => pick.state === 'stored').length;

  return (
    <Panel>
      <PanelHeader
        title={alreadySubmitted ? 'Send another document' : 'Your insurance document'}
        action={
          picks.length > 0 ? (
            <StatusChip tone="neutral">
              {picks.length} {picks.length === 1 ? 'file' : 'files'}
            </StatusChip>
          ) : null
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

      <div className="flex flex-col gap-2 border-t border-brand-border-soft px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button
          type="button"
          variant="brand"
          className="h-11 w-full sm:w-auto"
          disabled={picks.length === 0 || busy}
          onClick={() => {
            void handleSubmit();
          }}
        >
          {busy ? (
            <Loader2 aria-hidden className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden className="size-4" />
          )}
          {busy ? 'Sending…' : 'Send my document'}
        </Button>
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

/**
 * What the customer is told once the files are filed.
 *
 * READ THE COPY BEFORE EDITING IT. This is "we have it and we are looking at
 * it", and it is NOT "your booking is confirmed" — the operator's approval is a
 * separate, later event that this page cannot see, and `notify-booking-approved`
 * is the email that carries that word. The words "confirmed" and "complete" do
 * not appear.
 */
function ReceivedPanel({
  session,
  count,
  onAddMore,
}: {
  session: BookingDocumentsSession;
  count: number;
  onAddMore: () => void;
}) {
  const operator = session.tenant.companyName ?? 'the rental company';

  return (
    <Panel className="px-5 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-success-light">
          <ShieldCheck aria-hidden strokeWidth={1.75} className="size-5 text-success" />
        </span>
        <p className="text-base font-medium text-brand-text">
          {count === 1 ? 'Your document has arrived' : 'Your documents have arrived'}
        </p>
        <p className="max-w-md text-sm leading-relaxed text-brand-text-soft">
          {count === 1 ? 'It is' : 'They are'} now under review by {operator}. Your
          booking is not confirmed yet — we will email you as soon as it is, and
          there is nothing else for you to do until then.
        </p>
        {session.rental.rentalNumber ? (
          <StatusChip tone="neutral" className="mt-1">
            Booking {session.rental.rentalNumber}
          </StatusChip>
        ) : null}
        <Button type="button" variant="brand-outline" className="mt-1 h-11" onClick={onAddMore}>
          <Upload aria-hidden className="size-4" />
          Send another document
        </Button>
        <p className="max-w-md text-xs leading-relaxed text-brand-text-subtle">
          You can close this page. The link in your email will bring you back here
          for the next seven days if you need it.
        </p>
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
      <CircleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="min-w-0 text-sm leading-relaxed text-brand-text">{message}</p>
    </div>
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
        wrong here.
      */}
      <BrandHeader session={state?.kind === 'ready' ? state.session : null} />

      {state === null || isLoading ? (
        <LoadingScreen />
      ) : state.kind === 'ready' ? (
        <ReadyScreen token={token} session={state.session} />
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
          title="We already have your insurance document"
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

function ReadyScreen({
  token,
  session,
}: {
  token: string;
  session: BookingDocumentsSession;
}) {
  const operator = session.tenant.companyName ?? 'the rental company';

  /*
    'submitted' is what `submit-insurance` writes, so this is a customer coming
    BACK to a booking whose documents are already with the operator — most often
    because they want to add a page they missed. They are told where things
    stand rather than being asked again as though nothing had happened.
    ('verified' never reaches here: the server answers `already_complete`.)
  */
  const alreadySubmitted = session.documentsStatus === 'submitted';

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
              {alreadySubmitted ? (
                <>
                  We have your insurance document and it is{' '}
                  <span className="font-medium text-brand-text">under review</span> by{' '}
                  {operator}. Your booking is not confirmed yet — we will email you
                  as soon as it is. You can send another document below if you have
                  more to add.
                </>
              ) : (
                <>
                  Your booking is{' '}
                  <span className="font-medium text-brand-text">not confirmed yet</span>.
                  We need a copy of your insurance document before {operator} can
                  confirm it — it takes about a minute.
                </>
              )}
            </p>
          </div>
        </div>

        <BookingSummary session={session} />
      </Panel>

      <InsuranceUpload token={token} session={session} alreadySubmitted={alreadySubmitted} />

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
          <row.icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-brand-text-subtle" />
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
 * email, and returns 500 if that slide fails. So a 200 means the link in front
 * of the customer is live again — they do not have to wait for an inbox at all.
 * Refetching is therefore not optimism, it is reading back a change the server
 * has already committed.
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
