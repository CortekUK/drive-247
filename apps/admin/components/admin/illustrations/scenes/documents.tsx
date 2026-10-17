'use client';

/**
 * Documents empty state (illustration guide §4a): a driving licence, an
 * insurance certificate and a signed agreement, filed into one folder that
 * carries the customer's name: a file comes in on the left, and what is
 * filed stays linked to the rental on the right. No car.
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick } from '../scene-kit';

export function documentsArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);

  // Folder back, with its tab.
  const back = `<path d="M96 70 Q96 60 106 60 L150 60 L160 72 L262 72 Q272 72 272 82 L272 160 L96 160 Z" fill="${p.lite}" ${S}/>`;

  // The three papers, fanned as they go in.
  const licence = `
  <g transform="translate(92 44) rotate(-12)">
   <rect width="80" height="54" rx="8" fill="${p.card}" ${S}/>
   <rect x="8" y="10" width="22" height="28" rx="4" fill="${p.soft}"/>
   ${avatar(19, 22, 9, p).replace(`<circle r="9" fill="${p.soft}"/>`, '')}
   <rect x="36" y="12" width="34" height="5" rx="2.5" fill="${p.ink}"/><rect x="36" y="23" width="26" height="4" rx="2" fill="${p.lite}"/><rect x="36" y="32" width="30" height="4" rx="2" fill="${p.lite}"/>
  </g>`;
  const insurance = `
  <g transform="translate(150 24)">
   <rect width="68" height="92" rx="8" fill="${p.card}" ${S}/>
   <path d="M34 12 L48 17 L48 28 Q48 38 34 44 Q20 38 20 28 L20 17 Z" fill="${p.soft}" stroke="${p.acc}" stroke-width="2" stroke-linejoin="round"/>
   ${tick(28.5, 28, p.acc, 2.2)}
   <rect x="12" y="54" width="44" height="5" rx="2.5" fill="${p.ink}"/><rect x="12" y="65" width="34" height="4" rx="2" fill="${p.lite}"/><rect x="12" y="75" width="40" height="4" rx="2" fill="${p.lite}"/>
  </g>`;
  const agreement = `
  <g transform="translate(222 30) rotate(10)">
   <rect width="64" height="86" rx="8" fill="${p.card}" ${S}/>
   <rect x="10" y="12" width="36" height="5" rx="2.5" fill="${p.ink}"/>
   <rect x="10" y="24" width="44" height="4" rx="2" fill="${p.lite}"/><rect x="10" y="33" width="40" height="4" rx="2" fill="${p.lite}"/><rect x="10" y="42" width="44" height="4" rx="2" fill="${p.lite}"/>
   <path d="M12 66 C16 56 20 72 25 62 S33 58 38 64 S46 60 52 62" fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round"/>
   <path d="M10 72 H54" stroke="${p.mut}" stroke-width="1.2"/>
  </g>`;

  // Folder front, lower than the back so the papers show above it, with the
  // customer's name on it and a verified tick.
  const front = `
  <path d="M92 98 Q92 92 98 92 L270 92 Q276 92 276 98 L272 160 Q272 166 266 166 L102 166 Q96 166 96 160 Z" fill="${p.card}" ${S}/>
  ${avatar(124, 126, 13, p)}
  <rect x="144" y="118" width="64" height="7" rx="3.5" fill="${p.ink}"/><rect x="144" y="131" width="42" height="5" rx="2.5" fill="${p.lite}"/>
  <circle cx="252" cy="128" r="11" fill="${p.acc}"/>${tick(246.5, 128.5, p.onAcc, 2.2)}`;

  // In: an upload tile. Out: the rental the papers are kept against.
  const dash = (d: string) => `<path d="${d}" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>`;
  const upload = `
  <g transform="translate(18 76)">
   <rect width="56" height="56" rx="14" fill="${p.card}" ${S}/>
   <path d="M28 38 V18 M20 26 L28 18 L36 26" fill="none" stroke="${p.acc}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
   <path d="M16 42 H40" stroke="${p.ink}" stroke-width="2.2" stroke-linecap="round"/>
  </g>
  ${dash('M78 104 H90')}`;
  const cells = [0, 1, 2, 3].map((c) => `<rect x="${8 + c * 12}" y="22" width="9" height="9" rx="2.5" fill="${c === 1 || c === 2 ? p.acc : p.lite}"/>`).join('');
  const rental = `
  ${dash('M280 126 H292')}
  <g transform="translate(296 100)">
   <rect width="60" height="52" rx="12" fill="${p.card}" ${S}/>
   <path d="M0 12 Q0 0 12 0 L48 0 Q60 0 60 12 L60 14 L0 14 Z" fill="${p.ink}"/>
   <g transform="translate(0 4)">${cells}</g>
   <rect x="8" y="40" width="30" height="4" rx="2" fill="${p.lite}"/>
  </g>`;

  return `${back}${licence}${insurance}${agreement}${front}${upload}${rental}${ground(186, 172, 150, dark)}`;
}

export const DocumentsEmptyArt = makeEmptyArt(documentsArt, '8 14 360 166');
