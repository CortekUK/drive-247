"use client";

import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { TONE_META, type AnnouncementTone } from "@/lib/announcements/contract";

/** The lucide icon each tone names in `TONE_META` (the admin preview maps the same names). */
const TONE_ICONS: Record<(typeof TONE_META)[AnnouncementTone]["icon"], LucideIcon> = {
  Info,
  CircleCheck,
  TriangleAlert,
  OctagonAlert,
};

export function ToneIcon({ tone, className }: { tone: AnnouncementTone; className?: string }) {
  const Icon = TONE_ICONS[TONE_META[tone]?.icon] ?? Info;
  return <Icon className={className} aria-hidden="true" data-tone-icon={tone} />;
}
