'use client';

/**
 * Enquiries empty-state picture (ILLUSTRATION_GUIDE.md §4a).
 *
 * The story: a customer asks a question on your site, and it drops into your
 * inbox as a new, unread message at the top. No car.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

function enquiriesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const row = (i: number) => {
    const y = 38 + i * 30;
    const first = i === 0;
    return `<g transform="translate(10 ${y})">
   ${first ? `<rect width="160" height="24" rx="8" fill="${p.soft}"/>` : ''}
   <circle cx="8" cy="12" r="3" fill="${first ? p.acc : 'none'}"/>
   ${first ? avatar(24, 12, 8.5, { ...p, soft: p.card }) : `<circle cx="24" cy="12" r="8.5" fill="${p.lite}"/>`}
   <rect x="40" y="6" width="${[64, 56, 60][i]}" height="5" rx="2.5" fill="${first ? p.ink : p.lite}"/>
   <rect x="40" y="15" width="${[48, 40, 44][i]}" height="4" rx="2" fill="${p.lite}"/>
   <rect x="134" y="7" width="18" height="4" rx="2" fill="${first ? p.acc : p.lite}" opacity="${first ? 0.8 : 1}"/>
  </g>`;
  };
  return `
 <!-- a question, asked on your site -->
 <g transform="translate(18 40)">
  <path d="M14 0 H96 Q110 0 110 14 V54 Q110 68 96 68 H34 L18 82 L20 68 H14 Q0 68 0 54 V14 Q0 0 14 0 Z" fill="${p.card}" ${S}/>
  <circle cx="26" cy="34" r="13" fill="${p.acc}"/>${txt(26, 39.5, '?', 16, 800, p.onAcc, 'middle')}
  <rect x="48" y="22" width="48" height="6" rx="3" fill="${p.ink}"/><rect x="48" y="33" width="40" height="5" rx="2.5" fill="${p.lite}"/><rect x="48" y="43" width="44" height="5" rx="2.5" fill="${p.lite}"/>
 </g>
 ${avatar(32, 146, 15, p)}
 <path d="M134 74 C 146 74, 148 62, 164 62" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M159 56 L166 62 L159 68" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- your inbox, newest on top -->
 <g transform="translate(174 24)">
  <rect width="180" height="136" rx="14" fill="${p.card}" ${S}/>
  <path d="M0 14 Q0 0 14 0 L166 0 Q180 0 180 14 L180 26 L0 26 Z" fill="${p.ink}"/>
  ${txt(14, 17.5, 'Inbox', 10, 700, dark ? 'hsl(var(--background))' : '#ffffff')}
  <rect x="146" y="7" width="22" height="12" rx="6" fill="${p.acc}"/>${txt(157, 16.5, '1', 9, 700, p.onAcc, 'middle')}
  ${[0, 1, 2].map(row).join('')}
 </g>
 ${ground(188, 170, 160, dark)}`;
}

/** Enquiries: a question from your site drops into your inbox as a new message. */
export const EnquiriesEmptyArt = makeEmptyArt(enquiriesArt, '0 14 372 166');
