'use client';

/**
 * Add period — the two choice pictures (ILLUSTRATION_GUIDE.md §4a).
 *
 * Manual extension: a month card where the booked days sit in the soft accent
 * and ONE new return day, picked by hand, is the solid accent with a plus.
 * Auto extension: the same card, every week banded, with a renew badge on its
 * corner — it keeps going on its own. No car: the choice is about time.
 */
import { ground, makeEmptyArt, pal, stroke, type Pal } from '../scene-kit';

const COLS = 7;
const ROWS = 4;
const X0 = 66;
const Y0 = 44;
const DX = 13;
const DY = 12.5;

/** The month card: ink outline, a dark header with two binder rings. */
function card(p: Pal, S: string): string {
  return `
 <rect x="52" y="14" width="104" height="96" rx="11" fill="${p.card}" ${S}/>
 <path d="M52 25 Q52 14 63 14 L145 14 Q156 14 156 25 L156 30 L52 30 Z" fill="${p.ink}"/>
 <rect x="74" y="8" width="5" height="12" rx="2.5" fill="${p.ink}"/><rect x="129" y="8" width="5" height="12" rx="2.5" fill="${p.ink}"/>`;
}

const cell = (c: number, r: number) => ({ x: X0 + c * DX, y: Y0 + r * DY });

function manualArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  let days = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = cell(c, r);
      const i = r * COLS + c;
      // Booked: the first nine days. The rest of the month is quiet.
      days += i < 9
        ? `<circle cx="${x}" cy="${y}" r="4.6" fill="${p.soft}"/><circle cx="${x}" cy="${y}" r="1.7" fill="${p.acc}"/>`
        : i === 15
          ? ''
          : `<circle cx="${x}" cy="${y}" r="1.7" fill="${p.lite}"/>`;
    }
  }
  const from = cell(1, 1);
  const to = cell(1, 2);
  const pick = cell(1, 2);
  return `${card(p, S)}
 ${days}
 <path d="M${from.x + 7} ${from.y + 1} Q${from.x + 26} ${from.y + 4} ${to.x + 9} ${to.y - 2}" fill="none" stroke="${p.acc}" stroke-width="1.8" stroke-dasharray="2.5 3.5" stroke-linecap="round"/>
 <circle cx="${pick.x}" cy="${pick.y}" r="7.5" fill="${p.acc}"/>
 <path d="M${pick.x - 3.2} ${pick.y} H${pick.x + 3.2} M${pick.x} ${pick.y - 3.2} V${pick.y + 3.2}" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round"/>
 ${ground(104, 116, 64, dark)}`;
}

function autoArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  let weeks = '';
  for (let r = 0; r < ROWS; r++) {
    const a = cell(0, r);
    const b = cell(COLS - 1, r);
    // Every week is a band: it renews, so every row is covered.
    weeks += `<rect x="${a.x - 5}" y="${a.y - 4.6}" width="${b.x - a.x + 10}" height="9.2" rx="4.6" fill="${p.soft}" opacity="${1 - r * 0.18}"/>`;
    for (let c = 0; c < COLS; c++) {
      const { x, y } = cell(c, r);
      weeks += `<circle cx="${x}" cy="${y}" r="1.7" fill="${p.acc}" opacity="${1 - r * 0.2}"/>`;
    }
  }
  const bx = 154;
  const by = 22;
  return `${card(p, S)}
 ${weeks}
 <circle cx="${bx}" cy="${by}" r="15" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>
 <path d="M${bx - 6.5} ${by - 1} A6.8 6.8 0 0 1 ${bx + 5.5} ${by - 4}" fill="none" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round"/>
 <path d="M${bx + 6.5} ${by + 1} A6.8 6.8 0 0 1 ${bx - 5.5} ${by + 4}" fill="none" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round"/>
 <path d="M${bx + 2.6} ${by - 6.6} L${bx + 6} ${by - 4} L${bx + 3.2} ${by - 0.8}" fill="none" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M${bx - 2.6} ${by + 6.6} L${bx - 6} ${by + 4} L${bx - 3.2} ${by + 0.8}" fill="none" stroke="${p.onAcc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 ${ground(104, 116, 64, dark)}`;
}

/** Manual extension: you pick the new return day. */
export const ManualExtensionArt = makeEmptyArt(manualArt, '36 2 140 120');
/** Auto extension: it renews week after week on its own. */
export const AutoExtensionArt = makeEmptyArt(autoArt, '36 2 140 120');
