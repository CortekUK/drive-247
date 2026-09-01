'use client';

/**
 * The post-payment errand, whole: RESOLVE THE TOKEN, THEN RUN TWO STEPS.
 *
 * This file owns everything about the token-addressed screen that is not one of
 * the two steps themselves — the link states (invalid, expired, cancelled,
 * already checked), the branding, the "your payment has gone through" header,
 * and the rail that says how far through the errand the customer is. The steps
 * live next door: `identity-capture.tsx` is step one, `insurance-upload.tsx` is
 * step two.
 *
 * ── WHY TWO STEPS AND NOT ONE WIDGET ────────────────────────────────────────
 * v1 collects both things after payment, and so do we. An earlier build of this
 * surface fused them into a single component and every problem it had came from
 * the fusion:
 *
 *  * The two do not have the same shape. A licence is PHOTOGRAPHED — rear
 *    camera, one frame at a time, retake until it is readable. An insurance
 *    certificate is a PDF the customer already has in their inbox — a file
 *    picker, several files, no camera anywhere. One widget served neither.
 *  * They must not share a status column, and they do not: identity ends on
 *    `booking_document_links.identity_status`, insurance moves
 *    `rentals.documents_status` / `insurance_status`. With one column and two
 *    writers, a rejected licence photo renders "we could not read your
 *    documents" over an insurance PDF that arrived five minutes earlier.
 *  * The identity session must be minted LAZILY. `create-ai-verification-session`
 *    caps a customer at ten an hour and sets
 *    `customers.identity_verification_status = 'pending'` as a side effect. The
 *    fused build minted one on every page open, so ten refreshes locked a
 *    customer out of their own paid booking and left a false statement on their
 *    record. Opening this screen mints NOTHING; a session appears when the
 *    customer presses Start inside step one, and from nowhere else.
 *
 * ── WHY EITHER ORDER WORKS ──────────────────────────────────────────────────
 * The steps are numbered because a numbered list is how a person judges how
 * much is left, but they are not a wizard: whichever is outstanding opens by
 * default, and the other can be opened at any time from its own row. Nothing
 * server-side cares about the order — `start-identity`/`submit-identity` and
 * `submit-insurance` are three independent actions on the same token — and a
 * customer whose insurance PDF is to hand but whose licence is in another room
 * should not be stuck.
 *
 * ── WHO DECIDES A STEP IS DONE ──────────────────────────────────────────────
 * The SERVER, always. `identityDone` and `insuranceDone` below start from what
 * the link function reported and are only ever moved by a step's `onSubmitted`,
 * which fires after the server has come back from the write. The browser marks
 * nothing on its own: `identity_verifications` has RLS off with an anon UPDATE
 * grant on staging, so a page that could stamp its own completion is a page
 * that can be made to lie about it.
 *
 * ── WHAT THIS SCREEN MAY AND MAY NOT SAY ────────────────────────────────────
 * Sending documents is not approval. An operator reviews them afterwards and
 * can still reject the booking, and `notify-booking-approved` is the only email
 * in the product that carries the word "confirmed". So no success path here says
 * "confirmed" or "complete" — what they say is: received, under review, we will
 * confirm shortly.
 */

import { useCallback, useState } from 'react';
import {
  Ban,
  CalendarDays,
  CarFront,
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  IdCard,
  Link2Off,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Panel, PanelHeader } from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import {
  BrandHeader,
  LoadingScreen,
  NoticeScreen,
  ProblemBox,
} from '@/components/booking/documents-shared';
import { IdentityCapture, IdentityReceivedPanel } from '@/components/booking/identity-capture';
import { InsuranceUpload } from '@/components/booking/insurance-upload';
import {
  useBookingDocumentsSession,
  useResendBookingDocumentsLink,
  type BookingDocumentsSession,
} from '@/hooks/use-booking-documents';
import { parseDateOnly } from '@/lib/domain';
import { cn } from '@/lib/utils';

/* ──────────────────────────────── the shell ────────────────────────────── */

export function BookingDocumentsScreen({ token }: { token: string }) {
  const { state, isLoading, isRefetching, refetch } = useBookingDocumentsSession(token);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
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
          title="We already have what we need"
          /*
            NOT "your booking is confirmed". This state means
            `rentals.documents_status = 'verified'` — the operator's approval is
            a separate, later event that this page cannot see, and asserting
            either way would be a guess. So it says what is certainly true:
            there is nothing left for the customer to do HERE.
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

/* ─────────────────────────── the two-step errand ───────────────────────── */

type StepKey = 'identity' | 'insurance';

const STEP_LABEL: Record<StepKey, string> = {
  identity: 'Step 1 of 2',
  insurance: 'Step 2 of 2',
};

function ReadyScreen({
  token,
  session,
}: {
  token: string;
  session: BookingDocumentsSession;
}) {
  const operator = session.tenant.companyName ?? 'the rental company';

  /*
    THE SERVER'S WORD IS THE STARTING POINT FOR BOTH STEPS.

    `identityStatus` is `booking_document_links.identity_status`: null (never
    started), 'pending' (a session was minted but nothing came back), 'submitted'
    or 'rejected'. Only 'submitted' is done — a rejection is emphatically not,
    and step one renders its own retry panel for it.

    `documentsStatus` is the INSURANCE step, and 'submitted' is what
    `submit-insurance` writes. ('verified' never reaches here: the server answers
    `already_complete` and this screen is not rendered at all.)
  */
  const [identitySent, setIdentitySent] = useState(false);
  const [insuranceSent, setInsuranceSent] = useState(false);

  const identityDone = identitySent || session.identityStatus === 'submitted';
  const insuranceDone = insuranceSent || session.documentsStatus === 'submitted';

  /*
    Which step is expanded. `null` means "whichever is outstanding" — recomputed
    on every render rather than stored, so finishing one step opens the other
    without an effect. A press pins it; finishing a step un-pins it so the
    default takes over again.
  */
  const [pinned, setPinned] = useState<StepKey | null>(null);
  const openStep: StepKey | null = pinned ?? (!identityDone ? 'identity' : !insuranceDone ? 'insurance' : null);

  const handleIdentitySubmitted = useCallback(() => {
    setIdentitySent(true);
    setPinned(null);
  }, []);

  const handleInsuranceSubmitted = useCallback(() => {
    setInsuranceSent(true);
    setPinned(null);
  }, []);

  const bothDone = identityDone && insuranceDone;
  const outstanding = (identityDone ? 0 : 1) + (insuranceDone ? 0 : 1);

  return (
    <div className="flex flex-col gap-5">
      {/*
        THE GATE, IN ONE SENTENCE, ABOVE EVERYTHING ELSE.

        Three facts in this order, because that is the order the customer's
        anxiety runs in: the money arrived, the booking is NOT finished, and here
        is what is left to do. Getting the middle clause wrong — or leaving it
        out — is how a customer walks away believing they are booked.
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
              {bothDone ? (
                <>
                  We have everything we asked for, and it is all{' '}
                  <span className="font-medium text-brand-text">under review</span> by{' '}
                  {operator}. Your booking is not confirmed yet — we will email you as
                  soon as it is, and there is nothing else for you to do until then.
                </>
              ) : outstanding === 1 ? (
                <>
                  Your booking is{' '}
                  <span className="font-medium text-brand-text">not confirmed yet</span>.
                  One thing is still outstanding, and {operator} can look at your
                  booking as soon as it arrives.
                </>
              ) : (
                <>
                  Your booking is{' '}
                  <span className="font-medium text-brand-text">not confirmed yet</span>.{' '}
                  {operator} needs two things from you first — photos of your driving
                  licence, and a copy of your insurance. It takes a couple of minutes.
                </>
              )}
            </p>
          </div>
        </div>

        <BookingSummary session={session} />
      </Panel>

      <StepRail identityDone={identityDone} insuranceDone={insuranceDone} />

      {/* ── step one: identity ───────────────────────────────────────────── */}
      {identityDone ? (
        <Panel>
          <PanelHeader
            title="Your identity documents"
            action={<StatusChip tone="success">Received</StatusChip>}
          />
          <IdentityReceivedPanel operator={operator} />
        </Panel>
      ) : openStep === 'identity' ? (
        <IdentityCapture
          token={token}
          session={session}
          stepLabel={STEP_LABEL.identity}
          serverStatus={session.identityStatus}
          onSubmitted={handleIdentitySubmitted}
        />
      ) : (
        <CollapsedStep
          icon={IdCard}
          title="Your identity documents"
          summary="Photos of your driving licence and a photo of you, so we can check they match."
          stepLabel={STEP_LABEL.identity}
          onOpen={() => setPinned('identity')}
        />
      )}

      {/* ── step two: insurance ──────────────────────────────────────────── */}
      {insuranceDone && openStep !== 'insurance' ? (
        <Panel>
          <PanelHeader
            title="Your insurance document"
            action={<StatusChip tone="success">Received</StatusChip>}
          />
          <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-light">
              <ShieldCheck aria-hidden strokeWidth={1.75} className="size-4.5 text-success" />
            </span>
            <div className="min-w-0">
              <p className="text-sm leading-relaxed text-brand-text-soft">
                We have your insurance document and it is{' '}
                <span className="font-medium text-brand-text">under review</span> by{' '}
                {operator}. There is nothing else for you to do on this step.
              </p>
              <Button
                type="button"
                variant="brand-outline"
                className="mt-3 h-11"
                onClick={() => setPinned('insurance')}
              >
                Send another document
              </Button>
            </div>
          </div>
        </Panel>
      ) : openStep === 'insurance' ? (
        <InsuranceUpload
          token={token}
          session={session}
          alreadySubmitted={insuranceDone}
          stepLabel={STEP_LABEL.insurance}
          onSubmitted={handleInsuranceSubmitted}
        />
      ) : (
        <CollapsedStep
          icon={FileText}
          title="Your insurance document"
          summary="Your certificate or declarations page — a PDF or a photo is fine."
          stepLabel={STEP_LABEL.insurance}
          onOpen={() => setPinned('insurance')}
        />
      )}

      <p className="px-1 text-xs leading-relaxed text-brand-text-subtle">
        This page belongs to your booking, so keep the link to yourself. It stays
        open for seven days, and every visit extends it — if it ever does run out,
        the page will offer to email you a fresh one.
      </p>
    </div>
  );
}

/**
 * How much of the errand is left, in one glance.
 *
 * "Received" and "To do", never "complete": the step is what has been received,
 * and the booking behind it is still the operator's to approve.
 */
function StepRail({
  identityDone,
  insuranceDone,
}: {
  identityDone: boolean;
  insuranceDone: boolean;
}) {
  const done = (identityDone ? 1 : 0) + (insuranceDone ? 1 : 0);
  const rows: { key: StepKey; label: string; done: boolean }[] = [
    { key: 'identity', label: 'Identity documents', done: identityDone },
    { key: 'insurance', label: 'Insurance document', done: insuranceDone },
  ];

  return (
    <Panel className="px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-medium text-brand-text-subtle">
          {done} of 2 received
        </p>
        <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
          {rows.map((row, index) => (
            <li key={row.key} className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium',
                  row.done
                    ? 'bg-success-light text-success'
                    : 'bg-brand-stone text-brand-text-subtle',
                )}
              >
                {row.done ? <CircleCheck strokeWidth={2} className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'truncate text-sm',
                  row.done ? 'text-brand-text-subtle' : 'text-brand-text',
                )}
              >
                {row.label}
              </span>
              <span className="sr-only">{row.done ? 'Received' : 'Still to do'}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

/**
 * The step that is not open yet — a name, a sentence and a way in.
 *
 * It is a real button rather than a disabled placeholder because the order is
 * not enforced anywhere: three independent server actions hang off this token,
 * and a customer with their insurance PDF to hand but their licence upstairs
 * should be able to start with the one they have.
 */
function CollapsedStep({
  icon: Icon,
  title,
  summary,
  stepLabel,
  onOpen,
}: {
  icon: LucideIcon;
  title: string;
  summary: string;
  stepLabel: string;
  onOpen: () => void;
}) {
  return (
    <Panel>
      <PanelHeader title={title} action={<StatusChip tone="neutral">{stepLabel}</StatusChip>} />
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-stone">
            <Icon aria-hidden strokeWidth={1.75} className="size-4.5 text-brand-text-subtle" />
          </span>
          <p className="min-w-0 text-sm leading-relaxed text-brand-text-soft">{summary}</p>
        </div>
        <Button
          type="button"
          variant="brand-outline"
          className="h-11 w-full shrink-0 sm:w-auto"
          onClick={onOpen}
        >
          Start this step
        </Button>
      </div>
    </Panel>
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
