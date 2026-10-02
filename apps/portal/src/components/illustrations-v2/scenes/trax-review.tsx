'use client';

/**
 * Insights → Trax summary, before the first review (docs/brand/illustration-
 * guide.md §4a style).
 *
 * The story: Trax reads the business. A review sheet — a verdict line, a small
 * bar chart, three ticked findings — under a magnifying glass, with the
 * sparkle that is Trax over it. The fleet's car waits beside it; a coin and a
 * booking card drift in, the things being read. Ink lines, white cards, the
 * tenant's accent only where it matters. Static scene-kit markup only.
 */
import { carSvg, MONO_PAINT } from '../car-art';
import { ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function traxReviewArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);

  const bars = [22, 30, 26, 40, 34, 52]
    .map((h, i) => `<rect x="${22 + i * 14}" y="${96 - h}" width="9" height="${h}" rx="2.5" fill="${i === 5 ? p.acc : p.lite}"/>`)
    .join('');

  const findings = [0, 1, 2]
    .map((i) => {
      const y = 116 + i * 16;
      return `<circle cx="27" cy="${y}" r="6" fill="${p.soft}"/>${tick(23, y, p.acc, 1.8)}` + `<rect x="40" y="${y - 3}" width="${[70, 56, 64][i]}" height="5.5" rx="2.75" fill="${p.lite}"/>`;
    })
    .join('');

  // Trax's four-point sparkle.
  const sparkle = (cx: number, cy: number, r: number, fill: string) =>
    `<path d="M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z" fill="${fill}"/>`;

  return `
 <!-- the car, parked beside the review -->
 <g transform="translate(6 120) scale(.36)">${carSvg(MONO_PAINT, dark ? 'trxd' : 'trxl')}</g>

 <!-- a booking card and a coin, drifting in to be read -->
 <g transform="translate(36 34) rotate(-8 24 18)">
  <rect width="54" height="40" rx="9" fill="${p.card}" ${S}/>
  <path d="M0 10 Q0 0 10 0 L44 0 Q54 0 54 10 L54 13 L0 13 Z" fill="${p.ink}"/>
  <rect x="9" y="21" width="10" height="9" rx="2.5" fill="${p.acc}"/>
  <rect x="23" y="21" width="10" height="9" rx="2.5" fill="${p.lite}"/>
  <rect x="37" y="21" width="10" height="9" rx="2.5" fill="${p.lite}"/>
 </g>
 <path d="M96 58 Q112 62 124 74" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <g transform="translate(92 96)">
  <circle r="13" fill="${p.acc}" stroke="${p.ink}" stroke-width="2"/>
  ${txt(0, 4.5, '$', 13, 800, p.onAcc, 'middle')}
 </g>
 <path d="M106 96 Q118 98 128 104" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>

 <!-- the review sheet -->
 <g transform="translate(132 22)">
  <rect width="134" height="168" rx="14" fill="${p.card}" ${S}/>
  ${txt(16, 26, 'Your review', 11, 800, p.ink)}
  <rect x="16" y="34" width="86" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="16" y="42" width="64" height="5" rx="2.5" fill="${p.lite}"/>
  <path d="M16 97 H118" stroke="${p.ink}" stroke-width="1.4" stroke-linecap="round"/>
  ${bars}
  ${findings}
 </g>

 <!-- the magnifying glass, reading the chart -->
 <g transform="translate(228 70)">
  <circle cx="22" cy="22" r="22" fill="${p.soft}" stroke="${p.ink}" stroke-width="2.6"/>
  <path d="M8 14 Q14 6 24 6" fill="none" stroke="${p.card}" stroke-width="3" stroke-linecap="round" opacity=".9"/>
  <path d="M38 38 L56 56" stroke="${p.ink}" stroke-width="7" stroke-linecap="round"/>
  <path d="M38 38 L56 56" stroke="${p.acc}" stroke-width="3" stroke-linecap="round"/>
 </g>

 <!-- Trax -->
 ${sparkle(282, 34, 15, p.acc)}
 ${sparkle(306, 58, 7, p.acc)}
 ${sparkle(258, 20, 5, p.ink)}

 ${ground(176, 196, 150, dark)}`;
}

export const TraxReviewArt = makeEmptyArt(traxReviewArt, '0 10 330 196');
