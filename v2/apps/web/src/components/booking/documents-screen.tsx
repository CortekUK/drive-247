'use client';

/**
 * The post-payment errand, whole: RESOLVE THE TOKEN, THEN COLLECT TWO THINGS.
 *
 * This file owns everything about the token-addressed screen that is not one of
 * the two collection panels themselves — the link states (invalid, expired,
 * cancelled, already checked), the branding, the "your payment has gone
 * through" header, the rail that says how far through the errand the customer
 * is, and THE ONE BUTTON THAT SENDS EVERYTHING. The panels live next door:
 * `identity-capture.tsx` is the identity documents, `insurance-upload.tsx` is
 * the insurance certificate.
 *
 * ── WHY TWO PANELS AND NOT ONE WIDGET ───────────────────────────────────────
 * v1 collects both things after payment, and so do we. An earlier build of this
 * surface fused them into a single component and every problem it had came from
 * the fusion:
 *
 *  * The two do not have the same shape. A licence is PHOTOGRAPHED — rear
 *    camera, a slot per photo, retake until it is readable. An insurance
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
 *    customer presses the send button below, and from nowhere else.
 *
 * ── ONE BUTTON, NOT TWO, AND WHY IT IS THE SHELL THAT OWNS IT ───────────────
 * Both panels used to carry their own footer submit, so a customer with photos
 * in one and a PDF in the other had two things to press and no way to tell
 * whether they had finished. There is now a single primary action at the foot
 * of the screen. It is disabled until BOTH things are present and — this is the
 * part that matters — it SAYS WHAT IS STILL MISSING while it is disabled. A
 * grey button with no explanation is the failure mode this replaces.
 *
 * Readiness is pushed UP from each panel (`onReadyChange`) and the send is
 * pulled DOWN through an imperative handle. The panels keep their own files,
 * previews and errors; the shell keeps the decision. Nothing about the two
 * server calls changed — they are still two independent actions on one token,
 * and each panel still owns its own mutation.
 *
 * THE INSURANCE FILES GO FIRST. Not cosmetic: `submit-insurance` is a plain
 * filing that essentially always succeeds, while `submit-identity` runs a paid
 * OCR and face-match pass that can be unavailable for reasons that have nothing
 * to do with the customer (staging's AWS credentials are expired right now, and
 * the function answers 502 `identity_unavailable`). Sending identity first
 * would let that outage block a perfectly good insurance upload that used to go
 * through on its own. This way a half-failure still lands the half that worked,
 * and the panel that failed says so and can be retried on its own.
 *
 * ── WHO DECIDES A STEP IS DONE ──────────────────────────────────────────────
 * The SERVER, always. `identityDone` and `insuranceDone` below start from what
 * the link function reported and are only ever moved by a panel's `onSubmitted`,
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
 *
 * The primary button is the one place that had to be argued over rather than
 * simply written. It reads "Confirm and send my documents": the object of the
 * verb is the DOCUMENTS, which is a thing the customer really is confirming,
 * and it is never "Confirm booking", which would assert something only the
 * operator can. The sentence directly above it still says the booking is not
 * confirmed yet, and what the button produces is a "received / under review"
 * state — never a confirmation.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Ban,
  CalendarDays,
  CarFront,
  CircleAlert,
  CircleCheck,
  Clock,
  Link2Off,
  Loader2,
  Mail,
  RefreshCw,
  Send,
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
import {
  IdentityCapture,
  IdentityReceivedPanel,
  type IdentityCaptureHandle,
} from '@/components/booking/identity-capture';
import {
  InsuranceUpload,
  type InsuranceUploadHandle,
} from '@/components/booking/insurance-upload';
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

/* ─────────────────────────── the two-part errand ───────────────────────── */

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
    THE SERVER'S WORD IS THE STARTING POINT FOR BOTH PANELS.

    `identityStatus` is `booking_document_links.identity_status`: null (never
    started), 'pending' (a session was minted but nothing came back), 'submitted'
    or 'rejected'. Only 'submitted' is done — a rejection is emphatically not,
    and the identity panel renders its own retry state for it.

    `documentsStatus` is the INSURANCE step, and 'submitted' is what
    `submit-insurance` writes. ('verified' never reaches here: the server answers
    `already_complete` and this screen is not rendered at all.)
  */
  const [identitySent, setIdentitySent] = useState(false);
  const [insuranceSent, setInsuranceSent] = useState(false);

  const identityDone = identitySent || session.identityStatus === 'submitted';
  const insuranceDone = insuranceSent || session.documentsStatus === 'submitted';

  /*
    What each panel says about itself. Pushed up rather than pulled, because the
    panels own the files and the shell owns the decision — and the shell must be
    able to render the disabled reason without reaching into either one.
  */
  const [identityReady, setIdentityReady] = useState(false);
  const [identityMissing, setIdentityMissing] = useState<readonly string[]>([]);
  const [insuranceReady, setInsuranceReady] = useState(false);

  const identityRef = useRef<IdentityCaptureHandle>(null);
  const insuranceRef = useRef<InsuranceUploadHandle>(null);

  const [sending, setSending] = useState(false);
  const [sendProblem, setSendProblem] = useState<string | null>(null);

  const handleIdentitySubmitted = useCallback(() => {
    setIdentitySent(true);
  }, []);

  const handleInsuranceSubmitted = useCallback(() => {
    setInsuranceSent(true);
  }, []);

  /*
    Stable identities. Both are the dependency of an effect inside a panel, so a
    fresh closure on every shell render would re-fire that effect on every
    keystroke elsewhere on the page.
  */
  const handleIdentityReady = useCallback((ready: boolean) => {
    setIdentityReady(ready);
  }, []);
  const handleIdentityMissing = useCallback((missing: readonly string[]) => {
    setIdentityMissing(missing);
  }, []);
  const handleInsuranceReady = useCallback((ready: boolean) => {
    setInsuranceReady(ready);
  }, []);

  const bothDone = identityDone && insuranceDone;
  const outstanding = (identityDone ? 0 : 1) + (insuranceDone ? 0 : 1);

  /*
    "Present" is deliberately two different facts joined by OR: the server has
    already filed it, or the customer has chosen it here. Reading only the
    server's column would leave the button permanently dead for a first-time
    customer; reading only the local files would leave it dead for someone
    coming back to finish the half they did not do last time.
  */
  const identityPresent = identityDone || identityReady;
  const insurancePresent = insuranceDone || insuranceReady;
  const canSend = identityPresent && insurancePresent && !sending;

  const missing: string[] = [
    ...(identityDone ? [] : identityMissing),
    ...(insurancePresent ? [] : ['your insurance document']),
  ];

  const handleSendEverything = useCallback(async () => {
    setSendProblem(null);
    setSending(true);
    try {
      /*
        INSURANCE FIRST — see the file header. It is the call that essentially
        always works, and putting it behind the AI pass would let an outage in
        the AI pass block it.
      */
      let allWell = true;
      if (!insuranceDone) {
        const ok = (await insuranceRef.current?.submit()) ?? false;
        if (!ok) allWell = false;
      }
      if (!identityDone) {
        const ok = (await identityRef.current?.submit()) ?? false;
        if (!ok) allWell = false;
      }
      if (!allWell) {
        // Each panel has already rendered the specific reason — the file that
        // would not store, the rate limit, the "we could not check your photos
        // just now". This line only says where to look.
        setSendProblem(
          'Not everything went through. The part that did not is marked above, ' +
            'and anything that arrived has been kept — you only need to send the rest.',
        );
      }
    } finally {
      setSending(false);
    }
  }, [identityDone, insuranceDone]);

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
                  licence, and a copy of your insurance. Add both below, then send them
                  together.
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
      ) : (
        <IdentityCapture
          ref={identityRef}
          token={token}
          session={session}
          stepLabel={STEP_LABEL.identity}
          serverStatus={session.identityStatus}
          onSubmitted={handleIdentitySubmitted}
          onReadyChange={handleIdentityReady}
          onMissingChange={handleIdentityMissing}
        />
      )}

      {/* ── step two: insurance ──────────────────────────────────────────── */}
      {insuranceDone ? (
        <Panel>
          <PanelHeader
            title="Your insurance document"
            action={<StatusChip tone="success">Received</StatusChip>}
          />
          <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success-light">
              <ShieldCheck aria-hidden strokeWidth={1.75} className="size-4.5 text-success" />
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-brand-text-soft">
              We have your insurance document and it is{' '}
              <span className="font-medium text-brand-text">under review</span> by{' '}
              {operator}. There is nothing else for you to do on this step.
            </p>
          </div>
        </Panel>
      ) : (
        <InsuranceUpload
          ref={insuranceRef}
          token={token}
          session={session}
          alreadySubmitted={insuranceDone}
          stepLabel={STEP_LABEL.insurance}
          onSubmitted={handleInsuranceSubmitted}
          onReadyChange={handleInsuranceReady}
        />
      )}

      {/* ── the one primary action ───────────────────────────────────────── */}
      {bothDone ? null : (
        <SendEverythingBar
          canSend={canSend}
          sending={sending}
          missing={missing}
          problem={sendProblem}
          onSend={() => {
            void handleSendEverything();
          }}
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
 * The screen's single primary action, and the sentence that explains it.
 *
 * ── THE DISABLED STATE IS THE IMPORTANT ONE ─────────────────────────────────
 * A greyed-out button with nothing beside it is the bug this exists to avoid.
 * While it cannot be pressed, the line above it NAMES what is still outstanding
 * — "Still needed: the front of your licence, a photo of you, and your insurance
 * document" — and the button carries the same list in `aria-describedby`, so a
 * screen reader gets the reason rather than just "dimmed".
 *
 * ── THE WORDING ─────────────────────────────────────────────────────────────
 * "Confirm and send my documents". The customer IS confirming something — that
 * these are the documents they mean to send — and the object of the verb says
 * so. What it deliberately is not is "Confirm booking": an operator still
 * reviews these and can still reject the booking, and `notify-booking-approved`
 * is the only thing in the product that says a booking is confirmed. The line
 * under the button keeps that explicit, and every result state this produces
 * reads "received" and "under review".
 */
function SendEverythingBar({
  canSend,
  sending,
  missing,
  problem,
  onSend,
}: {
  canSend: boolean;
  sending: boolean;
  missing: readonly string[];
  problem: string | null;
  onSend: () => void;
}) {
  const missingSentence =
    missing.length === 0
      ? null
      : missing.length === 1
        ? `Still needed: ${missing[0]}.`
        : `Still needed: ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`;

  return (
    <Panel className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3">
        {problem ? <ProblemBox message={problem} /> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p
              id="send-everything-state"
              className={cn(
                'text-sm leading-relaxed',
                canSend ? 'text-brand-text' : 'text-brand-text-soft',
              )}
            >
              {sending
                ? 'Sending everything. Please keep this page open.'
                : (missingSentence ??
                  'Both documents are ready to go. Nothing is sent until you press the button.')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-brand-text-subtle">
              This sends your documents for review. It does not confirm your
              booking — the team will email you once they have approved it.
            </p>
          </div>

          <Button
            type="button"
            variant="brand"
            className="h-11 w-full shrink-0 sm:w-auto"
            disabled={!canSend}
            aria-describedby="send-everything-state"
            onClick={onSend}
          >
            {sending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Send aria-hidden className="size-4" />
            )}
            {sending ? 'Sending…' : 'Confirm and send my documents'}
          </Button>
        </div>
      </div>
    </Panel>
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
