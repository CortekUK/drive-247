"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ChevronRight,
  Loader2,
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
import { BryanNudge, CallScreen, type BryanAnswer } from "./onboarding-call";
import {
  SignupWash,
  StepLines,
  SIGNUP_ARROW,
  SIGNUP_ENTER,
  SIGNUP_LEAD,
  SIGNUP_PRIMARY,
  SIGNUP_QUIET,
  SIGNUP_TITLE,
} from "./signup-ui";
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

/** The finished scene ("You're live.") stays up this long before moving on. */
const DONE_HOLD_MS = 1600;
/** When Bryan slides in: once the first scene has played. */
const BRYAN_AFTER_MS = 2500;

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

  // -------------------------------------------------------------------------
  // After the build (Ghulam, 2026-11-23): Bryan, the call, straight in.
  // -------------------------------------------------------------------------

  /** Bryan's question during the build: "Yes, let's book a time" or "Not now". */
  const [bryan, setBryan] = useState<BryanAnswer>(null);
  /** The answer as it is now, for the timer set when the build finished. */
  const bryanRef = useRef<BryanAnswer>(null);
  useEffect(() => {
    bryanRef.current = bryan;
  }, [bryan]);
  const [bryanShown, setBryanShown] = useState(false);
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setBryanShown(true), BRYAN_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [running]);

  /**
   * What follows "You're live.": Bryan's calendar, unless they told him "Not
   * now", or straight into the portal. `live` is the short hold on the
   * finished scene before either.
   */
  const [after, setAfter] = useState<"live" | "call" | "entering">("live");
  const [callBooked, setCallBooked] = useState(false);
  const enterPortal = useCallback(() => {
    if (!portalHref) return;
    setAfter("entering");
    window.location.assign(portalHref);
  }, [portalHref]);
  const finished = succeeded && result !== null;
  useEffect(() => {
    if (!finished) return;
    const t = window.setTimeout(() => {
      if (bryanRef.current === "no") enterPortal();
      else setAfter("call");
    }, DONE_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [finished, enterPortal]);

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
          className="fixed inset-0 z-[300] overflow-y-auto bg-white outline-none dark:bg-[#0e0e14] [&_button:not(:disabled)]:cursor-pointer [&_a[href]]:cursor-pointer [&_[role=checkbox]:not(:disabled)]:cursor-pointer"
        >
          {/* The same wash the signup screens wear, so the hand-off is seamless. */}
          <SignupWash />

          {!running && (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className={cn("absolute top-4 right-5 z-10 flex size-9 items-center justify-center rounded-full max-sm:top-2 max-sm:right-3 max-sm:size-11 transition-colors duration-200 ease-out focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none sm:right-8", succeeded && result ? "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-zinc-900" : "text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-white/10")}
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/*
            THE PREVIEW'S BUILD (Ghulam, 2026-11-23), in the questions' look:
            the real build's scene for each step (BuildArt) ranged left, Trax's
            heading and line for the step in hand under it, and the progress
            lines in the bottom corner. Bryan slides in from the right a few
            seconds in. Once it is finished: Bryan's calendar, or straight into
            the portal (onboarding-call.tsx).
          */}
          {finished && after === "call" ? (
            <div className="relative flex min-h-full w-full flex-col px-6 pt-14 sm:px-10 sm:pt-16 lg:px-12 [@media(max-height:760px)]:pt-10">
              <DialogPrimitive.Title className="sr-only">Book your onboarding call</DialogPrimitive.Title>
              <div className="flex flex-1 flex-col justify-center pb-6">
                <CallScreen
                  fullName={account?.fullName ?? ""}
                  email={email}
                  onBookedChange={setCallBooked}
                />
              </div>
              <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-x-6 gap-y-3 pt-8 pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-7 [@media(max-height:760px)]:pt-6 [@media(max-height:760px)]:pb-5">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -inset-x-6 -z-10 bg-linear-to-t from-white/90 from-50% to-transparent sm:-inset-x-10 lg:-inset-x-12 dark:from-[#0e0e14]/90"
                />
                {!callBooked ? (
                  <button type="button" onClick={enterPortal} className={SIGNUP_QUIET}>
                    Skip for now
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={enterPortal}
                  aria-label="Go to my portal"
                  title="Go to my portal"
                  className={SIGNUP_ARROW}
                >
                  <ChevronRight className="size-5" />
                </button>
              </footer>
            </div>
          ) : (
            <div className="relative flex min-h-full w-full flex-col px-6 pt-14 sm:px-10 sm:pt-16 lg:px-12 [@media(max-height:760px)]:pt-10">
              <div className="flex flex-1 flex-col items-center justify-center pb-6 text-center">
                {!failed ? (
                  <div className="relative mx-auto h-[220px] w-full max-w-[760px] sm:h-[340px] [@media(max-height:820px)]:h-[280px] [@media(max-height:700px)]:h-[200px]">
                    <BuildArt
                      progress={doneCount / total}
                      done={doneCount}
                      company={companyName === "your portal" ? "" : companyName}
                      slug={business.slug}
                      owner={account?.fullName ?? ""}
                    />
                  </div>
                ) : null}

                {running || finished ? (
                  <>
                    {/* Keyed on the step, so each new one rises in. */}
                    <DialogPrimitive.Title asChild>
                      <h1
                        key={finished ? "live" : (activeMilestone ?? "finishing")}
                        aria-live="polite"
                        className={cn(SIGNUP_TITLE, "signup-rise mx-auto mt-8 max-w-[22ch]")}
                      >
                        {finished
                          ? "You're live."
                          : activeMilestone
                            ? STEP_LINES[activeMilestone].title
                            : "Putting the kettle on"}
                      </h1>
                    </DialogPrimitive.Title>
                    <p
                      key={`${finished ? "live" : (activeMilestone ?? "finishing")}-${showSlowHint ? "slow" : "line"}`}
                      className={cn(SIGNUP_LEAD, "signup-rise signup-rise-2 mx-auto mt-4")}
                    >
                      {finished
                        ? after === "entering"
                          ? "Taking you into your portal."
                          : "Taking you in."
                        : showSlowHint
                          ? "Still going. Good things take a moment, and so does this one."
                          : activeMilestone
                            ? STEP_LINES[activeMilestone].line
                            : "Nearly there. Keep this tab open and I'll take you straight in."}
                    </p>
                  </>
                ) : (
                  <DialogPrimitive.Title asChild>
                    <h1 className={cn(SIGNUP_TITLE, "signup-rise mx-auto max-w-[22ch]")}>
                      {failed && activeMilestone ? `Stuck on: ${MILESTONE_COPY[activeMilestone].running.toLowerCase()}` : `Building ${companyName}`}
                    </h1>
                  </DialogPrimitive.Title>
                )}

                {failed && failure && (
                  <div className="mx-auto mt-8 w-full max-w-[34rem] text-left animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
                    <Alert variant="destructive" className="rounded-2xl">
                      <TriangleAlert />
                      <AlertTitle>We couldn&apos;t finish setting up your portal</AlertTitle>
                      <AlertDescription className="text-red-600 dark:text-red-400">
                        {failureCopy}
                      </AlertDescription>
                    </Alert>

                    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                      <Button onClick={() => void retryProvision()} className={SIGNUP_PRIMARY}>
                        <RotateCcw className="h-4 w-4" />
                        Try again
                      </Button>
                      {recoverable && !fixing && (
                        <button type="button" onClick={() => setFixing(true)} className={cn(SIGNUP_QUIET, "flex items-center gap-1.5")}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit details
                        </button>
                      )}
                      <a href="mailto:support@drive-247.com" className={cn(SIGNUP_QUIET, "flex items-center gap-1.5")}>
                        <MessageSquare className="h-3.5 w-3.5" />
                        Email support
                      </a>
                    </div>

                    {recoverable && fixing && (
                      <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-6 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out sm:grid-cols-2 motion-reduce:animate-none">
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
                        <p className="text-xs text-muted-foreground sm:col-span-2">
                          Nothing is charged again — your subscription is already
                          active.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* The questions' footer row: where they are in the build. */}
              {running || finished ? (
                <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 pt-8 pb-[max(20px,env(safe-area-inset-bottom))] sm:grid sm:grid-cols-[1fr_auto_1fr] sm:pb-7 [@media(max-height:760px)]:pt-6 [@media(max-height:760px)]:pb-5">
                  {/* Centred: where they are in the build, in the middle. */}
                  <div aria-hidden className="max-sm:hidden" />
                  <div className="flex items-center gap-4">
                    <StepLines total={total} current={Math.min(doneCount, total - 1)} label="Setup progress" />
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Step {Math.min(doneCount + 1, total)} of {total}
                    </p>
                  </div>
                  {after === "entering" ? (
                    <Loader2 className="size-5 animate-spin text-indigo-600 sm:justify-self-end dark:text-indigo-400" aria-hidden />
                  ) : null}
                </footer>
              ) : null}
            </div>
          )}

          {/* Bryan, while the build runs (and on "You're live." if it is still up). */}
          {bryanShown && !failed && !(finished && after !== "live") ? (
            <BryanNudge
              fullName={account?.fullName ?? ""}
              answer={bryan}
              onAnswer={setBryan}
              onClose={() => setBryanShown(false)}
            />
          ) : null}

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
