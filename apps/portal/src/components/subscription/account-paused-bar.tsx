"use client";

import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { useSubscriptionPause } from "@/hooks/use-subscription-pause";

/**
 * "Your account is paused" — shown at every width while the tenant's
 * subscription pause is running (Billing → Pause).
 *
 * Says why "Add rental / vehicle / customer" is refused (the database turns
 * those down while paused) and links to Billing, where the pause can be ended
 * early. Like PaymentDueBar it is in flow and renders nothing at all in any
 * other state, so a tenant who is not paused gets no wrapper and no spacer.
 */
export function AccountPausedBar() {
  const { data } = useSubscriptionPause();
  if (!data?.pausedNow || !data.pause) return null;

  const back = new Date(`${data.pause.end_date}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Link
      data-account-paused-bar=""
      href="/subscription"
      className="flex w-full items-center gap-2 bg-sky-50 px-4 py-2.5 text-xs font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
    >
      <PauseCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Your account is paused until {back}.</span>
      <span className="hidden opacity-70 sm:inline">
        Billing is off, your booking site is on hold, and new rentals, vehicles and customers can't be added.
      </span>
      <span className="ml-auto shrink-0 underline underline-offset-2">Manage</span>
    </Link>
  );
}
