"use client";

/**
 * The `/dev` control for the billing states.
 *
 * Modelled on `messages-preview.tsx` beside it: it reads and writes
 * `lib/dev-overrides.ts` and nothing else — no tenant, no Supabase — because
 * the selection is a per-browser developer preference, not tenant state.
 * Nothing it does touches the database or Stripe.
 *
 * The states swap DERIVED VALUES ONLY. Everything still renders through the
 * production components a real dunning event drives — the sidebar chip, the
 * Billing warning, the blocking dialog — so what is being judged is the real
 * UI with believable inputs, not a mock screen built beside it.
 */

import { useSyncExternalStore } from "react";
import { ArrowUpRight, CreditCard } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui-v2/card";
import {
  BILLING_SCENARIOS,
  readBillingScenario,
  setBillingScenario,
  subscribeDevOverrides,
  type BillingScenarioId,
} from "@/lib/dev-overrides";

export function BillingPreview() {
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readBillingScenario(),
    () => "off" as BillingScenarioId,
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <CreditCard className="h-4 w-4" />
              Billing states
            </CardTitle>
            <CardDescription className="mt-1.5">
              A failed payment arrives from a Stripe webhook, and grace expiry is a clock event —
              so without this you would have to fail a real card and then wait out the configured
              window to see the blocked screen once. Selecting a state changes what the app
              believes about this subscription; nothing is written, no Stripe call is made, and
              the real queries keep running underneath.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5 rounded-full">
            <a href="/subscription">
              Open Billing
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {BILLING_SCENARIOS.map((s) => {
            const active = scenario === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setBillingScenario(s.id)}
                aria-pressed={active}
                title={s.hint}
                className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {BILLING_SCENARIOS.find((s) => s.id === scenario)?.hint}
        </p>

        {/* The state changes what the whole app does, not just one page, so say
            where to look — otherwise the blocked state gets reviewed on the
            Billing page, which is one of the two routes it deliberately lets
            through. */}
        <div className="rounded-2xl bg-muted/40 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Where to look</p>
          <ul className="mt-1.5 space-y-1">
            <li>
              <span className="font-medium text-foreground">Payment failed / Overdue</span> —
              warning on Billing, and the chip at the bottom of the sidebar.
            </li>
            <li>
              <span className="font-medium text-foreground">Grace, nearly out</span> — the same
              warning in a stronger tone. There is no countdown anywhere, by decision.
            </li>
            <li>
              <span className="font-medium text-foreground">Grace expired</span> — open the
              Dashboard, not Billing: Billing and Settings stay reachable on purpose so a blocked
              tenant can still pay.
            </li>
            <li>
              <span className="font-medium text-foreground">Payment recovered</span> — select it
              while blocked to watch access come back without a reload.
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
