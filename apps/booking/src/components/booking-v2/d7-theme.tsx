"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Icon } from "./d7-icons";
import {
  applyD7Theme, D7_THEME_ATTR, readStoredD7Theme, type D7Theme,
} from "./d7-theme-script";

/* useLayoutEffect warns when it runs during SSR; this route renders on the
   client, but the guard keeps the component safe to reuse anywhere. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Restores the stored theme before the browser paints. Mounted once, at the
 * top of the page, above everything that reads a colour token.
 */
export function D7ThemeInit() {
  useIsomorphicLayoutEffect(() => {
    applyD7Theme(readStoredD7Theme(), false);
  }, []);
  return null;
}

/** Scoped light/dark state for the booking-v2 page. */
export function useD7Theme() {
  /* Starts light to match the first render, then syncs to whatever
     D7ThemeInit already put on <html>. */
  const [theme, setTheme] = useState<D7Theme>("light");

  useIsomorphicLayoutEffect(() => {
    setTheme(document.documentElement.getAttribute(D7_THEME_ATTR) === "dark" ? "dark" : "light");
  }, []);

  const apply = useCallback((next: D7Theme) => {
    setTheme(next);
    applyD7Theme(next);
  }, []);

  const toggle = useCallback(() => apply(theme === "dark" ? "light" : "dark"), [theme, apply]);

  return { theme, setTheme: apply, toggle };
}

/** Sun / moon switch. Sits with the other square controls in the nav. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useD7Theme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      className={`group relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[13px]
                  border border-[var(--line)] bg-[var(--white)] text-[var(--ink)]
                  transition hover:-translate-y-0.5 hover:border-[var(--v)]/45 hover:text-[var(--v)] ${className}`}>
      {/* glow only on hover, so the control stays quiet at rest */}
      <span aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500
                   [background:radial-gradient(70%_70%_at_50%_50%,rgba(139,124,255,.28),transparent)]
                   group-hover:opacity-100" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} className="relative"
          initial={{ opacity: 0, rotate: -70, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 70, scale: 0.6 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
          <Icon name={dark ? "sun" : "moon"} className="h-[18px] w-[18px]" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
