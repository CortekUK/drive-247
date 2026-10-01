'use client';

/**
 * Blocked customers: an identity card going onto an empty blocklist, and a new
 * customer passing the check beside it (shield with a tick) — nobody blocked
 * yet, all clear. No car.
 *
 * Illustration guide §4a. Static art from the scene kit only; nothing
 * user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

export function blockedArt(dark: boolean): string {const p=pal(dark),S=stroke(p);
 const ban=(x,y,r,c,w)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}"/><path d="M${x-r*0.7} ${y+r*0.7} L${x+r*0.7} ${y-r*0.7}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
 return `
 <g transform="translate(92 24)">
  <rect width="160" height="128" rx="14" fill="${p.card}" ${S}/>
  ${ban(24,23,8,p.ink,2)}${txt(40,27.5,'Blocklist',11.5,700,p.ink)}
  <path d="M14 42 H146" stroke="${p.lite}" stroke-width="1.5"/>
  ${[0,1,2].map(i=>`<rect x="14" y="${54+i*24}" width="132" height="16" rx="8" fill="none" stroke="${p.lite}" stroke-width="1.6" stroke-dasharray="4 4"/>`).join('')}
 </g>
 <g transform="translate(18 88) rotate(-8)">
  <rect width="86" height="56" rx="8" fill="${p.card}" ${S}/>
  <rect x="8" y="10" width="24" height="30" rx="4" fill="${p.soft}"/>${avatar(20,24,10,p,'#b77e5f','#2a1d1a').replace(`<circle r="10" fill="${p.soft}"/>`,'')}
  <rect x="40" y="12" width="36" height="5" rx="2.5" fill="${p.ink}"/><rect x="40" y="23" width="28" height="4" rx="2" fill="${p.lite}"/><rect x="40" y="32" width="32" height="4" rx="2" fill="${p.lite}"/>
  <rect x="8" y="45" width="44" height="4" rx="2" fill="${p.lite}"/>
  <circle cx="80" cy="2" r="12" fill="${p.acc}"/>${ban(80,2,6,p.onAcc,2)}
 </g>
 <path d="M254 88 H290" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <g transform="translate(262 72)"><path d="M10 0 L20 4 L20 14 Q20 24 10 30 Q0 24 0 14 L0 4 Z" fill="${p.card}" ${stroke(p,2)}/>${tick(4.5,15,p.acc,2.2)}</g>
 <g transform="translate(292 46)">
  <rect width="64" height="86" rx="12" fill="${p.card}" ${S}/>
  ${avatar(32,28,15,p)}
  <rect x="12" y="52" width="40" height="6" rx="3" fill="${p.ink}"/><rect x="16" y="65" width="32" height="5" rx="2.5" fill="${p.lite}"/>
 </g>
 ${ground(186,160,160,dark)}`;}

export const BlockedCustomersEmptyArt = makeEmptyArt(blockedArt, '0 10 368 160');
