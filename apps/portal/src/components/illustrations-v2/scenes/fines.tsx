'use client';

/**
 * Fines empty state (illustration guide §4a): a parking ticket, matched to the
 * rental it happened on — the day it was issued falls inside the booked dates,
 * so it goes to that driver's balance. No car: the page is about the ticket.
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

export function finesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const onInk = dark ? 'hsl(var(--background))' : '#ffffff';

  // The ticket: ink header, a few lines, the amount, a tear-off stub.
  const ticket = `
  <g transform="translate(26 30) rotate(-6 48 62)">
   <rect width="96" height="126" rx="10" fill="${p.card}" ${S}/>
   <path d="M0 10 Q0 0 10 0 L86 0 Q96 0 96 10 L96 26 L0 26 Z" fill="${p.ink}"/>
   ${txt(48, 17.5, 'PARKING', 9.5, 800, onInk, 'middle')}
   <rect x="12" y="38" width="42" height="5" rx="2.5" fill="${p.lite}"/>
   <rect x="12" y="50" width="30" height="5" rx="2.5" fill="${p.lite}"/>
   <rect x="12" y="62" width="36" height="5" rx="2.5" fill="${p.lite}"/>
   ${txt(84, 84, '$60', 17, 800, p.ink, 'end')}
   <path d="M4 96 H92" stroke="${p.mut}" stroke-width="1.4" stroke-dasharray="3 3"/>
   ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<rect x="${14 + i * 7}" y="104" width="${i % 3 === 0 ? 3 : 1.6}" height="12" fill="${p.ink}"/>`).join('')}
  </g>`;

  // The match: a dashed line from the ticket into the rental it belongs to.
  const link = `
  <path d="M128 94 C 150 94, 162 100, 192 100" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
  <path d="M186 94 L193 100 L186 106" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

  // The rental: the driver, the booked days (the ticket's day pinned on them),
  // and the balance the fine joins.
  const cells = [0, 1, 2, 3, 4, 5, 6]
    .map((c) => `<rect x="${14 + c * 20}" y="64" width="16" height="16" rx="4.5" fill="${p.lite}"/>`)
    .join('');
  const rental = `
  <g transform="translate(196 28)">
   <rect width="160" height="136" rx="14" fill="${p.card}" ${S}/>
   ${avatar(30, 30, 16, p)}
   <rect x="54" y="20" width="74" height="7" rx="3.5" fill="${p.ink}"/><rect x="54" y="34" width="48" height="5" rx="2.5" fill="${p.lite}"/>
   ${cells}
   <rect x="54" y="64" width="76" height="16" rx="5" fill="${p.acc}"/>
   <g transform="translate(102 58)"><path d="M0 -10 a6 6 0 0 1 6 6 c0 5 -6 10 -6 10 c0 0 -6 -5 -6 -10 a6 6 0 0 1 6 -6z" fill="${p.ink}"/><circle cy="-4" r="2.2" fill="${p.card}"/></g>
   <path d="M14 96 H146" stroke="${p.lite}" stroke-width="1.5"/>
   <rect x="14" y="110" width="50" height="6" rx="3" fill="${p.lite}"/>
   <rect x="98" y="104" width="48" height="18" rx="9" fill="${p.acc}"/>${txt(122, 116.5, '+$60', 9.5, 800, p.onAcc, 'middle')}
  </g>
  <circle cx="350" cy="30" r="10" fill="${p.acc}"/>${tick(344.5, 30.5, p.onAcc, 2.2)}`;

  return `${ticket}${link}${rental}${ground(190, 174, 160, dark)}`;
}

export const FinesEmptyArt = makeEmptyArt(finesArt, '14 14 354 168');
