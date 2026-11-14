import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackEmbed, type TrackPanel } from "@/components/sections/track-embed";

/*
 * One screen of the product track (calendar, messages, insights) on its own, exactly as the
 * desktop track draws it. The phone landing page shows it in a frame, scaled down to fit, so a
 * phone sees the whole screen end to end (boss, 2026-11-13). Not a page anyone visits.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const PANELS: TrackPanel[] = ["calendar", "messages", "insights"];

export default async function TrackEmbedPage({ params }: { params: Promise<{ panel: string }> }) {
  const { panel } = await params;
  if (!PANELS.includes(panel as TrackPanel)) notFound();
  return <TrackEmbed panel={panel as TrackPanel} />;
}
