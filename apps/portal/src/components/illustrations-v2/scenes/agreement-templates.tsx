'use client';

/**
 * Agreements tab → "Template Studio" card art (docs/brand/illustration-guide.md
 * §4d: one idea, one or two props, both modes, flat).
 *
 * The story: your templates, stacked, and the one on top being written. The
 * front sheet carries a variable (the accent pill, what gets filled in when it
 * is sent), a line Trax is writing right now (the accent caret at its end),
 * and the signature at its foot. A small four-point spark at the corner is
 * Trax. No car: this is paperwork.
 *
 * Drawn to sit in the card's upper area; the card's own text sits below it,
 * so nothing here reaches the bottom band.
 */
import { cn } from '@/lib/utils';
import { ground, pal, stroke } from '../scene-kit';

function templatesArt(dark: boolean): string {
  const p = pal(dark);
  const S = stroke(p);
  const S2 = stroke(p, 1.8);
  const backLines = [[40, 64], [52, 80], [64, 72]]
    .map(([y, w]) => `<rect x="14" y="${y}" width="${w}" height="5" rx="2.5" fill="${p.lite}"/>`)
    .join('');
  return `
 <!-- the other templates, behind -->
 <g transform="translate(118 12)">
  <rect width="112" height="124" rx="12" fill="${p.card}" ${S2}/>
  <rect x="14" y="16" width="44" height="7" rx="3.5" fill="${p.lite}"/>
  ${backLines}
 </g>
 <!-- the template on top, being written -->
 <g transform="translate(70 26)">
  <rect width="124" height="136" rx="12" fill="${p.card}" ${S}/>
  <rect x="14" y="16" width="58" height="8" rx="4" fill="${p.ink}"/>
  <rect x="14" y="31" width="38" height="5" rx="2.5" fill="${p.lite}"/>
  <!-- a line with a variable in it -->
  <rect x="14" y="48" width="34" height="5" rx="2.5" fill="${p.lite}"/>
  <rect x="52" y="45" width="44" height="11" rx="5.5" fill="${p.soft}"/>
  <rect x="58" y="48.5" width="32" height="4" rx="2" fill="${p.acc}"/>
  <rect x="14" y="62" width="92" height="5" rx="2.5" fill="${p.lite}"/>
  <!-- the line Trax is writing now -->
  <rect x="14" y="76" width="54" height="5" rx="2.5" fill="${p.acc}" opacity=".55"/>
  <rect x="71" y="72.5" width="2.4" height="12" rx="1.2" fill="${p.acc}"/>
  <!-- the signature -->
  <path d="M16 112 C22 98 27 118 34 105 S44 98 48 109 S60 102 72 107" fill="none" stroke="${p.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M14 120 H84" stroke="${p.mut}" stroke-width="1.5" stroke-linecap="round"/>
 </g>
 <!-- Trax -->
 <g transform="translate(194 30)">
  <circle r="15" fill="${p.acc}"/>
  <path d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8 Z" fill="${p.onAcc}"/>
 </g>
 ${ground(142, 166, 96, dark)}`;
}

/** Both themes drawn; the `dark:` class picks one, so there is no flash. Fills its box, keeping its shape. */
export function AgreementTemplatesCardArt({ className }: { className?: string }) {
  const scene = (dark: boolean) => (
    <svg
      viewBox="40 0 220 176"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={cn('h-full w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      dangerouslySetInnerHTML={{ __html: templatesArt(dark) }}
    />
  );
  return (
    <div className={cn('pointer-events-none', className)}>
      {scene(false)}
      {scene(true)}
    </div>
  );
}
