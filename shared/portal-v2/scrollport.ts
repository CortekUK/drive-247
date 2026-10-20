/**
 * Where the page actually scrolls.
 *
 * v1 chrome scrolls the WINDOW: the shell is `min-h-svh`, it grows with its
 * content, and the document scrolls under a static header.
 *
 * v2 chrome is a FIXED FRAME (Sep 23 2026, team lead: "make the top bar fixed
 * the same way the sidebar heading is, so scrolling starts below it"). The
 * shell is exactly one viewport tall and does not scroll at all; the top bar
 * and the banners are non-scrolling rows in it, and `<main>` — marked
 * `data-scrollport` by `(dashboard)/layout.tsx` — is the only scroll container.
 *
 * Anything that measured "how much room is left below me on screen" from
 * `window.scrollY` + `window.innerHeight` is wrong the moment the window stops
 * being the scroller, and wrong SILENTLY: `window.scrollY` is simply always 0,
 * so `rect.top + scrollY` stops being a stable, scroll-independent coordinate
 * and starts sliding with the page. The measurement then feeds back on itself —
 * exactly the failure the "DOCUMENT-space, not viewport-space" comments in
 * `calendar-view.tsx` and `list-table-v2.tsx` were written to prevent.
 *
 * WHY AN ATTRIBUTE AND NOT `getComputedStyle`
 *
 * Walking up looking for `overflow-y: auto` finds the WRONG box under v1: the
 * v1 `SidebarInset` carries `overflow-x-hidden`, and `overflow-x: hidden`
 * forces `overflow-y` to compute to `auto` (CSS Overflow 3) — so v1's inset
 * looks like a scroll container while actually growing with its content, and
 * every v1 measurement would quietly change. An explicit opt-in marker means
 * v1 keeps the window path byte for byte, and the frame says which box it is
 * rather than being guessed at.
 */

/** The element `el` scrolls inside, or `null` when the WINDOW scrolls it (v1). */
export function scrollPortOf(el: Element | null | undefined): HTMLElement | null {
  if (!el || typeof document === "undefined") return null;
  return el.closest<HTMLElement>("[data-scrollport]");
}

/**
 * The two numbers a "fill the room below me" measurement needs:
 *
 *   top     how far `el` sits from its scrollport's CONTENT origin, so the
 *           value does not move as the port scrolls and a measurement taken
 *           mid-scroll sizes exactly as one taken at the top would;
 *   height  the scrollport's visible height, padding included — which is what
 *           `window.innerHeight` was standing in for.
 *
 * `height - top - <space below>` is therefore the same expression it always
 * was, and under v1 (no scrollport) it returns exactly the old numbers.
 *
 * The two paths agree whenever the port is at the top: the port's padding-box
 * top plus its client height IS the viewport bottom in the fixed frame, so
 * `height - top` comes out identical. Only once the port has scrolled do they
 * differ, and then only the port path is right.
 */
export function scrollportFill(el: HTMLElement): { top: number; height: number } {
  const rect = el.getBoundingClientRect();
  const port = scrollPortOf(el);
  if (!port) return { top: rect.top + window.scrollY, height: window.innerHeight };
  const portRect = port.getBoundingClientRect();
  // `clientTop` is the port's top border: `getBoundingClientRect()` gives the
  // border box, the scrollport is the PADDING box.
  return {
    top: rect.top - (portRect.top + port.clientTop) + port.scrollTop,
    height: port.clientHeight,
  };
}
