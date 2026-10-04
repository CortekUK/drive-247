'use client';

/**
 * Custom domain (ILLUSTRATION_GUIDE.md §4a).
 *
 * The story: your booking site, in a browser, at YOUR address — the padlock
 * and the address bar are the hero, the page behind them is the rental site,
 * and the tick says it is live. No car: this is about the address.
 */
import { ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function customDomainArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(54 30)">
  <rect width="250" height="150" rx="14" fill="${p.card}" ${S}/>
  <path d="M0 32 H250" stroke="${p.lite}" stroke-width="1.5"/>
  ${[16, 28, 40].map((x) => `<circle cx="${x}" cy="16" r="3.5" fill="${p.lite}"/>`).join('')}
  <!-- the address bar: padlock + the operator's own domain -->
  <rect x="56" y="7" width="150" height="18" rx="9" fill="${p.soft}"/>
  <g transform="translate(68 16)">
   <rect x="-4" y="-1" width="8" height="6" rx="1.5" fill="${p.acc}"/>
   <path d="M-2.5 -1 V-3 a2.5 2.5 0 0 1 5 0 V-1" fill="none" stroke="${p.acc}" stroke-width="1.5"/>
  </g>
  ${txt(78, 20, 'yourrentals.com', 9, 700, p.ink)}
  <!-- the booking site behind it -->
  <rect x="16" y="46" width="108" height="62" rx="8" fill="${p.soft}"/>
  <path d="M30 96 l18 -18 l12 10 l14 -14 l22 22" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="136" y="50" width="96" height="7" rx="3.5" fill="${p.ink}"/>
  <rect x="136" y="64" width="70" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="136" y="75" width="82" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="136" y="92" width="62" height="16" rx="8" fill="${p.acc}"/>${txt(167, 103, 'Book', 8.5, 700, p.onAcc, 'middle')}
  <rect x="16" y="120" width="216" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="16" y="131" width="150" height="5" rx="2.5" fill="${p.lite}"/>
 </g>
 <!-- live -->
 <g transform="translate(300 40)">
  <circle r="17" fill="${p.acc}"/>
  ${tick(-7, 0, p.onAcc, 3)}
 </g>
 ${ground(180, 186, 150, dark)}`;
}

export const CustomDomainArt = makeEmptyArt(customDomainArt, '8 12 352 182');
