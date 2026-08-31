"use client";

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { VehicleImage } from "@/lib/vehicles/types";

/**
 * The vehicle's photos.
 *
 * `<img>` rather than `next/image` on purpose. These URLs come from the
 * database and are whatever the operator uploaded — today they are local paths
 * under /public, in production they are Supabase Storage or an operator's own
 * CDN. `next/image` refuses any host absent from `images.remotePatterns`, and
 * `next.config.ts` currently declares none, so an optimised tag would 400 on
 * every real tenant. Adding those patterns is a config change outside this
 * workstream; see the handoff.
 *
 * The images are already redacted where the operator published a redacted copy
 * — `normalizeVehicleImages` resolves that before they reach here, so nothing
 * in this component needs to know about number plates.
 *
 * `inset` is the variant that lives at the top of the vehicle card: the frame
 * loses its own border and radius (the card clips it) and the thumbnail strip
 * is padded in and shortened, because the card is a ~380px rail and every pixel
 * it spends is a pixel the price block below it does not get.
 */
export function VehicleGallery({
  images,
  alt,
  variant = "standalone",
  className,
}: {
  images: readonly VehicleImage[];
  alt: string;
  variant?: "standalone" | "inset";
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  // A different vehicle (or a photo re-order) must not leave the viewer parked
  // on an index that no longer exists.
  useEffect(() => {
    setIndex(0);
  }, [images]);

  const inset = variant === "inset";
  const usable = images.filter((image) => !failed.has(image.url));
  const active = usable[Math.min(index, Math.max(0, usable.length - 1))];

  if (!active) {
    return (
      <div
        className={cn(
          "flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-brand-stone/50",
          inset ? "" : "rounded-[18px] border border-brand-border-soft",
          className,
        )}
      >
        <ImageOff
          aria-hidden
          strokeWidth={1.5}
          className="size-7 text-brand-text-subtle"
        />
        <p className="text-xs text-brand-text-subtle">No photos yet</p>
      </div>
    );
  }

  const step = (delta: number) => {
    setIndex((current) => {
      const next = current + delta;
      if (next < 0) return usable.length - 1;
      if (next >= usable.length) return 0;
      return next;
    });
  };

  return (
    <div className={cn(inset ? "" : "space-y-3", className)}>
      <div
        className={cn(
          "relative overflow-hidden bg-white",
          inset ? "" : "rounded-[18px] border border-brand-border-soft",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={alt}
          loading="eager"
          className="aspect-[16/10] w-full object-cover"
          onError={() =>
            setFailed((current) => new Set(current).add(active.url))
          }
        />

        {usable.length > 1 ? (
          <>
            <GalleryArrow side="left" onClick={() => step(-1)} />
            <GalleryArrow side="right" onClick={() => step(1)} />
            <p className="absolute bottom-2.5 right-2.5 rounded-full bg-brand-forest-deep/80 px-2.5 py-1 text-[11px] font-medium text-white tabular-nums">
              {Math.min(index, usable.length - 1) + 1} / {usable.length}
            </p>
          </>
        ) : null}
      </div>

      {usable.length > 1 ? (
        <ul
          className={cn(
            "flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            inset ? "px-3 pb-1 pt-3" : "pb-1",
          )}
        >
          {usable.map((image, position) => (
            <li key={image.url}>
              <button
                type="button"
                aria-label={`Show photo ${position + 1}`}
                aria-current={position === index}
                onClick={() => setIndex(position)}
                className={cn(
                  "block shrink-0 overflow-hidden rounded-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25",
                  inset ? "h-12 w-[68px]" : "h-16 w-24",
                  position === index
                    ? "border-brand-forest"
                    : "border-brand-border-soft hover:border-brand-text-subtle",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                  onError={() =>
                    setFailed((current) => new Set(current).add(image.url))
                  }
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GalleryArrow({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={cn(
        // 44px on touch, 36px once there is a pointer to aim with.
        "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-brand-border-soft bg-white/90 text-brand-text transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 lg:size-9",
        side === "left" ? "left-2.5" : "right-2.5",
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
    </button>
  );
}
