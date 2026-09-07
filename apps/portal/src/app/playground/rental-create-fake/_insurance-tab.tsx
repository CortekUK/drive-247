"use client";

/**
 * Insurance — DESIGN SANDBOX. Nothing here is real.
 *
 * The second OUTPUT, and deliberately a narrower one: a policy is written
 * against the car and the cover period and nothing else, so moving the daily
 * rate or adding a child seat must NOT put it out of date. Drift is only drift
 * if the document carried the term in the first place — the host page decides
 * that, in `INSURANCE_TERMS`.
 *
 * OWNS: nothing. Renders its own `Panel`.
 */

import { ShieldCheck, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { money, fmtDate, Panel, cardCls, OutOfDateBanner, Pill, ActionButton, EmptyHint, type Drift } from "@/app/playground/_shared";

export type InsuranceState = "none" | "active";

export function InsuranceTab({
  state,
  drift,
  premium,
  quote,
  covers,
  from,
  to,
  days,
  hasVehicle,
  onBuy,
  onAcceptDrift,
}: {
  state: InsuranceState;
  drift: Drift[];
  /** What was actually paid for the policy in force. */
  premium: number;
  /** What cover would cost right now, for the button label. */
  quote: number;
  /** The snapshot's vehicle, cover start and cover end — what the POLICY says. */
  covers: string;
  from: string;
  to: string;
  days: number;
  hasVehicle: boolean;
  onBuy: () => void;
  onAcceptDrift: () => void;
}) {
  return (
    <Panel title="Insurance" description="Optional cover for the hire period. Priced from the car and the dates.">
      {drift.length > 0 && (
        <OutOfDateBanner
          title="This policy no longer matches the rental"
          meta={`Cover bought for ${money(premium)}`}
          drift={drift}
          primaryLabel="Re-quote and replace"
          onPrimary={onBuy}
          secondaryLabel="Keep the current policy"
          onSecondary={onAcceptDrift}
        />
      )}

      {state === "none" ? (
        <>
          <EmptyHint>No cover on this rental. The customer is on their own policy.</EmptyHint>
          <ActionButton onClick={onBuy} disabled={days === 0 || !hasVehicle}>
            <ShieldCheck className="size-4" />
            Add cover {days > 0 ? `· ${money(quote)}` : ""}
          </ActionButton>
          {days === 0 && (
            <p className="text-xs text-muted-foreground">
              Settle the dates first — the premium is priced per day.
            </p>
          )}
        </>
      ) : (
        <div className={cn(cardCls, "p-6")}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-heading text-sm font-semibold">Collision Damage Waiver</p>
              <p className="text-xs text-muted-foreground">Policy BZ-88134-C</p>
            </div>
            <Pill tone="success">
              <Check className="size-3" />
              Active
            </Pill>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Covers</dt>
              <dd className="font-medium">{covers}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Period</dt>
              <dd className="font-medium">
                {fmtDate(from)} → {fmtDate(to)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-foreground/10 pt-2 font-semibold">
              <dt>Premium</dt>
              <dd>{money(premium)}</dd>
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}
