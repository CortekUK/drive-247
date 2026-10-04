'use client';

/**
 * Shared kit for empty-state pictures (ILLUSTRATION_GUIDE.md §4a).
 *
 * Each page's picture is a function `(dark) => string` returning SVG markup,
 * built only from these helpers and constants — nothing user-supplied is ever
 * interpolated, which is what makes `dangerouslySetInnerHTML` safe here.
 * `makeEmptyArt` turns one into the light + dark pair the empty state expects.
 *
 * Style: ink lines, white cards, indigo only where it matters; one hero idea
 * that tells the page's story; the car only where the page is about cars.
 */
import { cn } from '@/lib/utils';

export type Pal = { ink: string; card: string; lite: string; acc: string; soft: string; bg: string; mut: string; onAcc: string };

/**
 * The accent is the tenant's theme colour (`--primary`), not a fixed indigo, so
 * a teal or rose tenant gets teal or rose art. In dark the accent is the
 * lighter `--v2-link` step (the button colour is too dim to draw with on a
 * dark card) and the surfaces are the portal's own neutral card and page
 * greys, so the art sits on the soft dark UI instead of on a navy slab.
 * `onAcc` is the ink for text and ticks drawn ON an accent shape.
 */
export function pal(dark: boolean): Pal {
  return {
    ink: dark ? '#d4d4d4' : '#111114',
    card: dark ? 'hsl(var(--card))' : '#ffffff',
    lite: dark ? '#3a3a3a' : '#e4e4e7',
    acc: dark ? 'hsl(var(--v2-link, var(--primary)))' : 'hsl(var(--primary))',
    soft: dark ? 'hsl(var(--primary) / 0.2)' : 'hsl(var(--primary) / 0.1)',
    bg: dark ? 'hsl(var(--background))' : '#ffffff',
    mut: dark ? '#7a7a7a' : '#a1a1aa',
    onAcc: dark ? 'hsl(var(--background))' : 'hsl(var(--primary-foreground))',
  };
}

/** Standard 2.2px ink stroke for cards and outlines. */
export const stroke = (p: Pal, w = 2.2) => `stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round"`;

export const txt = (x: number, y: number, t: string, size: number, weight: number, fill: string, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-family="DM Sans,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`;

export const tick = (x: number, y: number, color: string, w = 2.4) =>
  `<path d="M${x} ${y} l4 4 l7 -8" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A faceless person in a circle (head, hair, shoulders in the accent). */
export function avatar(x: number, y: number, r: number, p: Pal, skin = '#d9a88a', hair = '#1f2040'): string {
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${p.soft}"/><circle cy="${-r * 0.18}" r="${r * 0.38}" fill="${skin}"/><path d="M${-r * 0.65} ${r * 0.72} Q0 ${r * 0.05} ${r * 0.65} ${r * 0.72}" fill="${p.acc}" opacity=".9"/><path d="M${-r * 0.38} ${-r * 0.3} Q${-r * 0.36} ${-r * 0.66} 0 ${-r * 0.66} Q${r * 0.36} ${-r * 0.66} ${r * 0.38} ${-r * 0.3} Q${r * 0.18} ${-r * 0.48} 0 ${-r * 0.48} Q${-r * 0.18} ${-r * 0.48} ${-r * 0.38} ${-r * 0.3}Z" fill="${hair}"/></g>`;
}

/** Soft ground shadow under the scene. */
export const ground = (cx: number, cy: number, rx: number, dark: boolean) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="6" fill="#000" opacity="${dark ? 0.35 : 0.05}"/>`;

/**
 * Turn a picture function into the component an empty state takes as its
 * `illustration`: both themes drawn, the `dark:` class picks one, no flash.
 * `viewBox` should be cropped to the art (no empty band under the shadow).
 */
export function makeEmptyArt(art: (dark: boolean) => string, viewBox = '0 10 368 180') {
  const Scene = ({ dark }: { dark: boolean }) => (
    <svg
      viewBox={viewBox}
      aria-hidden="true"
      className={cn('h-auto w-full', dark ? 'hidden dark:block' : 'dark:hidden')}
      dangerouslySetInnerHTML={{ __html: art(dark) }}
    />
  );
  function EmptyArt({ className }: { className?: string }) {
    return (
      <div className={cn('mx-auto w-full', className)}>
        <Scene dark={false} />
        <Scene dark />
      </div>
    );
  }
  return EmptyArt;
}
