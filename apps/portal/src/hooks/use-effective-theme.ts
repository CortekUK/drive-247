"use client";

import { useTheme } from "next-themes";

/**
 * The theme that is actually on the DOM.
 *
 * `useTheme().resolvedTheme` is not that whenever a route sets `forcedTheme`.
 * next-themes computes it as
 *
 *     resolvedTheme: theme === "system" ? systemTheme : theme
 *
 * and never consults the forced value, while writing the forced value to the
 * DOM regardless. So on the light-only auth screens a user whose stored
 * preference is dark gets a light page and a `resolvedTheme` of `"dark"` — and
 * every consumer branching on it then picks the dark logo, the dark brand
 * variables and white type, all on a light background. Nothing throws; it just
 * comes out unreadable.
 *
 * Read the effective theme through this instead of `resolvedTheme` anywhere
 * the answer decides a colour.
 */
export function useEffectiveTheme(): { theme: string | undefined; isDark: boolean } {
  const { resolvedTheme, forcedTheme } = useTheme();
  const theme = forcedTheme ?? resolvedTheme;
  return { theme, isDark: theme === "dark" };
}

export default useEffectiveTheme;
