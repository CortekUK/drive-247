"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VehicleImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
  title: string;
  subtitle?: string | null;
  /** Index to show first when the lightbox opens */
  initialIndex?: number;
}

/**
 * Full-screen vehicle photo gallery. Big image at the top, a clickable
 * thumbnail strip at the bottom. Arrow keys / on-screen chevrons navigate,
 * Esc or clicking outside closes.
 *
 * Loading UX: the current image shows a spinner until it decodes, and the
 * neighbouring images are preloaded in the background so left/right feels
 * instant. Already-decoded images skip the spinner entirely.
 */
export default function VehicleImageLightbox({
  open,
  onOpenChange,
  images,
  title,
  subtitle,
  initialIndex = 0,
}: VehicleImageLightboxProps) {
  const [index, setIndex] = React.useState(initialIndex);
  const [loaded, setLoaded] = React.useState<Record<string, boolean>>({});
  const thumbsRef = React.useRef<HTMLDivElement>(null);

  const markLoaded = React.useCallback((src: string) => {
    setLoaded((prev) => (prev[src] ? prev : { ...prev, [src]: true }));
  }, []);

  // Reset to the requested image each time the lightbox is opened
  React.useEffect(() => {
    if (open) {
      setIndex(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
    }
  }, [open, initialIndex, images.length]);

  const total = images.length;
  const go = React.useCallback(
    (dir: number) => {
      if (total === 0) return;
      setIndex((prev) => (prev + dir + total) % total);
    },
    [total],
  );

  // Preload the current image + its neighbours so navigation is instant.
  React.useEffect(() => {
    if (!open || total === 0) return;
    const toPreload = [index, (index + 1) % total, (index - 1 + total) % total];
    for (const i of toPreload) {
      const src = images[i];
      if (!src || loaded[src]) continue;
      const img = new Image();
      img.onload = () => markLoaded(src);
      img.src = src;
    }
  }, [open, index, total, images, loaded, markLoaded]);

  // Keep the active thumbnail in view
  React.useEffect(() => {
    if (!open) return;
    const strip = thumbsRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(`[data-thumb-index="${index}"]`);
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [index, open]);

  // Arrow-key navigation
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  if (total === 0) return null;

  const currentSrc = images[index];
  const isLoading = !loaded[currentSrc];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[92vh] w-[96vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-3 focus:outline-none sm:gap-4 sm:p-5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 text-white">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-base font-semibold sm:text-lg">
                {title}
              </DialogPrimitive.Title>
              {subtitle ? (
                <DialogPrimitive.Description className="truncate text-xs text-white/60 sm:text-sm">
                  {subtitle}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">
                  {title} photo gallery
                </DialogPrimitive.Description>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-sm tabular-nums text-white/70">
                {index + 1} / {total}
              </span>
              <DialogPrimitive.Close className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none">
                <X className="h-5 w-5" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Big image */}
          <div className="relative flex-1 overflow-hidden rounded-xl bg-white/5">
            {/* Loading spinner — shown until the current image decodes */}
            {isLoading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-white/70">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-xs">Loading photo…</span>
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={currentSrc}
              src={currentSrc}
              alt={`${title} — photo ${index + 1}`}
              decoding="async"
              fetchPriority="high"
              onLoad={() => markLoaded(currentSrc)}
              className={cn(
                "h-full w-full object-contain transition-opacity duration-300",
                isLoading ? "opacity-0" : "opacity-100",
              )}
            />
            {total > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  className="absolute left-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  className="absolute right-3 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {total > 1 && (
            <div
              ref={thumbsRef}
              className="flex shrink-0 gap-2 overflow-x-auto pb-1"
            >
              {images.map((src, idx) => (
                <button
                  key={idx}
                  type="button"
                  data-thumb-index={idx}
                  onClick={() => setIndex(idx)}
                  className={cn(
                    "relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-white/5 transition-all sm:h-16 sm:w-24",
                    idx === index
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-black"
                      : "opacity-60 hover:opacity-100",
                  )}
                  aria-label={`View photo ${idx + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onLoad={() => markLoaded(src)}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
