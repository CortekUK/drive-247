'use client';

/**
 * Owner payouts: rental revenue ($) splits in two — the operator's commission
 * (grey) and the owner's share (indigo), whose card carries the paid tick. No car.
 *
 * Illustration guide §4a. Static art from the scene kit only; nothing
 * user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

export function ownerPayoutsArt(dark: boolean): string {const p=pal(dark),S=stroke(p);
 const dest=(y,skin,hair,extra)=>`<g transform="translate(232 ${y})"><rect width="112" height="58" rx="12" fill="${p.card}" ${S}/>${avatar(28,29,16,p,skin,hair)}<rect x="52" y="18" width="46" height="6" rx="3" fill="${p.ink}"/><rect x="52" y="32" width="34" height="5" rx="2.5" fill="${p.lite}"/>${extra}</g>`;
 return `
 <g transform="translate(24 44)">
  <rect width="92" height="86" rx="14" fill="${p.card}" ${S}/>
  <circle cx="46" cy="32" r="18" fill="${p.soft}"/>${txt(46,40,'$',22,800,p.ink,'middle')}
  <rect x="18" y="60" width="56" height="6" rx="3" fill="${p.ink}"/><rect x="26" y="72" width="40" height="4" rx="2" fill="${p.lite}"/>
 </g>
 <path d="M118 87 H160" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
 <path d="M160 87 C 190 87, 196 52, 226 50" fill="none" stroke="${p.mut}" stroke-width="2.4" stroke-linecap="round"/>
 <path d="M160 87 C 190 87, 196 124, 226 126" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
 <path d="M220 44 L227 50 L220 56" fill="none" stroke="${p.mut}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
 <path d="M220 120 L227 126 L220 132" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
 <circle cx="160" cy="87" r="5" fill="${p.card}" stroke="${p.acc}" stroke-width="2.4"/>
 ${dest(21,'#d9a88a','#1f2040','')}
 ${dest(97,'#b77e5f','#2a1d1a',`<circle cx="104" cy="4" r="11" fill="${p.acc}"/>${tick(98.5,4.5,p.onAcc,2.2)}`)}
 ${ground(184,166,164,dark)}`;}

export const OwnerPayoutsEmptyArt = makeEmptyArt(ownerPayoutsArt, '0 12 368 160');
