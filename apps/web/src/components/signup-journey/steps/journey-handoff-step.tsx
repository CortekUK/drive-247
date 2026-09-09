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
 * is no server behind this route, so elapsed time walks the list, against the
 * per-milestone dwells below.
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

/**
 * When each milestone finishes, in ms from the start of the run. Derived from
 * the dwells above so the two can never disagree.
 *
 * This is what lets the progress figure be a measure of the run rather than a
 * count of the list — see `percent` below.
 */
const MILESTONE_END_MS: readonly number[] = PROVISION_MILESTONES.reduce<
  number[]
>((ends, milestone) => {
  ends.push((ends[ends.length - 1] ?? 0) + MILESTONE_DWELL_MS[milestone]);
  return ends;
}, []);

/** The whole run, ~12.4s. */
const RUN_MS = MILESTONE_END_MS[MILESTONE_END_MS.length - 1];

/**
 * How long the finished list holds before the success screen replaces it.
 *
 * Without it the last milestone completing and the success screen replacing it
 * were the same render, so the eighth tick, the eighth line in its past tense
 * and 100% were never drawn at all. A progress bar whose last visible value is
 * 88% reads as a job that was abandoned, not finished — and this is the screen
 * whose entire purpose is to show the setup completing.
 */
const SETTLE_MS = 700;

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
  /**
   * How far into the run we are, in ms.
   *
   * THE RUN IS DRIVEN BY ELAPSED TIME, not by a chain of per-milestone timers,
   * and that is what fixed the progress figure. It used to be
   * `completed / 8 * 100` — a count of finished lines — which meant the number
   * and the bar were wrong in exactly the moments they were being looked at:
   *
   *   - the first 900ms showed 0%, an empty bar under a screen that had already
   *     started working;
   *   - every value was stale for as long as its milestone ran, and worst where
   *     the wait was longest — `brand_ready` is 3.2s, so a quarter of the whole
   *     run was spent frozen at 25% with nothing on screen moving;
   *   - it never reached 100%: the eighth milestone landing was also the frame
   *     that swapped in the success screen, so the last value anyone saw was
   *     88% (7 of 8, rounded).
   *
   * Deriving both the bar and the completed count from one clock makes the
   * figure the true fraction of the run — the dwells are constants here, so
   * this is measured, not invented — and it advances continuously through the
   * long milestone instead of standing still through it.
   *
   * (The LIVE screen must keep counting milestones: its steps are confirmed by
   * a server and have no knowable duration, which is why `onboarding-types.ts`
   * says not to invent sub-progress there. Here the durations ARE the truth.)
   *
   * Reading the clock each frame rather than accumulating deltas also means a
   * backgrounded tab — where rAF stops entirely — resumes at the right value
   * instead of however far it got before being parked.
   */
  const [elapsed, setElapsed] = React.useState(0);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    const startedAt = Date.now();
    let frame = 0;
    let settle = 0;

    const tick = () => {
      const ms = Math.min(Date.now() - startedAt, RUN_MS);
      setElapsed(ms);
      if (ms < RUN_MS) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      settle = window.setTimeout(() => setDone(true), SETTLE_MS);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, []);

  // Told once, in an effect rather than from the timer callback, so the parent's
  // headline swap is a commit-phase update and not a setState during render.
  React.useEffect(() => {
    if (done) onReady();
  }, [done, onReady]);

  /**
   * ALWAYS NORTHWIND — never the slug they typed. This is the one line that
   * makes the demo loop repeatable, and it was the bug the team lead reported.
   *
   * The journey creates NOTHING: no auth user, no tenant, no subscription (see
   * the header of `lib/signup-journey.ts`). So handing the browser to
   * `<their-slug>.portal.…` sends them to a workspace that does not exist and
   * ends a signup that otherwise worked perfectly on "Tenant not found or
   * inactive" — which is exactly what happened with "Gamma Dev".
   *
   * What he asked for instead, at [03:26] and [05:32]: "mujhe redirect karwa de
   * Northwind pe… end pe mujhe Northwind pe land karwa de, kyunki hum teenon ke
   * liye source of truth sirf Northwind hai."
   *
   * NOTE THE DELIBERATE SPLIT between this and `portalAddress` below. The
   * addresses on screen keep THEIR chosen name, because the fiction is the
   * point — "usko aise lagna chahiye ki main new tenant pe aa gaya hoon, lekin
   * actually main Northwind pe hi hoon." What is displayed is the workspace
   * they think they made; where the button goes is the one that exists.
   *
   * The URL also carries `firstrun=1`, which re-arms the wizard and the tour on
   * arrival, so the landing is a genuine first run rather than whatever state
   * Northwind was left in — see `lib/first-run-handoff.ts` in the portal.
   */
  const portalHref = portalHandoffUrl();
  const completed = MILESTONE_END_MS.filter((end) => elapsed >= end).length;
  const percent = (elapsed / RUN_MS) * 100;
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
          // The shared indicator eases over 500ms, which is right when the value
          // arrives in one big step per milestone. This one is re-targeted every
          // frame, so that transition is pure lag: the bar trailed the printed
          // percentage by several points for the whole run. Shortened rather
          // than removed — it is what smooths the jump when a backgrounded tab
          // comes back and the clock has moved on without any frames.
          className="h-1.5 [&>[data-slot=progress-indicator]]:duration-150"
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
