'use client';

import { BlockedDatesManager } from "@/components/blocked-dates/blocked-dates-manager";
import { WorkingHoursCard } from "@/components/blocked-dates/working-hours-card";
import { AvailabilityV2 } from "@/components/availability-v2/availability-v2";
import { useV2 } from "@/lib/v2-context";

/**
 * The Availability route.
 *
 * The ONLY edit v2 makes to this file: one branch, resolved from the gate the
 * root layout already worked out on the server (V2_PLAN §3). `northwind` gets
 * the week calendar; the other 36 tenants render exactly the two cards they
 * rendered yesterday, untouched.
 *
 * Retiring this is three deletions: the entry in `V2_AREAS`, this branch, and
 * `components/availability-v2/`.
 */
export default function BlockedDates() {
  const v2 = useV2("availability");
  return v2 ? <AvailabilityV2 /> : <BlockedDatesV1 />;
}

function BlockedDatesV1() {
  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Availability Management</h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Manage dates and hours when vehicles are available for rental
        </p>
      </div>

      <BlockedDatesManager />

      {/* Working Hours Section */}
      <WorkingHoursCard />
    </div>
  );
}
