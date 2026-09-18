'use client';

import React, { useEffect, useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CarouselMediaItem } from '@/types/cms';

/**
 * Preview of the live hero slider, before publishing.
 *
 * Deliberately mirrors the site's own behaviour rather than approximating it:
 * the same 2s dwell, the same crossfade, the same enabled/disabled filter, the
 * same mobile-image fallback and the same focal position. What an owner sees
 * here is what their customers get.
 *
 * Videos are skipped, exactly as the hero does — the hero is a still sequence.
 */
const INTERVAL_MS = 2000;

export function HeroSliderPreview({ media }: { media: CarouselMediaItem[] }) {
  const slides = media.filter(m => m.type === 'image' && m.url && m.enabled !== false);
  const [i, setI] = useState(0);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  useEffect(() => { setI(0); }, [slides.length, device]);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setInterval(() => setI(v => (v + 1) % slides.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, [slides.length]);

  if (slides.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No enabled images yet. Your site will show the default hero visual.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {slides.length} {slides.length === 1 ? 'image' : 'images'}
          {slides.length > 1 ? ' · changing every 2 seconds' : ' · no rotation with a single image'}
        </p>
        <div className="flex gap-1">
          <Button
            type="button" size="sm"
            variant={device === 'desktop' ? 'default' : 'ghost'}
            className="h-7 px-2"
            onClick={() => setDevice('desktop')}
          >
            <Monitor className="mr-1 h-3.5 w-3.5" /> Desktop
          </Button>
          <Button
            type="button" size="sm"
            variant={device === 'mobile' ? 'default' : 'ghost'}
            className="h-7 px-2"
            onClick={() => setDevice('mobile')}
          >
            <Smartphone className="mr-1 h-3.5 w-3.5" /> Mobile
          </Button>
        </div>
      </div>

      <div
        className={
          'relative mx-auto overflow-hidden rounded-lg bg-muted ' +
          (device === 'mobile' ? 'aspect-[9/14] max-w-[240px]' : 'aspect-[16/9] w-full')
        }
      >
        {slides.map((s, n) => (
          <img
            key={s.url + n}
            src={device === 'mobile' ? (s.mobile_url || s.url) : s.url}
            alt={s.alt || ''}
            style={{ objectPosition: s.focal || '50% 50%' }}
            className={
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ' +
              (n === i ? 'opacity-100' : 'opacity-0')
            }
          />
        ))}

        {slides.length > 1 && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-white/75 px-2 py-1 backdrop-blur">
            {slides.map((_, n) => (
              <span
                key={n}
                className={
                  'h-1.5 rounded-full transition-all ' +
                  (n === i ? 'w-4 bg-primary' : 'w-1.5 bg-primary/30')
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
