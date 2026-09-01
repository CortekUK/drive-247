'use client';

/**
 * ID verification, read-only.
 *
 * ── WHAT THIS PAGE IS FOR ───────────────────────────────────────────────────
 * One question: where does my identity check stand, and what happens next. It
 * answers it from `identity_verifications` (the attempt) reconciled against
 * `customers.identity_verification_status` (the operator's own verdict), which
 * is the pair v1 gets wrong — see `verifiedByOperator` in the hook.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not START a check, and it does not let the customer EDIT the details
 * a check extracted. Both are v1 features and both are left out on purpose:
 *
 *  1. STARTING. `create-ai-verification-session` IS deployed on staging and
 *     works — but the URL it mints is built from `BOOKING_APP_URL`, which is
 *     unset there, so it falls back to `https://<slug>.drive-247.com`. Calling
 *     it from this app returns a QR pointing at a PRODUCTION hostname while the
 *     session row it just created lives in the STAGING database. On top of
 *     that, this app has no `/verify/[token]` route at all, so there is no
 *     capture page on this origin for it to point at even once that secret is
 *     set. Minting anyway would not be a partial feature: the call also flips
 *     `customers.identity_verification_status` to `pending`, so every customer
 *     who pressed the button would be left permanently mid-check with a QR code
 *     that leads nowhere. The honest state is rendered instead. See notDone.
 *
 *  2. EDITING. v1 lets the customer rewrite `first_name`, `date_of_birth`,
 *     `document_number` and the rest on their own verification row from the
 *     browser, gated on an AI "does this match the document" call. The gate is
 *     client-side only — `anon` holds UPDATE on the whole table (verified live
 *     against staging), so the validation step is advisory and anyone can PATCH
 *     the row the operator later trusts. Porting that would move a real
 *     integrity hole into v2. It belongs behind an edge function that does the
 *     matching and the write together.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  IdCard,
  Mail,
  Phone,
  ScanFace,
  ShieldCheck,
  ShieldQuestion,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';

import { formatDate, formatTimestamp } from '@/components/portal/format';
import {
  DetailList,
  DetailRow,
  LoadError,
  PageHeader,
  Panel,
  PanelHeader,
} from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useTenant } from '@/contexts/TenantContext';
import {
  useCustomerVerification,
  type CustomerVerificationRow,
  type UseCustomerVerificationResult,
  type VerificationOutcome,
  type VerificationProgress,
} from '@/hooks/use-customer-verification';
import { parseDateOnly } from '@/lib/domain';
import { cn } from '@/lib/utils';

import { DocumentPreview } from './_components/document-preview';

/* ──────────────────────────── outcome vocabulary ───────────────────────── */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface OutcomeCopy {
  chip: string;
  tone: Tone;
  icon: LucideIcon;
  headline: string;
  body: string;
}

const OUTCOME: Record<VerificationOutcome, OutcomeCopy> = {
  none: {
    chip: 'Not verified',
    tone: 'neutral',
    icon: ShieldQuestion,
    headline: 'You have not verified your ID yet',
    body: 'An identity check confirms you are the person named on the booking. It takes a couple of minutes on your phone.',
  },
  in_progress: {
    chip: 'In progress',
    tone: 'info',
    icon: Smartphone,
    headline: 'Your check is in progress',
    body: 'Finish it on the phone you opened the secure link on. This page updates on its own as each photo arrives.',
  },
  in_review: {
    chip: 'Being reviewed',
    tone: 'warning',
    icon: Hourglass,
    headline: 'Your documents are being reviewed',
    body: 'Everything we need has arrived. Someone is checking it now — there is nothing else for you to do.',
  },
  approved: {
    chip: 'Verified',
    tone: 'success',
    icon: ShieldCheck,
    headline: 'Your identity is verified',
    body: 'Your ID has been checked and accepted. You will not be asked for it again unless your document expires.',
  },
  rejected: {
    chip: 'Not accepted',
    tone: 'danger',
    icon: CircleX,
    headline: 'We could not verify your ID',
    body: 'The photos did not pass our checks. This is usually glare, a blurred edge or a face photo that was hard to match — it can be tried again.',
  },
  expired: {
    chip: 'Link expired',
    tone: 'warning',
    icon: Clock,
    headline: 'Your verification link expired',
    body: 'A secure link only lasts a few hours. The photos you had already taken were not kept, so a new link starts fresh.',
  },
};

/* ─────────────────────────── in-flight step labels ─────────────────────── */

/**
 * `verification_step` as the capture page writes it, in customer language.
 *
 * The percentages are the same ones v1's QR panel uses, so a customer who has
 * seen the old flow sees the bar in the same place.
 */
const STEP: Record<string, { label: string; percent: number }> = {
  init: { label: 'Waiting for you to open the link', percent: 0 },
  qr_scanned: { label: 'Link opened', percent: 10 },
  document_front: { label: 'Photographing the front of your ID', percent: 20 },
  document_front_captured: { label: 'Front of ID captured', percent: 35 },
  document_back: { label: 'Photographing the back of your ID', percent: 45 },
  document_back_captured: { label: 'Back of ID captured', percent: 55 },
  selfie: { label: 'Taking your selfie', percent: 65 },
  selfie_captured: { label: 'Selfie captured', percent: 75 },
  uploading: { label: 'Uploading your photos', percent: 85 },
  processing: { label: 'Checking your documents', percent: 95 },
  completed: { label: 'Finished', percent: 100 },
};

/* ──────────────────────────────── helpers ──────────────────────────────── */

/** 'drivers_license' → "Driver's licence". Falls back to a tidy Title Case. */
function documentTypeLabel(value: string | null): string | null {
  if (!value) return null;
  const known: Record<string, string> = {
    drivers_license: "Driver's licence",
    driving_licence: "Driver's licence",
    passport: 'Passport',
    id_card: 'ID card',
    residence_permit: 'Residence permit',
  };
  const key = value.toLowerCase();
  if (known[key]) return known[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function providerLabel(row: CustomerVerificationRow): string | null {
  const provider = (row.verification_provider ?? row.provider ?? '').toLowerCase();
  if (provider === 'ai') return 'Automated photo check';
  if (provider === 'veriff') return 'Veriff';
  if (provider === '') return null;
  return provider.replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Whole years between a date-only string and today. */
function ageInYears(dateOfBirth: string, now: Date): number | null {
  const day = dateOfBirth.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const born = parseDateOnly(day);
  let years = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) {
    years -= 1;
  }
  return years >= 0 && years < 130 ? years : null;
}

/** "2h 14m left", or null once it has run out. */
function timeLeftLabel(expiresAt: Date, now: Date): string | null {
  const ms = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return `${hours}h ${minutes % 60}m left`;
  return `${Math.max(1, minutes)}m left`;
}

/**
 * A clock that starts AFTER mount.
 *
 * Reading `Date.now()` during the first render would make the server-rendered
 * markup and the first client render disagree. Returning null until the effect
 * runs means the countdown simply appears a tick later instead of tripping a
 * hydration mismatch.
 */
function useNow(intervalMs: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* ──────────────────────────────── the page ─────────────────────────────── */

export default function PortalVerificationPage() {
  const verification = useCustomerVerification();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="ID verification"
        description="Where your identity check stands, and what happens next."
      />

      {verification.isError ? (
        <LoadError
          title="We could not load your verification"
          error={verification.error}
          onRetry={() => {
            void verification.refetch();
          }}
        />
      ) : verification.isLoading ? (
        <VerificationSkeleton />
      ) : (
        <VerificationBody verification={verification} />
      )}
    </div>
  );
}

function VerificationBody({
  verification,
}: {
  verification: UseCustomerVerificationResult;
}) {
  const { latest, history, outcome, verifiedByOperator, progress, documentExpiry } =
    verification;
  const copy = OUTCOME[outcome];

  return (
    <>
      <StatusPanel
        copy={copy}
        outcome={outcome}
        verifiedByOperator={verifiedByOperator}
        checkedOn={latest?.verification_completed_at ?? latest?.updated_at ?? null}
      />

      {progress ? <ProgressPanel progress={progress} /> : null}

      {/*
        Only on a check that was actually accepted. "The document you verified
        with expires soon" is untrue of a REJECTED attempt — they did not verify
        with it — and on a half-finished one the OCR figure is not trustworthy
        enough to warn anybody about.
      */}
      {(outcome === 'approved' || outcome === 'in_review') &&
      (documentExpiry === 'expired' || documentExpiry === 'expiring') ? (
        <ExpiryNotice
          state={documentExpiry}
          expiry={latest?.document_expiry_date ?? null}
        />
      ) : null}

      {latest ? <VerificationDetails row={latest} expiry={documentExpiry} /> : null}

      <NextSteps outcome={outcome} verifiedByOperator={verifiedByOperator} />

      {history.length > 1 ? <HistoryPanel history={history} /> : null}
    </>
  );
}

/* ───────────────────────────────── status ──────────────────────────────── */

const TONE_ICON: Record<Tone, string> = {
  neutral: 'bg-brand-stone text-brand-text-soft',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  danger: 'bg-danger-light text-danger',
  info: 'bg-info-light text-info',
};

function StatusPanel({
  copy,
  outcome,
  verifiedByOperator,
  checkedOn,
}: {
  copy: OutcomeCopy;
  outcome: VerificationOutcome;
  verifiedByOperator: boolean;
  checkedOn: string | null;
}) {
  const { tenant } = useTenant();
  const operator = tenant?.company_name ?? 'your rental company';
  const Icon = copy.icon;

  return (
    <Panel className="px-4 py-5 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-full',
            TONE_ICON[copy.tone],
          )}
        >
          <Icon aria-hidden strokeWidth={1.75} className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium text-brand-text">{copy.headline}</h2>
            <StatusChip tone={copy.tone}>{copy.chip}</StatusChip>
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-brand-text-soft">
            {/*
              A customer the operator vouched for in person has no photos, no
              face-match score and no document on file. Telling them "your ID
              has been checked and accepted" is true; letting them go on to look
              for the paperwork behind it is not.
            */}
            {verifiedByOperator
              ? `${operator} confirmed your ID directly, so there is no online check to show here. You are verified and there is nothing for you to do.`
              : copy.body}
          </p>

          {checkedOn && outcome !== 'in_progress' ? (
            <p className="mt-2 text-xs text-brand-text-subtle">
              Last updated {formatTimestamp(checkedOn)}
            </p>
          ) : null}

          {tenant?.require_identity_verification && outcome !== 'approved' ? (
            <p className="mt-3 rounded-[10px] bg-brand-stone px-3 py-2 text-sm leading-relaxed text-brand-text-soft">
              {operator} requires a verified ID before you can collect a vehicle.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/* ──────────────────────────────── progress ─────────────────────────────── */

function ProgressPanel({ progress }: { progress: VerificationProgress }) {
  const now = useNow(30_000);
  const step = STEP[progress.step] ?? STEP.init;
  const timeLeft =
    now && progress.expiresAt ? timeLeftLabel(progress.expiresAt, now) : null;

  const captured: { label: string; done: boolean }[] = [
    { label: 'Front of ID', done: progress.documentFront },
    { label: 'Back of ID', done: progress.documentBack },
    { label: 'Selfie', done: progress.selfie },
  ];

  return (
    <Panel>
      <PanelHeader
        title="On your phone right now"
        action={
          timeLeft ? (
            <span className="text-xs text-brand-text-subtle">Link {timeLeft}</span>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-brand-text">{step.label}</p>
            <span className="shrink-0 text-xs tabular-nums text-brand-text-subtle">
              {step.percent}%
            </span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-stone"
            role="progressbar"
            aria-valuenow={step.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Verification progress"
          >
            <div
              className="h-full rounded-full bg-brand-progress-fill transition-[width] duration-500"
              style={{ width: `${step.percent}%` }}
            />
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {captured.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-sm">
              {item.done ? (
                <CircleCheck
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-4 shrink-0 text-success"
                />
              ) : (
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded-full border border-brand-border"
                />
              )}
              <span
                className={item.done ? 'text-brand-text' : 'text-brand-text-subtle'}
              >
                {item.label}
              </span>
              <span className="sr-only">{item.done ? 'captured' : 'not yet captured'}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-brand-text-subtle">
          You can close this page — the check carries on. Come back here to see
          the result.
        </p>
      </div>
    </Panel>
  );
}

/* ─────────────────────────────── expiry note ───────────────────────────── */

function ExpiryNotice({
  state,
  expiry,
}: {
  state: 'expired' | 'expiring';
  expiry: string | null;
}) {
  const date = formatDate(expiry);
  const expired = state === 'expired';

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[14px] border px-4 py-3.5',
        expired
          ? 'border-danger-subtle bg-danger-light'
          : 'border-warning-med bg-warning-light',
      )}
    >
      <TriangleAlert
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          'mt-0.5 size-4 shrink-0',
          expired ? 'text-danger' : 'text-warning',
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-text">
          {expired
            ? 'The document you verified with has expired'
            : 'The document you verified with expires soon'}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">
          {date ? `It runs out on ${date}. ` : ''}
          You will need to verify again with a current document before your next
          collection.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────── the details ───────────────────────────── */

function VerificationDetails({
  row,
  expiry,
}: {
  row: CustomerVerificationRow;
  expiry: 'valid' | 'expiring' | 'expired' | null;
}) {
  const { tenant } = useTenant();
  const operator = tenant?.company_name ?? 'your rental company';
  const now = useNow(3_600_000);
  const age = row.date_of_birth && now ? ageInYears(row.date_of_birth, now) : null;

  const hasPersonal = Boolean(row.first_name ?? row.last_name ?? row.date_of_birth);
  const hasDocument = Boolean(
    row.document_type ??
      row.document_number ??
      row.document_country ??
      row.document_expiry_date ??
      row.document_issuing_date,
  );
  const images: { label: string; src: string; portrait?: boolean }[] = [
    row.document_front_url
      ? { label: 'Front of ID', src: row.document_front_url }
      : null,
    row.document_back_url ? { label: 'Back of ID', src: row.document_back_url } : null,
    row.selfie_image_url
      ? { label: 'Selfie', src: row.selfie_image_url, portrait: true }
      : null,
    // Veriff returns a cropped face separately from the selfie. Only shown when
    // there is no selfie, so the same face is not printed twice.
    !row.selfie_image_url && row.face_image_url
      ? { label: 'Face photo', src: row.face_image_url, portrait: true }
      : null,
  ].filter((item): item is { label: string; src: string; portrait?: boolean } =>
    item !== null,
  );

  const faceMatch =
    row.ai_face_match_score === null
      ? null
      : `${Math.round(row.ai_face_match_score * 100)}%`;

  return (
    <>
      {hasPersonal ? (
        <Panel>
          <PanelHeader title="What your document says" />
          <div className="px-4 sm:px-5">
            <DetailList>
              <DetailRow label="First name" value={row.first_name} />
              <DetailRow label="Last name" value={row.last_name} />
              <DetailRow
                label="Date of birth"
                value={formatDate(row.date_of_birth?.slice(0, 10) ?? null)}
                hint={age === null ? undefined : `${age} years old`}
              />
            </DetailList>
          </div>
          <p className="border-t border-brand-border-soft px-4 py-3 text-xs leading-relaxed text-brand-text-subtle sm:px-5">
            These were read off your document automatically. If anything is
            wrong, tell us and we will correct it — this page cannot be edited.
          </p>
        </Panel>
      ) : null}

      {hasDocument ? (
        <Panel>
          <PanelHeader title="Your document" />
          <div className="px-4 sm:px-5">
            <DetailList>
              <DetailRow label="Type" value={documentTypeLabel(row.document_type)} />
              <DetailRow label="Number" value={row.document_number} />
              <DetailRow
                label="Issued in"
                value={
                  row.document_country ? (
                    <span className="uppercase">{row.document_country}</span>
                  ) : null
                }
              />
              <DetailRow
                label="Issued on"
                value={formatDate(row.document_issuing_date?.slice(0, 10) ?? null)}
              />
              <DetailRow
                label="Expires"
                value={
                  row.document_expiry_date ? (
                    <span className="flex flex-wrap items-center gap-2">
                      {formatDate(row.document_expiry_date.slice(0, 10))}
                      {expiry === 'expired' ? (
                        <StatusChip tone="danger">Expired</StatusChip>
                      ) : expiry === 'expiring' ? (
                        <StatusChip tone="warning">Expires soon</StatusChip>
                      ) : expiry === 'valid' ? (
                        <StatusChip tone="success">Valid</StatusChip>
                      ) : null}
                    </span>
                  ) : null
                }
              />
            </DetailList>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="The check itself" />
        <div className="px-4 sm:px-5">
          <DetailList>
            <DetailRow label="Method" value={providerLabel(row)} />
            <DetailRow
              label="Face match"
              value={faceMatch}
              hint={
                faceMatch === null
                  ? undefined
                  : 'How closely your selfie matched the photo on your document.'
              }
            />
            <DetailRow label="Started" value={formatTimestamp(row.created_at)} />
            <DetailRow
              label="Completed"
              value={formatTimestamp(row.verification_completed_at)}
            />
            <DetailRow
              label="Reference"
              value={
                row.session_id ? (
                  <span className="font-mono text-xs break-all">{row.session_id}</span>
                ) : null
              }
              hint={row.session_id ? 'Quote this if you contact us about it.' : undefined}
            />
          </DetailList>
        </div>
      </Panel>

      {images.length > 0 ? (
        <Panel>
          <PanelHeader title="What you sent" />
          <div className="px-4 py-4 sm:px-5">
            <p className="mb-4 text-sm leading-relaxed text-brand-text-soft">
              Hidden by default, so a document number is not sitting on screen
              when you do not need it. Only you and {operator} can see these.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((image) => (
                <DocumentPreview
                  key={image.label}
                  label={image.label}
                  src={image.src}
                  portrait={image.portrait}
                />
              ))}
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

/* ──────────────────────────────── next steps ───────────────────────────── */

/**
 * The honest version of v1's "Start ID Verification" button.
 *
 * See the file header for why there is no button. The point of this panel is
 * that the customer leaves knowing exactly what has to happen and who makes it
 * happen, rather than pressing something that quietly does nothing useful.
 */
function NextSteps({
  outcome,
  verifiedByOperator,
}: {
  outcome: VerificationOutcome;
  verifiedByOperator: boolean;
}) {
  const { tenant } = useTenant();
  const operator = tenant?.company_name ?? 'your rental company';
  const email = tenant?.contact_email ?? null;
  const phone = tenant?.contact_phone ?? tenant?.phone ?? null;

  if (outcome === 'in_review') {
    return (
      <Panel className="px-4 py-4 sm:px-5">
        <p className="text-sm font-medium text-brand-text">Nothing to do</p>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
          {operator} will be in touch once the review is finished. This page
          updates by itself, so you do not need to keep checking it.
        </p>
      </Panel>
    );
  }

  if (outcome === 'in_progress') {
    return (
      <Panel className="px-4 py-4 sm:px-5">
        <p className="text-sm font-medium text-brand-text">Finish on your phone</p>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
          Open the secure link {operator} sent you and keep going. If you have
          lost it, ask for a new one — the link below reaches them.
        </p>
        <ContactLinks email={email} phone={phone} />
      </Panel>
    );
  }

  if (outcome === 'approved') {
    if (verifiedByOperator) return null;
    return (
      <Panel className="px-4 py-4 sm:px-5">
        <p className="text-sm font-medium text-brand-text">
          Changed document, or something wrong above?
        </p>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
          If you have renewed your licence or changed your name, tell {operator}
          {' '}
          and they will set up a fresh check.
        </p>
        <ContactLinks email={email} phone={phone} />
      </Panel>
    );
  }

  const heading =
    outcome === 'rejected'
      ? 'What to do next'
      : outcome === 'expired'
        ? 'Get a new link'
        : 'How verification works';

  return (
    <Panel>
      <PanelHeader title={heading} />
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <ol className="flex flex-col gap-3">
          <Step
            index={1}
            icon={Smartphone}
            title="You get a secure link"
            body={`${operator} sends you a one-time link by email or text. It only works for a few hours.`}
          />
          <Step
            index={2}
            icon={IdCard}
            title="Photograph your ID"
            body="Front and back of your driving licence, passport or ID card, in good light with no glare."
          />
          <Step
            index={3}
            icon={ScanFace}
            title="Take a selfie"
            body="Your face is compared with the photo on the document. That is the whole check."
          />
        </ol>

        {/*
          The one thing a customer must not be misled about. This app cannot
          create the link — saying so plainly beats a button that appears to
          work and leaves them stuck mid-check.
        */}
        <div className="rounded-[10px] border border-brand-border-soft bg-brand-stone px-3 py-3">
          <p className="text-sm font-medium text-brand-text">
            You cannot start a check from here yet
          </p>
          <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
            This part of your account is still being connected. Ask {operator}
            {' '}
            for a verification link and it will show up on this page as soon as
            you start it.
          </p>
          <ContactLinks email={email} phone={phone} />
        </div>
      </div>
    </Panel>
  );
}

function Step({
  index,
  icon: Icon,
  title,
  body,
}: {
  index: number;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-stone">
        <Icon aria-hidden strokeWidth={1.75} className="size-4 text-brand-text-soft" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-text">
          <span className="sr-only">Step {index}: </span>
          {title}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">{body}</p>
      </div>
    </li>
  );
}

/**
 * How to reach the operator.
 *
 * `contact_email` and `contact_phone` are both nullable and are empty for real
 * tenants on staging today, so the fallback is not theoretical: without it this
 * panel tells the customer to ask somebody and gives them no way to. The site's
 * own contact page always exists, so that is the floor.
 */
function ContactLinks({
  email,
  phone,
}: {
  email: string | null;
  phone: string | null;
}) {
  if (!email && !phone) {
    return (
      <Link
        href="/contact"
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
      >
        <Mail aria-hidden strokeWidth={1.75} className="size-4" />
        Get in touch
      </Link>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
      {email ? (
        <a
          href={`mailto:${email}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
        >
          <Mail aria-hidden strokeWidth={1.75} className="size-4" />
          <span className="break-all">{email}</span>
        </a>
      ) : null}
      {phone ? (
        <a
          href={`tel:${phone.replace(/\s+/g, '')}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
        >
          <Phone aria-hidden strokeWidth={1.75} className="size-4" />
          {phone}
        </a>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────── history ─────────────────────────────── */

/**
 * Earlier attempts.
 *
 * A list of rows rather than a `<table>`: this has to survive 360px, and the
 * three columns v1 uses (date / method / status) wrap into an unreadable mess
 * long before that. The newest attempt is excluded — it is the whole page above.
 */
function HistoryPanel({ history }: { history: CustomerVerificationRow[] }) {
  const earlier = history.slice(1);

  return (
    <Panel>
      <PanelHeader title="Earlier attempts" />
      <ul className="divide-y divide-brand-border-soft">
        {earlier.map((row) => {
          const outcome = historyOutcome(row);
          const copy = OUTCOME[outcome];
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5"
            >
              <div className="min-w-0">
                <p className="text-sm text-brand-text">
                  {formatTimestamp(row.created_at) ?? 'Unknown date'}
                </p>
                <p className="text-xs text-brand-text-subtle">
                  {providerLabel(row) ?? 'Identity check'}
                </p>
              </div>
              <StatusChip tone={copy.tone}>{copy.chip}</StatusChip>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * A past attempt's outcome.
 *
 * Anything that never reached a decision is shown as expired rather than "in
 * progress": a superseded attempt cannot still be running, and labelling it as
 * running would put two live checks on one screen.
 */
function historyOutcome(row: CustomerVerificationRow): VerificationOutcome {
  const result = row.review_result?.toUpperCase() ?? null;
  if (result === 'GREEN') return 'approved';
  if (result === 'RED') return 'rejected';
  if (result === 'YELLOW' || result === 'RETRY') return 'in_review';
  const status = row.status.toLowerCase();
  if (status === 'approved' || status === 'verified') return 'approved';
  if (status === 'rejected' || status === 'declined') return 'rejected';
  return 'expired';
}

/* ─────────────────────────────── skeleton ─────────────────────────────── */

/** Sized like the status panel plus two detail panels, so nothing jumps. */
function VerificationSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Panel className="px-4 py-5 sm:px-5">
        <div className="flex gap-4">
          <Skeleton className="size-11 shrink-0 rounded-full bg-brand-stone" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-56 max-w-full bg-brand-stone" />
            <Skeleton className="h-4 w-full max-w-md bg-brand-stone" />
            <Skeleton className="h-4 w-40 bg-brand-stone" />
          </div>
        </div>
      </Panel>
      <Skeleton className="h-44 w-full rounded-[14px] bg-brand-stone" />
      <Skeleton className="h-56 w-full rounded-[14px] bg-brand-stone" />
    </div>
  );
}
