"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

/**
 * Aurora auth shell — the shared chrome for every (auth) screen.
 * Spec: design_handoff_bento "Auth: Aurora Solo" (Aurora material + Solo composition).
 * Presentation only — no data/routing/validation here.
 */

/** Full-bleed Aurora background: brand-tinted radial mesh + slow drifting blobs.
 *  The top-left header zone (brand lockup) is kept clear — all light pools to the
 *  right and bottom so the logo never sits on a bright wash. */
export function AuthBackground() {
  // Drifting blobs, deliberately positioned away from the top-left logo area.
  const blobs = [
    { size: 440, pos: { bottom: -130, left: "6%" }, bg: "color-mix(in srgb, hsl(var(--primary)) 26%, transparent)", dur: "12s", delay: "0s" },
    { size: 400, pos: { top: "26%", right: -110 }, bg: "color-mix(in srgb, var(--bento-info) 22%, transparent)", dur: "14s", delay: "0.8s" },
    { size: 320, pos: { bottom: -80, right: "24%" }, bg: "color-mix(in srgb, hsl(var(--primary)) 18%, transparent)", dur: "16s", delay: "1.4s" },
  ];
  return (
    <>
      {/* base (near-black indigo in dark, soft lavender in light) */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-background" />
      {/* aurora mesh — light pools right + bottom, top-left stays clean for the logo */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(50% 46% at 82% 16%, color-mix(in srgb, hsl(var(--primary)) 40%, transparent), transparent 70%)," +
            "radial-gradient(55% 50% at 80% 92%, color-mix(in srgb, var(--bento-info) 36%, transparent), transparent 72%)," +
            "radial-gradient(58% 54% at 18% 96%, color-mix(in srgb, hsl(var(--primary)) 30%, transparent), transparent 72%)",
        }}
      />
      {/* drifting blurred blobs for the living-aurora feel (reduced-motion safe) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
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
    </>
  );
}

/**
 * Sun/moon pill toggle — fully animated:
 *  • knob slides on a spring (transform)
 *  • track + knob colours TWEEN between themes (literal colours, so they don't
 *    hit the Chromium var()-freeze gotcha — DESIGN_SYSTEM §6)
 *  • the sun/moon icon cross-fades + rotates
 *  • a one-shot full-screen fade animates the whole page's colour change
 * All reduced-motion safe.
 */
export function ThemePill() {
  const { resolvedTheme, setTheme } = useTheme();
  const reduce = useReducedMotion();
  const dark = resolvedTheme === "dark";
  const [fadeKey, setFadeKey] = React.useState(0);

  const toggle = () => {
    setTheme(dark ? "light" : "dark");
    setFadeKey((k) => k + 1); // re-trigger the page colour-fade
  };

  // Literal colours (NOT var()) so motion can tween them safely.
  const track = dark ? "rgba(36,31,64,0.55)" : "rgba(255,255,255,0.55)";
  const trackBorder = dark ? "rgba(139,109,255,0.55)" : "rgba(106,79,240,0.45)";
  const knobBg = dark ? "#100e22" : "#ffffff";
  const knobFg = dark ? "#b9a6ff" : "#6a4ff0";

  return (
    <>
      <motion.button
        type="button"
        onClick={toggle}
        aria-label="Toggle theme"
        aria-pressed={dark}
        initial={false}
        animate={{ backgroundColor: track, borderColor: trackBorder }}
        transition={reduce ? { duration: 0 } : { duration: 0.45, ease: [0.65, 0, 0.35, 1] }}
        whileTap={{ scale: 0.94 }}
        className="relative h-9 w-16 rounded-full border backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        style={{ WebkitBackdropFilter: "blur(8px)" }}
      >
        <motion.span
          initial={false}
          animate={{ x: dark ? 28 : 0, backgroundColor: knobBg, color: knobFg }}
          transition={reduce ? { duration: 0.15 } : springs.pop}
          className="absolute left-1 top-1 grid h-7 w-7 place-items-center rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.28)]"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={dark ? "moon" : "sun"}
              initial={reduce ? { opacity: 0 } : { opacity: 0, rotate: -90, scale: 0.4 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, rotate: 90, scale: 0.4 }}
              transition={{ duration: 0.18 }}
              className="grid place-items-center"
            >
              {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
        </motion.span>
      </motion.button>

      {/* One-shot full-screen fade of the NEW background — softens the colour swap
          app-wide without CSS-transitioning a var()-driven colour. */}
      <AnimatePresence>
        {fadeKey > 0 && !reduce && (
          <motion.div
            key={fadeKey}
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[200] bg-background"
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** Brand lockup — tenant logo, or an initials square + name + tagline. */
export function BrandLockup({
  appName,
  logo,
  tagline = "Fleet Portal",
}: {
  appName: string;
  logo?: string | null;
  tagline?: string;
}) {
  const initials =
    appName
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "D2";
  return (
    <div className="flex items-center gap-3">
      {logo ? (
        <img src={logo} alt={appName} className="h-11 w-auto max-w-[170px] object-contain" />
      ) : (
        <>
          <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-primary text-base font-extrabold text-white shadow-[0_6px_16px_hsl(var(--primary)/0.35)]">
            {initials}
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-extrabold tracking-tight text-foreground">{appName}</div>
            <div className="text-xs font-semibold text-muted-foreground">{tagline}</div>
          </div>
        </>
      )}
    </div>
  );
}

/** Resolve the per-tenant brand name + logo for auth chrome. */
export function useAuthBrand() {
  const { branding } = useTenantBranding();
  const { resolvedTheme } = useTheme();
  const authLogoUrl = branding?.auth_logo_url;
  const logoUrl =
    (resolvedTheme === "dark" && branding?.dark_logo_url
      ? branding.dark_logo_url
      : branding?.logo_url) || "/logo.png";
  const appName = branding?.app_name || "Drive247";
  const logo = authLogoUrl || (logoUrl && logoUrl !== "/logo.png" ? logoUrl : null);
  return { appName, logo };
}

/**
 * Full Aurora shell: background + brand/theme header + centered content column.
 * `align="top"` + a wider `width` suits long documents (terms); default is the
 * centered solo sign-in column.
 */
export function AuthShell({
  children,
  width = "max-w-[564px]",
  align = "center",
}: {
  children: React.ReactNode;
  width?: string;
  align?: "center" | "top";
}) {
  const { appName, logo } = useAuthBrand();
  return (
    <div className="relative min-h-screen w-full overflow-hidden text-foreground">
      <AuthBackground />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <BrandLockup appName={appName} logo={logo} />
        <ThemePill />
      </header>

      <main
        className={cn(
          "relative z-10 flex min-h-[calc(100vh-84px)] justify-center px-4 pb-20",
          align === "center"
            ? "items-start pt-2 sm:items-center sm:pt-0"
            : "items-start pt-2",
        )}
      >
        <div className={cn("w-full", width)}>{children}</div>
      </main>
    </div>
  );
}
