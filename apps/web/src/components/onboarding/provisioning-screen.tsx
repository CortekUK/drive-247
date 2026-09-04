"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowRight,
  Circle,
  CircleCheck,
  CircleCheckBig,
  ExternalLink,
  Info,
  Loader2,
  MessageSquare,
  Pencil,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { useOnboarding } from "./onboarding-provider";
import { TenantIdentityFields } from "./tenant-identity-fields";
import {
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

  const succeeded = phase === "succeeded" || (state.step === "done" && result !== null);
  const failed = phase === "failed" && !succeeded;
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

  const completedSet = new Set(completed);
  const activeIndex = PROVISION_MILESTONES.findIndex((m) => !completedSet.has(m));
  const total = PROVISION_MILESTONES.length;
  const doneCount = Math.min(completed.length, total);
  const percent = (doneCount / total) * 100;

  const companyName = result?.companyName || business.companyName || "your portal";

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
          className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-background px-4 py-10 outline-none"
        >
          {!running && (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="absolute top-4 right-4 rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <div className="my-auto w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-300">
            <div className="flex justify-center">
              <Image
                src="/logo-light.png"
                alt="Drive247"
                width={855}
                height={195}
                className="h-7 w-auto dark:hidden"
                priority
              />
              <Image
                src="/logo-dark.png"
                alt="Drive247"
                width={855}
                height={195}
                className="hidden h-7 w-auto dark:block"
                priority
              />
            </div>

            {succeeded && result ? (
              /* ── success ─────────────────────────────────────────────────── */
              <div className="animate-in fade-in-0 duration-300">
                <CircleCheckBig className="mx-auto mt-8 h-12 w-12 text-indigo-600 dark:text-indigo-400" />
                {/* asChild so the visible heading IS the accessible name of the
                    dialog — exactly one Title renders in either branch. */}
                <DialogPrimitive.Title asChild>
                  <h2 className="mt-6 text-center text-2xl font-bold tracking-tighter">
                    You&apos;re live.
                  </h2>
                </DialogPrimitive.Title>
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {companyName} is set up. Your portal and your booking site are both ready.
                </p>

                {result.contentSeeded === false && (
                  <Alert variant="info" className="mt-6">
                    <Info />
                    <AlertDescription className="text-foreground">
                      Your booking site is live, but some pages still show our default copy. You can
                      edit every page from Portal → Website.
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  size="lg"
                  onClick={() => window.location.assign(portalHref)}
                  className="mt-8 w-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  Go to portal
                  <ArrowRight className="h-4 w-4" />
                </Button>

                {/*
                  The address itself, spelled out. The button is the fast path,
                  but this is the one thing the operator has to be able to write
                  down or find again later — nothing renames a tenant slug, and
                  an unlabelled button leaves them with no idea what their portal
                  is actually called.
                */}
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {result.portalUrl.replace(/^https?:\/\//, "")}
                  </span>
                  {result.portalSignInUrl === null
                    ? " — sign in with the email and password you just created."
                    : null}
                </p>

                <a
                  href={result.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 block text-center text-sm font-semibold text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  View my booking site
                  <ExternalLink className="ml-1 inline h-3.5 w-3.5" />
                </a>
              </div>
            ) : (
              /* ── running / failed ────────────────────────────────────────── */
              <>
                <DialogPrimitive.Title asChild>
                  <h1 className="mt-8 text-center text-2xl font-bold tracking-tighter">
                    Setting up {companyName}
                  </h1>
                </DialogPrimitive.Title>
                {running && (
                  <p className="mt-2 text-center text-sm text-muted-foreground">
                    This usually takes under a minute. Please keep this tab open.
                  </p>
                )}

                {running && (
                  <>
                    <Progress
                      value={percent}
                      aria-label="Setup progress"
                      className="mt-8 h-1.5"
                    />
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                      <span>
                        {doneCount} of {total} complete
                      </span>
                      <span>{Math.round(percent)}%</span>
                    </div>
                  </>
                )}

                {/*
                  aria-live so a screen reader hears each milestone land. Colour is
                  never the only signal: every row carries its own icon AND its own
                  wording (present tense while running, past tense when done), which
                  is what makes this legible with prefers-reduced-motion on.
                */}
                <ul className="mt-6 space-y-3" aria-live="polite">
                  {PROVISION_MILESTONES.map((milestone, index) => {
                    const isDone = completedSet.has(milestone);
                    const isActive = running && index === activeIndex;
                    const showSlowHint =
                      isActive &&
                      milestone === SLOW_MILESTONE &&
                      activeSince !== null &&
                      now - activeSince > SLOW_MILESTONE_HINT_MS;

                    return (
                      <li key={milestone}>
                        <div
                          className={cn(
                            "flex items-start gap-2.5",
                            isDone && "animate-in fade-in-0 slide-in-from-bottom-1 duration-200",
                          )}
                        >
                          {isDone ? (
                            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                          ) : isActive ? (
                            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" />
                          ) : (
                            // /70 is the floor that still clears the 3:1 minimum for
                            // a non-text glyph in BOTH themes; anything fainter is
                            // decoration the user cannot see.
                            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
                          )}
                          <span
                            className={cn(
                              "text-sm",
                              isDone && "text-foreground",
                              isActive && "font-medium text-foreground",
                              // Full-strength token, not a faded one: six of these
                              // eight rows are pending for most of the run, and a
                              // composited /60 lands around 2.3:1 in light mode —
                              // well under AA. State is already carried by the icon
                              // and by the tense of the copy, so contrast does not
                              // have to signal anything.
                              !isDone && !isActive && "text-muted-foreground",
                            )}
                          >
                            {isDone ? MILESTONE_COPY[milestone].done : MILESTONE_COPY[milestone].running}
                          </span>
                        </div>
                        {showSlowHint && (
                          <p className="mt-1 ml-6.5 text-xs text-muted-foreground">
                            Still working — this one can take a few seconds.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {failed && failure && (
                  <div className="mt-6 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
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
                        className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
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
                      <div className="mt-6 space-y-4 rounded-lg border p-4 text-left animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
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
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
