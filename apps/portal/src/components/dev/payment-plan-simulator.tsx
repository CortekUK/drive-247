"use client";

/**
 * The `/dev` section for payment plans (docs/PAYMENT_PLANS_DESIGN.md §10).
 *
 * The lead: "Put the testing in the developer tab… we should be able to test
 * each and every branch" and "However you test it, make sure I can test it
 * that same way." So this section runs the REAL engine (`runTick` and the
 * operator operations, mirrored byte-for-byte from the edge functions' copy) in
 * the browser:
 *
 *   Scenarios   the §10.1 list the vitest suite runs, with pass/fail per check
 *   Free play   the real form, a clock, a card whose next answer you pick, and
 *               the real plan card driven by what the engine did
 *
 * BLAST RADIUS — none. Everything here lives in an in-memory store inside this
 * tab. There is no Supabase import in this section and no edge-function call;
 * no card is charged and nothing is written to the database. The sentence in
 * dev-page.tsx ("the one database write in here is a delete on
 * tenant_first_run…") stays true with this section added.
 *
 * Northwind-only, like the rest of /dev — the gate is the page's.
 */

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui-v2/card";
import { cn } from "@/lib/utils";
import { PaymentPlanScenarios } from "./payment-plan-scenarios";
import { PaymentPlanFreePlay } from "./payment-plan-free-play";

type Tab = "scenarios" | "free";

export function PaymentPlanSimulator() {
  const [tab, setTab] = useState<Tab>("scenarios");
  return (
    <Card className="mt-6" data-payment-plan-simulator="">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <CalendarClock className="h-4 w-4" />
          Payment plan simulator
        </CardTitle>
        <CardDescription className="mt-1.5">
          Runs the real payment-plan engine in this browser, against an in-memory store and a simulated card. Every scenario the
          automated tests run is here, with each check&rsquo;s expected and actual value. Nothing is written to the database and no card is
          charged — reloading the page forgets everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="inline-flex rounded-full bg-muted/60 p-0.5" role="tablist" aria-label="Simulator mode">
          {(
            [
              ["scenarios", "Scenarios"],
              ["free", "Free play"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "h-7 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/5"
                  : "text-muted-foreground hover:text-primary dark:hover:text-[hsl(var(--v2-link,var(--primary)))]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Both stay mounted so switching tabs never throws away a run. */}
        <div hidden={tab !== "scenarios"}>
          <PaymentPlanScenarios />
        </div>
        <div hidden={tab !== "free"}>
          <PaymentPlanFreePlay />
        </div>
      </CardContent>
    </Card>
  );
}
