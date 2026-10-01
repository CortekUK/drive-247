'use client';

/**
 * Referrals: your shop sends a link across to another rental operator's shop,
 * and both carry a discount tag — they save, you save. No amounts: rewards are
 * configured per operator.
 *
 * Illustration guide §4a. Static art from the scene kit only; nothing
 * user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

export function referralsArt(dark: boolean): string {const p=pal(dark),S=stroke(p);
 const shop=(x,awn,skin,hair)=>{let sc='';for(let i=0;i<5;i++){sc+=`<path d="M${i*20} 26 q10 10 20 0" fill="${i%2?p.card:awn}" stroke="${p.ink}" stroke-width="1.8" stroke-linejoin="round"/>`;}
  return `<g transform="translate(${x} 40)"><rect width="100" height="104" rx="12" fill="${p.card}" ${S}/>
   <path d="M0 12 Q0 0 12 0 L88 0 Q100 0 100 12 L100 26 L0 26 Z" fill="${awn}" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/>${sc}
   ${[1,3].map(i=>`<rect x="${i*20}" y="1.1" width="20" height="24.9" fill="${p.card}"/>`).join('')}
   <path d="M0 26 H100" stroke="${p.ink}" stroke-width="2.2"/>
   <path d="M20 1.1 V26 M40 1.1 V26 M60 1.1 V26 M80 1.1 V26" stroke="${p.ink}" stroke-width="1.4"/>
   ${avatar(50,62,17,p,skin,hair)}
   <rect x="26" y="86" width="48" height="6" rx="3" fill="${p.ink}"/></g>`;};
 const tag=(x,y,r)=>`<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 8 Q0 0 8 0 L30 0 L42 12 L30 24 L8 24 Q0 24 0 16 Z" fill="${p.acc}" stroke="${p.ink}" stroke-width="1.8" stroke-linejoin="round"/><circle cx="33" cy="12" r="2.5" fill="${p.card}"/>${txt(15,16.5,'%',12,800,p.onAcc,'middle')}</g>`;
 return `
 <path d="M120 70 C 150 22, 218 22, 248 70" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M240 60 L248 70 L236 72" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <g transform="translate(184 36)"><circle r="17" fill="${p.card}" ${stroke(p,2)}/>
  <g transform="rotate(-40)" fill="none" stroke="${p.acc}" stroke-width="2.4"><rect x="-11" y="-4.5" width="12" height="9" rx="4.5"/><rect x="-1" y="-4.5" width="12" height="9" rx="4.5"/></g></g>
 ${shop(20,p.acc,'#d9a88a','#1f2040')}
 ${shop(248,p.lite,'#b77e5f','#2a1d1a')}
 ${tag(100,132,-10)}${tag(328,130,-10)}
 ${ground(184,160,164,dark)}`;}

export const ReferralsEmptyArt = makeEmptyArt(referralsArt, '0 14 368 152');
