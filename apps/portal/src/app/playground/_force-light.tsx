"use client";

import { useEffect } from "react";

/**
 * Pins the playground to light mode.
 *
 * The sandbox is a design surface Ghulam reviews in light; the portal itself
 * follows the operator's own theme. next-themes puts `dark` on <html>, and the
 * v2 tokens hang off `.dark .v2-theme`, so the only way to light this route
 * without touching the stored preference is to take the class off the element
 * while we are on it and put it back on the way out.
 *
 * Deliberately NOT `setTheme("light")`: that writes to localStorage and would
 * follow the operator back into the real portal.
 */
export function ForceLight() {
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");

    // next-themes re-applies `dark` on its own (storage events, system-theme
    // changes, its own re-syncs), so removing it once is not enough — watch the
    // attribute and take it off again for as long as this route is mounted.
    const observer = new MutationObserver(() => {
      if (root.classList.contains("dark")) root.classList.remove("dark");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  return null;
}
