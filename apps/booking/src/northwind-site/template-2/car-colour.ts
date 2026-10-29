'use client';

/**
 * Template 2 ("Glass") — reads a car's paint colour off its photo, so the hero
 * can take on the colour of whichever car is on stage without the operator
 * picking one. An operator's own `color` always wins over this.
 *
 * The photo is shrunk to 64px and read through a canvas. Clear pixels (a
 * cut-out's background) are skipped, and so are the near-black and near-white
 * ones: tyres, glass, glare. What is left is binned by hue, and the biggest
 * bin, pooled with its neighbours — the most paint by area, the windows
 * counting for less — is the paint, lifted to a
 * floor of saturation so a muted one still shows.
 *
 * Most cars are white, silver, grey or black, with no hue to find. Those get
 * a cool silver or a graphite instead, so the scene still changes with them.
 *
 * Images from another host need CORS headers to be read (Supabase storage
 * sends them); one that cannot be read keeps the fallback.
 */

import { useEffect, useState } from 'react';

export type Rgb = [number, number, number];

/** A white or silver car's scene. */
export const SILVER: Rgb = [196, 205, 218];
/** A black or dark grey car's scene. */
export const GRAPHITE: Rgb = [58, 62, 74];

const SIZE = 64;
const HUE_BINS = 24;

export const rgbCss = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;

/** "#c8a23a" → [200, 162, 58]; anything else → null. */
export const parseHex = (value: string | null | undefined): Rgb | null => {
  const hex = value?.trim().match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (!hex) return null;
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
};

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
};

/** The paint colour in an image's pixels. */
export function paintColour(pixels: Uint8ClampedArray, width: number): Rgb {
  const height = pixels.length / 4 / width;
  const bins = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let opaque = 0;
  let dark = 0;
  let coloured = 0;

  for (let at = 0; at < pixels.length; at += 4) {
    const [r, g, b, a] = [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
    if (a < 200) continue;
    opaque += 1;
    const { h, s, l } = rgbToHsl(r, g, b);
    if (l < 0.35) dark += 1;
    if (s < 0.14 || l < 0.12 || l > 0.86) continue;
    coloured += 1;
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS))];
    // By area, not saturation: the paint covers the most of the car. The top
    // third — the windows, full of reflected sky — counts for less.
    const y = Math.floor(at / 4 / width) / height;
    const weight = (0.5 + s) * (y < 0.36 ? 0.35 : 1);
    bin.weight += weight;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  }

  if (!opaque) return SILVER;
  // Under a tenth of the car has any colour to it: a white, grey or black car.
  // Chrome and glare are light on any car, so it is black when most of it is dark.
  if (coloured / opaque < 0.15) return dark / opaque > 0.45 ? GRAPHITE : SILVER;

  // A paint spreads over neighbouring hues (light and shade shift it), so
  // each bin is scored with its two neighbours.
  const score = (at: number) => [-1, 0, 1].reduce((sum, step) => sum + bins[(at + step + HUE_BINS) % HUE_BINS].weight, 0);
  let best = 0;
  for (let at = 1; at < HUE_BINS; at += 1) if (score(at) > score(best)) best = at;
  const pool = [-1, 0, 1].map((step) => bins[(best + step + HUE_BINS) % HUE_BINS]);
  const total = pool.reduce((sum, bin) => sum + bin.weight, 0);
  const [r, g, b] = (['r', 'g', 'b'] as const).map((channel) => pool.reduce((sum, bin) => sum + bin[channel], 0) / total);
  // A muted paint (olive, slate, bronze) still has to show in the scene.
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToRgb(h, Math.max(s, 0.38), Math.min(Math.max(l, 0.3), 0.6));
}

const hslToRgb = (h: number, s: number, l: number): Rgb => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((value) => Math.round(value * 255)) as Rgb;
};

const cache = new Map<string, Promise<Rgb>>();

export function readPaintColour(src: string): Promise<Rgb> {
  let found = cache.get(src);
  if (!found) {
    found = new Promise<Rgb>((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => {
        try {
          const scale = SIZE / Math.max(image.naturalWidth, image.naturalHeight);
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return resolve(SILVER);
          context.drawImage(image, 0, 0, width, height);
          resolve(paintColour(context.getImageData(0, 0, width, height).data, width));
        } catch {
          resolve(SILVER); // a cross-origin image without CORS headers
        }
      };
      image.onerror = () => resolve(SILVER);
      image.src = src;
    });
    cache.set(src, found);
  }
  return found;
}

/** Each car's scene colour, in order: the operator's own, else read off the photo. */
export function useCarColours(cars: ReadonlyArray<{ src: string; color?: string | null }>): Array<Rgb | null> {
  const key = cars.map((car) => `${car.src}|${car.color ?? ''}`).join('\n');
  const [colours, setColours] = useState<Array<Rgb | null>>(() => cars.map((car) => parseHex(car.color)));

  useEffect(() => {
    let live = true;
    setColours(cars.map((car) => parseHex(car.color)));
    cars.forEach((car, at) => {
      if (parseHex(car.color)) return;
      readPaintColour(car.src).then((rgb) => {
        if (!live) return;
        setColours((current) => current.map((value, index) => (index === at ? rgb : value)));
      });
    });
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return colours;
}
