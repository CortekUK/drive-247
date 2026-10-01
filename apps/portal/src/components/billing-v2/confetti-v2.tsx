"use client";

import { useMemo } from "react";
import type React from "react";

/**
 * A one-shot burst of confetti over its parent (which must be `relative` and
 * clip with `overflow-hidden`). No library: ~90 small pieces, each falling and
 * turning on its own delay and speed, then fading out. Transform and opacity
 * only (V2_PLAN §12), and nothing at all under `prefers-reduced-motion`.
 */

const COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#4338ca", "#f59e0b", "#10b981", "#ec4899", "#38bdf8"];

export function ConfettiV2({ count = 90 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const r = (n: number) => {
          // Deterministic per piece, so a re-render doesn't reshuffle the burst.
          const x = Math.sin((i + 1) * 9301 + n * 49297) * 233280;
          return x - Math.floor(x);
        };
        return {
          left: r(1) * 100,
          drift: (r(2) - 0.5) * 160,
          delay: r(3) * 0.6,
          duration: 2.2 + r(4) * 1.6,
          spin: (r(5) > 0.5 ? 1 : -1) * (360 + r(6) * 540),
          w: 6 + r(7) * 6,
          h: r(8) > 0.6 ? 6 + r(7) * 6 : 10 + r(9) * 8,
          round: r(10) > 0.7,
          color: COLORS[Math.floor(r(11) * COLORS.length)],
        };
      }),
    [count],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden motion-reduce:hidden">
      <style>{`
        @keyframes d247-confetti-fall {
          0%   { transform: translate3d(0, -20px, 0) rotate(0deg); opacity: 0; }
          8%   { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translate3d(var(--drift), 560px, 0) rotate(var(--spin)); opacity: 0; }
        }
      `}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 block"
          style={
            {
              left: `${p.left}%`,
              width: p.w,
              height: p.h,
              background: p.color,
              borderRadius: p.round ? "9999px" : "2px",
              opacity: 0,
              "--drift": `${p.drift}px`,
              "--spin": `${p.spin}deg`,
              animation: `d247-confetti-fall ${p.duration}s cubic-bezier(.2,.6,.35,1) ${p.delay}s forwards`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
