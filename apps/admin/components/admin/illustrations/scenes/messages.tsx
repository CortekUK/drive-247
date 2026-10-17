'use client';

/**
 * Messages: one thread between a customer and you. A text (phone mark) and an
 * email (envelope mark) arrive from the customer on the left, and your reply,
 * in indigo with its read ticks, goes back from the right. No car.
 *
 * Built only from the scene kit (ILLUSTRATION_GUIDE.md §4a): static
 * markup from constants, nothing user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke } from '../scene-kit';

function messagesArt(dark: boolean): string {const p=pal(dark),S=stroke(p);const onAcc=p.onAcc;
 // mini channel marks
 const phone=(x: number, y: number)=>`<rect x="${x}" y="${y}" width="11" height="17" rx="2.5" fill="none" stroke="${p.acc}" stroke-width="1.8"/><path d="M${x+4} ${y+14} h3" stroke="${p.acc}" stroke-width="1.6" stroke-linecap="round"/>`;
 const mail=(x: number, y: number)=>`<rect x="${x}" y="${y}" width="18" height="13" rx="2.5" fill="none" stroke="${p.acc}" stroke-width="1.8"/><path d="M${x+1.5} ${y+2} l7.5 6 l7.5 -6" fill="none" stroke="${p.acc}" stroke-width="1.6" stroke-linejoin="round"/>`;
 return `
 <!-- customer: a text -->
 <g><rect x="80" y="26" width="150" height="42" rx="14" fill="${p.card}" ${S}/>${phone(95,38.5)}
  <rect x="116" y="39" width="92" height="6" rx="3" fill="${p.ink}"/><rect x="116" y="51" width="62" height="5" rx="2.5" fill="${p.lite}"/></g>
 <!-- you: the reply -->
 <g><path d="M164 78 H290 Q304 78 304 92 V106 Q304 114 312 120 Q298 122 290 120 H164 Q150 120 150 106 V92 Q150 78 164 78 Z" fill="${p.acc}"/>
  <rect x="166" y="90" width="104" height="6" rx="3" fill="${onAcc}" opacity=".95"/><rect x="166" y="102" width="70" height="5" rx="2.5" fill="${onAcc}" opacity=".6"/>
  <path d="M272 106 l3.5 3.5 l6 -7 M279 106 l3.5 3.5 l6 -7" fill="none" stroke="${onAcc}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>
 <!-- customer: an email -->
 <g><path d="M94 130 H196 Q210 130 210 144 V150 Q210 164 196 164 H94 Q86 164 78 170 Q80 160 80 150 V144 Q80 130 94 130 Z" fill="${p.card}" ${S}/>${mail(94,140.5)}
  <rect x="122" y="141" width="70" height="6" rx="3" fill="${p.ink}"/><rect x="122" y="152" width="46" height="5" rx="2.5" fill="${p.lite}"/></g>
 ${avatar(46,154,22,p,'#b77e5f','#1f2040')}
 ${avatar(338,110,22,p,'#d9a88a','#1f2040')}
 ${ground(190,184,150,dark)}`;}

/** Cropped to the art, so no empty band sits under the shadow. */
export const MessagesEmptyArt = makeEmptyArt(messagesArt, '20 14 348 180');
