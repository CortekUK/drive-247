'use client';

/**
 * Pending bookings empty-state picture (ILLUSTRATION_GUIDE.md §4a).
 *
 * The story: a customer presses Book on your site, and the request lands here
 * with its payment held, waiting for you to decline or approve. No car.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function pendingBookingsArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <!-- your booking site, a customer pressing Book -->
 <g transform="translate(14 40)">
  <rect width="96" height="112" rx="12" fill="${p.card}" ${S}/>
  <path d="M0 12 Q0 0 12 0 L84 0 Q96 0 96 12 L96 18 L0 18 Z" fill="${p.ink}"/>
  <circle cx="12" cy="9" r="2.5" fill="${p.card}"/><circle cx="21" cy="9" r="2.5" fill="${p.card}"/><circle cx="30" cy="9" r="2.5" fill="${p.card}"/>
  <rect x="10" y="28" width="76" height="26" rx="5" fill="${p.lite}"/>
  <path d="M18 50 l10 -10 l8 7 l6 -5 l10 8" fill="none" stroke="${p.mut}" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="10" y="62" width="50" height="6" rx="3" fill="${p.ink}"/><rect x="10" y="73" width="34" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="10" y="86" width="76" height="17" rx="8.5" fill="${p.acc}"/>${txt(48, 98, 'Book', 9, 700, p.onAcc, 'middle')}
 </g>
 <path d="M116 96 H138" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M133 90 L140 96 L133 102" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- the request, waiting for you -->
 <g transform="translate(148 26)">
  <rect width="164" height="140" rx="14" fill="${p.card}" ${S}/>
  ${avatar(28, 28, 15, p)}
  <rect x="52" y="20" width="70" height="7" rx="3.5" fill="${p.ink}"/><rect x="52" y="33" width="46" height="5" rx="2.5" fill="${p.lite}"/>
  <path d="M14 54 H150" stroke="${p.lite}" stroke-width="1.5"/>
  <g transform="translate(14 63)"><rect width="15" height="14" rx="3" fill="none" stroke="${p.ink}" stroke-width="1.6"/><path d="M0 5 H15" stroke="${p.ink}" stroke-width="1.6"/><path d="M4.5 -2 V2 M10.5 -2 V2" stroke="${p.ink}" stroke-width="1.6" stroke-linecap="round"/></g>
  <rect x="38" y="68" width="62" height="5" rx="2.5" fill="${p.lite}"/>
  ${txt(21.5, 99, '$', 14, 800, p.ink, 'middle')}
  <rect x="38" y="90" width="40" height="5" rx="2.5" fill="${p.lite}"/><rect x="116" y="89" width="34" height="7" rx="3.5" fill="${p.acc}" opacity=".85"/>
  <rect x="14" y="110" width="64" height="20" rx="10" fill="${p.card}" stroke="${p.ink}" stroke-width="1.8"/>
  <path d="M42 116 l8 8 M50 116 l-8 8" stroke="${p.ink}" stroke-width="2" stroke-linecap="round"/>
  <rect x="86" y="110" width="64" height="20" rx="10" fill="${p.acc}"/>
  ${tick(112.5, 120.5, p.onAcc, 2.4)}
  <circle cx="160" cy="4" r="13" fill="${p.acc}"/>
  <circle cx="160" cy="4" r="6.5" fill="none" stroke="${p.onAcc}" stroke-width="1.8"/><path d="M160 0.5 V4 L162.6 5.6" fill="none" stroke="${p.onAcc}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 <!-- the payment, held until you decide -->
 <path d="M312 96 H326" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 <g transform="translate(326 74)">
  <rect width="44" height="46" rx="11" fill="${p.card}" ${S}/>
  <path d="M15 22 V17 Q15 10 22 10 Q29 10 29 17 V22" fill="none" stroke="${p.ink}" stroke-width="2" stroke-linecap="round"/>
  <rect x="11" y="21" width="22" height="16" rx="4" fill="${p.soft}" stroke="${p.ink}" stroke-width="1.8"/>
  <circle cx="22" cy="28" r="2.2" fill="${p.acc}"/><path d="M22 29.5 V32.5" stroke="${p.acc}" stroke-width="2" stroke-linecap="round"/>
 </g>
 ${ground(192, 172, 164, dark)}`;
}

/** Pending bookings: a Book press on your site becomes a request with its payment held, waiting for decline or approve. */
export const PendingBookingsEmptyArt = makeEmptyArt(pendingBookingsArt, '0 14 384 166');
