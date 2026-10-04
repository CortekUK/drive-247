'use client';

/**
 * The two "Before you go" choices on v2 Billing's cancel flow, as square spot
 * pictures (ILLUSTRATION_GUIDE.md: ink lines, white cards, the
 * accent only where it matters, one idea each, both themes). No car.
 *
 *  - Help:  a video-call window with a specialist on a headset, and a small
 *           calendar card beside it with the booked slot ticked.
 *  - Price: a price tag, its old figure struck through, with a $ badge in the
 *           accent and a soft downward arrow (no %, so the tile doesn't give
 *           the offer away before it's clicked).
 *
 * Built only from the scene kit: static markup from constants, nothing
 * user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function helpArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const agent = (x: number, y: number, r: number) =>
    avatar(x, y, r, p, '#d9a88a', '#1f2040') +
    `<g transform="translate(${x} ${y})" fill="none" stroke="${p.ink}" stroke-linecap="round">
      <path d="M${-r * 0.5} ${-r * 0.12} Q${-r * 0.52} ${-r * 0.8} 0 ${-r * 0.8} Q${r * 0.52} ${-r * 0.8} ${r * 0.5} ${-r * 0.12}" stroke-width="2"/>
      <rect x="${-r * 0.6}" y="${-r * 0.28}" width="${r * 0.2}" height="${r * 0.34}" rx="${r * 0.08}" fill="${p.ink}" stroke="none"/>
      <rect x="${r * 0.4}" y="${-r * 0.28}" width="${r * 0.2}" height="${r * 0.34}" rx="${r * 0.08}" fill="${p.ink}" stroke="none"/>
      <path d="M${r * 0.5} ${r * 0.06} Q${r * 0.48} ${r * 0.3} ${r * 0.16} ${r * 0.3}" stroke-width="1.6"/></g>`;
  return `
  <!-- the call -->
  <rect x="22" y="22" width="120" height="92" rx="12" fill="${p.card}" ${S}/>
  <path d="M22 40 H142" stroke="${p.lite}" stroke-width="2"/>
  <circle cx="34" cy="31" r="2.6" fill="${p.lite}"/><circle cx="43" cy="31" r="2.6" fill="${p.lite}"/><circle cx="52" cy="31" r="2.6" fill="${p.lite}"/>
  ${agent(82, 74, 26)}
  <!-- you, small, in the corner -->
  <rect x="106" y="88" width="28" height="20" rx="5" fill="${p.bg}" stroke="${p.ink}" stroke-width="1.6"/>
  <circle cx="120" cy="96" r="4" fill="#b77e5f"/><path d="M113 106 Q120 99 127 106" fill="${p.mut}"/>
  <!-- the booked slot -->
  <g><rect x="132" y="66" width="48" height="52" rx="9" fill="${p.card}" ${S}/>
   <path d="M132 80 H180" stroke="${p.ink}" stroke-width="2"/>
   <rect x="132" y="66" width="48" height="14" rx="9" fill="${p.acc}"/><rect x="132" y="73" width="48" height="7" fill="${p.acc}"/>
   <path d="M144 62 V70 M168 62 V70" stroke="${p.ink}" stroke-width="2.2" stroke-linecap="round"/>
   <circle cx="156" cy="99" r="11" fill="${p.soft}"/>${tick(150, 98.5, p.acc, 2.6)}</g>
  ${ground(100, 132, 82, dark)}`;
}

function priceArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <!-- the tag -->
  <g transform="rotate(-8 92 74)">
   <path d="M44 34 H124 Q134 34 140 42 L162 70 Q166 76 162 82 L140 110 Q134 118 124 118 H44 Q32 118 32 106 V46 Q32 34 44 34 Z" fill="${p.card}" ${S}/>
   <circle cx="146" cy="76" r="5" fill="${p.bg}" stroke="${p.ink}" stroke-width="2"/>
   <path d="M151 76 Q176 70 184 52" fill="none" stroke="${p.mut}" stroke-width="1.8" stroke-linecap="round"/>
   <!-- the old figure, struck through, and the new one -->
   <rect x="48" y="52" width="58" height="9" rx="4.5" fill="${p.lite}"/>
   <path d="M44 57 L110 57" stroke="${p.mut}" stroke-width="2.4" stroke-linecap="round"/>
   <rect x="48" y="74" width="72" height="14" rx="7" fill="${p.ink}"/>
   <rect x="48" y="98" width="40" height="6" rx="3" fill="${p.lite}"/>
  </g>
  <!-- the saving -->
  <circle cx="150" cy="114" r="20" fill="${p.acc}"/>
  ${txt(150, 121.5, '$', 21, 800, p.onAcc, 'middle')}
  <path d="M182 92 V114" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M176 108 L182 115 L188 108" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  ${ground(104, 142, 80, dark)}`;
}

/** Call booked: a calendar, the meeting slot marked, a clock, a video badge. */
function callBookedArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g><rect x="40" y="34" width="124" height="96" rx="12" fill="${p.card}" ${S}/>
   <rect x="40" y="34" width="124" height="20" rx="12" fill="${p.ink}"/><rect x="40" y="44" width="124" height="10" fill="${p.ink}"/>
   <path d="M66 28 V40 M138 28 V40" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
   ${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => `<rect x="${52 + c * 22}" y="${64 + r * 16}" width="14" height="9" rx="3" fill="${p.lite}"/>`).join("")).join("")}
   <!-- the meeting -->
   <rect x="94" y="78" width="58" height="13" rx="4" fill="${p.acc}"/>
   <rect x="100" y="82.5" width="30" height="4" rx="2" fill="${p.onAcc}" opacity=".9"/></g>
  <!-- within 12 hours -->
  <g><circle cx="44" cy="120" r="20" fill="${p.card}" ${S}/>
   <path d="M44 108 V120 L52 125" fill="none" stroke="${p.acc}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>
  <!-- online -->
  <g><rect x="146" y="102" width="34" height="26" rx="7" fill="${p.acc}"/>
   <rect x="153" y="110" width="13" height="10" rx="2.5" fill="${p.onAcc}"/><path d="M167 113 L174 109 V121 L167 117 Z" fill="${p.onAcc}"/></g>
  ${ground(104, 146, 84, dark)}`;
}

/** Discount: an invoice with the 10% line ticked in the accent. */
function discountArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g><path d="M56 26 H148 Q156 26 156 34 V132 L146 126 L136 132 L126 126 L116 132 L106 126 L96 132 L86 126 L76 132 L66 126 L56 132 Q48 132 48 124 V34 Q48 26 56 26 Z" fill="${p.card}" ${S}/>
   <rect x="62" y="40" width="44" height="8" rx="4" fill="${p.ink}"/>
   <rect x="62" y="60" width="54" height="5" rx="2.5" fill="${p.lite}"/><rect x="124" y="60" width="20" height="5" rx="2.5" fill="${p.lite}"/>
   <rect x="62" y="72" width="44" height="5" rx="2.5" fill="${p.lite}"/><rect x="124" y="72" width="20" height="5" rx="2.5" fill="${p.lite}"/>
   <!-- the saving -->
   <rect x="58" y="84" width="90" height="15" rx="5" fill="${p.soft}"/>
   <rect x="64" y="89" width="38" height="5" rx="2.5" fill="${p.acc}"/><rect x="122" y="89" width="20" height="5" rx="2.5" fill="${p.acc}"/>
   <path d="M62 110 H144" stroke="${p.lite}" stroke-width="2"/>
   <rect x="62" y="116" width="30" height="7" rx="3.5" fill="${p.ink}"/><rect x="118" y="116" width="26" height="7" rx="3.5" fill="${p.ink}"/></g>
  <g><circle cx="160" cy="44" r="18" fill="${p.acc}"/>${tick(153.5, 43, p.onAcc, 3)}</g>
  ${ground(102, 146, 70, dark)}`;
}

/** Cancellation received: your request on its way to a person on the team. */
function cancelReceivedArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g><rect x="22" y="44" width="92" height="74" rx="10" fill="${p.card}" ${S}/>
   <rect x="34" y="58" width="46" height="7" rx="3.5" fill="${p.ink}"/>
   <rect x="34" y="74" width="66" height="5" rx="2.5" fill="${p.lite}"/><rect x="34" y="85" width="56" height="5" rx="2.5" fill="${p.lite}"/><rect x="34" y="96" width="62" height="5" rx="2.5" fill="${p.lite}"/></g>
  <path d="M122 76 C 136 64, 148 60, 160 62" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>
  <path d="M153 56 L161 62 L153 68" fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  ${avatar(178, 78, 22, p, '#d9a88a', '#1f2040')}
  <g><circle cx="196" cy="98" r="9" fill="${p.acc}"/>${tick(191.5, 97.5, p.onAcc, 2.2)}</g>
  ${ground(110, 136, 92, dark)}`;
}

/**
 * Leaving: a face, sad to see you go (brows up, eyes closed and down, a frown,
 * a tear). Nothing else — no car, no weather, no props. Ink lines on white,
 * the accent only on the tear, one soft glow behind.
 */
function leavingArt(dark: boolean): string {
  const p = pal(dark);
  const S = `stroke="${p.ink}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
  return `
  <!-- the one glow -->
  <circle cx="104" cy="98" r="70" fill="${p.soft}"/>
  <!-- the face -->
  <circle cx="104" cy="98" r="48" fill="${p.card}" ${S}/>
  <g ${S} fill="none">
   <path d="M80 80 L94 74"/><path d="M114 74 L128 80"/>
   <path d="M80 90 Q87 96 94 90"/><path d="M114 90 Q121 96 128 90"/>
   <path d="M90 122 Q104 110 118 122"/>
  </g>
  <!-- the tear -->
  <path d="M86 98 Q81 106 86 111 Q91 106 86 98 Z" fill="${p.acc}"/>
  <path d="M86 116 Q84 121 86 124" fill="none" stroke="${p.acc}" stroke-opacity=".45" stroke-width="2" stroke-linecap="round"/>
`;
}

/** Both cropped to the art, roughly square, for the two choice tiles. */
export const RetentionHelpArt = makeEmptyArt(helpArt, '12 10 182 132');
export const RetentionPriceArt = makeEmptyArt(priceArt, '18 18 182 132');

/** The outcome pictures, for the flow's final screens. */
export const RetentionCallBookedArt = makeEmptyArt(callBookedArt, '18 22 172 132');
export const RetentionDiscountArt = makeEmptyArt(discountArt, '28 18 162 134');
export const RetentionCancelReceivedArt = makeEmptyArt(cancelReceivedArt, '12 34 204 108');

/** The cancel step's picture. */
export const RetentionLeavingArt = makeEmptyArt(leavingArt, '30 24 148 148');
