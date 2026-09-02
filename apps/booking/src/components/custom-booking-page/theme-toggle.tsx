"use client";

import { useEffect, useState } from "react";

export type CbpMode = "light" | "dark";

const KEY = "cbp-theme";

/**
 * Light/dark for this site.
 *
 * The mode lives on the `.cbp` root as `data-theme`, which every token in
 * `styles.css` keys off — so nothing is themed in JavaScript and no component
 * needs to know the mode. It is a per-visitor preference, stored in
 * localStorage, independent of the tenant's own `customer_theme_mode` (which
 * governs the legacy site).
 *
 * Resolution order: a stored choice, else the visitor's OS setting, else
 * light. Reading localStorage during render would differ between the server
 * and the first client pass and trip hydration, so the mode is resolved in an
 * effect and the root simply carries no attribute until then — which renders
 * as light, the approved default.
 */
export function useCbpTheme() {
  const [mode, setMode] = useState<CbpMode | null>(null);

  useEffect(() => {
    let initial: CbpMode = "light";
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "dark" || saved === "light") initial = saved;
      else if (window.matchMedia("(prefers-color-scheme: dark)").matches) initial = "dark";
    } catch {
      // Private mode or blocked storage — the default stands.
    }
    setMode(initial);
  }, []);

  const toggle = () => {
    setMode(prev => {
      const next: CbpMode = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch { /* not fatal */ }
      return next;
    });
  };

  return { mode, toggle };
}

/**
 * The header control. Renders a fixed-size button whichever way it is
 * pointing, so the navigation never reflows when the mode changes.
 */
/**
 * The mode currently stamped on the site root, read when a portal opens.
 *
 * Radix portals its overlays to <body>, outside `.cbp`, so they inherit
 * neither the class nor the `data-theme` the dark tokens hang off. Portalled
 * content carries both, and this reads the second across the boundary.
 */
export function useRootTheme(open: boolean) {
  const [theme, setTheme] = useState<string | undefined>();
  useEffect(() => {
    if (!open) return;
    setTheme(document.querySelector(".cbp-root")?.getAttribute("data-theme") ?? undefined);
  }, [open]);
  return theme;
}

export function ThemeToggle({
  mode, onToggle, className = "",
}: {
  mode: CbpMode | null;
  onToggle: () => void;
  className?: string;
}) {
  const dark = mode === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={`cbp-icon-btn ${className}`}
    >
      {/* Both marks are drawn here rather than swapped from the icon set, so
          the crossfade has no layout step between them. */}
      <span className="relative block h-[18px] w-[18px]">
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={`absolute inset-0 h-full w-full transition-all duration-300 ${
            dark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
        >
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" />
        </svg>
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          className={`absolute inset-0 h-full w-full transition-all duration-300 ${
            dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"}`}
        >
          <path d="M20.4 13.6A8.4 8.4 0 1 1 10.4 3.6a6.6 6.6 0 0 0 10 10Z" />
        </svg>
      </span>
    </button>
  );
}
