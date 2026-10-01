'use client';

/**
 * Vehicle owners: an owner's card linked to the car they own, with a share
 * dial on the link (the split is illustrative — commission is set per owner).
 * The car is here because the page is about whose car it is.
 *
 * Illustration guide §4a. Static art from the scene kit only; nothing
 * user-supplied is interpolated.
 */
import { avatar, ground, makeEmptyArt, pal, stroke } from '../scene-kit';
import { carSvg, MONO_PAINT } from '../car-art';

export function vehicleOwnersArt(dark: boolean): string {const p=pal(dark),S=stroke(p);
 const R=11,C=2*Math.PI*R,share=0.7;
 return `
 <g transform="translate(14 34)">
  <rect width="96" height="104" rx="14" fill="${p.card}" ${S}/>
  ${avatar(48,36,20,p,'#b77e5f','#2a1d1a')}
  <rect x="20" y="66" width="56" height="6" rx="3" fill="${p.ink}"/><rect x="26" y="80" width="44" height="5" rx="2.5" fill="${p.lite}"/>
 </g>
 <path d="M112 90 C 130 90, 150 90, 176 96" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <g transform="translate(142 90)"><circle r="19" fill="${p.card}" ${stroke(p,2)}/>
  <circle r="${R}" fill="none" stroke="${p.lite}" stroke-width="6"/>
  <circle r="${R}" fill="none" stroke="${p.acc}" stroke-width="6" stroke-dasharray="${(C*share).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90)"/></g>
 <g transform="translate(168 58) scale(.58)">${carSvg(MONO_PAINT, dark ? 'voDark' : 'voLight')}</g>
 ${ground(62,146,52,dark)}`;}

export const VehicleOwnersEmptyArt = makeEmptyArt(vehicleOwnersArt, '0 22 368 132');
