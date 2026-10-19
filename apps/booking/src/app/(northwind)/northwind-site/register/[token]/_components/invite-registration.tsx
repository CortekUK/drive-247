"use client";

/**
 * The invite registration page, new booking design.
 *
 * Oct 7 2026 — a full page of the operator's site (see page.tsx for the
 * navbar and footer around it), top to bottom:
 *
 *   hero            "You're invited by …", the headline, three reasons, the
 *                   site's own hero car with a small "your invite" card
 *   sign-up card    a three-step tracker across the top, then the step:
 *                     1. Your details   name, email, phone, gig driver
 *                     2. Verify          optional ID check by QR, or skip
 *                     3. Done
 *   why an account  three cards
 *   quick answers   three questions people ask before starting
 *
 * Behaviour is the original page's, call for call. The only thing it does not
 * keep is a toast for every message: errors sit next to what caused them, and
 * the identity poll is scoped to the tenant as well as the session.
 *
 * Motion is the app standard: 200ms, ease-out, opacity + a 12px lift, the
 * hero's pieces a beat apart; the tracker's bar fills by transform.
 */

import { useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ImagePlus,
  LayoutDashboard,
  Loader2,
  ScanFace,
  ShieldCheck,
  Smartphone,
  X,
  XCircle,
  Zap,
} from "lucide-react-nw";
import { toast } from "sonner-nw";

import { Button } from "@nw/components/ui/button";
import { Checkbox } from "@nw/components/ui/checkbox";
import { Input } from "@nw/components/ui/input";
import { Label } from "@nw/components/ui/label";
import {
  CHECKBOX_CLASS,
  FIELD_INPUT_CLASS,
  FieldError,
  FieldLabel,
} from "@nw/components/booking/field-primitives";
import { cn } from "@nw/lib/utils";

import {
  GIG_ACCEPT,
  QR_LIFETIME_S,
  fmtClock,
  fmtExpiry,
  inviteQrImageUrl,
  mergeGigFiles,
  sanitizeInviteInput,
  useInviteRegistration,
} from "./use-invite-registration";

/* ──────────────────────────────── page ──────────────────────────────────── */

export function InviteRegistration({
  token,
  companyFallback,
  heroImage,
  heroImageAlt,
}: {
  token: string;
  /** The site's own name, from the server — shown before the invite resolves. */
  companyFallback?: string | null;
  heroImage: string;
  heroImageAlt: string;
}) {
  // Every call, poll and rule lives in `use-invite-registration.ts` (shared
  // with the v2 page); this file is the v1 markup only.
  const {
    phase,
    invalidReason,
    tenant,
    step,
    setStep,
    values,
    setValue,
    touched,
    touch,
    errors,
    isGig,
    setIsGig,
    gigFiles,
    setGigFiles,
    submitError,
    session,
    creating,
    remaining,
    polling,
    verified,
    docLabel,
    startVerification,
    cancelVerification,
    submit,
    goVerify,
  } = useInviteRegistration({ token, notify: (message) => toast.error(message) });
  const cardRef = useRef<HTMLDivElement>(null);

  const scrollToCard = () => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  /* ── render ──────────────────────────────────────────────────────────── */

  const company = tenant?.tenantName ?? companyFallback ?? "your rental company";
  const expires = fmtExpiry(tenant?.expiresAt);
  const at = phase === "done" ? 2 : step;

  return (
    <>
      <Hero
        company={company}
        expires={expires}
        docLabel={docLabel}
        heroImage={heroImage}
        heroImageAlt={heroImageAlt}
        invalid={phase === "invalid"}
        onStart={scrollToCard}
      />

      {/* The sign-up card. */}
      <section className="bg-brand-cream pb-16 sm:pb-24">
        <div className="container-page">
          <div
            ref={cardRef}
            id="register"
            className="mx-auto w-full max-w-[760px] scroll-mt-24 overflow-hidden rounded-[28px] border border-brand-border-soft bg-white"
          >
            {phase === "loading" ? (
              <CardState>
                <Loader2 className="size-7 animate-spin text-brand-forest" aria-hidden />
                <p className="mt-3 text-sm text-brand-text-soft">Opening your invite…</p>
              </CardState>
            ) : phase === "invalid" ? (
              <CardState>
                <span className="flex size-14 items-center justify-center rounded-full bg-danger-subtle">
                  <XCircle className="size-7 text-danger" aria-hidden />
                </span>
                <h2 className="mt-5 text-2xl font-medium tracking-[-0.02em] text-brand-text">This invite can't be used</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-brand-text-soft">
                  {invalidReason} Ask {company} to send you a new link.
                </p>
                <Button asChild variant="brand-outline" className="mt-7 h-11 rounded-full px-6">
                  <a href="/">Visit {company}</a>
                </Button>
              </CardState>
            ) : (
              <>
                <Tracker at={at} />
                <div className="px-5 pb-7 pt-6 sm:px-10 sm:pb-10 sm:pt-8">
                  {phase === "done" ? (
                    <div className="flex min-h-[420px] items-center justify-center">
                      <Done company={company} verified={verified} />
                    </div>
                  ) : phase === "submitting" ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                      <Loader2 className="size-8 animate-spin text-brand-forest" aria-hidden />
                      <p className="mt-4 text-base font-medium text-brand-text">Setting up your account…</p>
                      <p className="mt-1 text-sm text-brand-text-soft">This only takes a moment.</p>
                    </div>
                  ) : (
                    <div
                      key={step}
                      className="flex min-h-[420px] flex-col animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none"
                    >
                      {step === 0 ? (
                        <DetailsStep
                          values={values}
                          errors={errors}
                          touched={touched}
                          onChange={setValue}
                          onBlur={touch}
                          isGig={isGig}
                          setIsGig={setIsGig}
                          gigFiles={gigFiles}
                          setGigFiles={setGigFiles}
                          onNext={goVerify}
                        />
                      ) : (
                        <VerifyStep
                          docLabel={docLabel}
                          session={session}
                          creating={creating}
                          remaining={remaining}
                          polling={polling}
                          verified={verified}
                          onStart={startVerification}
                          onCancel={cancelVerification}
                          onBack={() => setStep(0)}
                          onSubmit={submit}
                          submitError={submitError}
                        />
                      )}
                    </div>
                  )}
                </div>
                <p className="flex items-center justify-center gap-2 border-t border-brand-border-soft px-6 py-4 text-center text-xs text-brand-text-subtle">
                  <ShieldCheck className="size-3.5 shrink-0 text-brand-forest" aria-hidden />
                  Your details go only to {company}.{expires ? ` This invite is open until ${expires}.` : ""}
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <Benefits company={company} docLabel={docLabel} />
      <QuickAnswers company={company} docLabel={docLabel} />
    </>
  );
}

/* ────────────────────────────── sections ────────────────────────────────── */

/** Staggered entrance: the motion standard's fade + 12px lift, a beat apart. */
const RISE = "animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out [animation-fill-mode:both] motion-reduce:animate-none";

function Hero({
  company,
  expires,
  docLabel,
  heroImage,
  heroImageAlt,
  invalid,
  onStart,
}: {
  company: string;
  expires: string | null;
  docLabel: string;
  heroImage: string;
  heroImageAlt: string;
  invalid: boolean;
  onStart: () => void;
}) {
  const points = [
    { icon: Zap, title: "Book in a few taps", body: "Your details are filled in every time." },
    { icon: ScanFace, title: "Verify once", body: `Your ${docLabel} and a selfie, then never again.` },
    { icon: ShieldCheck, title: "Kept private", body: `Shared with ${company} and no one else.` },
  ];
  return (
    <section className="relative overflow-hidden bg-brand-cream">
      <div className="container-page grid grid-cols-1 items-center gap-x-10 gap-y-8 pb-12 pt-8 sm:pb-16 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] lg:pb-20 lg:pt-16">
        <div className="flex flex-col">
          <span className={cn("inline-flex w-fit items-center gap-2 rounded-full border border-brand-border-soft bg-brand-card px-3.5 py-1.5 text-xs font-medium text-brand-text", RISE)}>
            <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden />
            {invalid ? "Invite link" : `You're invited by ${company}`}
          </span>

          <h1 className={cn("mt-5 text-4xl leading-[1.05] tracking-tight text-brand-text sm:text-5xl lg:text-6xl", RISE, "[animation-delay:60ms]")}>
            Your {company} account, ready in two minutes.
          </h1>
          <p className={cn("mt-5 max-w-[480px] text-base leading-relaxed text-brand-text-soft", RISE, "[animation-delay:120ms]")}>
            Set it up once and every booking after this one is quicker — no forms at the counter, no waiting on paperwork.
          </p>

          {!invalid && (
            <div className={cn("mt-7 flex flex-wrap items-center gap-3", RISE, "[animation-delay:180ms]")}>
              <Button type="button" variant="brand" className="h-12 rounded-full px-7 text-[15px] font-medium" onClick={onStart}>
                Get started
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              {expires && (
                <span className="inline-flex items-center gap-1.5 text-sm text-brand-text-subtle">
                  <Clock className="size-4" aria-hidden />
                  Open until {expires}
                </span>
              )}
            </div>
          )}

          <ul className={cn("mt-10 grid gap-5 sm:grid-cols-3 lg:mt-14", RISE, "[animation-delay:240ms]")}>
            {points.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex flex-col gap-2">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-brand-forest text-white">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="text-sm font-medium text-brand-text">{p.title}</span>
                  <span className="text-xs leading-relaxed text-brand-text-soft">{p.body}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={cn("relative min-h-[220px] sm:min-h-[320px] lg:min-h-[520px]", RISE, "[animation-delay:120ms]")}>
          <div className="absolute inset-x-[-4%] inset-y-0 flex items-center lg:inset-x-[-12%]">
            <Image
              src={heroImage}
              alt={heroImageAlt}
              width={2600}
              height={1207}
              priority
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="h-auto w-full drop-shadow-[0px_25px_30px_rgba(0,0,0,0.12)]"
            />
          </div>
          {!invalid && (
            <div className="absolute bottom-2 right-0 z-10 hidden w-[240px] rounded-2xl border border-brand-border-soft bg-brand-card p-4 sm:block lg:bottom-6">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-brand-text-subtle">Your invite</p>
              <p className="mt-1.5 text-sm font-medium text-brand-text">From {company}</p>
              <ol className="mt-3 space-y-2">
                {["Your details", "Verify your ID", "You're set"].map((t, i) => (
                  <li key={t} className="flex items-center gap-2.5 text-xs text-brand-text-soft">
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand-stone text-[10px] font-semibold text-brand-text">{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CardState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[520px] flex-col items-center justify-center px-6 py-12 text-center">{children}</div>;
}

/** The three steps across the top of the card. The bar fills by transform. */
function Tracker({ at }: { at: number }) {
  const steps = ["Your details", "Verify your ID", "All set"];
  return (
    <ol className="grid grid-cols-3 border-b border-brand-border-soft" aria-label="Sign-up progress">
      {steps.map((title, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li key={title} className="relative flex items-center justify-center gap-2.5 px-3 py-4 sm:justify-start sm:px-6" aria-current={now ? "step" : undefined}>
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-200",
                done ? "bg-brand-forest text-white" : now ? "bg-brand-amber text-brand-text" : "bg-brand-stone text-brand-text-subtle",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", now ? "font-medium text-brand-text" : done ? "text-brand-text" : "text-brand-text-subtle")}>
              {title}
            </span>
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
              <span
                className={cn(
                  "block h-full origin-left bg-brand-forest transition-transform duration-500 ease-out motion-reduce:transition-none",
                  done || now ? "scale-x-100" : "scale-x-0",
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
  const items = [
    {
      icon: CalendarCheck,
      title: "Faster bookings",
      body: `Pick a car and dates, and the rest is already filled in. Your next ${company} booking takes a minute.`,
    },
    {
      icon: BadgeCheck,
      title: "Verified ahead of time",
      body: `Check your ${docLabel} from your phone now, and pickup is just keys in hand — no queue, no paperwork.`,
    },
    {
      icon: LayoutDashboard,
      title: "Everything in one place",
      body: "Your bookings, receipts, agreements and messages with the team, in your own account.",
    },
  ];
  return (
    <section className="bg-white">
      <div className="container-page py-14 sm:py-20 lg:py-24">
        <div className="max-w-[560px]">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand-gold">Why set up an account</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            Less admin, more driving.
          </h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.title} className="flex flex-col rounded-[22px] border border-brand-border-soft bg-brand-card p-6">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-brand-stone text-brand-forest">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-lg font-medium text-brand-text">{it.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-brand-text-soft">{it.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function QuickAnswers({ company, docLabel }: { company: string; docLabel: string }) {
  const qa = [
    {
      q: "Do I have to verify my ID now?",
      a: `No. It's optional here — you can skip it and ${company} will check your ${docLabel} at pickup instead. Doing it now just saves time on the day.`,
    },
    {
      q: "Who sees my details?",
      a: `Only ${company}. They use them to confirm your bookings and to reach you about your rental.`,
    },
    {
      q: "My link has expired. What now?",
      a: `Ask ${company} to send you a new one. Nothing you entered on an expired link is saved.`,
    },
  ];
  return (
    <section className="bg-brand-cream">
      <div className="container-page grid gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-16 lg:py-24">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand-gold">Quick answers</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">Before you start</h2>
        </div>
        <dl className="divide-y divide-brand-border-soft border-y border-brand-border-soft">
          {qa.map((x) => (
            <div key={x.q} className="py-5">
              <dt className="text-base font-medium text-brand-text">{x.q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-brand-text-soft">{x.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ── step 1 ─────────────────────────────────────────────────────────────── */

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
  values: { name: string; email: string; phone: string };
  errors: Partial<Record<"name" | "email" | "phone", string>>;
  touched: Record<string, boolean>;
  onChange: (k: "name" | "email" | "phone", v: string) => void;
  onBlur: (k: string) => void;
  isGig: boolean;
  setIsGig: (v: boolean) => void;
  gigFiles: File[];
  setGigFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onNext: () => void;
}) {
  const err = (k: "name" | "email" | "phone") => (touched[k] ? errors[k] : undefined);
  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
      noValidate
    >
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-brand-text">Tell us about you</h2>
      <p className="mt-1.5 text-sm text-brand-text-soft">We'll use these to confirm bookings and reach you about your rental.</p>

      <div className="mt-7 space-y-5">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="inv-name" required>
            Full name
          </FieldLabel>
          <Input
            id="inv-name"
            autoComplete="name"
            autoFocus
            value={values.name}
            placeholder="As it appears on your license"
            onChange={(e) => onChange("name", sanitizeInviteInput("name", e.target.value))}
            onBlur={() => onBlur("name")}
            aria-invalid={err("name") ? true : undefined}
            className={cn(FIELD_INPUT_CLASS, err("name") && "border-danger")}
          />
          <FieldError message={err("name")} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="inv-email" required>
              Email
            </FieldLabel>
            <Input
              id="inv-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={values.email}
              placeholder="you@example.com"
              onChange={(e) => onChange("email", e.target.value)}
              onBlur={() => onBlur("email")}
              aria-invalid={err("email") ? true : undefined}
              className={cn(FIELD_INPUT_CLASS, err("email") && "border-danger")}
            />
            <FieldError message={err("email")} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="inv-phone" required>
              Phone
            </FieldLabel>
            <Input
              id="inv-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={values.phone}
              placeholder="(555) 123-4567"
              onChange={(e) => onChange("phone", sanitizeInviteInput("phone", e.target.value))}
              onBlur={() => onBlur("phone")}
              aria-invalid={err("phone") ? true : undefined}
              className={cn(FIELD_INPUT_CLASS, err("phone") && "border-danger")}
            />
            <FieldError message={err("phone")} />
          </div>
        </div>

        {/* Gig driver — a selectable card, not a stray checkbox */}
        <div
          className={cn(
            "rounded-2xl border transition-colors duration-200",
            isGig ? "border-brand-forest/40 bg-brand-forest/[0.04]" : "border-brand-border-soft hover:border-brand-border",
          )}
        >
          <label htmlFor="inv-gig" className="flex cursor-pointer items-center gap-3.5 px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-stone text-brand-forest">
              <Briefcase className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-brand-text">I drive for a gig app</span>
              <span className="block text-xs text-brand-text-soft">Uber, Lyft, Bolt, DoorDash and similar</span>
            </span>
            <Checkbox id="inv-gig" checked={isGig} onCheckedChange={(c) => setIsGig(c === true)} className={CHECKBOX_CLASS} />
          </label>
          {isGig && (
            <div className="border-t border-brand-border-soft px-4 py-3.5">
              <p className="mb-2.5 text-xs text-brand-text-soft">Add a screenshot of your driver profile or earnings (JPG or PNG, up to 10 MB).</p>
              <div className="flex flex-wrap gap-2">
                {gigFiles.map((f, i) => (
                  <span key={f.name} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-brand-border-soft bg-white py-1 pl-3 pr-1 text-xs text-brand-text">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setGigFiles((p) => p.filter((_, x) => x !== i))}
                      className="flex size-6 items-center justify-center rounded-full text-brand-text-subtle hover:bg-brand-stone hover:text-brand-text"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
                <Label
                  htmlFor="inv-gig-files"
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-brand-border px-3 text-xs font-medium text-brand-forest hover:bg-brand-stone"
                >
                  <ImagePlus className="size-3.5" aria-hidden />
                  {gigFiles.length ? "Add another" : "Add proof"}
                </Label>
                <input
                  id="inv-gig-files"
                  type="file"
                  accept={GIG_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    setGigFiles((prev) => mergeGigFiles(prev, picked));
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto pt-8">
        <Button type="submit" variant="brand" className="h-12 w-full rounded-full text-[15px] font-medium">
          Continue
          <ArrowRight className="size-4" aria-hidden />
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
  verified: null | "GREEN" | "RED" | "REVIEW";
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onSubmit: () => void;
  submitError: string | null;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-brand-text">Verify your identity</h2>
      <p className="mt-1.5 text-sm text-brand-text-soft">
        Optional, but it means you won't need to do it at pickup. Takes about two minutes on your phone.
      </p>

      <div className="mt-7 flex-1">
        {verified ? (
          <div
            className={cn(
              "flex items-start gap-3.5 rounded-2xl border px-5 py-4",
              verified === "GREEN" ? "border-success/30 bg-success-light" : verified === "RED" ? "border-danger/30 bg-danger-subtle" : "border-brand-gold/40 bg-brand-pale-yellow",
            )}
          >
            {verified === "RED" ? (
              <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            ) : (
              <BadgeCheck className={cn("mt-0.5 size-5 shrink-0", verified === "GREEN" ? "text-success" : "text-brand-gold")} aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium text-brand-text">
                {verified === "GREEN" ? "You're verified" : verified === "RED" ? "We couldn't verify your ID" : "Sent for a quick review"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-brand-text-soft">
                {verified === "GREEN"
                  ? "Your ID and selfie matched. Finish below to create your account."
                  : verified === "RED"
                    ? "You can still finish — the rental company will check your ID at pickup."
                    : "The rental company will confirm it shortly. You can finish now."}
              </p>
            </div>
          </div>
        ) : session ? (
          <div className="grid items-center gap-6 rounded-2xl border border-brand-border-soft p-5 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto rounded-2xl border border-brand-border-soft bg-white p-3">
              <img
                src={inviteQrImageUrl(session.qrUrl)}
                alt="QR code to verify on your phone"
                width={168}
                height={168}
                className="block size-[168px] [image-rendering:pixelated]"
              />
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-brand-text">Scan with your phone's camera</p>
                <p className="mt-1 text-xs leading-relaxed text-brand-text-soft">
                  Take a photo of your {docLabel}, then a quick selfie. Keep this page open — it moves on by itself.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-brand-forest">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-forest/50" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand-forest" />
                </span>
                {polling ? "Waiting for your phone…" : "Starting…"}
                <span className={cn("ml-auto inline-flex items-center gap-1 tabular-nums", remaining < 60 ? "text-danger" : "text-brand-text-subtle")}>
                  <Clock className="size-3.5" aria-hidden />
                  {fmtClock(remaining)}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-brand-stone">
                <div className="h-full rounded-full bg-brand-forest transition-[width] duration-1000 ease-linear" style={{ width: `${(remaining / QR_LIFETIME_S) * 100}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(session.qrUrl);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-brand-border-soft px-3 text-xs text-brand-text hover:bg-brand-stone"
                >
                  {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Link copied" : "Copy link instead"}
                </button>
                <button type="button" onClick={onCancel} className="h-8 px-2 text-xs text-brand-text-subtle hover:text-brand-text">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={creating}
            className="group flex w-full items-center gap-4 rounded-2xl border border-brand-border-soft px-5 py-5 text-left transition-colors duration-200 hover:border-brand-forest/40 hover:bg-brand-forest/[0.03] disabled:opacity-70"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-forest text-white">
              {creating ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ScanFace className="size-5" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-brand-text">Verify with your phone</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-brand-text-soft">
                Scan a QR code, photograph your {docLabel}, take a selfie.
              </span>
            </span>
            <span className="flex items-center gap-1 text-sm font-medium text-brand-forest">
              {creating ? "Starting…" : "Start"}
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
            </span>
          </button>
        )}

        {!session && !verified && (
          <p className="mt-4 flex items-center gap-2 text-xs text-brand-text-subtle">
            <Smartphone className="size-3.5" aria-hidden />
            No phone handy? Skip it — you can verify at pickup instead.
          </p>
        )}
        {submitError && <p className="mt-4 text-sm text-danger">{submitError}</p>}
      </div>

      <div className="flex items-center gap-3 pt-8">
        <Button type="button" variant="brand-outline" className="h-12 rounded-full px-5" onClick={onBack} disabled={polling}>
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Button>
        <Button
          type="button"
          variant="brand"
          className="h-12 flex-1 rounded-full text-[15px] font-medium"
          onClick={onSubmit}
          disabled={polling}
        >
          {polling ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Finishing verification…
            </>
          ) : verified ? (
            "Create my account"
          ) : (
            "Skip and create my account"
          )}
        </Button>
      </div>
    </div>
  );
}

/* ── done ───────────────────────────────────────────────────────────────── */

function Done({ company, verified }: { company: string; verified: null | "GREEN" | "RED" | "REVIEW" }) {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center text-center animate-in fade-in-0 zoom-in-95 duration-300 ease-out motion-reduce:animate-none">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-success/20 [animation-iteration-count:2]" aria-hidden />
        <span className="relative flex size-16 items-center justify-center rounded-full bg-success-light">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
        </span>
      </div>
      <h2 className="mt-6 text-2xl font-medium tracking-[-0.02em] text-brand-text">You're registered</h2>
      <p className="mt-2 text-sm leading-relaxed text-brand-text-soft">
        {company} has your details. They'll be in touch about your rental — and next time you book, you're already set up.
      </p>
      {verified && verified !== "RED" && (
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 text-xs font-medium text-success">
          <ShieldCheck className="size-3.5" aria-hidden />
          ID {verified === "GREEN" ? "verified" : "sent for review"}
        </p>
      )}
      <Button asChild variant="brand-outline" className="mt-8 h-11 rounded-full px-6">
        <a href="/">Visit {company}</a>
      </Button>
    </div>
  );
}
