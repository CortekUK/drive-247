"use client";

/**
 * The way out of a billing state a developer switched on.
 *
 * ── the bug this fixes ──────────────────────────────────────────────────────
 *
 * The subscription blocker is deliberately inescapable: no Esc, no click
 * outside, no close button. That is correct for a tenant with an unpaid
 * invoice, and it was a trap for anyone reviewing the screen — `/dev`, the page
 * holding the switch, sits inside the dashboard and is therefore behind the
 * blocker too. Selecting "Grace expired" locked the tester out of the control
 * that turns it off, and signing out did not help: the flag lives in
 * localStorage and survives a sign-out, so signing back in landed on the same
 * wall. The only way back was the browser console.
 *
 * ── three ways out, deliberately ────────────────────────────────────────────
 *
 * The whole point of the blocked state is that it stops everything, so one exit
 * is not enough — whichever one is missing is the one you need:
 *
 *   1. `<DevBillingStateEscape />` inside the blocking dialog itself.
 *   2. `<DevBillingStatePill />` floating on every dashboard page, so a state
 *      that warns rather than blocks can also be cleared from where you are.
 *   3. `/dev` stays reachable while blocked (see `(dashboard)/layout.tsx`).
 *
 * ── neither can appear for a real tenant ────────────────────────────────────
 *
 * Three conditions, all required: `NODE_ENV === "development"` (a literal, so a
 * production bundle folds `readBillingScenario` to a constant "off" and drops
 * the storage code), the northwind canary by SLUG, and a scenario actually
 * selected. A tenant whose subscription genuinely lapsed sees exactly what they
 * saw before — these render nothing.
 */

import { useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import {
  BILLING_SCENARIOS,
  readBillingScenario,
  setBillingScenario,
  subscribeDevOverrides,
  type BillingScenarioId,
} from "@/lib/dev-overrides";

/** The active scenario, or null when this browser must not have one. */
function useActiveScenario(): { id: BillingScenarioId; label: string } | null {
  const { tenant } = useTenant();
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readBillingScenario(),
    () => "off" as BillingScenarioId,
  );

  if (scenario === "off") return null;
  if (!tenant?.slug || !isLeanTenant(tenant.slug)) return null;

  return {
    id: scenario,
    label: BILLING_SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario,
  };
}

/** Inside the blocking dialog — the exit for the state that stops everything. */
export function DevBillingStateEscape() {
  const active = useActiveScenario();
  if (!active) return null;

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2.5 text-center">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Developer preview
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        This screen is being driven by the{" "}
        <span className="font-medium text-foreground">{active.label}</span> state, not by real
        billing data.
      </p>
      <button
        type="button"
        onClick={() => setBillingScenario("off")}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
      >
        <RotateCcw className="h-3 w-3" />
        Exit preview
      </button>
    </div>
  );
}

/**
 * Floating on every dashboard page while a state is active.
 *
 * Two jobs. It is the exit from wherever you happen to be — and it is a
 * standing reminder that what is on screen is NOT this tenant's real billing
 * state, which matters most for the states that only warn: a red chip in the
 * sidebar looks identical whether a card really failed or somebody left a
 * preview switched on an hour ago.
 *
 * Bottom-left, clear of the quick dock on the right edge and of the toasts that
 * come up bottom-right.
 */
export function DevBillingStatePill() {
  const active = useActiveScenario();
  if (!active) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[120] flex items-center gap-2 rounded-full border border-dashed border-amber-500/50 bg-amber-500/10 py-1.5 pl-3 pr-1.5 shadow-sm backdrop-blur">
      <span className="font-mono text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
        Preview
      </span>
      <span className="text-[12px] font-medium text-foreground">{active.label}</span>
      <button
        type="button"
        onClick={() => setBillingScenario("off")}
        title="Turn the billing preview off and go back to real data"
        className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
      >
        <RotateCcw className="h-3 w-3" />
        Exit
      </button>
    </div>
  );
}
