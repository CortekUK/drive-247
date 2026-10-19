"use client";

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react-nw";

import { useVehicleGallery } from "@nw/components/booking/use-vehicle-gallery";
import { cn } from "@nw/lib/utils";
import type { VehicleImage } from "@nw/lib/vehicles/types";

/**
 * The vehicle's photos, v2 — same props as `components/booking/vehicle-gallery`
 * and the same viewer state (`useVehicleGallery`), drawn in the portal v2
 * language: a 16px-radius frame, pill arrows, a quiet thumbnail strip.
 *
 * `<img>` rather than `next/image` for the same reason as v1: these URLs are
 * whatever the operator uploaded, and no remote host is allowlisted.
 *
 * `inset` drops the frame's own border and radius, for when a card clips it.
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
  const { index, setIndex, usable, active, step, markFailed } = useVehicleGallery(images);
  const inset = variant === "inset";
  const frame = inset ? "" : "rounded-2xl border border-pv-border";

  if (!active) {
    return (
      <div
        className={cn(
          "flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 bg-pv-muted md:aspect-[16/9]",
          frame,
          className,
        )}
      >
        <ImageOff aria-hidden strokeWidth={1.5} className="size-7 text-pv-muted-fg" />
        <p className="text-[13px] text-pv-muted-fg">No photos yet</p>
      </div>
    );
  }

  const position = Math.min(index, usable.length - 1);

  return (
    <div className={cn(inset ? "" : "space-y-3", className)}>
      <div className={cn("relative overflow-hidden bg-pv-muted", frame)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={alt}
          loading="eager"
          className="aspect-[16/10] w-full object-cover md:aspect-[16/9]"
          onError={() => markFailed(active.url)}
        />

        {usable.length > 1 ? (
          <>
            <GalleryArrow side="left" onClick={() => step(-1)} />
            <GalleryArrow side="right" onClick={() => step(1)} />
            <p className="absolute bottom-3 right-3 rounded-full bg-pv-fg/70 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white">
              {position + 1} / {usable.length}
            </p>
          </>
        ) : null}
      </div>

      {usable.length > 1 ? (
        <ul
          className={cn(
            "flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            inset ? "px-4 pt-4 md:px-5" : "pb-1",
          )}
        >
          {usable.map((image, slot) => (
            <li key={image.url}>
              <button
                type="button"
                aria-label={`Show photo ${slot + 1}`}
                aria-current={slot === index}
                onClick={() => setIndex(slot)}
                className={cn(
                  "block h-14 w-20 shrink-0 overflow-hidden rounded-[10px] border-2 transition-colors duration-200 ease-out motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30",
                  slot === index ? "border-pv-primary" : "border-transparent opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                  onError={() => markFailed(image.url)}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GalleryArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={cn(
        // 44px on touch, 36px once there is a pointer to aim with.
        "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-pv-border bg-pv-card/90 text-pv-fg",
        "transition-colors duration-200 ease-out hover:bg-pv-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none lg:size-9",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="size-4" strokeWidth={2} />
    </button>
  );
}
