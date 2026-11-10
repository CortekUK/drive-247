"use client";

/**
 * Insurance on a phone — DESIGN SANDBOX, for the landing page's Insurance story.
 *
 * The rental's Bonzah card (`rentals-v2/rental-detail/bonzah-cover-card.tsx`),
 * on its own at phone width, under a header like the rental's. `?bought=1`
 * shows it with the demo policy in force (so its Documents open the Bonzah
 * certificate). Demo rental only: nothing here reads or writes anything, and
 * "Add cover" only flips the page's own state.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { BonzahCoverCard } from "@/components/rentals-v2/rental-detail/bonzah-cover-card";
import type { InsurancePolicy } from "@/hooks/use-rental-insurance-policies";
import { Pill } from "@/app/playground/_shared";

const FROM = "2026-11-14";
const TO = "2026-11-18";
const DAYS = 4;

export default function InsurancePhone() {
  const [bought, setBought] = useState(false);
  // Read after mount, so the page needs no Suspense boundary for the query string.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("bought") === "1") setBought(true);
  }, []);

  const policy = bought
    ? ({
        id: "demo-policy",
        policy_id: "demo-policy",
        policy_no: "BZ-88134-C",
        status: "active",
        premium_amount: Math.round((14.95 + 7.95) * DAYS * 100) / 100,
        coverage_types: { cdw: true, rcli: true },
        trip_start_date: FROM,
        trip_end_date: TO,
        pickup_state: "FL",
      } as unknown as InsurancePolicy)
    : null;

  return (
    <main className="min-h-screen bg-app-gradient px-4 pb-8 pt-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" />
        RNT-2049 · Marcus Bell
      </div>
      <h1 className="mt-4 font-heading text-2xl font-semibold tracking-tight">Insurance</h1>
      <p className="mt-1 text-sm text-muted-foreground">Honda Accord · Nov 14 → Nov 18</p>
      <div className="mt-5">
        <BonzahCoverCard
          policy={policy}
          covered={bought}
          live
          sandbox={false}
          days={DAYS}
          rentalStart={FROM}
          rentalEnd={TO}
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
          onRequote={() => setBought(true)}
        />
      </div>
    </main>
  );
}
