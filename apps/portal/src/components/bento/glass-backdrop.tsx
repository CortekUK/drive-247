"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Ambient backdrop for glass screens — 2–3 soft, blurred, brand-tinted blobs
 * fixed behind the content so `.glass` panels have something colourful to frost.
 * Spec: GLASS.md §4. The largest blob follows the per-tenant accent via
 * color-mix on --primary. pointer-events:none; honours reduced-motion via CSS.
 *
 * Use on full-screen glass moments (auth) or behind floating glass panels.
 * `fixed` (default) covers the viewport; `absolute` scopes it to a positioned parent.
 */
export function GlassBackdrop({
  position = "fixed",
  className,
}: {
  position?: "fixed" | "absolute";
  className?: string;
}) {
  const blobs = [
    {
      // largest — follows the tenant accent
      size: 460,
      pos: { top: -120, left: -90 },
      bg: "color-mix(in srgb, hsl(var(--primary)) 32%, transparent)",
      dur: "9s",
      delay: "0s",
    },
    {
      size: 400,
      pos: { bottom: -110, right: -60 },
      bg: "color-mix(in srgb, var(--bento-info) 26%, transparent)",
      dur: "11s",
      delay: "0.6s",
    },
    {
      size: 300,
      pos: { top: "38%", right: "40%" },
      bg: "color-mix(in srgb, hsl(var(--primary)) 18%, transparent)",
      dur: "13s",
      delay: "1.2s",
    },
  ];

  return (
    <div
      aria-hidden
      className={cn(
        position === "fixed" ? "fixed" : "absolute",
        "inset-0 -z-10 overflow-hidden pointer-events-none",
        className,
      )}
    >
      {blobs.map((b, i) => (
        <div
          key={i}
          className="glass-blob absolute rounded-full"
          style={{
            width: b.size,
            height: b.size,
            background: b.bg,
            filter: "blur(72px)",
            animation: `floaty ${b.dur} ease-in-out ${b.delay} infinite`,
            ...b.pos,
          }}
        />
      ))}
    </div>
  );
}
