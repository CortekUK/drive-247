'use client';

/**
 * Reminders: the one coming up (an open checkbox, its title and a 9:00 time
 * pill) in front of one already ticked off, beside a clock set to nine with an
 * indigo bell on its shoulder. No car.
 *
 * Built only from the scene kit (ILLUSTRATION_GUIDE.md §4a): static
 * markup from constants, nothing user-supplied is interpolated.
 */
import { ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function remindersArt(dark: boolean): string {const p=pal(dark),S=stroke(p);const onAcc=p.onAcc;
 const clock=(cx: number, cy: number, r: number)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.card}" ${S}/>`+
  [0,90,180,270].map((a: number)=>{const t=a*Math.PI/180;return `<path d="M${(cx+Math.sin(t)*(r-6)).toFixed(1)} ${(cy-Math.cos(t)*(r-6)).toFixed(1)} L${(cx+Math.sin(t)*(r-12)).toFixed(1)} ${(cy-Math.cos(t)*(r-12)).toFixed(1)}" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>`;}).join('')+
  [30,60,120,150,210,240,300,330].map((a: number)=>{const t=a*Math.PI/180;return `<circle cx="${(cx+Math.sin(t)*(r-8)).toFixed(1)}" cy="${(cy-Math.cos(t)*(r-8)).toFixed(1)}" r="1.4" fill="${p.mut}"/>`;}).join('')+
  `<path d="M${cx} ${cy} L${cx-20} ${cy}" stroke="${p.ink}" stroke-width="3.2" stroke-linecap="round"/><path d="M${cx} ${cy} L${cx} ${cy-28}" stroke="${p.acc}" stroke-width="2.6" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="4" fill="${p.ink}"/>`;
 const bell=(x: number, y: number)=>`<circle cx="${x}" cy="${y}" r="17" fill="${p.acc}"/><path d="M${x-7.5} ${y+5} Q${x-7} ${y+3} ${x-7} ${y-1} Q${x-7} ${y-8} ${x} ${y-8.5} Q${x+7} ${y-8} ${x+7} ${y-1} Q${x+7} ${y+3} ${x+7.5} ${y+5} Z" fill="${onAcc}"/><path d="M${x-2.5} ${y+7.5} Q${x} ${y+10.5} ${x+2.5} ${y+7.5}" fill="none" stroke="${onAcc}" stroke-width="1.8" stroke-linecap="round"/><circle cx="${x}" cy="${y-9.5}" r="1.6" fill="${onAcc}"/>`;
 return `
 <!-- one already done -->
 <g opacity=".75"><rect x="50" y="30" width="166" height="46" rx="12" fill="${p.card}" ${S}/>
  <rect x="64" y="45" width="16" height="16" rx="5" fill="${p.acc}"/>${tick(67.5,53,onAcc,2)}
  <rect x="92" y="46" width="84" height="6" rx="3" fill="${p.mut}"/><path d="M90 49 H180" stroke="${p.mut}" stroke-width="1.6"/><rect x="92" y="58" width="52" height="5" rx="2.5" fill="${p.lite}"/></g>
 <!-- the one coming up -->
 <g><rect x="30" y="88" width="200" height="70" rx="14" fill="${p.card}" ${S}/>
  <rect x="46" y="104" width="18" height="18" rx="5" fill="${p.card}" stroke="${p.ink}" stroke-width="2"/>
  <rect x="78" y="104" width="104" height="7" rx="3.5" fill="${p.ink}"/><rect x="78" y="118" width="72" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="78" y="131" width="64" height="16" rx="8" fill="${p.soft}"/>
  <circle cx="89" cy="139" r="4.6" fill="none" stroke="${p.acc}" stroke-width="1.5"/><path d="M89 136.6 V139 H91" fill="none" stroke="${p.acc}" stroke-width="1.4" stroke-linecap="round"/>
  ${txt(98,142.6,'9:00',9.5,700,p.acc)}</g>
 ${clock(292,100,46)}
 ${bell(330,62)}
 ${ground(190,172,150,dark)}`;}

/** Cropped to the art, so no empty band sits under the shadow. */
export const RemindersEmptyArt = makeEmptyArt(remindersArt, '20 18 348 162');
