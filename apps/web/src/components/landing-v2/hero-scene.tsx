import { carSvg, MONO_PAINT } from "./car-art";

/*
 * The hero picture, per ILLUSTRATION_GUIDE.md §4c: the approved car on a
 * perspective grid floor (the grid is the calendar), two faint light trails
 * behind it, one soft glow underneath. No chips, no labels.
 *
 * Static markup from constants only, so dangerouslySetInnerHTML is safe. One
 * hero per page, so the gradient ids can be fixed.
 */

const ID = "lvhero";
const VP = { x: 330, y: 214 }; // vanishing point, just above the horizon
const HORIZON = 236;
const FLOOR = 400;

function grid(): string {
  let s = "";
  // Rows: spacing grows toward the viewer.
  for (let i = 1; i <= 9; i++) {
    const t = i / 9;
    const y = HORIZON + (FLOOR - HORIZON) * t * t;
    s += `<path d="M-40 ${y.toFixed(1)} L680 ${y.toFixed(1)}"/>`;
  }
  // Columns: run from the floor's front edge to the vanishing point.
  for (let x = -520; x <= 1180; x += 85) {
    s += `<path d="M${x} ${FLOOR} L${VP.x + (x - VP.x) * 0.12} ${HORIZON}"/>`;
  }
  return s;
}

const SCENE = `
<defs>
  <linearGradient id="${ID}fade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".3" stop-color="#fff" stop-opacity=".9"/>
    <stop offset=".7" stop-color="#fff" stop-opacity="1"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="${ID}side" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/>
    <stop offset=".18" stop-color="#fff" stop-opacity="1"/>
    <stop offset=".82" stop-color="#fff" stop-opacity="1"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <mask id="${ID}m1"><rect x="-40" y="${HORIZON}" width="720" height="${FLOOR - HORIZON}" fill="url(#${ID}fade)"/></mask>
  <mask id="${ID}m2"><rect x="-40" y="${HORIZON}" width="720" height="${FLOOR - HORIZON}" fill="url(#${ID}side)"/></mask>
  <radialGradient id="${ID}glow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="var(--lv-car-glow)" stop-opacity=".34"/>
    <stop offset="1" stop-color="var(--lv-car-glow)" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="${ID}trail" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="var(--lv-accent)" stop-opacity=".5"/>
    <stop offset="1" stop-color="var(--lv-accent)" stop-opacity="0"/>
  </linearGradient>
</defs>
<g mask="url(#${ID}m2)"><g mask="url(#${ID}m1)" fill="none" stroke="var(--lv-grid)" stroke-width="1">${grid()}</g></g>
<ellipse cx="350" cy="352" rx="250" ry="34" fill="url(#${ID}glow)"/>
<path d="M560 268 L700 262" stroke="url(#${ID}trail)" stroke-width="2.4" stroke-linecap="round"/>
<path d="M572 302 L700 300" stroke="url(#${ID}trail)" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>
<g transform="translate(98 158) scale(1.5)">${carSvg(MONO_PAINT, ID + "car")}</g>
`;

export function HeroScene({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 150 640 260"
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: SCENE }}
    />
  );
}
