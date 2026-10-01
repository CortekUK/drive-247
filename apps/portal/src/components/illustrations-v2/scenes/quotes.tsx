'use client';

/**
 * Quotes empty-state picture (docs/brand/illustration-guide.md §4a).
 *
 * The story: pick the dates, every free car is priced onto one quote, and the
 * quote flies off to the customer. No car drawn — the lines are the fleet.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

function quotesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const cells = [0, 1, 2]
    .map((r: number) =>
      [0, 1, 2, 3]
        .map((c: number) => `<rect x="${10 + c * 17}" y="${28 + r * 15}" width="13" height="10" rx="3" fill="${p.lite}"/>`)
        .join(''),
    )
    .join('');
  const line = (i: number) => {
    const y = 54 + i * 20;
    return `<rect x="14" y="${y}" width="18" height="12" rx="3" fill="${p.lite}"/>
   <rect x="38" y="${y + 1.5}" width="${[44, 36, 40][i]}" height="5" rx="2.5" fill="${p.lite}"/>
   <rect x="38" y="${y + 9}" width="${[26, 30, 22][i]}" height="3.5" rx="1.75" fill="${p.lite}"/>
   <rect x="${126 - [22, 18, 20][i]}" y="${y + 3}" width="${[22, 18, 20][i]}" height="6" rx="3" fill="${p.ink}"/>`;
  };
  return `
 <!-- the dates you picked -->
 <g transform="translate(16 50)">
  <rect width="86" height="80" rx="12" fill="${p.card}" ${S}/>
  <path d="M0 12 Q0 0 12 0 L74 0 Q86 0 86 12 L86 18 L0 18 Z" fill="${p.ink}"/>
  <circle cx="22" cy="0" r="4.5" fill="${p.card}" ${stroke(p, 2)}/><circle cx="64" cy="0" r="4.5" fill="${p.card}" ${stroke(p, 2)}/>
  ${cells}
  <rect x="${10 + 17}" y="43" width="${2 * 17 + 13}" height="10" rx="4" fill="${p.acc}"/>
 </g>
 <path d="M106 90 H124" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M119 84 L126 90 L119 96" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- the quote, every free car priced -->
 <g transform="translate(132 18)">
  <rect width="140" height="152" rx="12" fill="${p.card}" ${S}/>
  ${txt(14, 26, 'Quote', 13, 800, p.ink)}
  <rect x="14" y="34" width="52" height="4" rx="2" fill="${p.lite}"/>
  <path d="M14 46 H126" stroke="${p.lite}" stroke-width="1.5"/>
  ${[0, 1, 2].map(line).join('')}
  <path d="M14 118 H126" stroke="${p.lite}" stroke-width="1.5"/>
  ${txt(14, 138, 'Total', 10, 700, p.mut)}
  <rect x="80" y="127" width="46" height="15" rx="7.5" fill="${p.acc}"/>${txt(103, 138, '$', 11, 800, p.onAcc, 'middle')}
 </g>
 <!-- sent to the customer -->
 <path d="M276 76 C 288 58, 292 52, 300 48" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 <g transform="translate(302 30)">
  <path d="M0 16 L34 0 L24 32 L15 21 Z" fill="${p.card}" ${S}/>
  <path d="M34 0 L15 21 L14 30" fill="none" stroke="${p.ink}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
 </g>
 <path d="M320 70 C 322 84, 324 92, 326 102" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 ${avatar(326, 128, 22, p)}
 ${ground(190, 176, 160, dark)}`;
}

/** Quotes: the dates you picked become a priced quote that flies off to the customer. */
export const QuotesEmptyArt = makeEmptyArt(quotesArt, '0 12 368 174');
