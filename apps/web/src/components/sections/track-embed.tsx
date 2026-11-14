"use client";

import { useEffect } from "react";
import { LandingTheme } from "@/components/shared/landing-theme";
import { CalendarSection } from "./calendar-section";
import { MultichatSection } from "./multichat-section";
import { InsightsGallery } from "./insights-gallery";
import "./product-track.css";
import "./track-phone-stage.css";

export type TrackPanel = "calendar" | "messages" | "insights";

/** The message the phone stage sends its frame: which label is the one being read. */
export type TrackFocusMessage = { type: "d247-track-focus"; n: number };

/*
 * The track's markup around one screen (product-track.tsx), so the desktop CSS lays it out
 * edge to edge as it does on the sliding track. The frame is a fixed desktop size
 * (track-phone-stage.tsx), so the desktop rules apply inside it whatever the phone is.
 */
export function TrackEmbed({ panel }: { panel: TrackPanel }) {
  // The label being read on the phone is lit here; the others step back.
  useEffect(() => {
    const onMessage = (event: MessageEvent<TrackFocusMessage>) => {
      if (event.origin !== location.origin || event.data?.type !== "d247-track-focus") return;
      document.documentElement.dataset.trackFocus = String(event.data.n);
    };
    addEventListener("message", onMessage);
    document.documentElement.classList.add("is-track-embed");
    return () => removeEventListener("message", onMessage);
  }, []);

  return (
    <LandingTheme>
      <div className="pt-outer pt-embed" style={{ "--pt-n": 1 } as React.CSSProperties}>
        <div className="pt-pin">
          <div className="pt-track">
            <div className="pt-panel is-here">
              {panel === "calendar" ? <CalendarSection /> : panel === "messages" ? <MultichatSection /> : <InsightsGallery />}
            </div>
          </div>
        </div>
      </div>
    </LandingTheme>
  );
}
