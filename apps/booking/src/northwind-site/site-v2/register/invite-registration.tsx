'use client';

/**
 * Northwind booking site v2 — the customer invite sign-up page
 * (`/register/<token>`), v2 of
 * `app/(northwind)/northwind-site/register/[token]/_components/invite-registration.tsx`.
 * The (site) layout's shell is the frame, so there is no navbar or footer here.
 *
 *   intro           "You're invited by …", the title, one muted line
 *   sign-up card    a three-step tracker, then the step:
 *                     1. Your details   name, email, phone, gig driver
 *                     2. Verify          optional ID check by QR, or skip
 *                     3. Done
 *   why an account  three cards
 *   quick answers   three questions people ask before starting
 *
 * Markup only. Every call, poll and rule is `use-invite-registration.ts`,
 * shared with v1 — the same edge functions in the same order with the same
 * payloads. The one difference: v1 toasts a verification that would not start
 * or a QR that ran out; no Toaster is mounted in v2, so those lines sit inline
 * next to the verify card instead.
 */

import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react-nw';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CalendarCheck,
  Check,
  CircleCheck,
  Clock,
  Copy,
  ImagePlus,
  LayoutDashboard,
  Link2Off,
  Loader2,
  ScanFace,
  ShieldCheck,
  Smartphone,
  UserRound,
  X,
  Zap,
} from 'lucide-react-nw';

import {
  GIG_ACCEPT,
  QR_LIFETIME_S,
  fmtClock,
  fmtExpiry,
  inviteQrImageUrl,
  mergeGigFiles,
  sanitizeInviteInput,
  useInviteRegistration,
  type InviteErrors,
  type InviteField,
  type InviteValues,
  type InviteVerdict,
} from '@/app/(northwind)/northwind-site/register/[token]/_components/use-invite-registration';
import { Button } from '@nw/components/ui/button';
import { Checkbox } from '@nw/components/ui/checkbox';
import { CHECKBOX_CLASS } from '@nw/components/booking/field-primitives';
import { StatusChip } from '@nw/portal-v2/status-chip';
import {
  CARD,
  FIELD,
  FIELD_LABEL,
  ICON_TILE,
  PageIntro,
  Section,
  SectionHeading,
  SITE_CONTAINER,
} from '@nw/site-v2/kit';
import { cn } from '@nw/lib/utils';

import { Callout, ToneTile } from '../booking/documents-shared';

/* ──────────────────────────────── page ──────────────────────────────────── */

export function InviteRegistration({
  token,
  companyFallback,
}: {
  token: string;
  /** The site's own name, from the server — shown before the invite resolves. */
  companyFallback?: string | null;
  /** v1 draws the home hero car; v2 does not, so these are accepted and unused. */
  heroImage?: string;
  heroImageAlt?: string;
}) {
  // The transient lines v1 toasts. Cleared whenever a new verification starts.
  const [notice, setNotice] = useState<string | null>(null);

  const invite = useInviteRegistration({ token, notify: setNotice });
  const { phase, invalidReason, tenant, step, docLabel, verified } = invite;

  const cardRef = useRef<HTMLDivElement>(null);
  const scrollToCard = () => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const company = tenant?.tenantName ?? companyFallback ?? 'your rental company';
  const expires = fmtExpiry(tenant?.expiresAt);
  const at = phase === 'done' ? 2 : step;
  const invalid = phase === 'invalid';

  const points: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: Zap, title: 'Book in a few taps', body: 'Your details are filled in every time.' },
    { icon: ScanFace, title: 'Verify once', body: `Your ${docLabel} and a selfie, then never again.` },
    { icon: ShieldCheck, title: 'Kept private', body: `Shared with ${company} and no one else.` },
  ];

  return (
    <div className="pb-16 md:pb-24">
      <PageIntro
        eyebrow={invalid ? 'Invite link' : `You're invited by ${company}`}
        title={`Your ${company} account, ready in two minutes.`}
        description="Set it up once and every booking after this one is quicker — no forms at the counter, no waiting on paperwork."
        actions={
          invalid || phase === 'loading' ? null : (
            <>
              {expires ? (
                <span className="inline-flex h-11 items-center gap-1.5 px-1 text-sm text-pv-muted-fg">
                  <Clock aria-hidden className="size-4" />
                  Open until {expires}
                </span>
              ) : null}
              <Button type="button" variant="brand" className="h-11 px-5" onClick={scrollToCard}>
                Get started
                <ArrowDown aria-hidden className="size-4" />
              </Button>
            </>
          )
        }
      />

      <div className={cn(SITE_CONTAINER, 'grid gap-4 pt-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6')}>
        {/* The sign-up card. */}
        <div ref={cardRef} id="register" className={cn(CARD, 'min-w-0 scroll-mt-24 overflow-hidden')}>
          {phase === 'loading' ? (
            <CardState>
              <Loader2 aria-hidden className="size-6 animate-spin text-pv-primary" />
              <p className="mt-3 text-sm text-pv-muted-fg">Opening your invite…</p>
            </CardState>
          ) : invalid ? (
            <CardState>
              <ToneTile icon={Link2Off} tone="danger" size="lg" />
              <h2 className="mt-5 text-[22px] font-bold tracking-[-0.025em] text-pv-fg">This invite can't be used</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-pv-muted-fg">
                {invalidReason} Ask {company} to send you a new link.
              </p>
              <Button asChild variant="brand-outline" className="mt-6 h-11 px-5">
                <a href="/">Visit {company}</a>
              </Button>
            </CardState>
          ) : (
            <>
              <Tracker at={at} />
              <div className="px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
                {phase === 'done' ? (
                  <div className="flex min-h-[400px] items-center justify-center">
                    <Done company={company} verified={verified} />
                  </div>
                ) : phase === 'submitting' ? (
                  <div className="flex min-h-[400px] flex-col items-center justify-center text-center" aria-live="polite">
                    <Loader2 aria-hidden className="size-7 animate-spin text-pv-primary" />
                    <p className="mt-4 text-[15px] font-semibold text-pv-fg">Setting up your account…</p>
                    <p className="mt-1 text-sm text-pv-muted-fg">This only takes a moment.</p>
                  </div>
                ) : (
                  <div key={step} className="pv2-enter flex min-h-[400px] flex-col">
                    {step === 0 ? (
                      <DetailsStep
                        values={invite.values}
                        errors={invite.errors}
                        touched={invite.touched}
                        onChange={invite.setValue}
                        onBlur={invite.touch}
                        isGig={invite.isGig}
                        setIsGig={invite.setIsGig}
                        gigFiles={invite.gigFiles}
                        setGigFiles={invite.setGigFiles}
                        onNext={invite.goVerify}
                      />
                    ) : (
                      <VerifyStep
                        docLabel={docLabel}
                        session={invite.session}
                        creating={invite.creating}
                        remaining={invite.remaining}
                        polling={invite.polling}
                        verified={verified}
                        notice={notice}
                        onStart={() => {
                          setNotice(null);
                          void invite.startVerification();
                        }}
                        onCancel={invite.cancelVerification}
                        onBack={() => invite.setStep(0)}
                        onSubmit={() => {
                          void invite.submit();
                        }}
                        submitError={invite.submitError}
                      />
                    )}
                  </div>
                )}
              </div>
              <p className="flex items-center justify-center gap-2 border-t border-pv-border bg-pv-row/60 px-6 py-3.5 text-center text-xs text-pv-muted-fg">
                <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-pv-primary" />
                Your details go only to {company}.{expires ? ` This invite is open until ${expires}.` : ''}
              </p>
            </>
          )}
        </div>

        {/* What the invite is, beside the card on wide screens. */}
        {invalid ? null : (
          <aside className={cn(CARD, 'p-5 sm:p-6')}>
            <p className="text-xs font-medium text-pv-muted-fg">Your invite</p>
            <p className="mt-1 text-[15px] font-semibold text-pv-fg">From {company}</p>
            <ul className="mt-5 flex flex-col gap-4">
              {points.map((point) => (
                <li key={point.title} className="flex items-start gap-3">
                  <span aria-hidden className={ICON_TILE}>
                    <point.icon strokeWidth={1.75} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-pv-fg">{point.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-pv-muted-fg">{point.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      <Benefits company={company} docLabel={docLabel} />
      <QuickAnswers company={company} docLabel={docLabel} />
    </div>
  );
}

/* ────────────────────────────── sections ────────────────────────────────── */

function CardState({ children }: { children: React.ReactNode }) {
  return (
    <div className="pv2-enter flex min-h-[480px] flex-col items-center justify-center px-6 py-12 text-center">
      {children}
    </div>
  );
}

/** The three steps across the top of the card. The bar fills by transform. */
function Tracker({ at }: { at: number }) {
  const steps = ['Your details', 'Verify your ID', 'All set'];
  return (
    <ol className="grid grid-cols-3 border-b border-pv-border" aria-label="Sign-up progress">
      {steps.map((title, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li
            key={title}
            className="relative flex items-center justify-center gap-2.5 px-3 py-4 sm:justify-start sm:px-6"
            aria-current={now ? 'step' : undefined}
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors duration-200 ease-out motion-reduce:transition-none',
                done
                  ? 'bg-pv-primary text-pv-primary-fg'
                  : now
                    ? 'bg-pv-tint text-pv-primary ring-1 ring-pv-primary/30'
                    : 'bg-pv-muted text-pv-muted-fg',
              )}
            >
              {done ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : i + 1}
            </span>
            <span
              className={cn(
                'hidden text-sm sm:inline',
                now ? 'font-semibold text-pv-fg' : done ? 'text-pv-fg' : 'text-pv-muted-fg',
              )}
            >
              {title}
            </span>
            <span className="sr-only sm:hidden">{title}</span>
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
              <span
                className={cn(
                  'block h-full origin-left bg-pv-primary transition-transform duration-200 ease-out motion-reduce:transition-none',
                  done || now ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Benefits({ company, docLabel }: { company: string; docLabel: string }) {
  const items: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: CalendarCheck,
      title: 'Faster bookings',
      body: `Pick a car and dates, and the rest is already filled in. Your next ${company} booking takes a minute.`,
    },
    {
      icon: BadgeCheck,
      title: 'Verified ahead of time',
      body: `Check your ${docLabel} from your phone now, and pickup is just keys in hand — no queue, no paperwork.`,
    },
    {
      icon: LayoutDashboard,
      title: 'Everything in one place',
      body: 'Your bookings, receipts, agreements and messages with the team, in your own account.',
    },
  ];
  return (
    <Section>
      <SectionHeading title="Less admin, more driving" description="What an account does for you." />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.title} className={cn(CARD, 'flex flex-col p-5 sm:p-6')}>
            <ToneTile icon={item.icon} />
            <h3 className="mt-4 text-[15px] font-semibold text-pv-fg">{item.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-pv-muted-fg">{item.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function QuickAnswers({ company, docLabel }: { company: string; docLabel: string }) {
  const qa = [
    {
      q: 'Do I have to verify my ID now?',
      a: `No. It's optional here — you can skip it and ${company} will check your ${docLabel} at pickup instead. Doing it now just saves time on the day.`,
    },
    {
      q: 'Who sees my details?',
      a: `Only ${company}. They use them to confirm your bookings and to reach you about your rental.`,
    },
    {
      q: 'My link has expired. What now?',
      a: `Ask ${company} to send you a new one. Nothing you entered on an expired link is saved.`,
    },
  ];
  return (
    <Section>
      <SectionHeading title="Before you start" description="The three things people ask first." />
      <dl className={cn(CARD, 'mt-6 divide-y divide-pv-border')}>
        {qa.map((x) => (
          <div key={x.q} className="px-5 py-4 sm:px-6 sm:py-5">
            <dt className="text-[15px] font-semibold text-pv-fg">{x.q}</dt>
            <dd className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{x.a}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/* ── step 1 ─────────────────────────────────────────────────────────────── */

function TextField({
  id,
  label,
  error,
  className,
  ...props
}: React.ComponentProps<'input'> & { id: string; label: string; error?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        <span aria-hidden className="text-pv-danger"> *</span>
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(FIELD, error && 'border-pv-danger focus-visible:border-pv-danger focus-visible:ring-pv-danger/15')}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs text-pv-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DetailsStep({
  values,
  errors,
  touched,
  onChange,
  onBlur,
  isGig,
  setIsGig,
  gigFiles,
  setGigFiles,
  onNext,
}: {
  values: InviteValues;
  errors: InviteErrors;
  touched: Record<string, boolean>;
  onChange: (k: InviteField, v: string) => void;
  onBlur: (k: string) => void;
  isGig: boolean;
  setIsGig: (v: boolean) => void;
  gigFiles: File[];
  setGigFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onNext: () => void;
}) {
  const err = (k: InviteField) => (touched[k] ? errors[k] : undefined);
  const gigInput = useRef<HTMLInputElement>(null);

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
      noValidate
    >
      <div className="flex items-start gap-3">
        <ToneTile icon={UserRound} />
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-[-0.02em] text-pv-fg">Tell us about you</h2>
          <p className="mt-0.5 text-[13px] text-pv-muted-fg">
            We'll use these to confirm bookings and reach you about your rental.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <TextField
          id="inv-name"
          label="Full name"
          autoComplete="name"
          autoFocus
          value={values.name}
          placeholder="As it appears on your license"
          onChange={(e) => onChange('name', sanitizeInviteInput('name', e.target.value))}
          onBlur={() => onBlur('name')}
          error={err('name')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="inv-email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            placeholder="you@example.com"
            onChange={(e) => onChange('email', e.target.value)}
            onBlur={() => onBlur('email')}
            error={err('email')}
          />
          <TextField
            id="inv-phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.phone}
            placeholder="(555) 123-4567"
            onChange={(e) => onChange('phone', sanitizeInviteInput('phone', e.target.value))}
            onBlur={() => onBlur('phone')}
            error={err('phone')}
          />
        </div>

        {/* Gig driver — a selectable card, not a stray checkbox. */}
        <div
          className={cn(
            'rounded-2xl border [transition:border-color_200ms_ease-out,background-color_200ms_ease-out] motion-reduce:transition-none',
            isGig ? 'border-pv-primary/40 bg-pv-tint/50' : 'border-pv-border hover:border-pv-primary/30',
          )}
        >
          <label htmlFor="inv-gig" className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3.5">
            <span aria-hidden className={ICON_TILE}>
              <Briefcase strokeWidth={1.75} className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-pv-fg">I drive for a gig app</span>
              <span className="block text-xs text-pv-muted-fg">Uber, Lyft, Bolt, DoorDash and similar</span>
            </span>
            <Checkbox id="inv-gig" checked={isGig} onCheckedChange={(c) => setIsGig(c === true)} className={CHECKBOX_CLASS} />
          </label>
          {isGig ? (
            <div className="pv2-enter border-t border-pv-border px-4 py-3.5">
              <p className="mb-2.5 text-xs text-pv-muted-fg">
                Add a screenshot of your driver profile or earnings (JPG or PNG, up to 10 MB).
              </p>
              <div className="flex flex-wrap gap-2">
                {gigFiles.map((f, i) => (
                  <span
                    key={f.name}
                    className="inline-flex h-9 max-w-[240px] items-center gap-1.5 rounded-full border border-pv-border bg-pv-card pl-3 pr-1 text-xs text-pv-fg"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setGigFiles((p) => p.filter((_, x) => x !== i))}
                      className="grid size-7 place-items-center rounded-full text-pv-muted-fg transition-colors duration-200 hover:bg-pv-muted hover:text-pv-fg motion-reduce:transition-none"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => gigInput.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-pv-border px-3 text-xs font-medium text-pv-primary transition-colors duration-200 hover:border-pv-primary/50 hover:bg-pv-tint motion-reduce:transition-none"
                >
                  <ImagePlus aria-hidden className="size-3.5" />
                  {gigFiles.length ? 'Add another' : 'Add proof'}
                </button>
                <input
                  ref={gigInput}
                  type="file"
                  accept={GIG_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    setGigFiles((prev) => mergeGigFiles(prev, picked));
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-auto pt-8">
        <Button type="submit" variant="brand" className="h-11 w-full">
          Continue
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </form>
  );
}

/* ── step 2 ─────────────────────────────────────────────────────────────── */

function VerifyStep({
  docLabel,
  session,
  creating,
  remaining,
  polling,
  verified,
  notice,
  onStart,
  onCancel,
  onBack,
  onSubmit,
  submitError,
}: {
  docLabel: string;
  session: { qrUrl: string } | null;
  creating: boolean;
  remaining: number;
  polling: boolean;
  verified: InviteVerdict;
  notice: string | null;
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitError: string | null;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-start gap-3">
        <ToneTile icon={ScanFace} />
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold tracking-[-0.02em] text-pv-fg">Verify your identity</h2>
          <p className="mt-0.5 text-[13px] text-pv-muted-fg">
            Optional, but it means you won't need to do it at pickup. Takes about two minutes on your phone.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-1 flex-col gap-4">
        {verified ? (
          <Callout
            tone={verified === 'GREEN' ? 'success' : verified === 'RED' ? 'danger' : 'warning'}
            title={
              verified === 'GREEN'
                ? "You're verified"
                : verified === 'RED'
                  ? "We couldn't verify your ID"
                  : 'Sent for a quick review'
            }
          >
            {verified === 'GREEN'
              ? 'Your ID and selfie matched. Finish below to create your account.'
              : verified === 'RED'
                ? 'You can still finish — the rental company will check your ID at pickup.'
                : 'The rental company will confirm it shortly. You can finish now.'}
          </Callout>
        ) : session ? (
          <div className="pv2-enter grid items-center gap-5 rounded-2xl border border-pv-border p-5 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto rounded-2xl bg-white p-3 ring-1 ring-pv-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inviteQrImageUrl(session.qrUrl)}
                alt="QR code to verify on your phone"
                width={168}
                height={168}
                className="block size-[168px] [image-rendering:pixelated]"
              />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <p className="text-sm font-semibold text-pv-fg">Scan with your phone's camera</p>
                <p className="mt-1 text-xs leading-relaxed text-pv-muted-fg">
                  Take a photo of your {docLabel}, then a quick selfie. Keep this page open — it moves on by itself.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-pv-primary" aria-live="polite">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-pv-primary/50 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2 rounded-full bg-pv-primary" />
                </span>
                {polling ? 'Waiting for your phone…' : 'Starting…'}
                <span
                  className={cn(
                    'ml-auto inline-flex items-center gap-1 tabular-nums',
                    remaining < 60 ? 'text-pv-danger' : 'text-pv-muted-fg',
                  )}
                >
                  <Clock aria-hidden className="size-3.5" />
                  {fmtClock(remaining)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-pv-muted">
                <div
                  className="h-full rounded-full bg-pv-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
                  style={{ width: `${(remaining / QR_LIFETIME_S) * 100}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="brand-outline"
                  className="h-11 px-4 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(session.qrUrl);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? <Check aria-hidden className="size-3.5 text-pv-success" /> : <Copy aria-hidden className="size-3.5" />}
                  {copied ? 'Link copied' : 'Copy link instead'}
                </Button>
                <Button type="button" variant="brand-ghost" className="h-11 px-4 text-xs" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={creating}
            className="group flex w-full items-center gap-4 rounded-2xl border border-pv-border bg-pv-card px-5 py-5 text-left transition-colors duration-200 ease-out hover:border-pv-primary/40 hover:bg-pv-tint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 disabled:opacity-70 motion-reduce:transition-none"
          >
            <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-pv-primary text-pv-primary-fg">
              {creating ? <Loader2 className="size-5 animate-spin" /> : <ScanFace className="size-5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-pv-fg">Verify with your phone</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-pv-muted-fg">
                Scan a QR code, photograph your {docLabel}, take a selfie.
              </span>
            </span>
            <span className="hidden items-center gap-1 text-sm font-semibold text-pv-primary sm:flex">
              {creating ? 'Starting…' : 'Start'}
              <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
          </button>
        )}

        {notice && !session && !verified ? <Callout tone="warning">{notice}</Callout> : null}

        {!session && !verified ? (
          <p className="flex items-center gap-2 text-xs text-pv-muted-fg">
            <Smartphone aria-hidden className="size-3.5" />
            No phone handy? Skip it — you can verify at pickup instead.
          </p>
        ) : null}

        {submitError ? (
          <Callout tone="danger">
            <span className="text-pv-fg">{submitError}</span>
          </Callout>
        ) : null}
      </div>

      <div className="flex items-center gap-3 pt-8">
        <Button type="button" variant="brand-outline" className="h-11 px-5" onClick={onBack} disabled={polling}>
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </Button>
        <Button type="button" variant="brand" className="h-11 min-w-0 flex-1" onClick={onSubmit} disabled={polling}>
          {polling ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Finishing verification…
            </>
          ) : verified ? (
            'Create my account'
          ) : (
            'Skip and create my account'
          )}
        </Button>
      </div>
    </div>
  );
}

/* ── done ───────────────────────────────────────────────────────────────── */

function Done({ company, verified }: { company: string; verified: InviteVerdict }) {
  return (
    <div className="pv2-enter m-auto flex max-w-sm flex-col items-center text-center">
      <ToneTile icon={CircleCheck} tone="success" size="lg" />
      <h2 className="mt-5 text-[22px] font-bold tracking-[-0.025em] text-pv-fg">You're registered</h2>
      <p className="mt-2 text-sm leading-relaxed text-pv-muted-fg">
        {company} has your details. They'll be in touch about your rental — and next time you book, you're already set up.
      </p>
      {verified && verified !== 'RED' ? (
        <StatusChip tone="success" className="mt-4">
          <ShieldCheck aria-hidden />
          ID {verified === 'GREEN' ? 'verified' : 'sent for review'}
        </StatusChip>
      ) : null}
      <Button asChild variant="brand-outline" className="mt-7 h-11 px-5">
        <a href="/">Visit {company}</a>
      </Button>
    </div>
  );
}
