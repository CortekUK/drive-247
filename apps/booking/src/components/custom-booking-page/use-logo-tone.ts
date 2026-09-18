"use client";

import { useEffect, useState } from "react";

/**
 * Which grounds does an uploaded logo actually read on?
 *
 *   "light" — drawn in light ink; needs a DARK ground. Invisible on white.
 *   "dark"  — drawn in dark ink;  needs a LIGHT ground. Invisible on midnight.
 *   null    — enough of both, or not measurable. Callers change nothing.
 *
 * Operators upload one logo, built for whichever ground their old site used,
 * and nothing in the database records which. Guessing from the filename would
 * be guessing, so this measures it — and mean luminance is the wrong measure:
 * one platform logo averages 0.59, which sounds mid-grey, yet only 44% of its
 * ink is dark enough to read on white and it disappears there.
 *
 * So it counts the SHARE of the mark that has usable contrast on each ground.
 * Measured across three real tenant logos: 71% / 44% / 0% readable on white —
 * a 55% cut separates them cleanly with room either side.
 *
 * Transparent padding is skipped. Most logos are mostly transparent, and
 * counting those pixels would report every one of them as light.
 *
 * Fails safe: no canvas, a tainted canvas, a load error, or a mark with almost
 * no opaque pixels all return null. Cached per URL — one decode per logo.
 */

export type LogoTone = "light" | "dark";

const cache = new Map<string, LogoTone | null>();
const inflight = new Map<string, Promise<LogoTone | null>>();

/** Luma at or below this reads acceptably on white; above it, on dark. */
const MID = 0.5;
/** A logo needs at least this share of readable ink to survive a ground. */
const MIN_READABLE = 0.55;
/** Below this share of opaque pixels the sample is not worth trusting. */
const MIN_OPAQUE_RATIO = 0.02;

function measure(url: string): Promise<LogoTone | null> {
  return new Promise(resolve => {
    const img = new Image();
    // The storage bucket serves `Access-Control-Allow-Origin: *`, so the
    // canvas stays untainted and `getImageData` is readable.
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        // A small sample is plenty for a share and costs almost nothing.
        const W = 48;
        const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W)) || 48;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);

        ctx.drawImage(img, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);

        let opaque = 0;
        let darkInk = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue; // transparent padding
          // Rec. 601 luma is enough: this is a light/dark decision, not a
          // contrast-ratio calculation.
          const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
          opaque++;
          if (l <= MID) darkInk++;
        }

        const total = data.length / 4;
        if (!opaque || opaque / total < MIN_OPAQUE_RATIO) return resolve(null);

        const darkShare = darkInk / opaque;   // reads on white
        const lightShare = 1 - darkShare;     // reads on dark

        if (darkShare < MIN_READABLE && darkShare <= lightShare) return resolve("light");
        if (lightShare < MIN_READABLE && lightShare < darkShare) return resolve("dark");
        return resolve(null); // survives both grounds
      } catch {
        // Tainted canvas or a blocked read — say nothing rather than guess.
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function useLogoTone(url: string | null | undefined): LogoTone | null {
  const [tone, setTone] = useState<LogoTone | null>(() => (url ? cache.get(url) ?? null : null));

  useEffect(() => {
    if (!url) { setTone(null); return; }
    if (cache.has(url)) { setTone(cache.get(url) ?? null); return; }

    let cancelled = false;
    const job = inflight.get(url) ?? measure(url);
    inflight.set(url, job);

    job.then(result => {
      cache.set(url, result);
      inflight.delete(url);
      if (!cancelled) setTone(result);
    });

    return () => { cancelled = true; };
  }, [url]);

  return tone;
}
