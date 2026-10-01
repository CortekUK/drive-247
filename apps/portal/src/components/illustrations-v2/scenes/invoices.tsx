'use client';

/**
 * Invoices empty state (docs/brand/illustration-guide.md §4a).
 *
 * The story: a rental (its booked dates) produces its invoice — line items
 * and a total in indigo — and the invoice goes on to the customer's inbox.
 * No car: this page is about what a customer owes.
 */
import { ground, makeEmptyArt, pal, stroke, txt } from '../scene-kit';

function invoicesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const cells = [0, 1].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${10 + c * 18}" y="${30 + r * 20}" width="14" height="14" rx="4" fill="${p.lite}"/>`).join('')).join('');
  const items = [
    { w: 52, amount: '$360' },
    { w: 40, amount: '$45' },
    { w: 46, amount: '$75' },
  ]
    .map((it, i) => {
      const y = 70 + i * 16;
      return `<rect x="14" y="${y}" width="${it.w}" height="5" rx="2.5" fill="${p.lite}"/>${txt(118, y + 5.5, it.amount, 9.5, 600, p.ink, 'end')}`;
    })
    .join('');
  return `
 <!-- the rental it comes from -->
 <g transform="translate(22 58)">
  <rect width="88" height="78" rx="12" fill="${p.card}" ${S}/>
  <path d="M0 12 Q0 0 12 0 L76 0 Q88 0 88 12 L88 20 L0 20 Z" fill="${p.ink}"/>
  ${txt(10, 14, 'May', 9, 700, dark ? 'hsl(var(--background))' : '#ffffff')}
  ${cells}
  <rect x="28" y="50" width="50" height="14" rx="5" fill="${p.acc}"/>
  <circle cx="36" cy="57" r="4" fill="${p.onAcc}"/>
 </g>
 <path d="M116 97 H138" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <path d="M133 91 L140 97 L133 103" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
 <!-- the invoice, with its total -->
 <g transform="translate(150 22)">
  <rect width="132" height="152" rx="12" fill="${p.card}" ${S}/>
  ${txt(14, 28, 'Invoice', 12.5, 800, p.ink)}
  ${txt(118, 28, '#1042', 9, 600, p.mut, 'end')}
  <rect x="14" y="40" width="44" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="14" y="50" width="30" height="5" rx="2.5" fill="${p.lite}"/>
  ${items}
  <path d="M14 122 H118" stroke="${p.ink}" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="8" y="128" width="116" height="18" rx="7" fill="${p.soft}"/>
  ${txt(16, 141, 'Total', 10, 700, p.ink)}
  ${txt(116, 141.5, '$480', 12.5, 800, p.acc, 'end')}
 </g>
 <!-- on its way to the customer -->
 <path d="M288 97 H300" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
 <g transform="translate(304 75)">
  <rect width="52" height="44" rx="12" fill="${p.card}" ${S}/>
  <rect x="11" y="12" width="30" height="20" rx="3" fill="${p.soft}" stroke="${p.ink}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M12 14 L26 24 L40 14" fill="none" stroke="${p.ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
 </g>
 ${ground(184, 180, 150, dark)}`;
}

export const InvoicesEmptyArt = makeEmptyArt(invoicesArt, '10 10 352 178');
