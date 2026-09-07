"use client";

/**
 * Step 4 of the dialog — provisioning, then the handoff into the portal.
 *
 * The milestone list is the REAL one: `PROVISION_MILESTONES` and
 * `MILESTONE_COPY` are imported from `onboarding-types.ts`, which is the same
 * module `signup-provision` writes its milestone names against. So the eight
 * lines read here are the eight lines a real operator reads, in the real order,
 * with the real wording.
 *
 * What is different is only the clock. The live screen advances when the server
 * confirms a milestone — it never predicts and it never runs on a timer. There
 * is no server behind this route, so a timer walks the list.
 *
 * The headline belongs to the DIALOG, and it changes when the list finishes —
 * "Setting up …" becomes "You're live." — so this step reports that moment
 * upward through `onReady` rather than printing a heading of its own.
 *
 * THE HANDOFF keys on the slug `northwind`, never on a tenant id: northwind has
 * a different id in production and on the staging branch, and an id-keyed
 * handoff would silently open the wrong workspace with no error anywhere.
 */

import * as React from "react";
import {
  ArrowRight,
  Circle,
  CircleCheck,
  ExternalLink,
  Loader2,
} from "lucide-react";

import type { JourneyPaymentOutcome } from "@/components/signup-journey/steps/journey-payment-step";
import {
  MILESTONE_COPY,
  PROVISION_MILESTONES,
} from "@/components/onboarding/onboarding-types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { JOURNEY_TENANT_SLUG, portalHandoffUrl } from "@/lib/signup-journey";
import { cn } from "@/lib/utils";

/**
 * Per-milestone dwell. Eight milestones, so the whole run is a shade over three
 * seconds — long enough to read the list going by, short enough that nobody
 * watching starts talking over it.
 */
const MILESTONE_INTERVAL_MS = 420;

interface JourneyHandoffStepProps {
  slug: string;
  payment: JourneyPaymentOutcome | null;
  /** Fired once the milestones finish, so the dialog can change its headline. */
  onReady(): void;
  /** Dismiss the dialog. The journey is over; there is nothing to come back to. */
  onFinish(): void;
}

export function JourneyHandoffStep({
  slug,
  payment,
  onReady,
  onFinish,
}: JourneyHandoffStepProps) {
  const [completed, setCompleted] = React.useState(0);
  const done = completed >= PROVISION_MILESTONES.length;

  React.useEffect(() => {
    if (done) return;
    const timer = window.setTimeout(
      () => setCompleted((n) => n + 1),
      MILESTONE_INTERVAL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [completed, done]);

  // Told once, in an effect rather than from the timer callback, so the parent's
  // headline swap is a commit-phase update and not a setState during render.
  React.useEffect(() => {
    if (done) onReady();
  }, [done, onReady]);

  const portalHref = portalHandoffUrl(slug || JOURNEY_TENANT_SLUG);
  const percent = (completed / PROVISION_MILESTONES.length) * 100;
  /** The address the operator's portal answers on. */
  const portalAddress = `${slug || JOURNEY_TENANT_SLUG}.portal.drive-247.com`;

  if (!done) {
    return (
      <div>
        <Progress
          value={percent}
          aria-label="Setup progress"
          className="h-1.5"
        />
        <div className="mt-2.5 flex justify-between text-xs text-muted-foreground">
          <span>
            {completed} of {PROVISION_MILESTONES.length} complete
          </span>
          <span className="tabular-nums">{Math.round(percent)}%</span>
        </div>

        {/* Colour is never the only signal: every row carries its own icon AND
            its own wording — present tense while running, past tense when
            done. */}
        <ul className="mt-7 space-y-3.5" aria-live="polite">
          {PROVISION_MILESTONES.map((milestone, index) => {
            const isDone = index < completed;
            const isActive = index === completed;
            return (
              <li key={milestone} className="flex items-start gap-3">
                {isDone ? (
                  <CircleCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400"
                    aria-hidden="true"
                  />
                ) : isActive ? (
                  <Loader2
                    className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    "text-[15px]",
                    isDone && "text-foreground",
                    isActive && "font-medium text-foreground",
                    !isDone && !isActive && "text-muted-foreground",
                  )}
                >
                  {isDone
                    ? MILESTONE_COPY[milestone].done
                    : MILESTONE_COPY[milestone].running}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in-0 duration-300">
      <p className="text-xs tracking-[0.12em] text-muted-foreground uppercase">
        Your portal
      </p>
      <p className="mt-1.5 font-mono text-[17px] break-all sm:text-lg">
        {portalAddress}
      </p>

      {/* Only stated when Stripe actually answered. Nothing is invented. */}
      {payment && !payment.simulated && payment.last4 && (
        <p className="mt-5 text-sm text-muted-foreground">
          Paid with your {payment.brand ?? "card"} ending {payment.last4}.
        </p>
      )}

      <Button
        size="lg"
        onClick={() => window.location.assign(portalHref)}
        className="mt-8 h-12 w-full bg-indigo-600 text-[15px] text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        Open my portal
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <a
          href={portalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Open it in a new tab
          <ExternalLink className="ml-1 inline h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={onFinish}
          className="font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
