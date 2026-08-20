/**
 * Theme plumbing for booking-v2.
 *
 * booking-v2 keeps its own scoped theme rather than joining the booking app's
 * `next-themes` setup — that one flips the whole product, and this page is a
 * self-contained design under `.d7`.
 *
 * The attribute goes on <html> rather than the `.d7` wrapper so it can be set
 * before the wrapper itself exists; every dark declaration in v2.css is still
 * written as `[data-d7-theme="dark"] .d7 { … }`, so nothing escapes.
 *
 * There is deliberately no inline pre-paint <script>: the booking app's root
 * layout is a client tree, so this route ships no server-rendered markup for a
 * script to run ahead of. `D7ThemeInit` applying this in a layout effect is
 * the earliest point that actually exists here, and it still lands before the
 * first paint of the page.
 */

export const D7_THEME_KEY = "d7-theme";
export const D7_THEME_ATTR = "data-d7-theme";

export type D7Theme = "light" | "dark";

/** Light is the default — only an explicit stored "dark" turns it on. */
export function readStoredD7Theme(): D7Theme {
  try {
    return localStorage.getItem(D7_THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // private mode / storage disabled
  }
}

export function applyD7Theme(theme: D7Theme, persist = true) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute(D7_THEME_ATTR, "dark");
  else root.removeAttribute(D7_THEME_ATTR);
  if (persist) {
    try { localStorage.setItem(D7_THEME_KEY, theme); } catch { /* ignore */ }
  }
}
