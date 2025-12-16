'use client';

import { BlockedDatesManager } from "@/components/blocked-dates/blocked-dates-manager";

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
    </div>
  );
}
