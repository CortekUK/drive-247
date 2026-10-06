'use client';

/**
 * Add a customer — one small picture per screen of the v2 dialog
 * (customers-v2/customer-form-dialog-v2.tsx). Each says what its screen asks:
 *
 *   who        a customer record being filled in
 *   contact    an envelope and a phone, both threaded to the same person
 *   licence    a driving licence passing the blocklist check (shield + tick)
 *   extras     a phone running a ride app, and two switches
 *   emergency  the customer and the one person to call, linked
 *   reach      that person's phone ringing, and where they live
 *   verify     a phone showing the QR, the licence and selfie that follow
 *
 * Illustration guide §4a: ink lines, white cards, the accent only where it
 * matters, no car (none of these screens are about a car). All drawn on the
 * same 264 × 132 canvas so the picture never changes size between screens.
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, type Pal } from '../scene-kit';

const VIEW = '0 0 264 132';

const dash = (p: Pal, d: string) =>
  `<path d="${d}" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>`;

/** A small accent badge with a tick, for "checked" / "done". */
const badge = (p: Pal, x: number, y: number, r = 10) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>${tick(x - 5.5, y + 0.5, p.onAcc, 2.2)}`;

/** A switch, on (accent) or off (quiet). */
const toggle = (p: Pal, x: number, y: number, on: boolean) =>
  `<rect x="${x}" y="${y}" width="26" height="14" rx="7" fill="${on ? p.acc : p.lite}"/><circle cx="${x + (on ? 19 : 7)}" cy="${y + 7}" r="5" fill="${on ? p.onAcc : p.card}"/>`;

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

function contactArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(20 40)">
  <rect width="72" height="50" rx="9" fill="${p.card}" ${S}/>
  <path d="M6 8 L36 30 L66 8" fill="none" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M6 44 L26 26 M66 44 L46 26" fill="none" stroke="${p.lite}" stroke-width="1.8" stroke-linecap="round"/>
 </g>
 ${dash(p, 'M96 65 H112')}
 <g transform="translate(132 65)">${avatar(0, 0, 22, p, '#b77e5f', '#2a1d1a')}</g>
 ${dash(p, 'M156 65 H172')}
 <g transform="translate(178 12)">
  <rect width="58" height="104" rx="13" fill="${p.card}" ${S}/>
  <rect x="20" y="7" width="18" height="4" rx="2" fill="${p.ink}"/>
  <path d="M10 26 Q10 20 16 20 L42 20 Q48 20 48 26 L48 36 Q48 42 42 42 L20 42 L13 48 L14 42 Q10 41 10 36 Z" fill="${p.soft}"/>
  <rect x="16" y="27" width="24" height="4" rx="2" fill="${p.acc}"/><rect x="16" y="34" width="16" height="3.5" rx="1.75" fill="${p.acc}" opacity=".6"/>
  <path d="M48 58 Q48 52 42 52 L16 52 Q10 52 10 58 L10 66 Q10 72 16 72 L38 72 L45 78 L44 72 Q48 71 48 66 Z" fill="${p.lite}"/>
  <rect x="16" y="59" width="22" height="4" rx="2" fill="${p.mut}"/>
 </g>
 ${ground(132, 124, 116, dark)}`;
}

function licenceArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(42 24) rotate(-4)">
  <rect width="132" height="84" rx="11" fill="${p.card}" ${S}/>
  <path d="M0 11 Q0 0 11 0 L121 0 Q132 0 132 11 L132 16 L0 16 Z" fill="${p.ink}"/>
  <rect x="12" y="26" width="34" height="42" rx="6" fill="${p.soft}"/>
  ${avatar(29, 45, 14, p).replace(`<circle r="14" fill="${p.soft}"/>`, '')}
  <rect x="56" y="28" width="56" height="6" rx="3" fill="${p.ink}"/>
  <rect x="56" y="41" width="40" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="56" y="52" width="50" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="56" y="63" width="30" height="5" rx="2.5" fill="${p.acc}" opacity=".85"/>
 </g>
 ${dash(p, 'M182 66 H196')}
 <g transform="translate(200 40)">
  <path d="M20 0 L40 8 L40 26 Q40 44 20 54 Q0 44 0 26 L0 8 Z" fill="${p.card}" ${stroke(p, 2.2)}/>
  <path d="M20 8 L33 13 L33 26 Q33 38 20 45 Q7 38 7 26 L7 13 Z" fill="${p.soft}"/>
  ${tick(13.5, 27, p.acc, 2.6)}
 </g>
 ${ground(132, 124, 110, dark)}`;
}

function extrasArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(46 12)">
  <rect width="60" height="106" rx="13" fill="${p.card}" ${S}/>
  <rect x="21" y="7" width="18" height="4" rx="2" fill="${p.ink}"/>
  <rect x="8" y="18" width="44" height="58" rx="7" fill="${p.lite}" opacity=".6"/>
  <path d="M16 66 C 22 52, 34 60, 30 44 S 40 30, 44 28" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 3.5" stroke-linecap="round"/>
  <circle cx="16" cy="66" r="3.5" fill="${p.ink}"/>
  <path d="M44 16 Q51 16 51 23 Q51 29 44 36 Q37 29 37 23 Q37 16 44 16 Z" fill="${p.acc}"/><circle cx="44" cy="23" r="2.6" fill="${p.onAcc}"/>
  <rect x="8" y="84" width="44" height="13" rx="6.5" fill="${p.acc}"/>
 </g>
 ${dash(p, 'M112 64 H128')}
 <g transform="translate(132 30)">
  <rect width="96" height="70" rx="12" fill="${p.card}" ${S}/>
  <rect x="12" y="17" width="40" height="5" rx="2.5" fill="${p.ink}"/>
  ${toggle(p, 60, 12.5, true)}
  <path d="M12 35 H84" stroke="${p.lite}" stroke-width="1.5"/>
  <rect x="12" y="49" width="32" height="5" rx="2.5" fill="${p.lite}"/>
  ${toggle(p, 60, 44.5, false)}
 </g>
 ${ground(136, 124, 106, dark)}`;
}

function emergencyArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const person = (x: number, skin: string, hair: string) => `
  <g transform="translate(${x} 46)">
   <rect width="64" height="66" rx="12" fill="${p.card}" ${S}/>
   ${avatar(32, 26, 16, p, skin, hair)}
   <rect x="14" y="50" width="36" height="5" rx="2.5" fill="${p.ink}"/>
  </g>`;
  return `
 ${person(34, '#d9a88a', '#1f2040')}
 ${person(166, '#b77e5f', '#2a1d1a')}
 ${dash(p, 'M98 66 C 112 34, 152 34, 166 66')}
 <circle cx="132" cy="36" r="15" fill="${p.acc}" stroke="${p.card}" stroke-width="3"/>
 <rect x="127" y="27.5" width="10" height="17" rx="2.5" fill="none" stroke="${p.onAcc}" stroke-width="2"/>
 <path d="M130.5 41 H133.5" stroke="${p.onAcc}" stroke-width="1.8" stroke-linecap="round"/>
 ${ground(132, 124, 110, dark)}`;
}

function emergencyReachArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
 <g transform="translate(52 12)">
  <rect width="60" height="106" rx="13" fill="${p.card}" ${S}/>
  <rect x="21" y="7" width="18" height="4" rx="2" fill="${p.ink}"/>
  ${avatar(30, 40, 15, p, '#b77e5f', '#2a1d1a')}
  <rect x="14" y="62" width="32" height="5" rx="2.5" fill="${p.ink}"/>
  <circle cx="30" cy="88" r="10" fill="${p.acc}"/>
  <path d="M26 84.5 Q25 89 29.5 92.5 L31.5 91 Q33.5 92.5 34.5 91.5 L33 89 L31 90 Q28.5 88 28 86 L29.5 84.8 L28 82.5 Q27 82.5 26 84.5 Z" fill="${p.onAcc}"/>
 </g>
 ${dash(p, 'M118 65 H134')}
 <g transform="translate(140 34)">
  <rect width="78" height="62" rx="12" fill="${p.card}" ${S}/>
  <path d="M39 12 Q49 12 49 22 Q49 30 39 40 Q29 30 29 22 Q29 12 39 12 Z" fill="${p.acc}"/><circle cx="39" cy="22" r="3.6" fill="${p.onAcc}"/>
  <rect x="14" y="46" width="50" height="5" rx="2.5" fill="${p.lite}"/>
 </g>
 ${ground(134, 124, 104, dark)}`;
}

function verifyArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  // A small QR: a fixed pattern, three finder squares and a scatter of cells.
  const cells = [
    [3, 0], [4, 1], [3, 2], [0, 3], [2, 3], [4, 3], [5, 4], [3, 4], [4, 5], [3, 6], [5, 6],
  ]
    .map(([c, r]) => `<rect x="${c * 4}" y="${r * 4}" width="3.2" height="3.2" rx=".8" fill="${p.ink}"/>`)
    .join('');
  const finder = (x: number, y: number) =>
    `<rect x="${x}" y="${y}" width="13" height="13" rx="3" fill="none" stroke="${p.ink}" stroke-width="2.2"/><rect x="${x + 4}" y="${y + 4}" width="5" height="5" rx="1.2" fill="${p.acc}"/>`;
  return `
 <g transform="translate(26 50) rotate(-8)">
  <rect width="66" height="44" rx="7" fill="${p.card}" ${S}/>
  <rect x="7" y="8" width="18" height="24" rx="3" fill="${p.soft}"/>
  ${avatar(16, 19, 8, p).replace(`<circle r="8" fill="${p.soft}"/>`, '')}
  <rect x="30" y="10" width="28" height="4.5" rx="2.25" fill="${p.ink}"/><rect x="30" y="20" width="20" height="4" rx="2" fill="${p.lite}"/><rect x="30" y="29" width="24" height="4" rx="2" fill="${p.lite}"/>
 </g>
 ${dash(p, 'M96 72 H108')}
 <g transform="translate(110 8)">
  <rect width="64" height="112" rx="14" fill="${p.card}" ${S}/>
  <rect x="23" y="7" width="18" height="4" rx="2" fill="${p.ink}"/>
  <g transform="translate(14 26)">
   <rect x="-4" y="-4" width="44" height="44" rx="8" fill="${p.card}" stroke="${p.lite}" stroke-width="1.6"/>
   ${finder(0, 0)}${finder(23, 0)}${finder(0, 23)}
   <g transform="translate(15 15)">${cells}</g>
  </g>
  <rect x="12" y="82" width="40" height="5" rx="2.5" fill="${p.ink}"/>
  <rect x="18" y="93" width="28" height="4" rx="2" fill="${p.lite}"/>
 </g>
 ${dash(p, 'M178 72 H190')}
 <g transform="translate(194 46)">
  <rect width="48" height="54" rx="12" fill="${p.card}" ${S}/>
  <circle cx="24" cy="27" r="16" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="4 4"/>
  ${avatar(24, 27, 12, p, '#b77e5f', '#2a1d1a')}
 </g>
 ${badge(p, 238, 48)}
 ${ground(134, 124, 112, dark)}`;
}

export const AddCustomerWhoArt = makeEmptyArt(whoArt, VIEW);
export const AddCustomerContactArt = makeEmptyArt(contactArt, VIEW);
export const AddCustomerLicenceArt = makeEmptyArt(licenceArt, VIEW);
export const AddCustomerExtrasArt = makeEmptyArt(extrasArt, VIEW);
export const AddCustomerEmergencyArt = makeEmptyArt(emergencyArt, VIEW);
export const AddCustomerEmergencyReachArt = makeEmptyArt(emergencyReachArt, VIEW);
export const AddCustomerVerifyArt = makeEmptyArt(verifyArt, VIEW);
