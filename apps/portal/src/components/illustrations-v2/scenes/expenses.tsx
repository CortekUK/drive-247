'use client';

/**
 * Expenses empty state (illustration guide §4a): a receipt pinned to the costs
 * of one car, and those costs landing on a small profit-and-loss line.
 * Static art from the scene kit only; nothing user-supplied is interpolated.
 */
import { carSvg, MONO_PAINT } from '../car-art';
import { ground, makeEmptyArt, pal, stroke, tick, txt } from '../scene-kit';

export function expensesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const arrow = (x1: number, y: number, x2: number) =>
    `<path d="M${x1} ${y} H${x2 - 2}" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>` +
    `<path d="M${x2 - 7} ${y - 6} L${x2} ${y} L${x2 - 7} ${y + 6}" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

  // The receipt: torn (zigzag) foot, a few lines, and a bold total.
  let zig = '';
  for (let x = 0; x <= 78; x += 6.5) zig += ` L${(78 - x).toFixed(1)} ${x % 13 === 0 ? 118 : 112}`;
  const receipt = `
  <g transform="translate(22 32) rotate(-5 39 60)">
   <path d="M0 8 Q0 0 8 0 L70 0 Q78 0 78 8 L78 118${zig} Z" fill="${p.card}" ${S}/>
   <rect x="20" y="12" width="38" height="6" rx="3" fill="${p.ink}"/>
   <rect x="12" y="30" width="30" height="4.5" rx="2.25" fill="${p.lite}"/><rect x="50" y="30" width="16" height="4.5" rx="2.25" fill="${p.lite}"/>
   <rect x="12" y="42" width="24" height="4.5" rx="2.25" fill="${p.lite}"/><rect x="50" y="42" width="16" height="4.5" rx="2.25" fill="${p.lite}"/>
   <rect x="12" y="54" width="34" height="4.5" rx="2.25" fill="${p.lite}"/><rect x="50" y="54" width="16" height="4.5" rx="2.25" fill="${p.lite}"/>
   <path d="M12 70 H66" stroke="${p.mut}" stroke-width="1.4" stroke-dasharray="3 3"/>
   ${txt(12, 90, 'Total', 9, 600, p.mut)}${txt(66, 91, '$84', 14, 800, p.ink, 'end')}
   <circle cx="39" cy="-2" r="6" fill="${p.acc}" stroke="${p.ink}" stroke-width="2"/>
  </g>`;

  // The car's costs: the car on top, its cost lines below, the new one ticked.
  const rows = [0, 1, 2]
    .map((i) => {
      const y = 86 + i * 18;
      const isNew = i === 0;
      return `<rect x="14" y="${y}" width="8" height="8" rx="2.5" fill="${isNew ? p.acc : p.lite}"/>` +
        `<rect x="28" y="${y + 1}" width="${[44, 36, 40][i]}" height="6" rx="3" fill="${isNew ? p.ink : p.lite}"/>` +
        `<rect x="${isNew ? 94 : 100}" y="${y + 1}" width="${isNew ? 26 : 20}" height="6" rx="3" fill="${isNew ? p.acc : p.lite}"/>`;
    })
    .join('');
  const car = `
  <g transform="translate(126 22)">
   <rect width="134" height="142" rx="14" fill="${p.card}" ${S}/>
   <g transform="translate(18 14) scale(.3)">${carSvg(MONO_PAINT, dark ? 'expd' : 'expl')}</g>
   <path d="M14 74 H120" stroke="${p.lite}" stroke-width="1.5"/>
   ${rows}
  </g>`;

  // Profit and loss: a few month bars and the line they make.
  const bars = [30, 22, 34, 26]
    .map((h, i) => `<rect x="${14 + i * 13}" y="${80 - h}" width="8" height="${h}" rx="2.5" fill="${i === 3 ? p.acc : p.lite}" opacity="${i === 3 ? 0.9 : 1}"/>`)
    .join('');
  const pnl = `
  <g transform="translate(280 44)">
   <rect width="76" height="96" rx="12" fill="${p.card}" ${S}/>
   ${txt(14, 24, 'P&amp;L', 11, 800, p.ink)}
   ${bars}
   <path d="M14 86 H62" stroke="${p.lite}" stroke-width="1.5"/>
  </g>
  <circle cx="352" cy="46" r="10" fill="${p.acc}"/>${tick(346.5, 46.5, p.onAcc, 2.2)}`;

  return `${receipt}${arrow(104, 92, 124)}${car}${arrow(262, 92, 278)}${pnl}${ground(190, 172, 160, dark)}`;
}

export const ExpensesEmptyArt = makeEmptyArt(expensesArt, '12 16 356 164');
