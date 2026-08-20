"use client";

/**
 * Scroll orchestration for booking-v2.
 *
 * Lenis drives the scroll position, GSAP's ticker drives Lenis, and
 * ScrollTrigger reads from Lenis rather than the native scroll event — that
 * three-way handshake is what stops pinned sections from juddering half a
 * frame behind the smoothed scroll.
 *
 * GSAP and Lenis are both imported dynamically: a failure to load either one
 * must degrade to plain native scrolling, never to a blank page.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Gsap = typeof import("gsap").gsap;
type ScrollTriggerT = typeof import("gsap/ScrollTrigger").ScrollTrigger;
type GsapBundle = { gsap: Gsap; ScrollTrigger: ScrollTriggerT };

/* Loaded once and shared — importing gsap twice would register the plugin
   against two different instances. */
let gsapPromise: Promise<GsapBundle | null> | null = null;

export function loadGsap(): Promise<GsapBundle | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!gsapPromise) {
    gsapPromise = Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        gsap.registerPlugin(ScrollTrigger);
        return { gsap, ScrollTrigger };
      })
      .catch(() => null);
  }
  return gsapPromise;
}

/** Lenis smooth scroll, wired into the GSAP ticker and ScrollTrigger. */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let lenis: { raf: (t: number) => void; destroy: () => void; on: (e: string, cb: () => void) => void } | null = null;
    let detach: (() => void) | null = null;
    let cancelled = false;

    Promise.all([import("lenis"), loadGsap()])
      .then(([{ default: Lenis }, bundle]) => {
        if (cancelled) return;
        lenis = new Lenis({ duration: 1.15, smoothWheel: true, touchMultiplier: 1.6 });

        if (bundle) {
          const { gsap, ScrollTrigger } = bundle;
          /* ScrollTrigger must recompute from Lenis' smoothed position, not
             from the native scroll event, or pinned sections lag a frame. */
          const update = () => ScrollTrigger.update();
          lenis.on("scroll", update);
          const tick = (time: number) => lenis?.raf(time * 1000);
          gsap.ticker.add(tick);
          gsap.ticker.lagSmoothing(0);
          detach = () => { gsap.ticker.remove(tick); };
        } else {
          /* No GSAP — drive Lenis off rAF directly. */
          let frame = 0;
          const raf = (t: number) => { lenis?.raf(t); frame = requestAnimationFrame(raf); };
          frame = requestAnimationFrame(raf);
          detach = () => cancelAnimationFrame(frame);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; detach?.(); lenis?.destroy(); };
  }, []);

  return null;
}

/**
 * GSAP ScrollTrigger parallax. `speed` is the fraction of the element's own
 * height it travels across the whole scroll pass — 0.2 is subtle, 0.6 is loud.
 */
export function GsapParallax({ children, speed = 0.25, className, scale = false }: {
  children: ReactNode; speed?: number; className?: string; scale?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx: { revert: () => void } | null = null;
    let cancelled = false;

    loadGsap().then(bundle => {
      if (!bundle || cancelled) return;
      const { gsap } = bundle;
      ctx = gsap.context(() => {
        gsap.fromTo(el,
          { yPercent: -speed * 50, ...(scale ? { scale: 1.12 } : {}) },
          {
            yPercent: speed * 50,
            ...(scale ? { scale: 1 } : {}),
            ease: "none",
            scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.6 },
          });
      });
    });

    return () => { cancelled = true; ctx?.revert(); };
  }, [speed, scale]);

  return <div ref={ref} className={className}>{children}</div>;
}

/**
 * GSAP stagger-in for a set of children matched by selector, keyed off the
 * wrapper entering the viewport. Used where a per-item <BlurFade> would mean
 * dozens of IntersectionObservers.
 */
export function GsapStagger({ children, selector, className, y = 34, stagger = 0.08, start = "top 82%" }: {
  children: ReactNode; selector: string; className?: string;
  y?: number; stagger?: number; start?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll(selector);
    if (!targets.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let ctx: { revert: () => void } | null = null;
    let cancelled = false;

    loadGsap().then(bundle => {
      if (!bundle || cancelled) return;
      const { gsap } = bundle;
      ctx = gsap.context(() => {
        gsap.from(targets, {
          y, opacity: 0, filter: "blur(6px)", duration: 0.85, ease: "power3.out", stagger,
          scrollTrigger: { trigger: el, start, once: true },
        });
      }, el);
    });

    return () => { cancelled = true; ctx?.revert(); };
  }, [selector, y, stagger, start]);

  return <div ref={ref} className={className}>{children}</div>;
}

/** Soft trailing cursor. Pointer-fine only, so touch devices are untouched. */
export function Cursor({ children }: { children?: ReactNode }) {
  const dot = useRef<HTMLDivElement | null>(null);
  const ring = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let x = -100, y = -100, rx = -100, ry = -100, frame = 0;
    const move = (e: MouseEvent) => {
      x = e.clientX; y = e.clientY;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      /* Grow over anything clickable. */
      const over = (e.target as HTMLElement | null)?.closest("a,button,[data-cursor]");
      if (ring.current) ring.current.dataset.on = over ? "1" : "0";
    };
    const loop = () => {
      rx += (x - rx) * 0.14; ry += (y - ry) * 0.14;
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px,${ry}px,0) translate(-50%,-50%)`;
      frame = requestAnimationFrame(loop);
    };
    window.addEventListener("mousemove", move, { passive: true });
    frame = requestAnimationFrame(loop);
    document.documentElement.dataset.d7Cursor = "1";
    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(frame);
      delete document.documentElement.dataset.d7Cursor;
    };
  }, []);

  return (
    <>
      {children}
      <div ref={ring} data-on="0" aria-hidden
        className={cn("d7-cursor hidden h-9 w-9 border border-[var(--v)]/45 bg-[var(--v)]/[.06] md:block",
          "data-[on='1']:h-14 data-[on='1']:w-14 data-[on='1']:bg-[var(--v)]/[.12]")} />
      <div ref={dot} aria-hidden
        className="d7-cursor hidden h-1.5 w-1.5 bg-[var(--v)] md:block" />
    </>
  );
}
