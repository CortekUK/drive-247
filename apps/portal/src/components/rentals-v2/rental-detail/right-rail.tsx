"use client";

import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { RailMessages } from "./rail-messages";
import { RailActivity } from "./rail-activity";
import { ContextTabs } from "@/components/timeline-v2/context-rail";
import { RentalPaymentPlan } from "@/components/timeline-v2/rental-plan";

export function RightRail({ detail }: { detail: RentalDetailV2; refetch: () => void }) {
  return <div className="flex h-full min-h-0 flex-col" data-tour="rental-right-rail">
    <ContextTabs label="Rental context" defaultValue="payment-plan" tabs={[
      { id: "payment-plan", label: "Payment Plan", keepMounted: true, content: <RentalPaymentPlan detail={detail} /> },
      // Opening Messages joins the realtime room and marks messages read. Do not pre-mount it.
      { id: "messages", label: "Messages", scroll: false, content: <RailMessages detail={detail} /> },
      { id: "activity", label: "Activity", scroll: false, content: <RailActivity detail={detail} /> },
    ]} />
  </div>;
}

export default RightRail;
