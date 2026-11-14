"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TrackPanel } from "./track-embed";
import "./track-phone-stage.css";

/*
 * Phones (boss, 2026-11-13): each screen on the product track is shown whole, end to end, in
 * one box, as the other mockups are, instead of a phone-only rearrangement of it. The box is
 * the real desktop screen (/embed/track/<panel>, a frame of a fixed desktop size) scaled down
 * to the phone's width, with its heading above it.
 *
 * No numbered list under it (boss, 2026-11-14): the screen carries its own labels, drawn on it
 * exactly as on desktop, so they are not repeated as numbers below, and none of them is lit
 * in turn ("don't run the labels"; the desktop shows them all at once).
 *
 * Wider than a phone, the section itself renders as before.
 */

const PHONE = "(max-width: 767.98px)";
/** The desktop size the screen is drawn at, inside the frame. */
const FRAME_W = 1280;
const FRAME_H = 800;

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const media = matchMedia(PHONE);
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return phone;
}

export function TrackPhoneStage({
  panel,
  title,
  heading,
  sub,
  children,
}: {
  panel: TrackPanel;
  title: string;
  /** Kept for the callers; the screen draws its own labels (see above). */
  labels?: string[];
  /** The screen's heading and sub-line, held in view above it on phones (the track's own intro is hidden there). */
  heading?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0);
  // Load the frame only as it comes near, so the page above does not wait on it.
  const [near, setNear] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!phone || !box) return;
    const ro = new ResizeObserver(() => setScale(box.clientWidth / FRAME_W));
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "150% 0px" });
    io.observe(box);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [phone]);

  if (!phone) return <>{children}</>;

  return (
    <section className="tps" aria-label={title}>
      <div className="tps-stick">
        {/* The heading, then the whole screen under it. */}
        {heading && (
          <div className="tps-head">
            <h2 className="tps-title">{heading}</h2>
            {sub && <p className="tps-sub">{sub}</p>}
          </div>
        )}
        <div ref={boxRef} className="tps-box">
          {near && scale > 0 && (
            <iframe
              ref={frameRef}
              className="tps-frame"
              src={`/embed/track/${panel}`}
              title={title}
              tabIndex={-1}
              aria-hidden
              loading="lazy"
              width={FRAME_W}
              height={FRAME_H}
              style={{ scale: String(scale) }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
