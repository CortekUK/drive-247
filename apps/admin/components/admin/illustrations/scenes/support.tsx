'use client';

/**
 * Support: your ticket (a ticket stub with a question mark on it) travels to a
 * person on a headset, and their reply comes back as an indigo bubble. No car.
 *
 * Built only from the scene kit (ILLUSTRATION_GUIDE.md §4a): static
 * markup from constants, nothing user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

function supportArt(dark: boolean): string {const p=pal(dark),S=stroke(p);const onAcc=p.onAcc;
 const agent=(x: number, y: number, r: number)=>avatar(x,y,r,p,'#d9a88a','#1f2040')+
  `<g transform="translate(${x} ${y})" fill="none" stroke="${p.ink}" stroke-linecap="round"><path d="M${-r*.5} ${-r*.12} Q${-r*.52} ${-r*.8} 0 ${-r*.8} Q${r*.52} ${-r*.8} ${r*.5} ${-r*.12}" stroke-width="2"/>
   <rect x="${-r*.6}" y="${-r*.28}" width="${r*.2}" height="${r*.34}" rx="${r*.08}" fill="${p.ink}" stroke="none"/><rect x="${r*.4}" y="${-r*.28}" width="${r*.2}" height="${r*.34}" rx="${r*.08}" fill="${p.ink}" stroke="none"/>
   <path d="M${r*.5} ${r*.06} Q${r*.48} ${r*.3} ${r*.16} ${r*.3}" stroke-width="1.6"/></g>`;
 return `
 <!-- your ticket -->
 <g><path d="M38 34 H134 A8 8 0 0 0 150 34 H170 Q184 34 184 48 V124 Q184 138 170 138 H150 A8 8 0 0 0 134 138 H38 Q24 138 24 124 V48 Q24 34 38 34 Z" fill="${p.card}" ${S}/>
  <path d="M142 48 V124" stroke="${p.lite}" stroke-width="2" stroke-dasharray="4 5" stroke-linecap="round"/>
  <rect x="40" y="52" width="80" height="7" rx="3.5" fill="${p.ink}"/>
  <rect x="40" y="70" width="86" height="5" rx="2.5" fill="${p.lite}"/><rect x="40" y="82" width="72" height="5" rx="2.5" fill="${p.lite}"/><rect x="40" y="94" width="80" height="5" rx="2.5" fill="${p.lite}"/>
  <circle cx="45" cy="118" r="4" fill="${p.acc}"/><rect x="54" y="115.5" width="36" height="5" rx="2.5" fill="${p.mut}"/>
  <circle cx="163" cy="86" r="12" fill="${p.soft}"/>${txt(163,91.5,'?',15,800,p.acc,'middle')}</g>
 <!-- it reaches a person -->
 <path d="M192 60 C 214 44, 232 40, 250 44" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M243 38 L251 44 L243 50" fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 ${agent(284,50,26)}
 <!-- and the reply comes back -->
 <g><path d="M210 92 H276 Q282 84 290 80 Q290 88 292 92 H330 Q344 92 344 106 V124 Q344 138 330 138 H210 Q196 138 196 124 V106 Q196 92 210 92 Z" fill="${p.acc}"/>
  <rect x="212" y="105" width="108" height="6" rx="3" fill="${onAcc}" opacity=".95"/><rect x="212" y="118" width="80" height="5" rx="2.5" fill="${onAcc}" opacity=".6"/></g>
 ${ground(184,154,150,dark)}`;}

/** Cropped to the art, so no empty band sits under the shadow. */
export const SupportEmptyArt = makeEmptyArt(supportArt, '14 20 346 142');
