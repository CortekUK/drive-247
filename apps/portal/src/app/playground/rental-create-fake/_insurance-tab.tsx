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
 * Laid out as the real stage is (components/rentals-v2/rental-detail/
 * stage-insurance.tsx): the real Bonzah card on top, and the customer's own
 * policy, checked by Trax, under it. The Bonzah card runs in its "live" mode
 * with `onRequote` pointed at the sandbox's own buy, so nothing reaches Bonzah;
 * the customer's own policy is made up, and arrives by the Simulate button.
 *
 * OWNS: nothing. Renders its own `Panel`.
 */

import { useState } from "react";
import { Check, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { TraxMark } from "@/components/trax/trax-greeting";
import { BonzahCoverCard } from "@/components/rentals-v2/rental-detail/bonzah-cover-card";
import { Surface, insetCls, listCls } from "@/components/rentals-v2/rental-detail/_kit";
import type { InsurancePolicy } from "@/hooks/use-rental-insurance-policies";
import { money, Panel, OutOfDateBanner, Pill, type Drift } from "@/app/playground/_shared";

export type InsuranceState = "none" | "active";

/** Bonzah's demo rates (bonzah-cover-card.tsx): CDW plus the RCLI it requires. */
const CDW_RCLI_PER_DAY = 14.95 + 7.95;

type OwnPolicy = "none" | "reading" | "valid";

export function InsuranceTab({
  state,
  drift,
  premium,
  from,
  to,
  days,
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
  const [own, setOwn] = useState<OwnPolicy>("none");
  const length = Math.max(1, days);

  // The policy the sandbox "bought": CDW with the RCLI that comes with it.
  const policy =
    state === "active"
      ? ({
          id: "demo-policy",
          policy_id: "demo-policy",
          policy_no: "BZ-88134-C",
          status: "active",
          premium_amount: Math.round(CDW_RCLI_PER_DAY * length * 100) / 100,
          coverage_types: { cdw: true, rcli: true },
          trip_start_date: from,
          trip_end_date: to,
          pickup_state: "FL",
        } as unknown as InsurancePolicy)
      : null;

  const simulateUpload = () => {
    setOwn("reading");
    window.setTimeout(() => setOwn("valid"), 2200);
  };

  return (
    <Panel title="Insurance" description="Cover for the hire — Bonzah, or the customer's own policy checked by Trax.">
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

      <div className="flex flex-col gap-4">
        <BonzahCoverCard
          policy={policy}
          covered={state === "active"}
          live
          sandbox={false}
          days={length}
          rentalStart={from || null}
          rentalEnd={to || null}
          customerName="Marcus Bell"
          tenantId={undefined}
          emptyNote={null}
          statusChip={
            <Pill tone="success">
              <Check className="size-3" />
              Active
            </Pill>
          }
          gapDays={null}
          onRequote={onBuy}
        />

        {/* ── the customer's own policy, checked by Trax (as the real stage) ── */}
        <Surface className="flex flex-col p-5">
          <div className="flex items-center gap-2.5">
            <h3 className="font-heading text-sm font-semibold">Customer&rsquo;s own policy</h3>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary">
              <TraxMark size="xs" className="-ml-1 size-4" />
              Checked by Trax
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="outline" onClick={simulateUpload}>
              <Upload />
              Upload certificate
            </Button>
          </div>

          {own === "none" ? (
            <div
              className={cn(
                insetCls,
                "mt-4 flex min-h-16 flex-col items-center justify-center gap-2 border border-dashed border-foreground/10 px-6 py-5 text-center"
              )}
            >
              <Upload className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drop in Marcus&rsquo;s insurance certificate — I&rsquo;ll read it and check it.
              </p>
              <p className="text-xs text-muted-foreground/70">PDF or a photo</p>
            </div>
          ) : (
            <div className={cn(listCls, "mt-4")}>
              <div className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{own === "reading" ? "coastal-mutual-card.png" : "Coastal Mutual"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {own === "reading" ? "Reading the document…" : "CM-4471-0923 · to 2027-06-01"}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                    own === "reading" ? "text-muted-foreground" : "text-success"
                  )}
                >
                  {own === "reading" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  {own === "reading" ? "Reading" : "Valid"}
                </span>
              </div>
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="ghost" onClick={simulateUpload}>
              Simulate the customer&rsquo;s upload
            </Button>
          </div>
        </Surface>
      </div>
    </Panel>
  );
}
