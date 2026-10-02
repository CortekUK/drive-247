/**
 * Wheel — the Vehicles icon.
 *
 * A car silhouette read as a toy at sidebar size, and lucide has no alloy
 * wheel, so this is drawn to match the reference: tyre, rim, hub and six
 * spokes. `disc-3` stood in for it briefly and is not a wheel — it is a disc
 * with a highlight.
 *
 * ── WHY SIX SPOKES ──────────────────────────────────────────────────────────
 *
 * The reference alloy has ten. Ten does not survive the sizes this is actually
 * used at: the icon renders between 12 and 44px, and most of its appearances
 * are 14 to 19. Rendered at 19px, eight spokes already read as a snowflake and
 * ten fill the rim solid. Six keeps the gaps open at 12px while still reading
 * as a wheel rather than a target. The spokes are drawn at stroke-width 1.4
 * against the 2 of the circles, so the rim stays the dominant shape instead of
 * the icon turning into a grey smudge when it is small.
 *
 * ── WHY createLucideIcon ────────────────────────────────────────────────────
 *
 * It is passed as a bare component to things that take a lucide icon — sidebar
 * entries, section definitions, timeline rows — so it has to BE one, not merely
 * look like one: same props (`size`, `absoluteStrokeWidth`, `className`), same
 * ref, same defaults. Building it by hand would be a second kind of icon that
 * drifts the first time someone passes it a prop every other icon honours.
 */

import { createLucideIcon } from "lucide-react";

export const Wheel = createLucideIcon("Wheel", [
  // The tyre, on lucide's 24x24 grid.
  ["circle", { cx: "12", cy: "12", r: "10", key: "tyre" }],
  // The rim. Far enough inside the tyre that the two do not merge at 12px.
  ["circle", { cx: "12", cy: "12", r: "6.2", key: "rim" }],
  // The hub.
  ["circle", { cx: "12", cy: "12", r: "1.5", key: "hub" }],
  // Six spokes, hub to rim, lighter than the circles on purpose.
  [
    "path",
    {
      d: "M12 5.8v4.7M12 13.5v4.7M18.2 8.4l-4.1 2.4M9.9 13.2l-4.1 2.4M18.2 15.6l-4.1-2.4M9.9 10.8L5.8 8.4",
      strokeWidth: "1.4",
      key: "spokes",
    },
  ],
]);

export default Wheel;
