"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Info,
  MessageSquare,
  Pencil,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useOnboarding } from "./onboarding-provider";
import { TenantIdentityFields } from "./tenant-identity-fields";
import { BuildArt } from "./signup-art";
import { LivePreview } from "./live-preview";
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
    title: "Counting your dollar",
    line: "All one of it. Then counting it again, to be safe.",
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
  const [shownDone, setShownDone] = useState(0);
  useEffect(() => {
    if (failed || shownDone >= serverDone) return;
    const t = window.setTimeout(() => setShownDone((n) => n + 1), STEP_DWELL_MS);
    return () => window.clearTimeout(t);
  }, [failed, shownDone, serverDone]);

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
              className="absolute top-4 right-5 z-10 flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none dark:hover:bg-white/10 sm:right-8"
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
              <div className="relative h-[220px] w-full max-w-[680px] sm:h-[340px] [@media(max-height:820px)]:h-[260px] [@media(max-height:680px)]:h-[180px]">
                <BuildArt
                  progress={percent / 100}
                  done={doneCount}
                  company={companyName === "your portal" ? "" : companyName}
                  slug={business.slug}
                />
              </div>
            )}

            {succeeded && result ? (
              /* ── success: two cards, the portal and the booking site ─────── */
              <div className={cn("w-full", SIGNUP_ENTER)}>
                {/* asChild so the visible heading IS the accessible name of the
                    dialog — exactly one Title renders in either branch. */}
                <DialogPrimitive.Title asChild>
                  <h2 className="text-center text-[30px] leading-tight font-semibold tracking-[-0.02em] sm:text-[40px]">
                    You&apos;re live.
                  </h2>
                </DialogPrimitive.Title>

                <div className="mt-12 grid gap-12 text-left sm:grid-cols-2 sm:gap-16">
                  <LiveCard
                    previewUrl={result.portalUrl}
                    shot={{ light: "/signup/portal-v2-light.jpg", dark: "/signup/portal-v2-dark.jpg" }}
                    ctaLabel={`Go to my portal, ${result.portalUrl.replace(/^https?:\/\//, "")}${result.portalSignInUrl === null ? ". Sign in with the email and password you just created." : ""}`}
                    onOpen={() => window.location.assign(portalHref)}
                    tilt="left"
                  />
                  <LiveCard
                    previewUrl={result.bookingUrl}
                    shot={{ light: "/signup/booking-site-v2.jpg", dark: "/signup/booking-site-v2.jpg" }}
                    ctaLabel={`View my booking site, ${result.bookingUrl.replace(/^https?:\/\//, "")}, opens in a new tab`}
                    href={result.bookingUrl}
                    tilt="right"
                    delayMs={120}
                  />
                </div>

                {result.contentSeeded === false && (
                  <Alert variant="info" className="mt-5 text-left">
                    <Info />
                    <AlertDescription className="text-foreground">
                      Your booking site is live, but some pages still show our default copy. You can
                      edit every page from Portal → Website.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              /* ── running / failed ────────────────────────────────────────── */
              <div className="w-full">
                <p className="mt-10 text-sm font-medium text-muted-foreground">Building {companyName}</p>

                {running ? (
                  <>
                    {/* Keyed on the step, so each new one rises in. */}
                    <DialogPrimitive.Title asChild>
                      <h1
                        key={activeMilestone ?? "finishing"}
                        aria-live="polite"
                        className={cn("mt-2.5 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[40px]", SIGNUP_ENTER)}
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
                    <h1 className="mt-2 text-[30px] leading-tight font-semibold tracking-[-0.02em] text-balance">
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * One of the two "You're live." cards: a real, live preview of the page, its
 * name, and the way in. The whole card is clickable through a stretched link
 * (the button's ::after covers the card), because a frame cannot sit inside a
 * <button> or <a>.
 */
function LiveCard({
  previewUrl,
  ctaLabel,
  tilt,
  shot,
  href,
  onOpen,
  delayMs = 0,
}: {
  previewUrl: string;
  ctaLabel: string;
  tilt?: "left" | "right";
  shot?: { light: string; dark: string };
  href?: string;
  onOpen?: () => void;
  delayMs?: number;
}) {
  // No label, no button: the laptop is the way in. An invisible link or button
  // covers it, named for screen readers, with the focus ring drawn round it.
  const cover =
    "absolute inset-0 z-10 rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-500/40";
  return (
    <div className={cn("group relative", SIGNUP_ENTER)} style={{ animationDelay: `${delayMs}ms` }}>
      <LivePreview url={previewUrl} tilt={tilt} shot={shot} />
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={ctaLabel} className={cover} />
      ) : (
        <button type="button" onClick={onOpen} aria-label={ctaLabel} className={cover} />
      )}
    </div>
  );
}
