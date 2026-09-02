"use client";

import { useEffect, useRef, useState } from "react";

/* ========================================================================== *
 * Reveal — fades an element up the first time it reaches the viewport.
 *
 * Deliberately NOT IntersectionObserver, which is the obvious choice and the
 * wrong one here. IO only notifies on threshold crossings, computed once per
 * rendering update: an element that goes from below the fold to above it
 * within a single frame reports ratio 0 both times, so no callback ever
 * arrives and it stays at `opacity: 0` permanently. That is not hypothetical —
 * it happens on any instant jump: an in-page anchor, a browser restoring
 * scroll position on reload, find-in-page, or a scripted scroll. Whole
 * sections of the page silently vanish.
 *
 * So: one shared passive listener, rAF-throttled, over a registry of the
 * elements still waiting. Anything at or above the fold is revealed, whether
 * it arrived there by scrolling through or by jumping past. Each element
 * unregisters as it reveals and the listener detaches once the registry is
 * empty, so a fully-revealed page carries no scroll work at all.
 * ========================================================================== */

type Pending = { el: HTMLElement; show: () => void };

const pending = new Set<Pending>();
let listening = false;
let frame = 0;

function flush() {
  frame = 0;
  const limit = window.innerHeight * 0.94;
  for (const p of [...pending]) {
    // `top < limit` covers both "scrolled into view" and "already scrolled
    // past" — a negative top is above the fold and must not stay hidden.
    if (p.el.getBoundingClientRect().top < limit) {
      pending.delete(p);
      p.show();
    }
  }
  if (!pending.size) detach();
}

function onScroll() {
  if (frame) return;
  frame = requestAnimationFrame(flush);
}

function attach() {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
}

function detach() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
}

function register(p: Pending) {
  pending.add(p);
  attach();
  // Evaluate immediately so anything already on screen at mount is never
  // hidden waiting for a scroll that may never come.
  onScroll();
  return () => {
    pending.delete(p);
    if (!pending.size) detach();
  };
}

export function Reveal({
  children, className = "", delay = 0, as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger, in ms, for siblings revealed together. */
  delay?: number;
  as?: "div" | "section" | "li" | "article";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return register({ el, show: () => setShown(true) });
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`cbp-reveal ${className}`}
      data-shown={shown}
      style={delay ? { transitionDelay: shown ? `${delay}ms` : "0ms" } : undefined}
    >
      {children}
    </Tag>
  );
}
