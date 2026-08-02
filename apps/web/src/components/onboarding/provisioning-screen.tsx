"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
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
  const { state, requestClose, retryProvision, editBusinessAfterFailure } = useOnboarding();
  const { provisioning, result, business, account, payment } = state;
  const { completed, phase, failure, activeSince } = provisioning;

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

  // A full-screen takeover that leaves the page scrollable behind it lets the
  // user scroll away from the only UI they have.
  useEffect(() => lockBodyScroll(), []);

  // The dialog that used to hold focus has just unmounted, so without this the
  // focus ring falls back to <body> and a screen reader is told nothing at all
  // about the takeover that replaced it.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Escape closes only once there is nothing left to interrupt. While the server
  // is mid-write there is deliberately no way out at all.
  useEffect(() => {
    if (running) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, requestClose]);

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
    <div
      ref={containerRef}
      tabIndex={-1}
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-background px-4 py-10 outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Setting up your portal"
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

      <div className="w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-300">
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
            <h2 className="mt-6 text-center text-2xl font-bold tracking-tighter">
              You&apos;re live.
            </h2>
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
              Take me to my portal
              <ArrowRight className="h-4 w-4" />
            </Button>

            {result.portalSignInUrl === null && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Sign in with the email and password you just created.
              </p>
            )}

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
            <h1 className="mt-8 text-center text-2xl font-bold tracking-tighter">
              Setting up {companyName}
            </h1>
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
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                      )}
                      <span
                        className={cn(
                          "text-sm",
                          isDone && "text-foreground",
                          isActive && "font-medium text-foreground",
                          !isDone && !isActive && "text-muted-foreground/60",
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
                  {recoverable && (
                    <Button variant="outline" onClick={editBusinessAfterFailure}>
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
