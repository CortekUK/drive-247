'use client';

import { BlockedDatesManager } from "@/components/blocked-dates/blocked-dates-manager";
import { WorkingHoursCard } from "@/components/blocked-dates/working-hours-card";

export default function BlockedDates() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Blocked Dates</h1>
        <p className="text-muted-foreground">
          Manage dates when vehicles are unavailable for rental
        </p>
      </div>

      <BlockedDatesManager />

      {/* Working Hours Section */}
      <WorkingHoursCard />
    </div>
  );
}
