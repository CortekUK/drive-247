'use client';

/**
 * Payments empty state (docs/brand/illustration-guide.md §4a).
 *
 * The story: money arrives two ways — a card payment, and cash or a bank
 * transfer you record by hand — and both land in one ledger, the newest row
 * with the indigo tick. No car: this page is about money.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function paymentsArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const rows = [
    { name: 52, amount: '$240', skin: '#d9a88a', hair: '#1f2040' },
    { name: 40, amount: '$85', skin: '#b77e5f', hair: '#2a1d1a' },
    { name: 46, amount: '$1,200', skin: '#d9a88a', hair: '#2a1d1a' },
    { name: 34, amount: '$60', skin: '#b77e5f', hair: '#1f2040' },
  ]
    .map((r, i) => {
      const y = 40 + i * 25;
      const fresh = i === 0;
      return `${fresh ? `<rect x="7" y="${y - 3}" width="156" height="24" rx="8" fill="${p.soft}"/>` : `<path d="M14 ${y - 3.5} H156" stroke="${p.lite}" stroke-width="1.2"/>`}
  ${avatar(24, y + 9, 9, fresh ? { ...p, soft: p.card } : p, r.skin, r.hair)}
  <rect x="40" y="${y + 6}" width="${r.name}" height="6" rx="3" fill="${fresh ? p.ink : p.lite}"/>
  ${fresh ? `<circle cx="112" cy="${y + 9}" r="7" fill="${p.acc}"/>${tick(108.2, y + 9.4, p.onAcc, 1.8).replace('l4 4 l7 -8', 'l3 3 l5 -6')}` : ''}
  ${txt(154, y + 13, r.amount, 10.5, 700, fresh ? p.acc : p.ink, 'end')}`;
    })
    .join('');
  return `
 <!-- a card payment -->
 <g transform="translate(24 44) rotate(-6)">
  <rect width="98" height="62" rx="9" fill="${p.card}" ${S}/>
  <rect x="12" y="16" width="18" height="13" rx="3" fill="${p.soft}" stroke="${p.acc}" stroke-width="1.5"/>
  <rect x="12" y="40" width="44" height="5" rx="2.5" fill="${p.lite}"/>
  <circle cx="72" cy="45" r="7" fill="${p.acc}"/><circle cx="82" cy="45" r="7" fill="${p.acc}" opacity=".45"/>
 </g>
 <!-- cash or a bank transfer, recorded by hand -->
 <g transform="translate(30 122) rotate(4)">
  <rect width="86" height="44" rx="8" fill="${p.card}" ${S}/>
  <rect x="6" y="6" width="74" height="32" rx="5" fill="none" stroke="${p.lite}" stroke-width="1.5"/>
  <circle cx="43" cy="22" r="11" fill="${p.soft}"/>
  ${txt(43, 27, '$', 14, 800, p.ink, 'middle')}
 </g>
 <path d="M128 78 C 142 80, 146 92, 158 94" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M124 142 C 140 140, 146 124, 158 120" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <!-- the ledger -->
 <g transform="translate(166 30)">
  <rect width="170" height="142" rx="14" fill="${p.card}" ${S}/>
  <rect x="14" y="16" width="58" height="8" rx="4" fill="${p.ink}"/>
  <rect x="120" y="16" width="36" height="8" rx="4" fill="${p.lite}"/>
  ${rows}
 </g>
 ${ground(184, 180, 150, dark)}`;
}

export const PaymentsEmptyArt = makeEmptyArt(paymentsArt, '8 12 352 176');
