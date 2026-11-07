"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { TraxMark } from "@/components/shared/trax-mark";
import { HELLO } from "./tour-script";
import { HERO_EXIT } from "./trax-pointer";
import "./trax-guide.css";

/*
 * Trax in the corner, on the hero only (Ghulam, 2026-11-07). It arrives a moment after the
 * page, says hello and offers to show the visitor around. As soon as they scroll down, it
 * leaves the corner to "Start free trial" (floating-trial.tsx, which appears at the same
 * point) and comes up inside the sections instead (trax-pointer.tsx).
 *
 * The hello says itself once; the orb brings it back. "Not now" or the close button stop the
 * tour for the visit, and the orb starts it again. Motion is the Trax standard: 200ms,
 * opacity plus a 12px lift; with reduced motion nothing moves and nothing types.
 */

const TYPING_MS = 650;

export function TraxGuide({ muted, setMuted }: { muted: boolean; setMuted: (on: boolean) => void }) {
  const [atTop, setAtTop] = useState(true);
  const [arrived, setArrived] = useState(false);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [reduced, setReduced] = useState(false);
  const heard = useRef(false);
  const timer = useRef(0);

  const say = useCallback(() => {
    heard.current = true;
    setOpen(true);
    window.clearTimeout(timer.current);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTyping(true);
    timer.current = window.setTimeout(() => setTyping(false), TYPING_MS);
  }, []);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setTyping(false);
  }, []);

  // The corner is Trax's only while the hero is up.
  useEffect(() => {
    setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches);
    const onScroll = () => setAtTop(scrollY < HERO_EXIT);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    const arrive = window.setTimeout(() => setArrived(true), 500);
    return () => {
      removeEventListener("scroll", onScroll);
      window.clearTimeout(arrive);
      window.clearTimeout(timer.current);
    };
  }, []);

  // Hello, once, if the visitor is still on the hero and hasn't turned the tour off.
  useEffect(() => {
    const hello = window.setTimeout(() => {
      if (!heard.current && !muted && scrollY < HERO_EXIT) say();
    }, 1400);
    return () => window.clearTimeout(hello);
  }, [muted, say]);

  // Leaving the hero takes the note with it.
  useEffect(() => {
    if (!atTop) close();
  }, [atTop, close]);

  const stop = () => {
    setMuted(true);
    close();
  };

  const onOrb = () => {
    if (open) {
      close();
      return;
    }
    if (muted) setMuted(false);
    say();
  };

  const showMeAround = () => {
    close();
    if (muted) setMuted(false);
    document.getElementById("features")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const shown = arrived && atTop;
  return (
    <div className={`tg${shown ? " is-here" : ""}`} data-tour-layer aria-hidden={!shown || undefined} inert={!shown || undefined}>
      <div
        id="tg-note"
        className={`tg-note${open ? " is-open" : ""}`}
        role="region"
        aria-label="Trax"
        aria-hidden={!open || undefined}
        inert={!open || undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <div className="tg-head">
          <TraxMark size="xs" animated={typing && !reduced} />
          <b>Trax</b>
          <span className="tg-label">{HELLO.label}</span>
          <button type="button" className="tg-close" aria-label="Stop the tour" onClick={stop}>
            <X strokeWidth={2} aria-hidden />
          </button>
        </div>

        {typing ? (
          <p className="tg-typing" aria-label="Trax is typing">
            <i />
            <i />
            <i />
          </p>
        ) : (
          <p className="tg-text">
            {reduced
              ? HELLO.text
              : HELLO.text.split(" ").map((word, i) => (
                  <span key={i} className="tg-word" style={{ animationDelay: `${i * 28}ms` }}>
                    {word}{" "}
                  </span>
                ))}
          </p>
        )}

        {!typing && (
          <div className="tg-actions">
            <button type="button" className="tg-btn" onClick={showMeAround}>
              Show me around
              <ArrowRight strokeWidth={2} aria-hidden />
            </button>
            <button type="button" className="tg-ghost" onClick={stop}>
              Not now
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="tg-orb"
        aria-label={open ? "Hide Trax" : "Ask Trax to show you around"}
        aria-expanded={open}
        aria-controls="tg-note"
        onClick={onOrb}
      >
        <TraxMark size="lg" animated={!reduced} />
      </button>
    </div>
  );
}
