"use client";

import { cn } from "@/lib/utils";

/*
 * One small picture per screen of the Book a demo dialog, in the style of the operator
 * portal's "add a customer" pictures (apps/portal/src/components/illustrations-v2): ink
 * lines, white cards, the accent only where it matters, one soft shadow underneath. All on
 * the same 264 x 132 canvas, so the picture never changes size between screens.
 *
 * The kit below is the portal's scene kit, carried over (the apps share no packages). Each
 * picture is static markup built from these helpers only: nothing a visitor types is ever
 * put into it.
 */

type Pal = { ink: string; card: string; lite: string; acc: string; soft: string; mut: string; onAcc: string };

function pal(dark: boolean): Pal {
  return {
    ink: dark ? "#d4d4d4" : "#111114",
    card: dark ? "var(--card)" : "#ffffff",
    lite: dark ? "#3a3a3a" : "#e4e4e7",
    acc: dark ? "hsl(var(--v2-link))" : "var(--primary)",
    soft: `color-mix(in srgb, var(--primary) ${dark ? 22 : 10}%, transparent)`,
    mut: dark ? "#7a7a7a" : "#a1a1aa",
    onAcc: dark ? "var(--background)" : "#ffffff",
  };
}

const stroke = (p: Pal, w = 2.2) => `stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round"`;
const tick = (x: number, y: number, color: string, w = 2.4) =>
  `<path d="M${x} ${y} l4 4 l7 -8" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const dash = (p: Pal, d: string) =>
  `<path d="${d}" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`;
const ground = (cx: number, cy: number, rx: number, dark: boolean) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="6" fill="#000" opacity="${dark ? 0.35 : 0.05}"/>`;
const sparkle = (x: number, y: number, r: number, fill: string) =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

/** A faceless person in a circle: head, hair, shoulders in the accent. */
function avatar(x: number, y: number, r: number, p: Pal, skin = "#d9a88a", hair = "#1f2040"): string {
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${p.soft}"/><circle cy="${-r * 0.18}" r="${r * 0.38}" fill="${skin}"/><path d="M${-r * 0.65} ${r * 0.72} Q0 ${r * 0.05} ${r * 0.65} ${r * 0.72}" fill="${p.acc}" opacity=".9"/><path d="M${-r * 0.38} ${-r * 0.3} Q${-r * 0.36} ${-r * 0.66} 0 ${-r * 0.66} Q${r * 0.36} ${-r * 0.66} ${r * 0.38} ${-r * 0.3} Q${r * 0.18} ${-r * 0.48} 0 ${-r * 0.48} Q${-r * 0.18} ${-r * 0.48} ${-r * 0.38} ${-r * 0.3}Z" fill="${hair}"/></g>`;
}

/* Who is booking: a contact card being filled in, the cursor in its last field. */
function whoArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(54 12)">
  <rect width="156" height="104" rx="14" fill="${p.card}" ${S}/>
  ${avatar(30, 32, 18, p)}
  <rect x="56" y="23" width="72" height="8" rx="4" fill="${p.ink}"/>
  <rect x="56" y="38" width="48" height="6" rx="3" fill="${p.lite}"/>
  <path d="M14 60 H142" stroke="${p.lite}" stroke-width="1.5"/>
  <rect x="14" y="70" width="128" height="20" rx="10" fill="${p.card}" stroke="${p.acc}" stroke-width="2"/>
  <rect x="24" y="77.5" width="46" height="5" rx="2.5" fill="${p.ink}" opacity=".8"/>
  <rect x="74" y="74" width="2" height="12" rx="1" fill="${p.acc}"/>
 </g>
 ${ground(132, 124, 110, dark)}`;
}

/* The fleet, from above: three cars in their bays and one bay still free. */
function fleetArt(dark: boolean): string {
  const p = pal(dark);
  const car = (x: number, fill: string) => `
  <g transform="translate(${x} 22)">
   <rect width="34" height="76" rx="13" fill="${fill}" ${stroke(p)}/>
   <rect x="6" y="18" width="22" height="13" rx="5" fill="${p.ink}"/>
   <rect x="6" y="52" width="22" height="9" rx="4.5" fill="${p.lite}"/>
   <path d="M6 37 H28" stroke="${p.lite}" stroke-width="1.5"/>
  </g>`;
  return `
 <path d="M38 14 V106 M90 14 V106 M142 14 V106 M194 14 V106 M246 14 V106" stroke="${p.lite}" stroke-width="2" stroke-linecap="round"/>
 ${car(47, p.card)}
 ${car(99, p.soft)}
 ${car(151, p.card)}
 <rect x="203" y="22" width="34" height="76" rx="13" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="4 5"/>
 <path d="M220 52 V68 M212 60 H228" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
 ${ground(132, 124, 116, dark)}`;
}

/* How bookings arrive today (a message on a phone) and where they are headed (a site with a Book button). */
function bookingsArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(26 12)">
  <rect width="58" height="104" rx="13" fill="${p.card}" ${S}/>
  <rect x="20" y="7" width="18" height="4" rx="2" fill="${p.ink}"/>
  <path d="M10 28 Q10 22 16 22 L42 22 Q48 22 48 28 L48 38 Q48 44 42 44 L20 44 L13 50 L14 44 Q10 43 10 38 Z" fill="${p.lite}"/>
  <rect x="16" y="29" width="24" height="4" rx="2" fill="${p.mut}"/><rect x="16" y="36" width="16" height="3.5" rx="1.75" fill="${p.mut}" opacity=".7"/>
  <path d="M48 62 Q48 56 42 56 L16 56 Q10 56 10 62 L10 70 Q10 76 16 76 L38 76 L45 82 L44 76 Q48 75 48 70 Z" fill="${p.lite}"/>
  <rect x="16" y="63" width="22" height="4" rx="2" fill="${p.mut}"/>
 </g>
 ${dash(p, "M94 64 H118")}
 <path d="M114 58 L121 64 L114 70" fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 <g transform="translate(130 20)">
  <rect width="108" height="88" rx="12" fill="${p.card}" ${S}/>
  <path d="M0 12 Q0 0 12 0 L96 0 Q108 0 108 12 L108 18 L0 18 Z" fill="${p.ink}"/>
  <circle cx="11" cy="9" r="2.2" fill="${p.card}"/><circle cx="19" cy="9" r="2.2" fill="${p.card}" opacity=".6"/>
  <rect x="12" y="28" width="52" height="7" rx="3.5" fill="${p.ink}"/>
  <rect x="12" y="41" width="36" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="12" y="56" width="84" height="22" rx="11" fill="${p.acc}"/>
  <rect x="38" y="64.5" width="32" height="5" rx="2.5" fill="${p.onAcc}"/>
 </g>
 ${ground(132, 124, 116, dark)}`;
}

/* The launch: a calendar with the day marked, done. */
function launchArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const cells = [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((col) => ({ row, col })));
  return `
 <g transform="translate(66 12)">
  <rect width="132" height="104" rx="14" fill="${p.card}" ${S}/>
  <path d="M0 14 Q0 0 14 0 L118 0 Q132 0 132 14 L132 24 L0 24 Z" fill="${p.ink}"/>
  <rect x="34" y="-7" width="6" height="16" rx="3" fill="${p.card}" ${stroke(p, 2)}/>
  <rect x="92" y="-7" width="6" height="16" rx="3" fill="${p.card}" ${stroke(p, 2)}/>
  ${cells
    .map(({ row, col }) =>
      row === 1 && col === 3
        ? `<rect x="${12 + col * 22.4}" y="${34 + row * 22}" width="18" height="16" rx="5" fill="${p.acc}"/>`
        : `<rect x="${12 + col * 22.4}" y="${34 + row * 22}" width="18" height="16" rx="5" fill="${p.lite}" opacity="${row === 0 && col < 2 ? 0.5 : 1}"/>`,
    )
    .join("")}
  ${tick(82.5, 64.5, p.onAcc, 2.2)}
 </g>
 ${sparkle(42, 34, 7, p.acc)}
 ${sparkle(222, 26, 6, p.acc)}
 ${sparkle(230, 92, 4, p.mut)}
 ${ground(132, 124, 100, dark)}`;
}

/** Both themes drawn, the `dark:` class picks one, so there is no flash. */
function make(art: (dark: boolean) => string) {
  const Scene = ({ dark }: { dark: boolean }) => (
    <svg
      viewBox="0 0 264 132"
      aria-hidden="true"
      className={cn("h-auto w-full", dark ? "hidden dark:block" : "dark:hidden")}
      dangerouslySetInnerHTML={{ __html: art(dark) }}
    />
  );
  return function Art({ className }: { className?: string }) {
    return (
      <div className={cn("mx-auto w-full", className)}>
        <Scene dark={false} />
        <Scene dark />
      </div>
    );
  };
}

export const DemoWhoArt = make(whoArt);
export const DemoFleetArt = make(fleetArt);
export const DemoBookingsArt = make(bookingsArt);
export const DemoLaunchArt = make(launchArt);
