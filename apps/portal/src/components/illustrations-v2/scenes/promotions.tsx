'use client';

/**
 * Promotions: your booking site showing offer cards (picture, title, a code
 * chip), a discount tag hanging off the window and the dates the offer runs.
 * The number on the tag is illustrative. No car.
 *
 * Illustration guide §4a. Static art from the scene kit only; nothing
 * user-supplied is interpolated.
 */
import { ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

export function promotionsArt(dark: boolean): string {const p=pal(dark),S=stroke(p);
 const card=(x,op)=>`<g transform="translate(${x} 30)" opacity="${op}"><rect width="86" height="96" rx="9" fill="${p.card}" stroke="${p.lite}" stroke-width="1.6"/>
   <rect x="6" y="6" width="74" height="40" rx="6" fill="${p.lite}"/><path d="M14 40 l14 -14 l10 9 l8 -6 l14 11" fill="none" stroke="${p.mut}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="62" cy="18" r="4" fill="${p.mut}"/>
   <rect x="8" y="54" width="52" height="6" rx="3" fill="${p.ink}"/><rect x="8" y="66" width="66" height="4" rx="2" fill="${p.lite}"/>
   <rect x="8" y="78" width="40" height="12" rx="4" fill="none" stroke="${p.acc}" stroke-width="1.4" stroke-dasharray="3 3"/><rect x="14" y="82.5" width="28" height="3" rx="1.5" fill="${p.acc}" opacity=".7"/></g>`;
 return `
 <g transform="translate(78 20)">
  <rect width="206" height="138" rx="14" fill="${p.card}" ${S}/>
  <path d="M0 14 Q0 0 14 0 L192 0 Q206 0 206 14 L206 20 L0 20 Z" fill="${p.soft}"/>
  <path d="M0 20 H206" stroke="${p.ink}" stroke-width="2.2"/>
  <circle cx="13" cy="10" r="3" fill="${p.ink}"/><circle cx="23" cy="10" r="3" fill="${p.mut}"/><circle cx="33" cy="10" r="3" fill="${p.mut}"/>
  <rect x="62" y="5" width="96" height="10" rx="5" fill="${p.card}" stroke="${p.lite}" stroke-width="1.2"/>
  ${card(12,1)}${card(108,.55)}
 </g>
 <g transform="translate(22 50) rotate(-12)">
  <path d="M0 12 Q0 0 12 0 L56 0 L76 20 L56 40 L12 40 Q0 40 0 28 Z" fill="${p.acc}" stroke="${p.ink}" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="60" cy="20" r="3.5" fill="${p.card}"/>
  ${txt(28,26.5,'20%',16,800,p.onAcc,'middle')}
 </g>
 <g transform="translate(282 96)">
  <rect width="80" height="62" rx="10" fill="${p.card}" ${S}/>
  <path d="M0 10 Q0 0 10 0 L70 0 Q80 0 80 10 L80 16 L0 16 Z" fill="${p.ink}"/>
  ${[0,1].map(r=>[0,1,2,3,4].map(c=>`<rect x="${9+c*13}" y="${24+r*16}" width="10" height="10" rx="3" fill="${p.lite}"/>`).join('')).join('')}
  <rect x="${9+13}" y="24" width="${3*13+10}" height="10" rx="4" fill="${p.acc}"/>
 </g>
 ${ground(186,166,160,dark)}`;}

export const PromotionsEmptyArt = makeEmptyArt(promotionsArt, '0 10 368 162');
