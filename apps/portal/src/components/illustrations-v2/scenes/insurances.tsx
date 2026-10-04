'use client';

/**
 * Insurance empty state (ILLUSTRATION_GUIDE.md §4a).
 *
 * The story: at checkout on your booking site the customer ticks "Cover";
 * the shield locks on to the booking, and the policy comes out the other side,
 * filed against it. No car: this page is about cover.
 */
import { ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

const SHIELD = 'M0 -38 L30 -27 V0 Q30 26 0 40 Q-30 26 -30 0 V-27 Z';

function insurancesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const box = (x: number, y: number, on: boolean) =>
    on
      ? `<rect x="${x}" y="${y}" width="12" height="12" rx="3.5" fill="${p.acc}"/>${tick(x + 2.2, y + 6.4, p.onAcc, 1.8).replace('l4 4 l7 -8', 'l2.6 2.6 l5 -5.6')}`
      : `<rect x="${x}" y="${y}" width="12" height="12" rx="3.5" fill="${p.card}" stroke="${p.mut}" stroke-width="1.5"/>`;
  return `
 <!-- checkout on the booking site -->
 <g transform="translate(22 28)">
  <rect width="116" height="146" rx="14" fill="${p.card}" ${S}/>
  <rect x="12" y="16" width="56" height="7" rx="3.5" fill="${p.ink}"/>
  <rect x="12" y="29" width="38" height="5" rx="2.5" fill="${p.lite}"/>
  <path d="M12 44 H104" stroke="${p.lite}" stroke-width="1.5"/>
  ${box(12, 53, false)}<rect x="30" y="56.5" width="40" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="6" y="72" width="104" height="24" rx="8" fill="${p.soft}"/>
  ${box(12, 78, true)}${txt(31, 88, 'Cover', 10, 700, p.ink)}${txt(102, 88, '$18', 9.5, 700, p.acc, 'end')}
  ${box(12, 103, false)}<rect x="30" y="106.5" width="32" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="12" y="122" width="92" height="16" rx="8" fill="${p.acc}"/>${txt(58, 133, 'Book', 9, 700, p.onAcc, 'middle')}
 </g>
 <path d="M134 112 C 146 112, 150 100, 160 100" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <!-- the cover, locked on -->
 <g transform="translate(196 98)">
  <path d="${SHIELD}" fill="${p.card}" ${S}/>
  <path d="${SHIELD}" transform="scale(.7)" fill="${p.soft}"/>
  <path d="M-11 1 L-3 9 L12 -8" fill="none" stroke="${p.acc}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 <path d="M232 98 H250" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M245 92 L252 98 L245 104" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- the policy, filed against the booking -->
 <g transform="translate(260 46) rotate(4)">
  <rect width="86" height="112" rx="10" fill="${p.card}" ${S}/>
  <path d="M0 -12 L9 -9 V0 Q9 8 0 12 Q-9 8 -9 0 V-9 Z" transform="translate(20 22)" fill="${p.acc}"/>
  <rect x="36" y="16" width="36" height="6" rx="3" fill="${p.ink}"/>
  <rect x="36" y="27" width="24" height="4" rx="2" fill="${p.lite}"/>
  ${[48, 60, 72].map((y, i) => `<rect x="12" y="${y}" width="${[62, 54, 60][i]}" height="5" rx="2.5" fill="${p.lite}"/>`).join('')}
  <path d="M12 90 H74" stroke="${p.lite}" stroke-width="1.5"/>
  <rect x="12" y="96" width="30" height="5" rx="2.5" fill="${p.mut}"/>
 </g>
 ${ground(184, 182, 150, dark)}`;
}

export const InsurancesEmptyArt = makeEmptyArt(insurancesArt, '8 12 352 178');
