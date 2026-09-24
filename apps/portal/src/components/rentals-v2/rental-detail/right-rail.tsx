"use client";

import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { RailMessages } from "./rail-messages";
import { RailActivity } from "./rail-activity";
import { Activity, CreditCard, MessageSquare } from "lucide-react";
import { ContextTabs, type ContextTab } from "@/components/timeline-v2/context-rail";
import { RentalPaymentPlan } from "@/components/timeline-v2/rental-plan";

/**
 * This rental's context views, as data.
 *
 * The desktop column renders them as a tab strip; on a phone the dock renders
 * one icon per entry, each opening that view directly. Both read this, so a
 * view cannot exist in one place and not the other.
 */
export function rentalRailTabs(detail: RentalDetailV2): ContextTab[] {
  return [
    { id: "payment-plan", label: "Payment Plan", icon: CreditCard, keepMounted: true, content: <RentalPaymentPlan detail={detail} /> },
    // Opening Messages joins the realtime room and marks messages read. Do not pre-mount it.
    { id: "messages", label: "Messages", icon: MessageSquare, scroll: false, content: <RailMessages detail={detail} /> },
    { id: "activity", label: "Activity", icon: Activity, scroll: false, content: <RailActivity detail={detail} /> },
  ];
}

export function RightRail({ detail }: { detail: RentalDetailV2; refetch: () => void }) {
  return <div className="flex h-full min-h-0 flex-col" data-tour="rental-right-rail">
    <ContextTabs label="Rental context" defaultValue="payment-plan" tabs={rentalRailTabs(detail)} />
  </div>;
}

export default RightRail;
