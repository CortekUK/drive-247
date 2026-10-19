'use client';

/**
 * Northwind booking site v2 — the post-payment errand, whole: resolve the
 * token, then collect two things. v2 of `components/booking/documents-screen.tsx`
 * (same exported name and props), mounted by
 * `app/(northwind-v2)/northwind-site-v2/(site)/booking/documents/[token]/page.tsx`.
 *
 * Markup only. The token states come from `useBookingDocumentsSession`, the
 * resend from `useResendBookingDocumentsLink`, and who is done / what is
 * missing / the one send from `use-documents-errand.ts` — all shared with v1.
 * Read v1's header for the rules: the server decides a step is done, opening
 * this page mints nothing, insurance is sent before identity, and no success
 * path says "confirmed" or "complete".
 *
 * v1 draws the operator's mark from the link function above the page
 * (`BrandHeader`). Here the site's own header already carries it, so the mark
 * is not repeated.
 */

import {
  Ban,
  CalendarDays,
  CarFront,
  CircleAlert,
  CircleCheck,
  Clock,
  Hash,
  Link2Off,
  Loader2,
  Mail,
  RefreshCw,
  ScanFace,
  Send,
  ShieldCheck,
} from 'lucide-react-nw';
import type { LucideIcon } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import {
  STEP_LABEL,
  formatDateRange,
  missingSentence,
  useDocumentsErrand,
  type StepKey,
} from '@nw/components/booking/use-documents-errand';
import {
  useBookingDocumentsSession,
  useResendBookingDocumentsLink,
  type BookingDocumentsSession,
} from '@nw/hooks/use-booking-documents';
import { StatusChip } from '@nw/portal-v2/status-chip';
import { CARD, PageIntro, SITE_CONTAINER } from '@nw/site-v2/kit';
import { cn } from '@nw/lib/utils';

import { LoadingScreen, NoticeScreen, ProblemBox, StepCard } from './documents-shared';
import { IdentityCapture, IdentityReceivedPanel } from './identity-capture';
import { InsuranceUpload } from './insurance-upload';

/** The page's reading column: narrower than the site's, one task at a time. */
const COLUMN = 'max-w-[760px]';

/* ──────────────────────────────── the shell ────────────────────────────── */

export function BookingDocumentsScreen({ token }: { token: string }) {
  const { state, isLoading, isRefetching, refetch } = useBookingDocumentsSession(token);
  const ready = state?.kind === 'ready' ? state.session : null;

  return (
    <div className="pb-16 md:pb-24">
      {ready ? (
        <ReadyScreen token={token} session={ready} />
      ) : (
        <>
          <PageIntro
            className={COLUMN}
            title="Send your documents"
            description="The secure page for the documents your booking needs."
          />
          <div className={cn(SITE_CONTAINER, COLUMN, 'pt-8')}>
            {state === null || isLoading ? (
              <LoadingScreen />
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
                // NOT "your booking is confirmed" — see v1.
                body="There is nothing left for you to do on this page. If anything else is needed for your booking, the team will be in touch by email."
              />
            ) : state.kind === 'booking_cancelled' ? (
              <NoticeScreen icon={Ban} tone="danger" title="This booking is closed" body={state.message} />
            ) : state.kind === 'ready' ? null : (
              <NoticeScreen
                icon={CircleAlert}
                tone="warning"
                title="We could not open your link"
                body={state.message}
                action={
                  <Button
                    type="button"
                    variant="brand"
                    className="h-11 px-5"
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
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── the two-part errand ───────────────────────── */

function ReadyScreen({ token, session }: { token: string; session: BookingDocumentsSession }) {
  const operator = session.tenant.companyName ?? 'the rental company';

  const {
    identityDone,
    insuranceDone,
    bothDone,
    outstanding,
    canSend,
    missing,
    sending,
    sendProblem,
    identityRef,
    insuranceRef,
    handleIdentitySubmitted,
    handleInsuranceSubmitted,
    handleIdentityReady,
    handleIdentityMissing,
    handleInsuranceReady,
    handleSendEverything,
  } = useDocumentsErrand(session);

  /*
    The gate in one sentence, in the order the customer's worry runs: the money
    arrived, the booking is NOT finished, here is what is left.
  */
  const description = bothDone ? (
    <>
      We have everything we asked for, and it is all <span className="font-semibold text-pv-fg">under review</span>{' '}
      by {operator}. Your booking is not confirmed yet — we will email you as soon as it is.
    </>
  ) : outstanding === 1 ? (
    <>
      Your booking is <span className="font-semibold text-pv-fg">not confirmed yet</span>. One thing is still
      outstanding, and {operator} can look at your booking as soon as it arrives.
    </>
  ) : (
    <>
      Your booking is <span className="font-semibold text-pv-fg">not confirmed yet</span>. {operator} needs
      photos of your driving licence and a copy of your insurance. Add both below, then send them together.
    </>
  );

  return (
    <>
      <PageIntro
        className={COLUMN}
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-pv-success">
            <CircleCheck aria-hidden strokeWidth={2} className="size-3.5" />
            Payment received
          </span>
        }
        title="Your payment has gone through"
        description={description}
      />

      <div className={cn(SITE_CONTAINER, COLUMN, 'flex flex-col gap-4 pt-8')}>
        <BookingSummary session={session} />
        <StepRail identityDone={identityDone} insuranceDone={insuranceDone} />

        {identityDone ? (
          <StepCard
            icon={ScanFace}
            tone="success"
            title="Your identity documents"
            chip={<StatusChip tone="success">Received</StatusChip>}
          >
            <IdentityReceivedPanel operator={operator} />
          </StepCard>
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

        {insuranceDone ? (
          <StepCard
            icon={ShieldCheck}
            tone="success"
            title="Your insurance document"
            chip={<StatusChip tone="success">Received</StatusChip>}
            description={
              <>
                We have your insurance document and it is{' '}
                <span className="font-semibold text-pv-fg">under review</span> by {operator}. There is nothing
                else for you to do on this step.
              </>
            }
          />
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

        <p className="px-1 pt-2 text-xs leading-relaxed text-pv-muted-fg">
          This page belongs to your booking, so keep the link to yourself. It stays open for seven days, and
          every visit extends it — if it ever does run out, the page will offer to email you a fresh one.
        </p>
      </div>
    </>
  );
}

/**
 * The single primary action. While disabled it SAYS what is still missing, and
 * the button carries the same sentence in `aria-describedby`. "Confirm and send
 * my documents" — the object is the documents, never the booking.
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
  const stillNeeded = missingSentence(missing);

  return (
    <div className={cn(CARD, 'flex flex-col gap-4 p-5 sm:p-6')}>
      {problem ? <ProblemBox message={problem} /> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p
            id="send-everything-state"
            className={cn('text-sm font-medium leading-relaxed', canSend ? 'text-pv-fg' : 'text-pv-muted-fg')}
          >
            {sending
              ? 'Sending everything. Please keep this page open.'
              : (stillNeeded ?? 'Both documents are ready to go. Nothing is sent until you press the button.')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-pv-muted-fg">
            This sends your documents for review. It does not confirm your booking — the team will email you
            once they have approved it.
          </p>
        </div>

        <Button
          type="button"
          variant="brand"
          className="h-11 w-full shrink-0 px-5 sm:w-auto"
          disabled={!canSend}
          aria-describedby="send-everything-state"
          onClick={onSend}
        >
          {sending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
          {sending ? 'Sending…' : 'Confirm and send my documents'}
        </Button>
      </div>
    </div>
  );
}

/** How much of the errand is left: "Received" and "To do", never "complete". */
function StepRail({ identityDone, insuranceDone }: { identityDone: boolean; insuranceDone: boolean }) {
  const done = (identityDone ? 1 : 0) + (insuranceDone ? 1 : 0);
  const rows: { key: StepKey; label: string; done: boolean }[] = [
    { key: 'identity', label: 'Identity documents', done: identityDone },
    { key: 'insurance', label: 'Insurance document', done: insuranceDone },
  ];

  return (
    <div className={cn(CARD, 'flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6')}>
      <div className="flex items-center gap-3">
        <p className="text-xs font-medium text-pv-muted-fg">{done} of 2 received</p>
        <span aria-hidden className="flex gap-1.5">
          {rows.map((row) => (
            <span
              key={row.key}
              className={cn(
                'h-1 w-6 rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none',
                row.done ? 'bg-pv-success' : 'bg-pv-border',
              )}
            />
          ))}
        </span>
      </div>
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        {rows.map((row, index) => (
          <li key={row.key} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                row.done ? 'bg-pv-success-light text-pv-success' : 'bg-pv-tint text-pv-primary',
              )}
            >
              {row.done ? <CircleCheck strokeWidth={2} className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('truncate text-sm', row.done ? 'text-pv-muted-fg' : 'font-medium text-pv-fg')}>
              {row.label}
            </span>
            <span className="sr-only">{row.done ? 'Received' : 'Still to do'}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The three facts that prove the link opened the RIGHT booking. */
function BookingSummary({ session }: { session: BookingDocumentsSession }) {
  const dates = formatDateRange(session.rental.startDate, session.rental.endDate);
  const rows: { icon: LucideIcon; label: string; value: string }[] = [];

  if (session.rental.rentalNumber) rows.push({ icon: Hash, label: 'Booking', value: session.rental.rentalNumber });
  if (session.rental.vehicleLabel) rows.push({ icon: CarFront, label: 'Vehicle', value: session.rental.vehicleLabel });
  if (dates) rows.push({ icon: CalendarDays, label: 'Dates', value: dates });

  // Every field is nullable server-side; an empty strip reads as a loading bug.
  if (rows.length === 0) return null;

  return (
    <dl className={cn(CARD, 'flex flex-col gap-4 px-5 py-4 sm:flex-row sm:flex-wrap sm:gap-x-10 sm:px-6')}>
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-pv-tint text-pv-primary">
            <row.icon strokeWidth={1.75} className="size-4" />
          </span>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-pv-muted-fg">{row.label}</dt>
            <dd className="mt-0.5 truncate text-sm font-medium text-pv-fg">{row.value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/* ──────────────────────────── the other screens ────────────────────────── */

/**
 * An expired link, with the button that fixes it — rendered ONLY when the
 * server said `canResend`. A successful resend has already slid this token's
 * expiry forward, so "Carry on here" just reads that back.
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
        body="We have emailed a fresh link to the address on your booking. It can take a minute or two, and it is worth checking your spam folder."
      >
        <div className="mt-2 flex flex-col items-center gap-2">
          <Button
            type="button"
            variant="brand"
            className="h-11 px-5"
            disabled={reopening}
            onClick={() => {
              void onReopened();
            }}
          >
            {reopening ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}
            Carry on here instead
          </Button>
          <p className="max-w-sm text-xs leading-relaxed text-pv-muted-fg">
            Sending the email reopened this page too, so you can go straight on without waiting for it.
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
          className="h-11 px-5"
          disabled={resend.isPending}
          onClick={() => {
            resend.mutate({ token });
          }}
        >
          {resend.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Mail aria-hidden className="size-4" />}
          Email me a new link
        </Button>
      }
    >
      {resend.isError ? (
        <div className="mt-3 w-full max-w-md text-left">
          <ProblemBox message={resend.error.message} />
        </div>
      ) : null}
    </NoticeScreen>
  );
}
