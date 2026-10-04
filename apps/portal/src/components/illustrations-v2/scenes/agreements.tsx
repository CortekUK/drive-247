'use client';

/**
 * Agreements empty state (ILLUSTRATION_GUIDE.md §4a).
 *
 * The story: a rental (its booked dates, the customer on the bar) sends its
 * agreement out; the document comes back signed — signature, pen, and the
 * indigo tick — and the customer it went to sits at the end of the line.
 * No car: this page is about paperwork.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function agreementsArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const cells = [0, 1].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${10 + c * 18}" y="${30 + r * 20}" width="14" height="14" rx="4" fill="${p.lite}"/>`).join('')).join('');
  const lines = [[50, 92], [62, 84], [74, 92], [86, 58]].map(([y, w]) => `<rect x="14" y="${y}" width="${w}" height="5" rx="2.5" fill="${p.lite}"/>`).join('');
  return `
 <!-- the rental: booked dates, the customer on the bar -->
 <g transform="translate(20 58)">
  <rect width="88" height="78" rx="12" fill="${p.card}" ${S}/>
  <path d="M0 12 Q0 0 12 0 L76 0 Q88 0 88 12 L88 20 L0 20 Z" fill="${p.ink}"/>
  ${txt(10, 14, 'May', 9, 700, dark ? 'hsl(var(--background))' : '#ffffff')}
  ${cells}
  <rect x="28" y="50" width="50" height="14" rx="5" fill="${p.acc}"/>
  <circle cx="36" cy="57" r="4" fill="${p.onAcc}"/>
 </g>
 <path d="M114 97 H138" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M133 91 L140 97 L133 103" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- the agreement, signed -->
 <g transform="translate(150 24)">
  <rect width="120" height="148" rx="12" fill="${p.card}" ${S}/>
  <rect x="14" y="18" width="60" height="8" rx="4" fill="${p.ink}"/>
  <rect x="14" y="32" width="40" height="5" rx="2.5" fill="${p.lite}"/>
  ${lines}
  <path d="M16 122 C22 106 27 128 34 114 S44 106 48 118 S60 110 72 116" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14 130 H84" stroke="${p.mut}" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="92" y="126" width="16" height="4" rx="2" fill="${p.lite}"/>
 </g>
 <!-- the pen, just lifted from the signature -->
 <g transform="translate(226 138) rotate(38)">
  <path d="M0 0 L-4.5 -11 L4.5 -11 Z" fill="${p.ink}"/>
  <rect x="-6" y="-54" width="12" height="44" rx="4" fill="${p.card}" ${S}/>
  <rect x="-6" y="-54" width="12" height="10" rx="4" fill="${p.acc}"/>
 </g>
 <circle cx="266" cy="28" r="12" fill="${p.acc}"/>${tick(260.5, 28.5, p.onAcc, 2.4)}
 <!-- the customer it went to -->
 <path d="M278 98 H294" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 ${avatar(322, 98, 22, p)}
 ${ground(184, 180, 150, dark)}`;
}

export const AgreementsEmptyArt = makeEmptyArt(agreementsArt, '8 10 352 178');
