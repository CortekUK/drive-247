'use client';

/**
 * Template 2 ("Glass") — the hero's car, in a studio.
 *
 * Works with any single cut-out (`home_hero.hero_image`), so it suits an
 * operator's own car as well as ours. At rest the car sits on the glass with a
 * soft floor shadow. Point at it and the studio lights come up:
 *
 *   tilt       the car turns a few degrees in 3D, following the pointer
 *   spotlight  a soft cone of light from above, tracking the pointer
 *   sheen      a highlight sweeps across the paint — masked by the image
 *              itself, so it lands on the car and never on the glass
 *   floor      a glossy reflection under the wheels; the shadow slides away
 *              from the light
 *
 * Touch: dragging across the car does the same, and it settles on release.
 * Reduced motion: the lights still come up, the car does not move.
 *
 * Pointer moves write CSS custom properties straight onto the stage (one
 * frame at a time), so nothing re-renders while the pointer moves. The look is
 * `.g2-car*` in styles/site.css.
 */

import { useEffect, useRef } from 'react';

import { cn } from '@nw/lib/utils';

/** How far the car turns at the stage's edges. */
const TURN_DEG = 14;
const PITCH_DEG = 5;
/** How far the floor shadow slides, in px, at the edges. */
const SHADOW_PX = 26;

export function HeroCar({
  src,
  alt,
  entrance = true,
  className,
}: {
  src: string;
  alt: string;
  /** Play the page's one-off entrance; off when the car is swapped in by the showroom. */
  entrance?: boolean;
  className?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const still = useRef(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (still.current = query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => {
      query.removeEventListener('change', sync);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  const aim = (clientX: number, clientY: number) => {
    const el = stage.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (clientY - box.top) / box.height));
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      if (still.current) return;
      el.style.setProperty('--ry', `${((x - 0.5) * 2 * TURN_DEG).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - y) * 2 * PITCH_DEG).toFixed(2)}deg`);
      el.style.setProperty('--sx', `${((0.5 - x) * 2 * SHADOW_PX).toFixed(1)}px`);
    });
  };

  const lightsUp = (on: boolean) => {
    const el = stage.current;
    if (!el) return;
    el.dataset.studio = String(on);
    if (on) return;
    cancelAnimationFrame(frame.current);
    for (const name of ['--mx', '--ry', '--rx', '--sx']) el.style.removeProperty(name);
  };

  return (
    <div
      ref={stage}
      data-studio="false"
      className={cn('g2-car relative flex w-full touch-pan-y select-none items-center justify-center', className)}
      onPointerEnter={(event) => {
        lightsUp(true);
        aim(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => aim(event.clientX, event.clientY)}
      onPointerLeave={() => lightsUp(false)}
      onPointerUp={(event) => {
        if (event.pointerType !== 'mouse') lightsUp(false);
      }}
      onPointerCancel={() => lightsUp(false)}
    >
      <span aria-hidden className="g2-car-spot" />
      <span aria-hidden className="g2-car-shadow" />

      <div className="g2-car-body relative inline-block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- an operator URL from the CMS, any host */}
        <img
          src={src}
          alt={alt}
          fetchPriority="high"
          draggable={false}
          className={cn(entrance && 'g2-car-in', 'relative block max-h-[min(30svh,290px)] w-auto max-w-full object-contain drop-shadow-[0_24px_30px_rgb(13_12_29/0.28)] lg:[@media(max-height:820px)]:max-h-[24svh]')}
        />
        <span aria-hidden className="g2-car-sheen" style={{ WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` }} />
        <span aria-hidden className="g2-car-reflect">
          {/* eslint-disable-next-line @next/next/no-img-element -- the same image, mirrored as its reflection */}
          <img src={src} alt="" draggable={false} />
        </span>
      </div>
    </div>
  );
}
