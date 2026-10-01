'use client';

/**
 * Leads empty-state picture (docs/brand/illustration-guide.md §4a).
 *
 * The story: prospects move along a small pipeline — one is being carried from
 * New to Contacted, and the one at the end has been approved. No car.
 */
import { avatar, ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

function leadsArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const lead = (x: number, y: number, w1: number, w2: number, extra = '') =>
    `<g transform="translate(${x} ${y})">
   <rect width="80" height="30" rx="8" fill="${p.card}" stroke="${p.ink}" stroke-width="1.8" stroke-linejoin="round"/>
   ${avatar(15, 15, 9, p)}
   <rect x="30" y="9" width="${w1}" height="5" rx="2.5" fill="${p.ink}"/><rect x="30" y="18" width="${w2}" height="4" rx="2" fill="${p.lite}"/>
   ${extra}
  </g>`;
  const column = (x: number, title: string, count: string) =>
    `<g transform="translate(${x} 28)">
   <rect width="100" height="132" rx="14" fill="${p.card}" ${S}/>
   ${txt(12, 20, title, 9.5, 700, p.ink)}
   ${txt(88, 20, count, 9, 700, p.mut, 'end')}
   <path d="M12 30 H88" stroke="${p.lite}" stroke-width="1.5"/>
  </g>`;
  return `
 ${column(18, 'New', '2')}
 ${column(134, 'Contacted', '1')}
 ${column(250, 'Approved', '1')}
 ${lead(28, 68, 36, 26)}
 ${lead(144, 68, 32, 28)}
 <!-- the empty slot the moving lead is heading for -->
 <rect x="144" y="106" width="80" height="30" rx="8" fill="none" stroke="${p.acc}" stroke-width="1.8" stroke-dasharray="4 4"/>
 ${lead(260, 68, 34, 24, `<circle cx="80" cy="0" r="9" fill="${p.acc}"/>${tick(75.5, 0.5, p.onAcc, 2)}`)}
 <!-- a lead being carried from New to Contacted -->
 <path d="M126 118 H136" fill="none" stroke="${p.acc}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>
 <path d="M133 113 L139 118 L133 123" fill="none" stroke="${p.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 <g transform="translate(42 114) rotate(-6)">
  ${lead(0, 0, 38, 24).replace('stroke-width="1.8"', 'stroke-width="2.2"')}
 </g>
 ${ground(184, 168, 164, dark)}`;
}

/** Leads: prospects moving along a small pipeline, one carried to the next stage. */
export const LeadsEmptyArt = makeEmptyArt(leadsArt, '0 14 368 164');
