import type { Metadata } from "next";
import { ConfirmationClient } from "./confirmation-client";
import { LegacyConfirmation } from "./legacy-confirmation";
import { getStrategyCallBookingSummary } from "@/lib/strategy-call/booking";

export const metadata: Metadata = {
  title: "Strategy call preparation | Drive247",
  description: "Prepare for your Drive247 strategy call.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConfirmationPage() {
  if (process.env.STRATEGY_CALL_CONFIRMATION_V2 !== "true") {
    return <LegacyConfirmation />;
  }

  const booking = await getStrategyCallBookingSummary();
  return <ConfirmationClient initialBooking={booking} />;
}
