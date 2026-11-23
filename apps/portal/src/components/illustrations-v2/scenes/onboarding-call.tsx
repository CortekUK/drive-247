'use client';

/**
 * Onboarding call booked (illustration guide §4a): a calendar page with one
 * day picked out in the accent and ticked, and beside it a small video-call
 * card with a person in it. No car. Thin ink outlines, white cards, the accent
 * only where it matters, a soft ground shadow.
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, sparkle, stroke, tick } from '../scene-kit';

export function callBookedArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);

  // The calendar page: 5 x 3 day cells, one of them the booked day.
  const cells: string[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const x = 122 + col * 26;
      const y = 80 + row * 22;
      const picked = row === 1 && col === 2;
      cells.push(
        picked
          ? `<rect x="${x - 3}" y="${y - 3}" width="22" height="18" rx="5" fill="${p.acc}"/>${tick(x + 3, y + 6, p.onAcc, 2.2)}`
          : `<rect x="${x}" y="${y}" width="16" height="12" rx="3" fill="${p.lite}"/>`,
      );
    }
  }

  return `
    ${ground(188, 170, 118, dark)}
    <rect x="104" y="40" width="160" height="124" rx="14" fill="${p.card}" ${S}/>
    <path d="M104 54 Q104 40 118 40 H250 Q264 40 264 54 V66 H104 Z" fill="${p.acc}" ${S}/>
    <rect x="134" y="30" width="8" height="20" rx="4" fill="${p.card}" ${S}/>
    <rect x="226" y="30" width="8" height="20" rx="4" fill="${p.card}" ${S}/>
    ${cells.join('')}
    <rect x="236" y="104" width="84" height="54" rx="12" fill="${p.card}" ${S}/>
    ${avatar(262, 131, 14, p)}
    <rect x="283" y="120" width="26" height="5" rx="2.5" fill="${p.lite}"/>
    <rect x="283" y="130" width="18" height="5" rx="2.5" fill="${p.lite}"/>
    <circle cx="304" cy="148" r="4" fill="${p.acc}"/>
    ${sparkle(90, 52, 7, p.acc)}
    ${sparkle(296, 84, 5, p.acc)}
    ${sparkle(84, 132, 4, p.soft)}
  `;
}

export const CallBookedArt = makeEmptyArt(callBookedArt, '70 22 262 158');
