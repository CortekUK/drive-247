"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TrackFocusMessage, TrackPanel } from "./track-embed";
import "./track-phone-stage.css";

/*
 * Phones (boss, 2026-11-13): each screen on the product track is shown whole, end to end, in
 * one box, as the other mockups are, instead of a phone-only rearrangement of it. The box is
 * the real desktop screen (/embed/track/<panel>, a frame of a fixed desktop size) scaled down
 * to the phone's width. It sticks at the top while the screen's numbered labels scroll up
 * under it, numbered and joined by a line as in "Everything around each rental"; the label
 * being read lights up in the screen too, and on the calendar its booking opens in the sheet.
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
  labels,
  heading,
  sub,
  children,
}: {
  panel: TrackPanel;
  title: string;
  labels: string[];
  /** The screen's heading and sub-line, held in view above it on phones (the track's own intro is hidden there). */
  heading?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
}) {
  const phone = usePhone();
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [scale, setScale] = useState(0);
  const [lit, setLit] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
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

  // The label being read: the one crossing just under the stuck screen.
  useEffect(() => {
    const list = listRef.current;
    const box = boxRef.current;
    if (!phone || !list || !box) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const under = box.getBoundingClientRect().bottom;
      const items = Array.from(list.children) as HTMLElement[];
      // The label being read is the first one still showing under the screen; the ones that
      // have scrolled up under the stuck screen fade away instead of showing around it.
      let at = -1;
      items.forEach((item, i) => {
        const rect = item.getBoundingClientRect();
        const gone = rect.top + rect.height / 2 < under;
        item.toggleAttribute("data-under", gone);
        if (!gone && at < 0) at = i;
      });
      if (at < 0) at = items.length - 1;
      setLit(at);
    };
    const queue = () => {
      setPicked(null);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    addEventListener("scroll", queue, { passive: true });
    addEventListener("resize", queue);
    return () => {
      removeEventListener("scroll", queue);
      removeEventListener("resize", queue);
      cancelAnimationFrame(frame);
    };
  }, [phone]);

  const on = picked ?? lit;

  // Tell the screen which label to light.
  useEffect(() => {
    const send = () => frameRef.current?.contentWindow?.postMessage({ type: "d247-track-focus", n: on + 1 } satisfies TrackFocusMessage, location.origin);
    send();
  }, [on, near]);

  if (!phone) return <>{children}</>;

  return (
    <section className="tps" aria-label={title}>
      <div className="tps-stick">
        {/* Phones (boss, 2026-11-14): the heading stays in view with its screen; the two stick
            together, a little room above the heading. */}
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
              onLoad={() => frameRef.current?.contentWindow?.postMessage({ type: "d247-track-focus", n: on + 1 } satisfies TrackFocusMessage, location.origin)}
            />
          )}
        </div>
      </div>
      <ol ref={listRef} className="tps-steps">
        {labels.map((label, i) => (
          <li key={label} data-on={i === on ? "" : undefined} data-done={i < on ? "" : undefined} onClick={() => setPicked(i)}>
            <span className="tps-n" aria-hidden>
              {i + 1}
            </span>
            <span className="tps-label">{label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
