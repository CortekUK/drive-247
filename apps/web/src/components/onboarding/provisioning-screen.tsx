"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Info,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";

import { isMockSignup } from "./mock-signup";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useOnboarding } from "./onboarding-provider";
import { TenantIdentityFields } from "./tenant-identity-fields";
import { BuildArt } from "./signup-art";
import Image from "next/image";

import { BrowserChrome } from "@/components/sections/portal-glass";
import "../../../../../shared/portal-v2/tokens.css";
import { SignupWash, SIGNUP_ENTER, SIGNUP_PRIMARY } from "./signup-ui";
import {
  type ProvisionMilestone,
  MILESTONE_COPY,
  PROVISION_MILESTONES,
  RECOVERABLE_PROVISION_CODES,
  SIGNUP_ERROR_COPY,
  SLOW_MILESTONE,
  SLOW_MILESTONE_HINT_MS,
} from "./onboarding-types";

/** §5 row 16 — the only honest thing to say when the money moved and the build did not. */
const PAID_FAILURE_COPY =
  "Your payment went through and your subscription is active — nothing was charged twice. We just couldn't finish building your portal. Try again, or talk to us and we'll finish it for you.";

/**
 * What Trax says on each step of the build. A little puffed up on purpose: the
 * build takes seconds, so the screen can afford to enjoy itself. First person,
 * no emojis, and every line still says what is really happening.
 */
const STEP_LINES: Record<ProvisionMilestone, { title: string; line: string }> = {
  validated: {
    title: "Reading your details very carefully",
    line: "Twice, actually. I like to be thorough.",
  },
  payment_verified: {
    title: "Tucking your card away",
    line: "Safe and sound. Nothing is charged today.",
  },
  brand_ready: {
    title: "Picking your colours",
    line: "I've ruled out beige. You deserve better than beige.",
  },
  workspace_created: {
    title: "Building your workspace",
    line: "Desks, drawers, a very nice chair. Digitally speaking.",
  },
  account_linked: {
    title: "Making you the boss",
    line: "Every key to every door. Try not to lose them.",
  },
  billing_ready: {
    title: "Sorting out the paperwork",
    line: "So that you never have to. That's rather the point.",
  },
  subscription_linked: {
    title: "Flicking the big switch",
    line: "It makes a very satisfying click.",
  },
  site_published: {
    title: "Putting your site on the internet",
    line: "The whole internet. Even the quiet corners.",
  },
};

/**
 * How long each step stays on screen, at the least. The real build often
 * finishes in a few seconds, which flicked through eight steps faster than
 * anyone could read them. The screen now walks the steps at this pace and
 * only says "You're live." once it has shown them all. A failure is shown at
 * once: nobody should wait to hear that.
 */
const STEP_DWELL_MS = 2800;

const UNPAID_FAILURE_COPY =
  "We couldn't finish building your portal. Try again, or talk to us and we'll finish it for you.";

/**
 * Reference-counted body scroll lock.
 *
 * The naive version — capture `document.body.style.overflow` in the effect and
 * restore it in the cleanup — is wrong under React 19 StrictMode: the second
 * mount captures the value the FIRST mount already set ("hidden"), so the final
 * unmount "restores" a locked page. Counting mounts and remembering the value
 * only at the 0 -> 1 transition makes the double-invoke a no-op.
 */
let bodyLockCount = 0;
let bodyOverflowBeforeLock = "";

function lockBodyScroll(): () => void {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyLockCount -= 1;
    if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
  };
}

export function ProvisioningScreen() {
  const { state, requestClose, retryProvision, updateBusiness, checkSlug } =
    useOnboarding();
  const { provisioning, result, business, account, payment } = state;
  const { completed, phase, failure, activeSince } = provisioning;

  /**
   * The inline fix panel, replacing the old "Edit details" button that sent the
   * operator back to a business step which no longer exists.
   *
   * Every code in `RECOVERABLE_PROVISION_CODES` is about one of the three fields
   * this renders — a taken or reserved web address, a malformed one, a company
   * name that failed validation, or an unticked terms box — so the fix is
   * offered where the failure appeared rather than by unwinding a paid signup
   * back through the dialog.
   */
  const [fixing, setFixing] = useState(false);

  const serverSucceeded = phase === "succeeded" || (state.step === "done" && result !== null);
  const failed = phase === "failed" && !serverSucceeded;

  // Steps actually shown, walking towards what the server has done at no more
  // than one per STEP_DWELL_MS. See STEP_DWELL_MS.
  const serverDone = serverSucceeded ? PROVISION_MILESTONES.length : Math.min(completed.length, PROVISION_MILESTONES.length);
  // Already finished when the screen appears (a refresh on "You're live."):
  // go straight there instead of replaying the build.
  const [shownDone, setShownDone] = useState(() => (serverSucceeded ? PROVISION_MILESTONES.length : 0));

  // Localhost rehearsal only (mock-signup.ts): a player bar to pause on a step,
  // step through them, and replay the build. The screen may then run ahead of
  // the fake server, which is harmless; real builds never see any of this.
  const [rehearsal] = useState(() => isMockSignup());
  const [paused, setPaused] = useState(false);
  const stepLimit = rehearsal ? PROVISION_MILESTONES.length : serverDone;

  useEffect(() => {
    if (failed || paused || shownDone >= stepLimit) return;
    const t = window.setTimeout(() => setShownDone((n) => n + 1), STEP_DWELL_MS);
    return () => window.clearTimeout(t);
  }, [failed, paused, shownDone, stepLimit]);

  const succeeded = serverSucceeded && shownDone >= PROVISION_MILESTONES.length;
  const running = !succeeded && !failed;

  // A 1 s heartbeat, only while work is actually in flight. It exists solely so
  // the slow-milestone hint can appear on time; nothing else on this screen is
  // time-driven, and the progress bar never moves because of it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  /**
   * A full-screen takeover that leaves the page scrollable behind it lets the
   * user scroll away from the only UI they have.
   *
   * Radix's own scroll lock lives on `Dialog.Overlay`, which this screen does
   * not render (the content itself is opaque and covers the viewport), so the
   * lock stays hand-rolled here.
   */
  useEffect(() => lockBodyScroll(), []);

  const containerRef = useRef<HTMLDivElement>(null);

  const total = PROVISION_MILESTONES.length;
  // What the SCREEN has reached, not the server: the paced count.
  const doneCount = failed ? serverDone : shownDone;
  const activeIndex = doneCount >= total ? -1 : doneCount;
  const percent = (doneCount / total) * 100;

  const companyName = result?.companyName || business.companyName || "your portal";

  const activeMilestone = activeIndex === -1 ? null : PROVISION_MILESTONES[activeIndex];
  // Only when the screen has caught up with the server: until then the wait is
  // the screen's own pacing, not a slow step.
  const showSlowHint =
    running &&
    shownDone === serverDone &&
    activeMilestone === SLOW_MILESTONE &&
    activeSince !== null &&
    now - activeSince > SLOW_MILESTONE_HINT_MS;

  const recoverable = failure ? RECOVERABLE_PROVISION_CODES.includes(failure.code) : false;
  const isWatchdog = Boolean(failure?.detail?.watchdog);

  const failureCopy = failure
    ? isWatchdog
      ? "This is taking longer than it should."
      : recoverable
        ? SIGNUP_ERROR_COPY[failure.code]
        : payment.paid
          ? PAID_FAILURE_COPY
          : UNPAID_FAILURE_COPY
    : "";

  const email = account?.email ?? "";
  const portalHref = result
    ? (result.portalSignInUrl ??
      (email
        ? `${result.portalUrl}/login?email=${encodeURIComponent(email)}`
        : `${result.portalUrl}/login`))
    : "";

  return (
    /*
      A real Radix dialog rather than a hand-rolled `role="dialog"` div.
      `aria-modal="true"` is a promise that the rest of the document is inert,
      and the only way to keep that promise is to have something actually trap
      focus and hide the background: Radix's modal Content gives us a trapped
      FocusScope plus `aria-hidden` on everything else, portalled out of the
      page. Without it the first Tab press landed on the site header behind the
      overlay — invisible, but focusable, and one Enter away from navigating
      out of a half-written tenant.
    */
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        // Escape and outside-dismiss both arrive here. The provider is the
        // authority on whether leaving is allowed — it refuses outright while
        // the server is mid-write.
        if (!next) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={containerRef}
          // This screen has no description element; without the override Radix
          // points aria-describedby at an id that is never rendered.
          aria-describedby={undefined}
          // Focus the takeover itself, not its first tabbable child. On the
          // running state there IS no child to focus, and on the terminal
          // states the first one is the small "Close" icon — landing there
          // announces "Close button" instead of the dialog and its heading.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            containerRef.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            // While work is in flight there is deliberately no way out at all.
            if (running) e.preventDefault();
          }}
          // The content covers the whole viewport, so there is no "outside" to
          // click — but a stray pointer/focus event must never dismiss it.
          onInteractOutside={(e) => e.preventDefault()}
          /*
            `items-start` + `my-auto` on the child, not `items-center`:
            `align-items: center` on a scroll container pushes overflow past the
            START edge, which no browser lets you scroll back to. Auto margins
            centre the child while there is free space and collapse to zero when
            there is not, so a tall failure panel on a small phone stays
            reachable.
          */
          className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-white px-5 py-10 outline-none dark:bg-[#0e0e14] [&_button:not(:disabled)]:cursor-pointer [&_a[href]]:cursor-pointer [&_[role=checkbox]:not(:disabled)]:cursor-pointer"
        >
          {/* The same wash the signup screens wear, so the hand-off is seamless. */}
          <SignupWash />

          {!running && (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className={cn("absolute top-4 right-5 z-10 flex size-9 items-center justify-center rounded-full transition-colors duration-200 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none sm:right-8", succeeded && result ? "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-zinc-900" : "text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-white/10")}
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/*
            ONE STEP AT A TIME, NO CARD. The build used to be a card with the
            full eight-row checklist; now the picture is the screen, and under
            it only the step in hand, swapping as each one lands.
          */}
          <div className={cn("relative my-auto flex w-full max-w-[1120px] flex-col items-center text-center", SIGNUP_ENTER)}>
            {!(succeeded && result) && (
              <div className="relative h-[260px] w-full max-w-[900px] sm:h-[460px] [@media(max-height:900px)]:h-[380px] [@media(max-height:780px)]:h-[300px] [@media(max-height:680px)]:h-[200px]">
                <BuildArt
                  progress={percent / 100}
                  done={doneCount}
                  company={companyName === "your portal" ? "" : companyName}
                  slug={business.slug}
                  owner={account?.fullName ?? ""}
                />
              </div>
            )}

            {succeeded && result ? null : (
              /* ── running / failed ────────────────────────────────────────── */
              <div className="w-full">
                {running ? (
                  <>
                    {/* Keyed on the step, so each new one rises in. */}
                    <DialogPrimitive.Title asChild>
                      <h1
                        key={activeMilestone ?? "finishing"}
                        aria-live="polite"
                        className={cn("mt-10 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[40px]", SIGNUP_ENTER)}
                      >
                        {activeMilestone ? STEP_LINES[activeMilestone].title : "Putting the kettle on"}
                      </h1>
                    </DialogPrimitive.Title>

                    <p
                      key={`${activeMilestone ?? "finishing"}-${showSlowHint ? "slow" : "line"}`}
                      className={cn("mt-3 text-[15px] text-muted-foreground sm:text-base", SIGNUP_ENTER)}
                    >
                      {showSlowHint
                        ? "Still going. Good things take a moment, and so does this one."
                        : activeMilestone
                          ? STEP_LINES[activeMilestone].line
                          : "Nearly there. Keep this tab open and I'll take you straight in."}
                    </p>

                    {/* Where they are in the build, as the signup's own dashes. */}
                    <div
                      role="progressbar"
                      aria-label="Setup progress"
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-valuenow={doneCount}
                      className="mt-10 flex items-center justify-center gap-1.5"
                    >
                      {PROVISION_MILESTONES.map((m, i) => (
                        <span key={m} aria-hidden className="relative h-1 w-7 overflow-hidden rounded-full bg-indigo-900/10 sm:w-9 dark:bg-white/15">
                          <span
                            className={cn(
                              "absolute inset-0 origin-left rounded-full bg-indigo-600 transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-indigo-400",
                              i < doneCount ? "scale-x-100" : "scale-x-0",
                            )}
                          />
                        </span>
                      ))}
                    </div>
                    <p className="mt-2.5 text-xs text-muted-foreground tabular-nums">
                      Step {Math.min(doneCount + 1, total)} of {total}
                    </p>
                  </>
                ) : (
                  <DialogPrimitive.Title asChild>
                    <h1 className="mt-10 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-balance">
                      {failed && activeMilestone ? `Stuck on: ${MILESTONE_COPY[activeMilestone].running.toLowerCase()}` : `Building ${companyName}`}
                    </h1>
                  </DialogPrimitive.Title>
                )}

                <div className="mx-auto max-w-[440px] text-left">
                {failed && failure && (
                  <div className="mt-6 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
                    <Alert variant="destructive">
                      <TriangleAlert />
                      <AlertTitle>We couldn&apos;t finish setting up your portal</AlertTitle>
                      <AlertDescription className="text-red-600 dark:text-red-400">
                        {failureCopy}
                      </AlertDescription>
                    </Alert>

                    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                      <Button
                        onClick={() => void retryProvision()}
                        className={cn(SIGNUP_PRIMARY, "sm:w-auto sm:px-6")}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Try again
                      </Button>
                      {recoverable && !fixing && (
                        <Button variant="outline" onClick={() => setFixing(true)}>
                          <Pencil className="h-4 w-4" />
                          Edit details
                        </Button>
                      )}
                      <Button variant="ghost" asChild>
                        <a href="/strategy-call">
                          <MessageSquare className="h-4 w-4" />
                          Talk to us
                        </a>
                      </Button>
                    </div>

                    {recoverable && fixing && (
                      <div className="mt-6 space-y-4 rounded-lg border p-4 text-left animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
                        <TenantIdentityFields
                          value={business}
                          // Always editable here: this panel only renders inside
                          // the `failed` branch, so nothing is in flight.
                          busy={false}
                          // The provision's own failure is already rendered in
                          // the alert above; painting it under a field as well
                          // would say the same thing twice.
                          errors={{}}
                          onChange={updateBusiness}
                          onClearError={() => {}}
                          onCheckSlug={checkSlug}
                          autoFocusCompanyName
                        />
                        <p className="text-xs text-muted-foreground">
                          Nothing is charged again — your subscription is already
                          active.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
          {succeeded && result && (
            /*
              YOU'RE LIVE, IN TWO HALVES. The portal on the left (where they
              run the business), the booking site on the right (where renters
              book), each with its own heading, preview and way in. Stacked on
              a phone.
            */
            <div className={cn("absolute inset-0 z-[1] overflow-y-auto lg:overflow-hidden", SIGNUP_ENTER)}>
              <DialogPrimitive.Title asChild>
                <h2 className="sr-only">
                  You&apos;re live.
                </h2>
              </DialogPrimitive.Title>

              {/* One colour across the whole screen: the indigo accent. */}
              {/* A soft purple wash: lavender at the top fading to white, with a
                  brighter glow behind each device. */}
              <div
                aria-hidden
                className="pv2-tokens absolute inset-0"
                style={{
                  background:
                    "radial-gradient(60% 55% at 25% 70%, rgb(165 160 250 / 0.35), transparent 70%), radial-gradient(60% 55% at 75% 70%, rgb(196 181 253 / 0.35), transparent 70%), linear-gradient(180deg, #ede9fe 0%, #f5f3ff 45%, #ffffff 100%)",
                }}
              />
              <div className="relative grid min-h-full grid-cols-1 lg:h-full lg:grid-cols-2">
                <LiveHalf
                  your="Your own"
                  big="portal."
                  lead="Run your rentals, money, fleet and to-dos from one place."
                  card={
                    <LiveDevice
                      src="/v2/hero/dashboard"
                      aspect="1440 / 900"
                      below="/v2/slide-fleet"
                      belowAspect="3834 / 1150"
                      phone="/v2/phone-dashboard"
                      tab="Your portal"
                      url={result.portalUrl.replace(/^https?:\/\//, "")}
                      label={`Go to my portal, ${result.portalUrl.replace(/^https?:\/\//, "")}${result.portalSignInUrl === null ? ". Sign in with the email and password you just created." : ""}`}
                      onOpen={() => window.location.assign(portalHref)}
                    />
                  }
                />
                <LiveHalf
                  tone="right"
                  your="Your own"
                  big="booking site."
                  lead="Renters pick their dates, choose a car and pay, under your name."
                  card={
                    <LiveDevice
                      src="/v2/site-main"
                      aspect="1917 / 992"
                      below="/v2/hero-booking"
                      belowAspect="1440 / 740"
                      phone="/v2/phone-booking-site"
                      tab={result.companyName || "Your booking site"}
                      url={result.bookingUrl.replace(/^https?:\/\//, "")}
                      label={`View my booking site, ${result.bookingUrl.replace(/^https?:\/\//, "")}, opens in a new tab`}
                      href={result.bookingUrl}
                    />
                  }
                  note={
                    result.contentSeeded === false
                      ? "Some pages still show our default copy. You can edit every page from Portal, then Website."
                      : null
                  }
                />
              </div>
            </div>
          )}

          {rehearsal && !failed && (
            <RehearsalControls
              step={Math.min(shownDone, total)}
              total={total}
              paused={paused}
              finished={succeeded}
              onToggle={() => setPaused((p) => !p)}
              onPrev={() => setShownDone((n) => Math.max(0, Math.min(n, total) - 1))}
              onNext={() => setShownDone((n) => Math.min(total, n + 1))}
              onReplay={() => {
                setShownDone(0);
                setPaused(false);
              }}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The rehearsal player: previous, pause / play, next, and replay once the build
 * has finished. Keyboard too: Space pauses, ← and → step, R replays.
 * Rendered only by the localhost mock signup.
 */
function RehearsalControls({
  step,
  total,
  paused,
  finished,
  onToggle,
  onPrev,
  onNext,
  onReplay,
}: {
  step: number;
  total: number;
  paused: boolean;
  finished: boolean;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onReplay(): void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && !finished) {
        e.preventDefault();
        onToggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && !finished) {
        e.preventDefault();
        onNext();
      } else if (e.key.toLowerCase() === "r") {
        onReplay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finished, onToggle, onPrev, onNext, onReplay]);

  const [open, setOpen] = useState(false);

  const icon =
    "flex size-9 items-center justify-center rounded-full text-zinc-600 transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-zinc-900 disabled:pointer-events-none disabled:opacity-35 focus-visible:ring-[3px] focus-visible:ring-indigo-500/30 focus-visible:outline-none dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white";

  if (!open) {
    // Tucked away: one small button in the corner. Keys still work.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open rehearsal controls"
        title="Rehearsal controls"
        className={cn(
          "fixed right-6 bottom-6 z-20 flex size-10 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-indigo-600 backdrop-blur transition-colors duration-200 ease-out hover:bg-white focus-visible:ring-[3px] focus-visible:ring-indigo-500/30 focus-visible:outline-none dark:border-white/10 dark:bg-[#16161f]/90 dark:text-indigo-400",
          SIGNUP_ENTER,
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label="Rehearsal controls"
      className={cn(
        "fixed right-6 bottom-6 z-20 flex items-center gap-1 rounded-full border border-zinc-200 bg-white/90 p-1.5 backdrop-blur dark:border-white/10 dark:bg-[#16161f]/90",
        SIGNUP_ENTER,
      )}
    >
      <button type="button" onClick={onPrev} disabled={step === 0} aria-label="Previous step" title="Previous (←)" className={icon}>
        <SkipBack className="h-4 w-4" />
      </button>

      {finished ? (
        <button
          type="button"
          onClick={onReplay}
          aria-label="Replay the build"
          title="Replay (R)"
          className="flex h-9 items-center gap-1.5 rounded-full bg-indigo-600 px-4 text-sm font-medium text-white transition-colors duration-200 ease-out hover:bg-indigo-700 focus-visible:ring-[3px] focus-visible:ring-indigo-500/30 focus-visible:outline-none"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Replay
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-label={paused ? "Play" : "Pause"}
          title={paused ? "Play (Space)" : "Pause (Space)"}
          className="flex size-10 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors duration-200 ease-out hover:bg-indigo-700 focus-visible:ring-[3px] focus-visible:ring-indigo-500/30 focus-visible:outline-none"
        >
          {paused ? <Play className="ml-0.5 h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
        </button>
      )}

      <button type="button" onClick={onNext} disabled={finished} aria-label="Next step" title="Next (→)" className={icon}>
        <SkipForward className="h-4 w-4" />
      </button>

      <span className="mx-1.5 h-5 w-px bg-zinc-200 dark:bg-white/10" aria-hidden />
      <span className="pr-1 text-xs font-medium text-zinc-500 tabular-nums dark:text-zinc-400">
        {finished ? "Done" : `${Math.min(step + 1, total)} / ${total}`}
        {paused && !finished ? " · Paused" : ""}
      </span>
      <button type="button" onClick={() => setOpen(false)} aria-label="Hide rehearsal controls" title="Hide" className={icon}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * One half of the "You're live." screen: a label, a short heading and line,
 * the preview, and one button.
 */
function LiveHalf({
  your,
  big,
  lead,
  card,
  tone = "left",
  note = null,
}: {
  your: string;
  big: string;
  lead: string;
  card: ReactNode;
  /** Left = soft lavender, right = a slightly deeper light indigo. */
  tone?: "left" | "right";
  note?: string | null;
}) {
  return (
    <section
      className={cn(
        "pv2-tokens flex min-h-[100dvh] flex-col items-center justify-center gap-[clamp(20px,3dvh,40px)] px-6 py-16 text-center sm:px-8 lg:h-full lg:px-4 lg:min-h-0",
        "lg:justify-start lg:pt-[max(64px,10dvh)] lg:pb-[max(56px,7dvh)]",
        "text-[hsl(var(--v2-primary))]",
      )}
    >
      {/* The laptop is about 1.6 times as wide as it is tall; capping its width
          by the screen height keeps each half exactly one screen tall. */}
      {/* Title, then one line. On a laptop the right half puts it under its
          device, so it sits in the white below the diagonal. */}
      <div>
        {/* The landing page's section title: one regular-weight line, the key
            word in the brand colour (product-track.css .pt-intro-title). */}
        <h3 className="whitespace-nowrap text-[clamp(2rem,min(3.8vw,8dvh),4.75rem)] leading-[1.05] font-bold tracking-[-0.04em]">
          {your} <span>{big}</span>
        </h3>
        <p className={cn("mx-auto mt-3 text-[clamp(1rem,min(1.35vw,2.5dvh),1.4rem)] lg:whitespace-nowrap leading-[1.4] tracking-[-0.012em]", "text-[hsl(var(--v2-primary)/0.7)]")}>{lead}</p>
      </div>
      {/* The device takes every pixel left under the title, down to a small gap
          above the bottom edge. */}
      <div className="w-full max-w-[900px] px-0 text-left sm:px-2 lg:min-h-0 lg:flex-1">{card}</div>
      {note && <p className="mt-4 max-w-[360px] text-xs text-[#737373]">{note}</p>}
    </section>
  );
}

/**
 * One of the two "You're live." screens, in the same frame the landing page
 * uses: the real screen open in a browser on a tablet, with the phone view
 * resting on its corner. It builds itself in on arrival (portal-glass.css,
 * the `is-in` reveal), and the whole device is the way in.
 */
function LiveDevice({
  src,
  aspect,
  phone,
  tab,
  url,
  label,
  href,
  onOpen,
  flipped = false,
  below,
  belowAspect = "1440 / 740",
}: {
  /** The visible slice of `below`, cropped from its top. */
  belowAspect?: string;
  /** A second page shown under the first, as if scrolled. */
  below?: string;
  src: string;
  aspect: string;
  phone: string;
  tab: string;
  url: string;
  label: string;
  href?: string;
  onOpen?: () => void;
  flipped?: boolean;
}) {
  const cover =
    "absolute inset-0 z-10 outline-none";
  return (
    <div
      className={cn(
        "pv2-tokens is-in group relative transition-transform duration-200 ease-out hover:-translate-y-1 motion-reduce:transition-none lg:h-full",
        flipped ? "is-flipped pl-[9%]" : "pr-[9%]",
      )}
      style={{ ["--pg-ease" as string]: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      <div className="pg-device lg:h-full">
        {/* A tablet: the landing page's dark frame with the browser in it. */}
        <div className="pg-tablet lg:flex lg:h-full lg:flex-col lg:[&_.pg-browser]:flex lg:[&_.pg-browser]:min-h-0 lg:[&_.pg-browser]:flex-1 lg:[&_.pg-browser]:flex-col lg:[&_.pg-screen]:min-h-0 lg:[&_.pg-screen]:flex-1" style={{ padding: "clamp(5px, 0.5vw, 8px)", borderRadius: "clamp(12px, 1.2vw, 18px)" }}>
          <i className="pg-tablet-camera" aria-hidden style={{ top: "calc(clamp(5px, 0.5vw, 8px) / 2)" }} />
          {/* Tall enough to reach the bottom of the screen. The page shows from
              the top at full width; a second page continues under the first,
              like scrolling down the site. */}
          <BrowserChrome tab={tab} url={url} screenStyle={{ minHeight: 240 }}>
            <div className="absolute inset-0 flex flex-col">
              {[
                // Alone, the page fills the screen from its top-left corner.
                { s: src, style: below ? { aspectRatio: aspect } : { flex: 1 }, pos: "left top" },
                // The page underneath loses its own nav bar (the top 8%), so it
                // reads as the same site scrolled, not a second header.
                ...(below ? [{ s: below, style: { aspectRatio: belowAspect }, pos: "center bottom" }] : []),
              ].map((pg) => (
                <div key={pg.s} className="relative w-full shrink-0 overflow-hidden" style={pg.style}>
                  <Image src={`${pg.s}.png`} alt="" fill sizes="45vw" className="dark:hidden" style={{ objectFit: "cover", objectPosition: pg.pos }} />
                  <Image src={`${pg.s}-dark.png`} alt="" fill sizes="45vw" className="hidden dark:block" style={{ objectFit: "cover", objectPosition: pg.pos }} />
                </div>
              ))}
            </div>
          </BrowserChrome>
        </div>
        {/* The phone view, resting on the tablet's outer bottom corner. */}
        <div
          className="pg-phone"
          style={{ width: "min(21%, 17dvh)", bottom: "-4%", borderRadius: 14, padding: 4, ...(flipped ? { left: "-9%", right: "auto" } : { right: "-9%" }) }}
        >
          <div className="pg-phone-screen" style={{ borderRadius: 10 }}>
            <Image src={`${phone}.png`} alt="" fill sizes="180px" className="dark:hidden" />
            <Image src={`${phone}-dark.png`} alt="" fill sizes="180px" className="hidden dark:block" />
          </div>
        </div>
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className={cover} />
      ) : (
        <button type="button" onClick={onOpen} aria-label={label} className={cover} />
      )}
    </div>
  );
}
