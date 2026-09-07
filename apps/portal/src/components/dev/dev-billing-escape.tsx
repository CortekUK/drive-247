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
 * So the mock now carries its own exit, and the dashboard lets `/dev` through
 * while a scenario is active (see `(dashboard)/layout.tsx`). Two routes out,
 * because the whole point of this state is that it blocks everything.
 *
 * ── it cannot appear for a real tenant ──────────────────────────────────────
 *
 * Three conditions, all required: `NODE_ENV === "development"` (a literal, so a
 * production bundle folds this to `return null` and drops the storage code),
 * the northwind canary by SLUG, and a scenario actually selected. A tenant whose
 * subscription genuinely lapsed sees exactly what they saw before — this
 * renders nothing.
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

export function DevBillingStateEscape() {
  const { tenant } = useTenant();
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readBillingScenario(),
    () => "off" as BillingScenarioId,
  );

  if (scenario === "off") return null;
  if (!tenant?.slug || !isLeanTenant(tenant.slug)) return null;

  const label = BILLING_SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario;

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-3 py-2.5 text-center">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Developer preview
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        This screen is being driven by the{" "}
        <span className="font-medium text-foreground">{label}</span> state, not by real billing
        data.
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
