'use client';

import { BlockedDatesManager } from "@/components/blocked-dates/blocked-dates-manager";
import { WorkingHoursCard } from "@/components/blocked-dates/working-hours-card";

export default function BlockedDates() {
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
