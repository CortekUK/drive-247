'use client';

/**
 * The quick tour's first card: the three things a first rental needs
 * (ILLUSTRATION_GUIDE.md §4a). One idea per picture, same frame for all three
 * so the tiles line up: thin ink outlines, white cards, the theme colour only
 * where it matters, a soft ground shadow.
 *
 *   a car       the approved car, its cover photo behind it, a price tag on it
 *   a customer  a driving licence, and the face check beside it
 *   Stripe      a card payment going straight into your own account
 *
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { carSvg, MONO_PAINT } from '../car-art';
import { avatar, ground, makeEmptyArt, pal, sparkle, stroke, tick, txt } from '../scene-kit';

const VIEWBOX = '0 6 240 144';

function carArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p, 2);
  return `
    ${ground(132, 136, 92, dark)}
    <g transform="translate(26 22) rotate(-7)">
      <rect width="96" height="68" rx="10" fill="${p.card}" ${S}/>
      <rect x="8" y="8" width="80" height="52" rx="6" fill="${p.soft}"/>
      <circle cx="68" cy="22" r="7" fill="${p.acc}" opacity=".55"/>
      <path d="M8 54 L34 30 L52 46 L62 38 L88 58 L88 60 L8 60 Z" fill="${p.acc}" opacity=".35"/>
    </g>
    <g transform="translate(40 62) scale(.58)">${carSvg(MONO_PAINT, dark ? 'rnCarD' : 'rnCarL')}</g>
    <path d="M176 38 C 172 52, 160 62, 152 76" fill="none" stroke="${p.ink}" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/>
    <g transform="translate(166 12) rotate(14)">
      <path d="M0 10 Q0 0 10 0 H40 Q50 0 50 10 V30 Q50 40 40 40 H10 Q0 40 0 30 Z" fill="${p.acc}" ${S}/>
      <circle cx="10" cy="20" r="3.5" fill="${p.card}" stroke="${p.ink}" stroke-width="1.4"/>
      ${txt(31, 27, '$', 19, 800, p.onAcc, 'middle')}
    </g>
    ${sparkle(222, 70, 5, p.acc)}`;
}

function customerArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p, 2);
  return `
    ${ground(120, 136, 88, dark)}
    <g transform="translate(26 34)">
      <rect width="150" height="96" rx="12" fill="${p.card}" ${S}/>
      <path d="M0 12 Q0 0 12 0 H138 Q150 0 150 12 V22 H0 Z" fill="${p.soft}"/>
      <path d="M0 22 H150" stroke="${p.ink}" stroke-width="1.4" opacity=".25"/>
      <rect x="12" y="8" width="44" height="6" rx="3" fill="${p.acc}"/>
      <rect x="12" y="32" width="44" height="52" rx="8" fill="${p.soft}"/>
      ${avatar(34, 58, 18, { ...p, soft: 'transparent' })}
      <rect x="66" y="36" width="62" height="7" rx="3.5" fill="${p.ink}"/>
      <rect x="66" y="50" width="48" height="5" rx="2.5" fill="${p.lite}"/>
      <rect x="66" y="61" width="56" height="5" rx="2.5" fill="${p.lite}"/>
      <rect x="66" y="74" width="34" height="5" rx="2.5" fill="${p.lite}"/>
    </g>
    <g transform="translate(176 44)">
      <circle r="30" fill="${p.card}" ${S}/>
      <path d="M-16 -8 V-16 H-8 M8 -16 H16 V-8 M16 8 V16 H8 M-8 16 H-16 V8" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cy="-3" r="6" fill="none" stroke="${p.ink}" stroke-width="1.8"/>
      <path d="M-9 11 Q0 3 9 11" fill="none" stroke="${p.ink}" stroke-width="1.8" stroke-linecap="round"/>
    </g>
    <circle cx="198" cy="68" r="11" fill="${p.acc}" stroke="${p.card}" stroke-width="2.4"/>
    ${tick(192.6, 68.6, p.onAcc, 2.2).replace('l4 4 l7 -8', 'l3.5 3.5 l6 -7')}
    ${sparkle(214, 20, 5, p.acc)}`;
}

function stripeArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p, 2);
  return `
    ${ground(122, 136, 96, dark)}
    <g transform="translate(18 62) rotate(-8)">
      <rect width="88" height="56" rx="9" fill="${p.card}" ${S}/>
      <rect x="11" y="14" width="17" height="12" rx="3" fill="${p.soft}" stroke="${p.acc}" stroke-width="1.5"/>
      <rect x="11" y="36" width="40" height="5" rx="2.5" fill="${p.lite}"/>
      <circle cx="64" cy="39" r="6.5" fill="${p.acc}"/><circle cx="73" cy="39" r="6.5" fill="${p.acc}" opacity=".45"/>
    </g>
    <path d="M100 74 C 116 58, 124 56, 138 58" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
    <path d="M133 52 L140 58 L132 63" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="translate(144 22)">
      <rect width="82" height="104" rx="14" fill="${p.card}" ${S}/>
      <circle cx="41" cy="30" r="16" fill="${p.acc}"/>
      ${txt(41, 37, '$', 19, 800, p.onAcc, 'middle')}
      <rect x="18" y="56" width="46" height="6" rx="3" fill="${p.ink}"/>
      <rect x="24" y="68" width="34" height="5" rx="2.5" fill="${p.lite}"/>
      <path d="M12 84 H70" stroke="${p.lite}" stroke-width="1.2"/>
      <circle cx="24" cy="94" r="6.5" fill="${p.soft}"/>
      ${tick(20, 94.4, p.acc, 1.8).replace('l4 4 l7 -8', 'l3 3 l5 -6')}
      <rect x="36" y="91.5" width="30" height="5" rx="2.5" fill="${p.lite}"/>
    </g>
    ${sparkle(226, 18, 5, p.acc)}
    ${sparkle(118, 34, 4, p.soft)}`;
}

export const RentalNeedCarArt = makeEmptyArt(carArt, VIEWBOX);
export const RentalNeedCustomerArt = makeEmptyArt(customerArt, VIEWBOX);
export const RentalNeedStripeArt = makeEmptyArt(stripeArt, VIEWBOX);
