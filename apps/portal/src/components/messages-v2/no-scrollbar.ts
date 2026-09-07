/**
 * Hide the scrollbar, keep the scrolling.
 *
 * ── why a constant and not the `.no-scrollbar` class ────────────────────────
 *
 * The codebase already has a `no-scrollbar` utility, but it lives in
 * `styles/v2-theme.css` under a `.v2-theme` selector, and that class is only on
 * <body> for tenants gated into the v2 theme. The Messages workspace ships to
 * every tenant, so the scoped utility would have hidden the bar for some of
 * them and left it for the rest — which is exactly the kind of difference that
 * shows up as "it looks unfinished on my account". `notification-sheet.tsx`
 * carries the same constant for the same reason.
 *
 * These are plain arbitrary properties: no track, no thumb, and wheel,
 * trackpad, touch and keyboard scrolling all completely untouched. It is a
 * paint-level change — `overflow` is never altered, so nothing becomes
 * unreachable and no sticky or fixed child changes behaviour.
 */
export const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
