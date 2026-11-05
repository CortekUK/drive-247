"use client";

/**
 * DEV ONLY: the build screen (ProvisioningScreen) on a loop, to tune its
 * motion without paying for a signup each time.
 *
 * It renders the real component inside a pretend onboarding context: the
 * milestones tick in on a timer, then it lands on success or failure. Nothing
 * here calls a server. Mounted only by app/signup-build-replay, which 404s
 * outside `next dev`.
 *
 * The screen is a modal Radix dialog, which makes everything else on the page
 * inert. The controls opt back in with `pointer-events: auto`, and the keys
 * work regardless: R replays, S jumps to success, F plays a failure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { INITIAL_ONBOARDING_STATE, OnboardingContext } from "../onboarding-provider";
import { PROVISION_MILESTONES, type OnboardingContextValue, type OnboardingState } from "../onboarding-types";
import { ProvisioningScreen } from "../provisioning-screen";

type Ending = "success" | "failure";

const COMPANY = "Ghulam Rentals";
const SLUG = "ghulam";
const FAIL_AT = 4;

export function BuildScreenReplay() {
  const [run, setRun] = useState(0);
  const [ending, setEnding] = useState<Ending>("success");
  const [stepMs, setStepMs] = useState(700);
  const [count, setCount] = useState(0);
  const [outcome, setOutcome] = useState<"running" | Ending>("running");
  const timer = useRef<number | null>(null);

  const replay = useCallback((next: Ending = ending) => {
    setEnding(next);
    setCount(0);
    setOutcome("running");
    setRun((r) => r + 1);
  }, [ending]);

  const jumpToSuccess = useCallback(() => {
    setEnding("success");
    setCount(PROVISION_MILESTONES.length);
    setOutcome("success");
    setRun((r) => r + 1);
  }, []);

  // The milestones arrive one at a time, like the real poller reports them.
  useEffect(() => {
    if (outcome !== "running") return;
    const stopAt = ending === "failure" ? FAIL_AT : PROVISION_MILESTONES.length;
    if (count >= stopAt) {
      timer.current = window.setTimeout(() => setOutcome(ending), stepMs);
    } else {
      timer.current = window.setTimeout(() => setCount((c) => c + 1), count === 0 ? 400 : stepMs);
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [count, outcome, ending, stepMs, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") replay();
      else if (k === "s") jumpToSuccess();
      else if (k === "f") replay("failure");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replay, jumpToSuccess]);

  const value = useMemo(() => {
    const base = INITIAL_ONBOARDING_STATE();
    const state: OnboardingState = {
      ...base,
      step: outcome === "success" ? "done" : "provisioning",
      planId: "starter",
      account: { fullName: "Ghulam", email: "ghulam@example.com" },
      business: { ...base.business, companyName: COMPANY, slug: SLUG, acceptedTerms: true },
      payment: { ...base.payment, paid: true },
      provisioning: {
        completed: PROVISION_MILESTONES.slice(0, count),
        phase: outcome === "running" ? "running" : outcome === "success" ? "succeeded" : "failed",
        failure:
          outcome === "failure"
            ? { code: "INTERNAL", message: "Pretend failure for the replay." }
            : null,
        activeSince: Date.now(),
      },
      result:
        outcome === "success"
          ? {
              tenantId: "replay",
              slug: SLUG,
              companyName: COMPANY,
              portalUrl: `https://${SLUG}.portal.drive-247.com`,
              bookingUrl: `https://${SLUG}.drive-247.com`,
              portalSignInUrl: null,
              contentSeeded: true,
            }
          : null,
    };
    const noop = () => {};
    return {
      state,
      requestClose: noop,
      retryProvision: async () => replay("success"),
      updateBusiness: noop,
      checkSlug: async () => ({ available: true }),
    } as unknown as OnboardingContextValue;
  }, [count, outcome, replay]);

  return (
    <>
      <OnboardingContext.Provider value={value}>
        {/* Keyed per run so every entrance animation plays from the top. */}
        <ProvisioningScreen key={run} />
      </OnboardingContext.Provider>

      <div
        style={{ pointerEvents: "auto" }}
        className="fixed top-4 left-4 z-[400] flex w-36 flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white/95 p-2.5 text-xs text-zinc-700 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-200"
      >
        <span className="px-1 pb-0.5 text-[11px] font-medium text-zinc-500">Replay</span>
        <button type="button" onClick={() => replay("success")} className="rounded-full bg-indigo-600 px-3 py-1 font-medium text-white">
          Run (R)
        </button>
        <button type="button" onClick={jumpToSuccess} className="rounded-full border border-zinc-200 px-3 py-1 dark:border-white/15">
          Success (S)
        </button>
        <button type="button" onClick={() => replay("failure")} className="rounded-full border border-zinc-200 px-3 py-1 dark:border-white/15">
          Failure (F)
        </button>
        <label className="mt-1 flex items-center justify-between gap-1.5 px-1">
          Step
          <select
            value={stepMs}
            onChange={(e) => setStepMs(Number(e.target.value))}
            className="rounded-md border border-zinc-200 bg-transparent px-1 py-0.5 dark:border-white/15"
          >
            {[300, 500, 700, 1000, 1500].map((ms) => (
              <option key={ms} value={ms}>
                {ms}ms
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
