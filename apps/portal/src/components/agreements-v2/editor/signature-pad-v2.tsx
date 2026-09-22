"use client";

/**
 * Agreements v2: draw your signature (build-spec D9).
 *
 * A copy of components/settings/bonzah-onboarding/signature-pad.tsx, which
 * stays exactly as it is for Bonzah onboarding, with ui-v2 buttons and its two
 * defects fixed:
 *
 *  1. The ink colour. The original set `strokeStyle` to the raw value of
 *     `--foreground`, which is a bare HSL triple ("222 47% 11%"). A canvas
 *     rejects that and silently keeps its default. Here the ink is the pad's
 *     computed CSS `color` (always an `rgb(...)` a canvas accepts), read when
 *     each stroke starts. It is dark in BOTH themes, on a white pad: the image
 *     is drawn onto a white PDF page, where a light "dark mode" ink would
 *     vanish.
 *  2. Resizing. The original re-sized the canvas bitmap on every window
 *     resize, which wipes it, and restored only the value it had on first
 *     render. Here the bitmap never changes size: it is a fixed 600 × 200
 *     drawing space (at 2× for sharpness), and CSS scales it to the pad's
 *     width at a fixed 3:1 aspect ratio. A resize changes how big the drawing
 *     LOOKS, never the drawing, and never stretches it.
 *
 * The emitted PNG is cropped to what was drawn (plus a small margin) on a
 * transparent background, so the image placed in the agreement is the
 * signature, not a wide empty box around it.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, PenLine } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { cn } from "@/lib/utils";

/** The drawing space, in logical units. Pointer positions are mapped into it. */
export const SIGNATURE_PAD_WIDTH = 600;
export const SIGNATURE_PAD_HEIGHT = 200;
/** Bitmap pixels per logical unit. Fixed, so the bitmap never has to be resized. */
const BITMAP_SCALE = 2;
const LINE_WIDTH = 2.5;
/** Kept around the drawn strokes when the image is cropped. */
const CROP_MARGIN = 10;
/** Used only when the pad's colour cannot be read (no layout). */
const FALLBACK_INK = "#0f172a";

export interface PadPoint {
  x: number;
  y: number;
}

export interface PadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A pointer position, mapped into the fixed drawing space whatever size the
 * pad is on screen right now.
 */
export function toPadPoint(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">): PadPoint {
  const width = rect.width || SIGNATURE_PAD_WIDTH;
  const height = rect.height || SIGNATURE_PAD_HEIGHT;
  return {
    x: clamp(((clientX - rect.left) / width) * SIGNATURE_PAD_WIDTH, 0, SIGNATURE_PAD_WIDTH),
    y: clamp(((clientY - rect.top) / height) * SIGNATURE_PAD_HEIGHT, 0, SIGNATURE_PAD_HEIGHT),
  };
}

/**
 * The ink: the element's computed CSS `color`. `getComputedStyle` always
 * answers a colour a canvas understands (`rgb(...)`), never a bare HSL
 * triple.
 */
export function resolveInkColor(element: Element | null): string {
  if (!element || typeof getComputedStyle !== "function") return FALLBACK_INK;
  const color = getComputedStyle(element).color?.trim();
  return color ? color : FALLBACK_INK;
}

export function extendBounds(bounds: PadBounds | null, point: PadPoint, reach = LINE_WIDTH): PadBounds {
  return {
    minX: Math.min(bounds?.minX ?? point.x, point.x - reach),
    minY: Math.min(bounds?.minY ?? point.y, point.y - reach),
    maxX: Math.max(bounds?.maxX ?? point.x, point.x + reach),
    maxY: Math.max(bounds?.maxY ?? point.y, point.y + reach),
  };
}

/** The bitmap rectangle to export: the strokes plus a margin, inside the canvas. */
export function cropRect(bounds: PadBounds): { x: number; y: number; width: number; height: number } {
  const x0 = clamp(Math.floor((bounds.minX - CROP_MARGIN) * BITMAP_SCALE), 0, SIGNATURE_PAD_WIDTH * BITMAP_SCALE);
  const y0 = clamp(Math.floor((bounds.minY - CROP_MARGIN) * BITMAP_SCALE), 0, SIGNATURE_PAD_HEIGHT * BITMAP_SCALE);
  const x1 = clamp(Math.ceil((bounds.maxX + CROP_MARGIN) * BITMAP_SCALE), 0, SIGNATURE_PAD_WIDTH * BITMAP_SCALE);
  const y1 = clamp(Math.ceil((bounds.maxY + CROP_MARGIN) * BITMAP_SCALE), 0, SIGNATURE_PAD_HEIGHT * BITMAP_SCALE);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

export function SignaturePadV2({
  onChange,
  className,
}: {
  /** A PNG data URL after every stroke, or "" when cleared. */
  onChange: (dataUrl: string) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<PadPoint | null>(null);
  const boundsRef = useRef<PadBounds | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const context = () => {
    const ctx = canvasRef.current?.getContext("2d") ?? null;
    if (!ctx) return null;
    ctx.setTransform(BITMAP_SCALE, 0, 0, BITMAP_SCALE, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = LINE_WIDTH;
    return ctx;
  };

  const pointOf = (e: ReactPointerEvent<HTMLCanvasElement>) =>
    toPadPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());

  const exportImage = (): string => {
    const canvas = canvasRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !bounds) return "";
    const rect = cropRect(bounds);
    const out = document.createElement("canvas");
    out.width = rect.width;
    out.height = rect.height;
    const outCtx = out.getContext("2d");
    if (!outCtx) return canvas.toDataURL("image/png");
    outCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return out.toDataURL("image/png");
  };

  const begin = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = context();
    if (!ctx) return;
    drawingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pointOf(e);
    lastRef.current = p;
    // Read now, not once at mount: the colour is whatever the pad is styled
    // with at the moment the stroke starts.
    const ink = resolveInkColor(e.currentTarget);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    // A tap leaves a dot, as a pen would.
    ctx.beginPath();
    ctx.arc(p.x, p.y, LINE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    boundsRef.current = extendBounds(boundsRef.current, p);
    setIsEmpty(false);
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastRef.current) return;
    const ctx = context();
    if (!ctx) return;
    const p = pointOf(e);
    ctx.strokeStyle = resolveInkColor(e.currentTarget);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    boundsRef.current = extendBounds(boundsRef.current, p);
  };

  const end = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const url = exportImage();
    if (url) onChange(url);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    boundsRef.current = null;
    setIsEmpty(true);
    onChange("");
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* White with dark ink in both themes: this is a sheet of paper. */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-white">
        <canvas
          ref={canvasRef}
          width={SIGNATURE_PAD_WIDTH * BITMAP_SCALE}
          height={SIGNATURE_PAD_HEIGHT * BITMAP_SCALE}
          aria-label="Draw your signature"
          role="img"
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          className="block aspect-[3/1] h-auto w-full cursor-crosshair touch-none text-slate-900"
        />
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-400">
            <PenLine className="size-4" aria-hidden="true" />
            Sign here
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Use your mouse, trackpad or finger.</p>
        <Button type="button" variant="ghost" size="xs" onClick={clear} disabled={isEmpty}>
          <Eraser data-icon="inline-start" />
          Clear
        </Button>
      </div>
    </div>
  );
}
