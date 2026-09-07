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
  Globe,
  LayoutDashboard,
  Loader2,
} from "lucide-react";

import type { JourneyPaymentOutcome } from "@/components/signup-journey/steps/journey-payment-step";
import {
  MILESTONE_COPY,
  PROVISION_MILESTONES,
  type ProvisionMilestone,
} from "@/components/onboarding/onboarding-types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { JOURNEY_TENANT_SLUG, portalHandoffUrl } from "@/lib/signup-journey";
import { cn } from "@/lib/utils";

/**
 * How long each milestone sits on screen, in ms.
 *
 * DELIBERATELY UNEVEN, and that is the whole point. A fixed interval — this was
 * 420ms for every line — makes eight steps tick past like a metronome, and a
 * metronome reads as a progress bar someone drew rather than as work being
 * done. Real provisioning is lumpy: some steps are a database write, one is an
 * OpenAI round trip. Giving each line a length that matches what it actually
 * represents is what makes the screen believable.
 *
 * `brand_ready` is the longest because it is genuinely the slowest in the live
 * flow — it is the one that calls OpenAI, and it is the milestone
 * `SLOW_MILESTONE` in onboarding-types.ts names for exactly that reason. The
 * two cheap checks at the top are the quickest. The last step is slower again,
 * so the run lands rather than stopping dead.
 *
 * Totals ~12.4s. Long enough to feel like setup actually happened — which is
 * the point of showing it at all — and to read every line without hurrying.
 *
 * THIS LIVES HERE, NOT IN `onboarding-types.ts`. That module is shared with the
 * LIVE signup, whose milestone list advances only when the server confirms a
 * step and never on a timer. Putting durations there would hand the real flow a
 * set of fake ones.
 */
const MILESTONE_DWELL_MS: Record<ProvisionMilestone, number> = {
  validated: 900,
  payment_verified: 1100,
  brand_ready: 3200,
  workspace_created: 1400,
  account_linked: 1200,
  billing_ready: 1300,
  subscription_linked: 1500,
  site_published: 1800,
};

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
    // The dwell of the milestone CURRENTLY RUNNING — index `completed`, since
    // that many are finished and this is the next one — not a fixed interval.
    const running = PROVISION_MILESTONES[completed];
    const timer = window.setTimeout(
      () => setCompleted((n) => n + 1),
      MILESTONE_DWELL_MS[running],
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
  /** The public site customers book on — the other half of what they just bought. */
  const bookingAddress = `${slug || JOURNEY_TENANT_SLUG}.drive-247.com`;

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
      {/*
        The two addresses the operator now owns, given equal weight in one
        panel. This screen used to name only the portal, in body text, with the
        booking site mentioned in the sentence above and never shown — so the
        thing an operator most wants to see at this moment, their own public
        URL, was the one thing missing. They are the reward; they should look
        like it rather than like a caption.
      */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-start gap-3 p-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400">
            <LayoutDashboard className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Your portal
            </p>
            <p className="mt-1 font-mono text-[15px] break-all sm:text-base">
              {portalAddress}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Where you run the fleet.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 border-t border-border p-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600 dark:text-indigo-400">
            <Globe className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
              Your booking site
            </p>
            <p className="mt-1 font-mono text-[15px] break-all sm:text-base">
              {bookingAddress}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Live now. This is what customers see.
            </p>
          </div>
        </div>
      </div>

      {/* Only stated when Stripe actually answered. Nothing is invented. */}
      {payment && !payment.simulated && payment.last4 && (
        <p className="mt-4 text-sm text-muted-foreground">
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
