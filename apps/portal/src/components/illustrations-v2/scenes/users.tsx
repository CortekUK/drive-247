'use client';

/**
 * Team: the owner's card at the top, two team members with their roles
 * (Manager, Ops) joining it, and an empty dashed seat with a + for the next one.
 *
 * Illustration guide §4a. Static art from the scene kit only; nothing
 * user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

export function usersArt(dark: boolean): string {const p=pal(dark),S=stroke(p);
 const pill=(x,y,w,t,strong)=>`<rect x="${x}" y="${y}" width="${w}" height="16" rx="8" fill="${strong?p.acc:p.soft}"/>${txt(x+w/2,y+11.2,t,8.5,700,strong?p.onAcc:p.acc,'middle')}`;
 const member=(x,y,skin,hair,role,w)=>`<g transform="translate(${x} ${y})"><rect width="104" height="58" rx="12" fill="${p.card}" ${S}/>${avatar(26,29,15,p,skin,hair)}<rect x="48" y="16" width="44" height="6" rx="3" fill="${p.ink}"/>${pill(48,30,w,role,false)}</g>`;
 return `
 <path d="M130 58 C 96 58, 76 66, 70 92" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 <path d="M238 58 C 272 58, 292 66, 298 92" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 <path d="M184 110 V118" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 <g transform="translate(130 16)">
  <rect width="108" height="94" rx="14" fill="${p.card}" ${S}/>
  ${avatar(54,30,19,p)}
  <rect x="26" y="56" width="56" height="6" rx="3" fill="${p.ink}"/>
  ${pill(28,68,52,'Owner',true)}
 </g>
 ${member(18,92,'#b77e5f','#2a1d1a','Manager',50)}
 ${member(246,92,'#e0b896','#5a3a22','Ops',32)}
 <g transform="translate(160 118)">
  <rect width="48" height="40" rx="12" fill="${dark?'rgba(139,140,240,.08)':'rgba(91,91,214,.05)'}" stroke="${p.acc}" stroke-width="2" stroke-dasharray="5 5"/>
  <path d="M24 13 v14 M17 20 h14" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round"/>
 </g>
 ${ground(184,164,160,dark)}`;}

export const UsersEmptyArt = makeEmptyArt(usersArt, '0 8 368 166');
