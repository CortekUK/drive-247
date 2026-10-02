"use client";

import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { RailMessages } from "./rail-messages";
import { RailActivity } from "./rail-activity";
import { RailTrax } from "./rail-trax";
import { RailNotifications } from "./rail-notifications";
import { Bell, History, MessagesSquare, ReceiptText, Sparkles } from "lucide-react";
import { ContextTabs, type ContextTab } from "@/components/timeline-v2/context-rail";
import { RailManagement } from "./rail-management";

/**
 * This rental's context views, as data.
 *
 * The desktop column renders them as a tab strip; on a phone the dock renders
 * one icon per entry, each opening that view directly. Both read this, so a
 * view cannot exist in one place and not the other.
 */
export function rentalRailTabs(detail: RentalDetailV2): ContextTab[] {
  return [
    { id: "management", label: "Management", icon: ReceiptText, showLabel: true, scroll: false, content: <RailManagement detail={detail} /> },
    // Opening Messages joins the realtime room and marks messages read. Do not pre-mount it.
    { id: "messages", label: "Messages", icon: MessagesSquare, scroll: false, content: <RailMessages detail={detail} /> },
    { id: "notifications", label: "Notifications", icon: Bell, scroll: false, content: <RailNotifications detail={detail} /> },
    { id: "activity", label: "Activity", icon: History, scroll: false, content: <RailActivity detail={detail} /> },
    // Last, outline — the Trax glyph (the sparkle inside the Trax mark), unfilled.
    // Trax keeps its thread across tab switches, and only wakes on first view (see rail-trax.tsx).
    { id: "trax", label: "Trax", icon: Sparkles, keepMounted: true, scroll: false, padded: false, content: <RailTrax detail={detail} /> },
  ];
}

export function RightRail({ detail }: { detail: RentalDetailV2; refetch: () => void }) {
  return <div className="flex h-full min-h-0 flex-col" data-tour="rental-right-rail">
    <ContextTabs label="Rental context" defaultValue="management" tabs={rentalRailTabs(detail)} iconsOnly />
  </div>;
}

export default RightRail;
