'use client';

/**
 * Availability empty state (illustration guide §4a): one week, with each day's
 * open hours drawn as a bar, and one day closed — hatched in indigo, tagged
 * "Closed", with the pointer that closed it. A small clock card beside it for
 * the weekly hours. No car.
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

export function blockedDatesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const onInk = dark ? 'hsl(var(--background))' : '#ffffff';
  const hatch = `bd${dark ? 'd' : 'l'}`;

  const X0 = 56;
  const COL = 30;
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  // Open hours per day (top offset, height) — weekends shorter.
  const hours: [number, number][] = [[0, 64], [0, 64], [0, 64], [0, 64], [0, 64], [12, 40], [18, 28]];
  const CLOSED = 3;

  const cols = letters
    .map((l, i) => {
      const x = X0 + i * COL;
      const [top, h] = hours[i];
      const head = txt(x + 11, 64, l, 10, 700, i === CLOSED ? p.acc : p.mut, 'middle');
      if (i === CLOSED) {
        return `${head}<rect x="${x}" y="76" width="22" height="64" rx="7" fill="url(#${hatch})" stroke="${p.acc}" stroke-width="2"/>`;
      }
      return `${head}<rect x="${x}" y="${76 + top}" width="22" height="${h}" rx="7" fill="${p.lite}"/>`;
    })
    .join('');

  const week = `
  <defs><pattern id="${hatch}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${p.soft}"/><path d="M0 0 V7" stroke="${p.acc}" stroke-width="2.2"/></pattern></defs>
  <g>
   <rect x="40" y="24" width="232" height="132" rx="14" fill="${p.card}" ${S}/>
   <path d="M40 38 Q40 24 54 24 L258 24 Q272 24 272 38 L272 46 L40 46 Z" fill="${p.ink}"/>
   ${txt(56, 39.5, 'This week', 10, 700, onInk)}
   <circle cx="252" cy="35" r="3" fill="${onInk}" opacity=".6"/><circle cx="240" cy="35" r="3" fill="${onInk}" opacity=".6"/>
   ${cols}
  </g>`;

  // The "Closed" tag on the blocked day, and the pointer that set it.
  const cx = X0 + CLOSED * COL + 11;
  const tag = `
  <g transform="translate(${cx - 26} 98)">
   <rect width="52" height="20" rx="10" fill="${p.acc}"/>${txt(26, 13.5, 'Closed', 9.5, 800, p.onAcc, 'middle')}
  </g>
  <g transform="translate(${cx + 8} 124) rotate(-18)">
   <path d="M0 0 L0 22 L6 17 L10 26 L14 24 L10 15 L18 15 Z" fill="${p.card}" stroke="${p.ink}" stroke-width="2" stroke-linejoin="round"/>
  </g>`;

  // Weekly hours: a clock card to the right.
  const clock = `
  <g transform="translate(288 64)">
   <rect width="64" height="72" rx="14" fill="${p.card}" ${S}/>
   <circle cx="32" cy="30" r="17" fill="${p.soft}" stroke="${p.ink}" stroke-width="2"/>
   <path d="M32 19 V30 L40 35" fill="none" stroke="${p.ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
   ${txt(32, 62, '9–5', 11, 800, p.ink, 'middle')}
  </g>`;

  return `${week}${tag}${clock}${ground(196, 170, 150, dark)}`;
}

export const BlockedDatesEmptyArt = makeEmptyArt(blockedDatesArt, '26 14 340 164');
