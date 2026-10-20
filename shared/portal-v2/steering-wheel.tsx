import { createLucideIcon } from "lucide-react";

/**
 * SteeringWheel — the vehicle icon for everywhere that is not the sidebar.
 *
 * A tyre was tried first and read as a disc, a target or a record depending on
 * the size; a steering wheel is unmistakable at every size this is used at,
 * because the three spokes meeting a hub inside a ring is a shape nothing else
 * in this portal has.
 *
 * ── DRAWN TO MATCH ITS NEIGHBOURS ──────────────────────────────────────────
 *
 * Rim, hub and three spokes, all at the inherited stroke width — no lighter
 * detail lines, because a mixed weight is exactly what made the previous
 * attempts look foreign next to Customers and Rentals. Nothing is added below
 * 12px that cannot be seen at 12px: the spokes run to the rim rather than
 * stopping short, so they stay separate when the icon is small.
 *
 * The detailed car drawing (./car-mark.tsx) stays in the sidebar, where it is
 * the one place the artwork was asked for. Everywhere else — rental stages,
 * timeline rows, filters, notification categories — takes this.
 */
export const SteeringWheel = createLucideIcon("SteeringWheel", [
  // The rim.
  ["circle", { cx: "12", cy: "12", r: "10", key: "rim" }],
  // The hub.
  ["circle", { cx: "12", cy: "12", r: "2.5", key: "hub" }],
  // Three spokes: down, left, right. They stop at the hub, not inside it.
  ["path", { d: "M12 14.5V22M9.5 12H2M14.5 12H22", key: "spokes" }],
]);

export default SteeringWheel;
