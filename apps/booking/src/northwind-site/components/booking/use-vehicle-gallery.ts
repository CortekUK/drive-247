"use client";

import { useEffect, useState } from "react";

import type { VehicleImage } from "@nw/lib/vehicles/types";

/**
 * The photo viewer's state: which photo is showing, and which URLs failed to
 * load (and are dropped rather than shown broken). Shared by
 * `vehicle-gallery.tsx` and `@nw/site-v2/booking/vehicle-gallery`, which differ
 * only in how they draw it.
 */
export function useVehicleGallery(images: readonly VehicleImage[]) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  // A different vehicle (or a photo re-order) must not leave the viewer parked
  // on an index that no longer exists.
  useEffect(() => {
    setIndex(0);
  }, [images]);

  const usable = images.filter((image) => !failed.has(image.url));
  const active = usable[Math.min(index, Math.max(0, usable.length - 1))];

  const step = (delta: number) => {
    setIndex((current) => {
      const next = current + delta;
      if (next < 0) return usable.length - 1;
      if (next >= usable.length) return 0;
      return next;
    });
  };

  const markFailed = (url: string) =>
    setFailed((current) => new Set(current).add(url));

  return { index, setIndex, usable, active, step, markFailed };
}
