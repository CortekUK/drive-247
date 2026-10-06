'use client';

/**
 * Add a vehicle — one small picture per screen of the v2 dialog
 * (vehicles-v2/add-vehicle-dialog-v2.tsx), on the same 264 × 132 canvas as the
 * add-customer pictures so the two dialogs read as one family:
 *
 *   car        the approved coupe — "which car is it?"
 *   plate      a licence plate, and a VIN tag with its barcode
 *   owned      a key fob on a paid receipt
 *   rates      a rate card: day, week, month
 *   miles      an odometer dial and the road it measures
 *   booking    a calendar with a booked stretch, and a pickup pin
 *   upkeep     a due date with a reminder bell on it
 *   papers     the logbook, a tracker pin and a lock
 *   keys       two keys on a ring, one tagged "spare"
 *   listing    the car's card on the booking site
 *   photos     three photos fanned, the front one the cover
 *
 * Illustration guide §4a: ink lines, white cards, the accent only where it
 * matters; the car only on the screen that is about the car. Static art from
 * the scene kit only; nothing user-supplied is interpolated.
 */
import { carSvg, MONO_PAINT } from '../car-art';
import { ground, makeEmptyArt, pal, stroke, tick, txt, type Pal } from '../scene-kit';

const VIEW = '0 0 264 132';

const dash = (p: Pal, d: string) =>
  `<path d="${d}" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`;

/** A month card: ink header with two rings, a grid of quiet days. */
function calendar(p: Pal, x: number, y: number, w: number, h: number, inner = ''): string {
  const S = stroke(p);
  return `<g transform="translate(${x} ${y})">
  <rect width="${w}" height="${h}" rx="11" fill="${p.card}" ${S}/>
  <path d="M0 11 Q0 0 11 0 L${w - 11} 0 Q${w} 0 ${w} 11 L${w} 18 L0 18 Z" fill="${p.ink}"/>
  <rect x="${w * 0.25}" y="-5" width="5" height="11" rx="2.5" fill="${p.ink}"/><rect x="${w * 0.75 - 5}" y="-5" width="5" height="11" rx="2.5" fill="${p.ink}"/>
  ${inner}
 </g>`;
}

function carArt(dark: boolean): string {
  // The car carries its own ground shadow.
  return `<g transform="translate(30 26) scale(.62)">${carSvg(MONO_PAINT, `vadd-car-${dark ? 'd' : 'l'}`)}</g>`;
}

function plateArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const bars = [0, 3, 5, 9, 12, 14, 18, 21, 23, 27, 30, 32, 36, 38, 41]
    .map((d, i) => `<rect x="${10 + d}" y="26" width="${i % 3 === 0 ? 2 : 1.2}" height="16" fill="${p.ink}"/>`)
    .join('');
  return `
 <g transform="translate(28 34)">
  <rect width="136" height="66" rx="10" fill="${p.card}" ${S}/>
  <rect x="7" y="7" width="122" height="52" rx="6" fill="none" stroke="${p.lite}" stroke-width="1.6"/>
  <rect x="44" y="13" width="48" height="5" rx="2.5" fill="${p.acc}" opacity=".85"/>
  ${txt(68, 46, '7KX 204', 22, 800, p.ink, 'middle')}
 </g>
 ${dash(p, 'M168 67 H180')}
 <g transform="translate(184 40) rotate(6)">
  <rect width="62" height="54" rx="9" fill="${p.card}" ${S}/>
  <rect x="10" y="10" width="30" height="5" rx="2.5" fill="${p.ink}"/>
  ${bars}
 </g>
 ${ground(132, 118, 112, dark)}`;
}

function ownedArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(66 14)">
  <path d="M0 10 Q0 0 10 0 L94 0 Q104 0 104 10 L104 104 L94 98 L84 104 L74 98 L64 104 L54 98 L44 104 L34 98 L24 104 L14 98 L4 104 L0 104 Z" fill="${p.card}" ${S}/>
  <rect x="14" y="16" width="44" height="6" rx="3" fill="${p.ink}"/>
  <rect x="14" y="32" width="56" height="4" rx="2" fill="${p.lite}"/><rect x="14" y="42" width="40" height="4" rx="2" fill="${p.lite}"/>
  <path d="M14 58 H90" stroke="${p.lite}" stroke-width="1.5"/>
  ${txt(14, 78, '$', 14, 800, p.ink)}<rect x="28" y="69" width="34" height="7" rx="3.5" fill="${p.ink}"/>
  <circle cx="84" cy="74" r="10" fill="${p.acc}"/>${tick(78.5, 74.5, p.onAcc, 2.2)}
 </g>
 <g transform="translate(180 52) rotate(-14)">
  <rect width="30" height="48" rx="12" fill="${p.acc}" ${stroke(p, 2)}/>
  <circle cx="15" cy="16" r="5" fill="${p.onAcc}" opacity=".9"/>
  <rect x="9" y="28" width="12" height="4" rx="2" fill="${p.onAcc}" opacity=".7"/>
  <circle cx="15" cy="-8" r="9" fill="none" stroke="${p.ink}" stroke-width="2.4"/>
 </g>
 ${ground(132, 124, 100, dark)}`;
}

function ratesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const row = (y: number, label: string, w: number, strong: boolean) =>
    `${txt(18, y + 8, label, 9, 700, p.mut)}<rect x="62" y="${y}" width="${w}" height="10" rx="5" fill="${strong ? p.acc : p.lite}"/>${txt(150, y + 9, '$', 11, 800, strong ? p.acc : p.ink, 'end')}`;
  return `
 <g transform="translate(52 18)">
  <rect width="164" height="96" rx="14" fill="${p.card}" ${S}/>
  ${row(18, 'DAY', 44, true)}
  <path d="M14 38 H150" stroke="${p.lite}" stroke-width="1.5"/>
  ${row(46, 'WEEK', 60, false)}
  <path d="M14 66 H150" stroke="${p.lite}" stroke-width="1.5"/>
  ${row(74, 'MONTH', 72, false)}
 </g>
 ${ground(132, 124, 100, dark)}`;
}

function milesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const ticks = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => {
      const a = Math.PI + (i * Math.PI) / 6;
      const x1 = 50 + 34 * Math.cos(a), y1 = 52 + 34 * Math.sin(a);
      const x2 = 50 + 40 * Math.cos(a), y2 = 52 + 40 * Math.sin(a);
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${p.ink}" stroke-width="2" stroke-linecap="round"/>`;
    })
    .join('');
  return `
 <path d="M150 118 C 176 92, 168 64, 204 46 S 246 22, 254 14" fill="none" stroke="${p.lite}" stroke-width="14" stroke-linecap="round"/>
 <path d="M150 118 C 176 92, 168 64, 204 46 S 246 22, 254 14" fill="none" stroke="${p.card}" stroke-width="1.8" stroke-dasharray="5 6"/>
 <g transform="translate(28 22)">
  <rect width="100" height="84" rx="14" fill="${p.card}" ${S}/>
  <path d="M14 52 A36 36 0 0 1 86 52" fill="none" stroke="${p.lite}" stroke-width="6" stroke-linecap="round"/>
  <path d="M14 52 A36 36 0 0 1 62 18" fill="none" stroke="${p.acc}" stroke-width="6" stroke-linecap="round"/>
  ${ticks}
  <path d="M50 52 L66 30" stroke="${p.ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="50" cy="52" r="4.5" fill="${p.ink}"/>
  <rect x="30" y="64" width="40" height="10" rx="3" fill="${p.ink}"/>${txt(50, 72, '0 1 2 4', 7, 700, p.card, 'middle')}
 </g>
 ${dash(p, 'M132 64 H146')}
 ${ground(132, 124, 112, dark)}`;
}

function bookingArt(dark: boolean): string {
  const p = pal(dark);
  let days = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) days += `<rect x="${12 + c * 20}" y="${28 + r * 18}" width="14" height="12" rx="3.5" fill="${p.lite}"/>`;
  const inner = `${days}<rect x="${12 + 20}" y="46" width="${3 * 20 + 14}" height="12" rx="4" fill="${p.acc}"/>`;
  return `
 ${calendar(p, 40, 22, 136, 88, inner)}
 ${dash(p, 'M180 66 H192')}
 <g transform="translate(196 38)">
  <rect width="48" height="52" rx="12" fill="${p.card}" ${stroke(p)}/>
  <path d="M24 10 Q34 10 34 20 Q34 28 24 38 Q14 28 14 20 Q14 10 24 10 Z" fill="${p.acc}"/><circle cx="24" cy="20" r="3.6" fill="${p.onAcc}"/>
  <rect x="12" y="42" width="24" height="4" rx="2" fill="${p.lite}"/>
 </g>
 ${ground(132, 124, 108, dark)}`;
}

function upkeepArt(dark: boolean): string {
  const p = pal(dark);
  let days = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) days += `<rect x="${12 + c * 18}" y="${28 + r * 17}" width="12" height="11" rx="3" fill="${r === 2 && c === 3 ? p.acc : p.lite}"/>`;
  return `
 ${calendar(p, 58, 20, 106, 86, days)}
 <g transform="translate(160 18)">
  <circle cx="26" cy="26" r="24" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>
  <path d="M26 13 Q17 13 17 23 L17 31 L14 35 L38 35 L35 31 L35 23 Q35 13 26 13 Z" fill="${p.onAcc}"/>
  <circle cx="26" cy="38.5" r="3" fill="${p.onAcc}"/>
 </g>
 ${dash(p, 'M152 88 C 168 88, 176 78, 180 66')}
 ${ground(132, 124, 100, dark)}`;
}

function papersArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(36 18) rotate(-6)">
  <rect width="76" height="96" rx="9" fill="${p.card}" ${S}/>
  <rect x="0" y="0" width="16" height="96" rx="8" fill="${p.ink}"/>
  <rect x="26" y="16" width="38" height="6" rx="3" fill="${p.ink}"/>
  <rect x="26" y="32" width="40" height="4" rx="2" fill="${p.lite}"/><rect x="26" y="42" width="32" height="4" rx="2" fill="${p.lite}"/><rect x="26" y="52" width="38" height="4" rx="2" fill="${p.lite}"/>
  <circle cx="54" cy="76" r="9" fill="${p.acc}"/>${tick(48.5, 76.5, p.onAcc, 2)}
 </g>
 <g transform="translate(130 30)">
  <rect width="52" height="56" rx="12" fill="${p.card}" ${S}/>
  <circle cx="26" cy="28" r="15" fill="${p.soft}"/>
  <path d="M26 16 Q34 16 34 24 Q34 30 26 38 Q18 30 18 24 Q18 16 26 16 Z" fill="${p.acc}"/><circle cx="26" cy="24" r="3" fill="${p.onAcc}"/>
 </g>
 <g transform="translate(196 38)">
  <path d="M10 18 V12 Q10 2 21 2 Q32 2 32 12 V18" fill="none" stroke="${p.ink}" stroke-width="3"/>
  <rect x="2" y="18" width="38" height="32" rx="8" fill="${p.card}" ${S}/>
  <circle cx="21" cy="31" r="4" fill="${p.ink}"/><rect x="19.5" y="33" width="3" height="8" rx="1.5" fill="${p.ink}"/>
 </g>
 ${ground(132, 124, 110, dark)}`;
}

function keysArt(dark: boolean): string {
  const p = pal(dark);
  const key = (x: number, y: number, rot: number, fill: string, on: string) => `
  <g transform="translate(${x} ${y}) rotate(${rot})">
   <rect x="-15" y="0" width="30" height="46" rx="12" fill="${fill}" ${stroke(p, 2)}/>
   <circle cx="0" cy="15" r="4.5" fill="${on}" opacity=".9"/><rect x="-6" y="26" width="12" height="4" rx="2" fill="${on}" opacity=".6"/>
  </g>`;
  return `
 <circle cx="120" cy="34" r="14" fill="none" stroke="${p.ink}" stroke-width="3"/>
 <path d="M109 43 L101 49 M131 43 L139 49" stroke="${p.ink}" stroke-width="2.6" stroke-linecap="round"/>
 ${key(98, 46, 18, p.acc, p.onAcc)}
 ${key(142, 46, -18, p.card, p.ink)}
 ${dash(p, 'M158 58 C 172 60, 178 66, 184 70')}
 <g transform="translate(184 58) rotate(8)">
  <path d="M0 6 Q0 0 6 0 L50 0 Q56 0 56 6 L56 26 Q56 32 50 32 L6 32 Q0 32 0 26 Z" fill="${p.card}" ${stroke(p)}/>
  <circle cx="10" cy="16" r="3" fill="${p.ink}"/>
  ${txt(33, 20, 'SPARE', 8.5, 800, p.acc, 'middle')}
 </g>
 ${ground(132, 124, 96, dark)}`;
}

function listingArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(44 10)">
  <rect width="176" height="108" rx="12" fill="${p.card}" ${S}/>
  <path d="M0 12 Q0 0 12 0 L164 0 Q176 0 176 12 L176 16 L0 16 Z" fill="${p.lite}"/>
  <circle cx="10" cy="8" r="2.5" fill="${p.mut}"/><circle cx="18" cy="8" r="2.5" fill="${p.mut}"/><circle cx="26" cy="8" r="2.5" fill="${p.mut}"/>
  <rect x="12" y="24" width="72" height="52" rx="7" fill="${p.soft}"/>
  <g transform="translate(15 38) scale(.2)">${carSvg(MONO_PAINT, `vadd-list-${dark ? 'd' : 'l'}`)}</g>
  <rect x="94" y="26" width="64" height="6" rx="3" fill="${p.ink}"/>
  <rect x="94" y="40" width="70" height="4" rx="2" fill="${p.acc}" opacity=".8"/>
  <rect x="94" y="50" width="58" height="4" rx="2" fill="${p.acc}" opacity=".8"/>
  <rect x="94" y="60" width="64" height="4" rx="2" fill="${p.acc}" opacity=".8"/>
  <rect x="12" y="86" width="40" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="122" y="82" width="42" height="14" rx="7" fill="${p.acc}"/>${txt(143, 92, 'Book', 8, 700, p.onAcc, 'middle')}
 </g>
 ${ground(132, 124, 100, dark)}`;
}

function photosArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const photo = (x: number, y: number, rot: number, cover: boolean) => `
  <g transform="translate(${x} ${y}) rotate(${rot})">
   <rect width="78" height="62" rx="9" fill="${p.card}" ${S}/>
   <rect x="7" y="7" width="64" height="40" rx="5" fill="${cover ? p.soft : p.lite}"/>
   ${cover ? `<g transform="translate(9 19) scale(.18)">${carSvg(MONO_PAINT, `vadd-ph-${dark ? 'd' : 'l'}`)}</g>` : `<path d="M14 42 l14 -14 l10 9 l8 -6 l14 11" fill="none" stroke="${p.mut}" stroke-width="1.6" stroke-linejoin="round"/>`}
   <rect x="7" y="52" width="${cover ? 30 : 22}" height="4" rx="2" fill="${cover ? p.acc : p.lite}"/>
  </g>`;
  return `
 ${photo(52, 30, -12, false)}
 ${photo(134, 30, 12, false)}
 ${photo(93, 20, 0, true)}
 ${ground(132, 124, 104, dark)}`;
}

export const AddVehicleCarArt = makeEmptyArt(carArt, VIEW);
export const AddVehiclePlateArt = makeEmptyArt(plateArt, VIEW);
export const AddVehicleOwnedArt = makeEmptyArt(ownedArt, VIEW);
export const AddVehicleRatesArt = makeEmptyArt(ratesArt, VIEW);
export const AddVehicleMilesArt = makeEmptyArt(milesArt, VIEW);
export const AddVehicleBookingArt = makeEmptyArt(bookingArt, VIEW);
export const AddVehicleUpkeepArt = makeEmptyArt(upkeepArt, VIEW);
export const AddVehiclePapersArt = makeEmptyArt(papersArt, VIEW);
export const AddVehicleKeysArt = makeEmptyArt(keysArt, VIEW);
export const AddVehicleListingArt = makeEmptyArt(listingArt, VIEW);
export const AddVehiclePhotosArt = makeEmptyArt(photosArt, VIEW);
