"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { firstNameOf, getGreeting } from "./trax-greeting-utils";

/**
 * Trax's identity: the mark, and the greeting an empty conversation opens on.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE GRADIENTS, AND NOT `.trax-icon`
 *
 * The lead asked for Trax to feel like "something advanced is happening" — a
 * gradient or two, not a light show. The mark carries it: an iridescent conic
 * fill that turns slowly, and a soft halo that breathes behind it. Both use
 * keyframes already in styles/v2-theme.css (`v2-spin-slow`, `v2-glow`), both
 * stop under `prefers-reduced-motion`, and both are built from `--primary` and
 * `--chart-1..5` only, so a tenant themed green gets a green shimmer.
 *
 * `.trax-icon` / `v2-trax-glow` is NOT used: it glows in `--accent`, which v2
 * sets to a near-white (light) and near-black (dark), so it is invisible in
 * both — the same reason featured-card-art-v2.tsx avoids it.
 *
 * Dark mode leads with `--chart-2`: dark `--primary` is a deep indigo that all
 * but disappears on the near-black ground.
 */

const MARK_SIZES = {
  sm: { box: "size-7", icon: "size-3.5", halo: "-inset-3" },
  md: { box: "size-10", icon: "size-5", halo: "-inset-5" },
  lg: { box: "size-14", icon: "size-7", halo: "-inset-7" },
} as const;

export function TraxMark({
  size = "sm",
  animated = false,
  className,
}: {
  size?: "sm" | "md" | "lg";
  animated?: boolean;
  className?: string;
}) {
  const s = MARK_SIZES[size];
  return (
    <span
      aria-hidden
      data-slot="trax-mark"
      className={cn("relative isolate inline-flex shrink-0 items-center justify-center rounded-full", s.box, className)}
    >
      {animated && (
        <span
          className={cn(
            "pointer-events-none absolute -z-10 rounded-full opacity-60 blur-xl",
            "bg-[radial-gradient(closest-side,hsl(var(--chart-2)/0.6),hsl(var(--primary)/0.25)_60%,transparent)]",
            "animate-[v2-glow_4s_ease-in-out_infinite] motion-reduce:animate-none",
            s.halo,
          )}
        />
      )}
      <span className="absolute inset-0 overflow-hidden rounded-full shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.55)]">
        {/* Oversized so the square corners never show while it turns. */}
        <span
          className={cn(
            "absolute -inset-1/4",
            "bg-[conic-gradient(from_180deg,hsl(var(--chart-2)),hsl(var(--primary)),hsl(var(--chart-4)),hsl(var(--chart-1)),hsl(var(--chart-2)))]",
            "dark:bg-[conic-gradient(from_180deg,hsl(var(--chart-2)),hsl(var(--chart-3)),hsl(var(--chart-1)),hsl(var(--chart-4)),hsl(var(--chart-2)))]",
            animated && "animate-[v2-spin-slow_12s_linear_infinite] motion-reduce:animate-none",
          )}
        />
      </span>
      <Sparkles
        className={cn("relative text-primary-foreground drop-shadow-[0_1px_2px_hsl(var(--chart-5)/0.55)]", s.icon)}
        strokeWidth={2}
      />
    </span>
  );
}

/**
 * "Good afternoon, Haseeb" — the dashboard hero's wording, reused.
 *
 * `now` starts null so the server render and the first client render agree
 * (the dashboard does the same), then an effect sets and ticks it. A minute is
 * plenty: the text only changes at five hour boundaries.
 */
export function useTraxGreeting(): { text: string; firstName: string } {
  const appUser = useAuthStore((state) => state.appUser);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  return {
    text: getGreeting(now ? now.getHours() : 8).text,
    firstName: firstNameOf(appUser?.name),
  };
}

/**
 * The empty-conversation greeting, Claude-style: the mark and one line, no
 * subtitle, no pitch. The composer sits directly beneath it (TraxThread).
 *
 * The wash behind it is sized to the greeting block rather than to a fixed
 * width, so it can never widen the panel's scroll container and summon a
 * horizontal scrollbar.
 */
export function TraxGreeting({
  density = "page",
  className,
}: {
  density?: "sheet" | "page";
  className?: string;
}) {
  const { text, firstName } = useTraxGreeting();
  const page = density === "page";

  return (
    <div className={cn("relative isolate flex w-full flex-col items-center text-center", page ? "gap-5" : "gap-3", className)}>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 -z-10",
          page ? "-inset-y-16" : "-inset-y-10",
          "bg-[radial-gradient(closest-side,hsl(var(--chart-2)/0.16),hsl(var(--primary)/0.06)_55%,transparent)]",
          "dark:bg-[radial-gradient(closest-side,hsl(var(--chart-2)/0.14),transparent)]",
        )}
      />
      <TraxMark size={page ? "lg" : "md"} animated />
      <h1
        className={cn(
          "text-balance font-medium leading-tight tracking-tight text-foreground",
          page ? "text-3xl sm:text-4xl" : "text-xl",
        )}
      >
        {text}
        {firstName ? `, ${firstName}` : ""}
      </h1>
    </div>
  );
}
