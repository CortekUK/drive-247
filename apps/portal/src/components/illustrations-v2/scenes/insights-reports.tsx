'use client';

/**
 * Insights → Reports: one small picture per report card
 * (ILLUSTRATION_GUIDE.md §4a style — ink lines, white cards, the
 * tenant's accent only where it matters, the car only where the report is
 * about cars).
 *
 * Every picture shares one 240 × 120 box so the nine cards line up, and each
 * renders at the HEIGHT its card has left (`h-full w-auto`) rather than at its
 * width — the Reports view must fit one screen, so the art gives way first.
 * Static markup from the scene kit only; nothing user-supplied is interpolated,
 * which is what makes `dangerouslySetInnerHTML` safe.
 */
import { cn } from '@/lib/utils';
import { carSvg, MONO_PAINT } from '../car-art';
import { ground, pal, stroke, tick, txt, avatar, type Pal } from '../scene-kit';

const VIEWBOX = '0 0 240 120';

const bar = (x: number, y: number, w: number, fill: string, h = 5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;

const arrow = (p: Pal, x1: number, y: number, x2: number) =>
  `<path d="M${x1} ${y} H${x2 - 2}" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>` +
  `<path d="M${x2 - 7} ${y - 6} L${x2} ${y} L${x2 - 7} ${y + 6}" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

/* Profit & loss — the receipt itself: lines that take a bite, then the kept total. */
function pnl(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  let zig = '';
  for (let x = 0; x <= 96; x += 8) zig += ` L${96 - x} ${x % 16 === 0 ? 104 : 98}`;
  const rows = [
    [38, '+', p.ink],
    [30, '−', p.mut],
    [34, '−', p.mut],
    [26, '−', p.mut],
  ]
    .map(([w, sign, c], i) => {
      const y = 22 + i * 13;
      return bar(12, y, w as number, p.lite) + txt(84, y + 5.5, sign as string, 10, 700, c as string, 'end');
    })
    .join('');
  return `
  <g transform="translate(72 6)">
   <path d="M0 8 Q0 0 8 0 L88 0 Q96 0 96 8 L96 104${zig} Z" fill="${p.card}" ${S}/>
   ${rows}
   <path d="M12 76 H84" stroke="${p.ink}" stroke-width="1.4"/><path d="M12 79 H84" stroke="${p.ink}" stroke-width="1.4"/>
   <rect x="8" y="83" width="80" height="13" rx="6" fill="${p.soft}"/>
   ${txt(14, 92.5, 'Kept', 8, 700, p.ink)}${txt(84, 93, '$23,848', 9, 800, p.acc, 'end')}
  </g>
  ${ground(120, 114, 60, dark)}`;
}

/* Monthly P&L — a card of month bars climbing, the latest in the accent. */
function monthly(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  const hs = [22, 30, 26, 38, 44, 56];
  const bars = hs
    .map((h, i) => `<rect x="${18 + i * 22}" y="${86 - h}" width="13" height="${h}" rx="3" fill="${i === hs.length - 1 ? p.acc : p.lite}"/>`)
    .join('');
  return `
  <g transform="translate(50 8)">
   <rect width="150" height="100" rx="12" fill="${p.card}" ${S}/>
   ${txt(14, 20, 'By month', 9, 700, p.ink)}
   ${bars}
   <path d="M24 64 L46 56 L68 60 L90 48 L112 42 L134 30" fill="none" stroke="${p.ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3"/>
   <path d="M14 87 H138" stroke="${p.ink}" stroke-width="1.4"/>
  </g>
  ${ground(125, 114, 76, dark)}`;
}

/* Sales tax — a slice of each charge set aside for the state. */
function salesTax(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g transform="translate(34 18)">
   <rect width="86" height="84" rx="12" fill="${p.card}" ${S}/>
   ${bar(12, 16, 46, p.lite)}${bar(12, 28, 36, p.lite)}${bar(12, 40, 42, p.lite)}
   <rect x="10" y="56" width="66" height="16" rx="6" fill="${p.soft}"/>
   ${txt(16, 67.5, 'Tax', 8.5, 700, p.ink)}${txt(70, 68, '$1,647', 9, 800, p.acc, 'end')}
  </g>
  ${arrow(p, 128, 60, 150)}
  <g transform="translate(156 30)">
   <circle cx="26" cy="30" r="26" fill="${p.acc}" stroke="${p.ink}" stroke-width="2.2"/>
   ${txt(26, 38, '%', 24, 800, p.onAcc, 'middle')}
  </g>
  ${ground(120, 114, 82, dark)}`;
}

/* Income ledger — charges coming in, each one a line on the ledger. */
function income(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  const rows = [0, 1, 2, 3]
    .map((i) => {
      const y = 22 + i * 18;
      return `<circle cx="20" cy="${y + 3}" r="5" fill="${i === 0 ? p.acc : p.soft}"/>` +
        (i === 0 ? `<path d="M17.5 ${y + 3} H22.5 M20 ${y + 0.5} V${y + 5.5}" stroke="${p.onAcc}" stroke-width="1.6" stroke-linecap="round"/>` : '') +
        bar(32, y, [50, 40, 46, 34][i], i === 0 ? p.ink : p.lite) +
        bar(104, y, 22, i === 0 ? p.acc : p.lite);
    })
    .join('');
  return `
  <g transform="translate(18 34) rotate(-4 26 26)">
   <rect width="52" height="34" rx="9" fill="${p.card}" ${S}/>
   <rect x="0" y="9" width="52" height="7" fill="${p.ink}"/>
   ${bar(8, 22, 18, p.acc, 5)}
  </g>
  ${arrow(p, 76, 58, 94)}
  <g transform="translate(98 8)">
   <rect width="138" height="96" rx="12" fill="${p.card}" ${S}/>
   ${rows}
  </g>
  ${ground(140, 114, 84, dark)}`;
}

/* Expenses — a torn receipt and the wrench it paid for. */
function expenses(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  let zig = '';
  for (let x = 0; x <= 80; x += 8) zig += ` L${80 - x} ${x % 16 === 0 ? 96 : 90}`;
  return `
  <g transform="translate(46 10) rotate(-4 40 50)">
   <path d="M0 8 Q0 0 8 0 L72 0 Q80 0 80 8 L80 96${zig} Z" fill="${p.card}" ${S}/>
   ${bar(22, 12, 36, p.ink, 6)}
   ${bar(12, 30, 30, p.lite)}${bar(54, 30, 14, p.lite)}
   ${bar(12, 42, 24, p.lite)}${bar(54, 42, 14, p.lite)}
   ${bar(12, 54, 34, p.lite)}${bar(54, 54, 14, p.lite)}
   <path d="M12 68 H68" stroke="${p.mut}" stroke-width="1.4" stroke-dasharray="3 3"/>
   ${txt(68, 83, '−$84', 12, 800, p.ink, 'end')}
  </g>
  <g transform="translate(140 30) rotate(35 30 30)">
   <path d="M22 6 a14 14 0 1 0 16 16 l-8 -2 l-4 -6 l2 -8 z" fill="${p.acc}" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/>
   <rect x="24" y="28" width="10" height="44" rx="5" fill="${p.card}" stroke="${p.ink}" stroke-width="2.2" transform="rotate(-45 29 50)"/>
  </g>
  ${ground(124, 114, 76, dark)}`;
}

/* Profit by car — the car, and what it kept, going up. */
function vehicleProfit(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g transform="translate(10 36) scale(.42)">${carSvg(MONO_PAINT, dark ? 'irpd' : 'irpl')}</g>
  <g transform="translate(160 14)">
   <rect width="70" height="44" rx="11" fill="${p.card}" ${S}/>
   ${txt(10, 17, 'Kept', 8, 700, p.mut)}
   ${txt(10, 34, '+$4,210', 12, 800, p.acc)}
   <path d="M56 30 L56 12 M50 18 L56 12 L62 18" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${ground(86, 112, 70, dark)}`;
}

/* Who owes you — a customer, a balance, and a clock on it. */
function receivables(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  ${avatar(52, 58, 30, p)}
  <g transform="translate(92 18)">
   <path d="M10 0 H112 Q122 0 122 10 V48 Q122 58 112 58 H30 L16 70 L18 58 H10 Q0 58 0 48 V10 Q0 0 10 0 Z" fill="${p.card}" ${S}/>
   ${txt(12, 20, 'Owes', 8.5, 700, p.mut)}
   ${txt(12, 42, '$1,240', 16, 800, p.ink)}
   <g transform="translate(92 29)">
    <circle r="14" fill="${p.acc}" stroke="${p.ink}" stroke-width="2"/>
    <path d="M0 -7 V0 L5 4" fill="none" stroke="${p.onAcc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
   </g>
  </g>
  ${ground(122, 114, 86, dark)}`;
}

/* Refunds — money going back round to the customer. */
function refunds(dark: boolean) {
  const p = pal(dark);
  return `
  <g transform="translate(120 58)">
   <path d="M-44 -6 A44 44 0 0 1 36 -26" fill="none" stroke="${p.acc}" stroke-width="2.6" stroke-dasharray="3 6" stroke-linecap="round"/>
   <path d="M29 -34 L38 -25 L26 -20" fill="none" stroke="${p.acc}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
   <circle r="24" fill="${p.card}" stroke="${p.ink}" stroke-width="2.2"/>
   <circle r="17" fill="${p.soft}"/>
   ${txt(0, 7, '$', 19, 800, p.acc, 'middle')}
  </g>
  ${avatar(196, 72, 22, p)}
  <g transform="translate(18 56)">
   <rect width="46" height="30" rx="9" fill="${p.card}" ${stroke(p)}/>
   ${tick(16, 14, p.acc)}
  </g>
  ${ground(120, 114, 92, dark)}`;
}

/* Cars bought and sold — the car with its price tag, outside profit. */
function fleetCapital(dark: boolean) {
  const p = pal(dark);
  return `
  <g transform="translate(20 34) scale(.42)">${carSvg(MONO_PAINT, dark ? 'ifcd' : 'ifcl')}</g>
  <g transform="translate(168 18) rotate(18 30 22)">
   <path d="M0 10 Q0 0 10 0 H44 L62 22 L44 44 H10 Q0 44 0 34 Z" fill="${p.acc}" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/>
   <circle cx="46" cy="22" r="4" fill="${p.card}" stroke="${p.ink}" stroke-width="1.8"/>
   ${txt(20, 27, '$', 15, 800, p.onAcc, 'middle')}
  </g>
  <path d="M160 64 Q150 70 138 66" fill="none" stroke="${p.ink}" stroke-width="1.6" stroke-linecap="round"/>
  ${ground(96, 112, 74, dark)}`;
}

/* Payments received — a card payment landing in the bank. */
function paymentsIn(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g transform="translate(26 34) rotate(-6 34 22)">
   <rect width="68" height="44" rx="9" fill="${p.card}" ${S}/>
   <rect x="0" y="11" width="68" height="8" fill="${p.ink}"/>
   ${bar(8, 28, 22, p.acc, 5)}${bar(36, 28, 16, p.lite, 5)}
  </g>
  ${arrow(p, 102, 60, 126)}
  <g transform="translate(132 18)">
   <path d="M4 26 L46 6 L88 26 Z" fill="${p.soft}" stroke="${p.ink}" stroke-width="2.2" stroke-linejoin="round"/>
   <rect x="8" y="26" width="76" height="6" rx="2" fill="${p.card}" stroke="${p.ink}" stroke-width="2"/>
   ${[0, 1, 2, 3].map((i) => `<rect x="${16 + i * 17}" y="36" width="8" height="34" rx="2" fill="${p.card}" stroke="${p.ink}" stroke-width="2"/>`).join('')}
   <rect x="4" y="72" width="84" height="8" rx="3" fill="${p.ink}"/>
   <circle cx="46" cy="18" r="4" fill="${p.acc}"/>
  </g>
  ${ground(126, 112, 90, dark)}`;
}

/* Rental register — a calendar with a booked stretch, each one a rental. */
function rentalsRegister(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  const cells = [0, 1, 2]
    .map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) => `<rect x="${12 + c * 18}" y="${34 + r * 18}" width="14" height="14" rx="3.5" fill="${p.lite}"/>`).join(''))
    .join('');
  return `
  <g transform="translate(52 8)">
   <rect width="140" height="98" rx="12" fill="${p.card}" ${S}/>
   <path d="M0 12 Q0 0 12 0 L128 0 Q140 0 140 12 L140 22 L0 22 Z" fill="${p.ink}"/>
   ${txt(12, 15.5, 'Rentals', 9, 700, dark ? 'hsl(var(--background))' : '#ffffff')}
   ${cells}
   <rect x="28" y="51" width="68" height="14" rx="5" fill="${p.acc}"/>
   <circle cx="36" cy="58" r="3.5" fill="${p.onAcc}"/><circle cx="88" cy="58" r="3.5" fill="${p.onAcc}"/>
   <rect x="64" y="69" width="50" height="14" rx="5" fill="${p.soft}" stroke="${p.acc}" stroke-width="1.6"/>
  </g>
  ${ground(122, 114, 76, dark)}`;
}

/* Cars due back — the car heading home, with the time it is due. */
function dueBack(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g transform="translate(76 40) scale(.42)">${carSvg(MONO_PAINT, dark ? 'idbd' : 'idbl')}</g>
  <path d="M70 92 H40" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-dasharray="3 5" stroke-linecap="round"/>
  <path d="M46 86 L39 92 L46 98" fill="none" stroke="${p.acc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <g transform="translate(14 14)">
   <rect width="62" height="46" rx="11" fill="${p.card}" ${S}/>
   ${txt(10, 17, 'Due back', 7.5, 700, p.mut)}
   ${txt(10, 35, 'Fri 4pm', 11, 800, p.ink)}
  </g>
  <g transform="translate(206 26)">
   <circle r="16" fill="${p.acc}" stroke="${p.ink}" stroke-width="2"/>
   <path d="M0 -8 V0 L6 4" fill="none" stroke="${p.onAcc}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${ground(144, 112, 70, dark)}`;
}

/* Utilisation by car — the car, and a gauge of how much of the month it worked. */
function utilisation(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  <g transform="translate(8 40) scale(.4)">${carSvg(MONO_PAINT, dark ? 'iutd' : 'iutl')}</g>
  <g transform="translate(150 12)">
   <rect width="80" height="68" rx="12" fill="${p.card}" ${S}/>
   <path d="M16 52 A24 24 0 0 1 64 52" fill="none" stroke="${p.lite}" stroke-width="7" stroke-linecap="round"/>
   <path d="M16 52 A24 24 0 0 1 54.4 33" fill="none" stroke="${p.acc}" stroke-width="7" stroke-linecap="round"/>
   <path d="M40 52 L52 37" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round"/>
   <circle cx="40" cy="52" r="3.5" fill="${p.ink}"/>
   ${txt(40, 64, '72%', 9, 800, p.ink, 'middle')}
  </g>
  ${ground(110, 112, 96, dark)}`;
}

/* Revenue by customer — three customers, biggest on the top step. */
function topCustomers(dark: boolean) {
  const p = pal(dark);
  const S = stroke(p);
  return `
  ${avatar(78, 46, 17, p, '#c98e6c', '#2a2140')}
  ${avatar(120, 30, 20, p)}
  ${avatar(162, 52, 16, p, '#e3b896', '#5b3a29')}
  <rect x="60" y="68" width="36" height="34" rx="6" fill="${p.card}" ${S}/>
  <rect x="100" y="54" width="40" height="48" rx="6" fill="${p.acc}" stroke="${p.ink}" stroke-width="2.2"/>
  <rect x="144" y="74" width="36" height="28" rx="6" fill="${p.card}" ${S}/>
  ${txt(78, 90, '2', 12, 800, p.ink, 'middle')}
  ${txt(120, 84, '1', 14, 800, p.onAcc, 'middle')}
  ${txt(162, 93, '3', 12, 800, p.ink, 'middle')}
  ${ground(120, 112, 76, dark)}`;
}

const ART = {
  pnl,
  monthly,
  'sales-tax': salesTax,
  income,
  expenses,
  'vehicle-profit': vehicleProfit,
  receivables,
  refunds,
  'fleet-capital': fleetCapital,
  'payments-in': paymentsIn,
  rentals: rentalsRegister,
  'due-back': dueBack,
  utilisation,
  'top-customers': topCustomers,
} as const;

export type ReportArtId = keyof typeof ART;

/** Both themes drawn; the `dark:` class picks one, so there is no flash. */
export function ReportArt({ id, className }: { id: ReportArtId; className?: string }) {
  const art = ART[id];
  const svg = (dark: boolean) => (
    <svg
      viewBox={VIEWBOX}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
      className={cn('h-full w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      dangerouslySetInnerHTML={{ __html: art(dark) }}
    />
  );
  return (
    <div className={cn('h-full w-full', className)}>
      {svg(false)}
      {svg(true)}
    </div>
  );
}
