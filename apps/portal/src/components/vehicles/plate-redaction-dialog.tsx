"use client";

/**
 * Hide the number plate on ONE vehicle photo.
 *
 * Two things about this screen are deliberate and easy to undo by accident:
 *
 * 1. It is MANUAL-FIRST. Trax is asked once, as a convenience, but on the eight
 *    real photos measured on this platform it found zero plates. The drag-a-box
 *    path is therefore the main path, not the fallback, and "Trax found nothing"
 *    is phrased as guidance rather than as a failure.
 *
 * 2. It fills an OPAQUE RECTANGLE. A CSS blur or a low-radius pixelate can be
 *    reversed well enough to read a plate; black pixels carry no information.
 *
 * The image is decoded exactly once and that single raster is used both for
 * what the operator sees and for what gets painted, so the box drawn and the
 * box filled cannot drift apart. Regions live as ratios (0-1) for the same
 * reason: the display size is never the natural size.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Eraser,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react";
import { usePlateRedaction, type PlateRegion } from "@/hooks/use-plate-redaction";
import { cn } from "@/lib/utils";

/* ─────────────────────────────── tuning ─────────────────────────────── */

/**
 * Grow every region by this fraction of its own size on each edge. A box drawn
 * in a hurry tends to clip a character at the end of the plate; 6% costs a few
 * pixels of bodywork and buys back the near-misses.
 */
const REGION_PADDING = 0.06;

/** Ignore anything smaller than this — it is a tap, not a box. */
const MIN_REGION_RATIO = 0.01;

/** Backing-store cap for the on-screen canvas. Plenty sharp, cheap to redraw. */
const MAX_DISPLAY_EDGE = 1600;

/**
 * Canvas area ceiling for the EXPORT canvas. Browsers (iOS Safari in
 * particular) silently hand back a blank canvas above roughly 16.7M pixels, so
 * anything larger is scaled down rather than exported as an empty black frame.
 */
const MAX_EXPORT_AREA = 16_777_216;

/** Refuse to decode absurd inputs rather than hanging the tab. */
const MAX_DECODE_AREA = 100_000_000;

/** Keep the request body inside what an edge function will accept. */
const MAX_JPEG_BYTES = 5_000_000;
const QUALITY_LADDER = [0.9, 0.8, 0.7, 0.6, 0.5];

const INDIGO = "#6366f1";

/* ──────────────────────────────── types ──────────────────────────────── */

export interface PlateRedactionPhoto {
  id: string;
  photo_url: string;
  redacted_url?: string | null;
  redaction_status?: string | null;
}

export interface PlateRedactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photo: PlateRedactionPhoto;
  vehicleReg: string;
  tenantId: string;
}

interface EditableRegion extends PlateRegion {
  key: string;
  source: "trax" | "manual";
}

interface Raster {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Present when decoded via createImageBitmap; must be closed to free memory. */
  bitmap: ImageBitmap | null;
  /** Present on the <img> fallback path; must be revoked. */
  objectUrl: string | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";
type DetectState = "idle" | "running" | "found" | "empty" | "failed";

/* ──────────────────────────── geometry helpers ──────────────────────────── */

/** Grow a region by REGION_PADDING on each edge, clipped to the image. */
export function padRegion(region: PlateRegion): PlateRegion {
  const padX = region.width * REGION_PADDING;
  const padY = region.height * REGION_PADDING;

  let x = region.x - padX;
  let y = region.y - padY;
  let width = region.width + padX * 2;
  let height = region.height + padY * 2;

  if (x < 0) {
    width += x;
    x = 0;
  }
  if (y < 0) {
    height += y;
    y = 0;
  }
  if (x + width > 1) width = 1 - x;
  if (y + height > 1) height = 1 - y;

  return { x, y, width: Math.max(0, width), height: Math.max(0, height) };
}

function rectFromPoints(ax: number, ay: number, bx: number, by: number): PlateRegion {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  return { x, y, width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/* ──────────────────────────── image plumbing ──────────────────────────── */

/**
 * Fetch the bytes ourselves and decode from the Blob.
 *
 * Never `crossOrigin` on an <img>: a tainted canvas throws on toBlob and the
 * whole feature dies at the last step. A Blob (and a blob: URL made from it) is
 * same-origin by construction, so the canvas stays clean either way.
 *
 * `imageOrientation: 'from-image'` matters more than it looks — a phone photo
 * carries its rotation in EXIF, and decoding without it paints the plate
 * sideways from where the operator drew the box.
 */
async function loadRaster(url: string, signal: AbortSignal): Promise<Raster> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Could not download the photo (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("The photo file is empty.");

  if (typeof createImageBitmap === "function") {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // Older engines reject the options bag; orientation is then whatever the
      // decoder does by default, which is still consistent between the raster
      // we display and the raster we paint.
      bitmap = await createImageBitmap(blob);
    }
    if (bitmap.width * bitmap.height > MAX_DECODE_AREA) {
      bitmap.close?.();
      throw new Error("This photo is too large to edit in the browser.");
    }
    return { source: bitmap, width: bitmap.width, height: bitmap.height, bitmap, objectUrl: null };
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("The photo could not be decoded."));
      el.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      bitmap: null,
      objectUrl,
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function releaseRaster(raster: Raster | null) {
  if (!raster) return;
  raster.bitmap?.close?.();
  if (raster.objectUrl) URL.revokeObjectURL(raster.objectUrl);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The browser could not export the image."))),
      "image/jpeg",
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the exported image."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Paint the regions onto a full-size copy and hand back a JPEG.
 *
 * Natural size unless the browser cannot hold a canvas that big, in which case
 * a scaled export is still a redacted photo whereas a blank one is a leak.
 */
async function exportRedactedJpeg(raster: Raster, regions: PlateRegion[]): Promise<Blob> {
  let width = raster.width;
  let height = raster.height;

  const area = width * height;
  if (area > MAX_EXPORT_AREA) {
    const scale = Math.sqrt(MAX_EXPORT_AREA / area);
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser does not support image editing.");

  ctx.drawImage(raster.source, 0, 0, width, height);

  ctx.fillStyle = "#000000";
  for (const region of regions) {
    const padded = padRegion(region);
    // Floor the origin and ceil the size so rounding can only ever cover more.
    ctx.fillRect(
      Math.floor(padded.x * width),
      Math.floor(padded.y * height),
      Math.ceil(padded.width * width),
      Math.ceil(padded.height * height),
    );
  }

  let smallest: Blob | null = null;
  for (const quality of QUALITY_LADDER) {
    const blob = await canvasToBlob(canvas, quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= MAX_JPEG_BYTES) return blob;
  }

  if (smallest && smallest.size <= MAX_JPEG_BYTES * 1.5) return smallest;
  throw new Error("This photo is too large to upload after editing.");
}

/* ─────────────────────────────── component ─────────────────────────────── */

export function PlateRedactionDialog({
  open,
  onOpenChange,
  photo,
  vehicleReg,
  tenantId,
}: PlateRedactionDialogProps) {
  const { detectRegions, saveRedaction, markNoPlate, restoreOriginal } =
    usePlateRedaction(tenantId);

  const isRedacted = photo.redaction_status === "redacted" && !!photo.redacted_url;
  const isMarkedNoPlate = photo.redaction_status === "no_plate";

  /** `view` shows what customers currently see; `edit` is the drawing surface. */
  const [mode, setMode] = useState<"view" | "edit">(isRedacted ? "view" : "edit");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regions, setRegions] = useState<EditableRegion[]>([]);
  const [draft, setDraft] = useState<PlateRegion | null>(null);
  const [detectState, setDetectState] = useState<DetectState>("idle");
  const [detectMessage, setDetectMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rasterRef = useRef<Raster | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const detectedForRef = useRef<string | null>(null);

  const busy =
    saveRedaction.isPending || markNoPlate.isPending || restoreOriginal.isPending;

  /** Which file this dialog is currently looking at. */
  const activeUrl = mode === "view" && isRedacted ? photo.redacted_url! : photo.photo_url;

  /* ── reset whenever the dialog opens on a (possibly different) photo ── */
  useEffect(() => {
    if (!open) return;
    setMode(photo.redaction_status === "redacted" && !!photo.redacted_url ? "view" : "edit");
    setRegions([]);
    setDraft(null);
    setExportError(null);
    setDetectState("idle");
    setDetectMessage(null);
    detectedForRef.current = null;
  }, [open, photo.id, photo.redaction_status, photo.redacted_url]);

  /* ── decode once, keep the raster ── */
  useEffect(() => {
    if (!open || !activeUrl) return;

    const controller = new AbortController();
    let cancelled = false;

    setLoadState("loading");
    setLoadError(null);

    loadRaster(activeUrl, controller.signal)
      .then((raster) => {
        if (cancelled) {
          releaseRaster(raster);
          return;
        }
        releaseRaster(rasterRef.current);
        rasterRef.current = raster;
        setNaturalSize({ width: raster.width, height: raster.height });
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "The photo could not be loaded.");
        setLoadState("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, activeUrl, reloadNonce]);

  /* ── free the raster when the dialog goes away ── */
  useEffect(() => {
    if (open) return;
    releaseRaster(rasterRef.current);
    rasterRef.current = null;
    setLoadState("idle");
  }, [open]);

  useEffect(
    () => () => {
      releaseRaster(rasterRef.current);
      rasterRef.current = null;
    },
    [],
  );

  /* ── ask Trax once, in the background, as a convenience ── */
  const runDetection = useCallback(
    async () => {
      const raster = rasterRef.current;
      if (!raster) return;

      setDetectState("running");
      setDetectMessage(null);
      try {
        const result = await detectRegions.mutateAsync({
          photoId: photo.id,
          imageWidth: raster.width,
          imageHeight: raster.height,
        });

        if (result.found) {
          setRegions((prev) => [
            ...prev,
            ...result.regions.map((r, i) => ({
              ...r,
              key: `trax-${Date.now()}-${i}`,
              source: "trax" as const,
            })),
          ]);
          setDetectState("found");
        } else {
          setDetectState("empty");
        }
        setDetectMessage(result.message ?? null);
      } catch (error: unknown) {
        setDetectState("failed");
        setDetectMessage(
          error instanceof Error ? error.message : "Trax could not be reached.",
        );
      }
    },
    [detectRegions, photo.id],
  );

  useEffect(() => {
    if (!open || mode !== "edit" || loadState !== "ready") return;
    if (detectedForRef.current === photo.id) return;
    detectedForRef.current = photo.id;
    void runDetection();
  }, [open, mode, loadState, photo.id, runDetection]);

  /* ── draw: the same raster the export uses ── */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const raster = rasterRef.current;
    if (!canvas || !raster || loadState !== "ready") return;

    const scale = Math.min(1, MAX_DISPLAY_EDGE / Math.max(raster.width, raster.height));
    const renderW = Math.max(1, Math.round(raster.width * scale));
    const renderH = Math.max(1, Math.round(raster.height * scale));

    if (canvas.width !== renderW) canvas.width = renderW;
    if (canvas.height !== renderH) canvas.height = renderH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, renderW, renderH);
    ctx.drawImage(raster.source, 0, 0, renderW, renderH);

    if (mode !== "edit") return;

    // Preview exactly what will be painted: padded, opaque, black.
    for (const region of regions) {
      const padded = padRegion(region);
      const x = padded.x * renderW;
      const y = padded.y * renderH;
      const w = padded.width * renderW;
      const h = padded.height * renderH;

      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = INDIGO;
      ctx.lineWidth = Math.max(2, renderW / 400);
      ctx.strokeRect(x, y, w, h);
    }

    if (draft) {
      const x = draft.x * renderW;
      const y = draft.y * renderH;
      const w = draft.width * renderW;
      const h = draft.height * renderH;

      ctx.fillStyle = "rgba(99, 102, 241, 0.3)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = INDIGO;
      ctx.lineWidth = Math.max(2, renderW / 400);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  }, [loadState, mode, regions, draft]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  /* ── pointer events cover mouse, pen and touch in one path ── */
  const ratioFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "edit" || loadState !== "ready" || busy) return;
    const point = ratioFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStartRef.current = point;
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
    setExportError(null);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const point = ratioFromEvent(event);
    if (!point) return;
    event.preventDefault();
    setDraft(rectFromPoints(start.x, start.y, point.x, point.y));
  };

  const commitDraft = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const point = ratioFromEvent(event);
    const rect = point ? rectFromPoints(start.x, start.y, point.x, point.y) : draft;
    setDraft(null);

    if (!rect || rect.width < MIN_REGION_RATIO || rect.height < MIN_REGION_RATIO) return;

    setRegions((prev) => [
      ...prev,
      { ...rect, key: `manual-${Date.now()}-${prev.length}`, source: "manual" as const },
    ]);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
  };

  /**
   * Only abandon the box when the pointer really escaped. While the canvas holds
   * pointer capture, dragging past its edge is normal — the plate is often right
   * at the edge of the frame, and cancelling there would make the box
   * undrawable. Without capture (older engines) leaving really does end it.
   */
  const handlePointerLeave = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
    handlePointerCancel(event);
  };

  /* ── actions ── */
  const handleConfirm = async () => {
    const raster = rasterRef.current;
    if (!raster || regions.length === 0) return;

    setExportError(null);

    // The two halves fail for unrelated reasons and must not share a catch:
    // the canvas half has no toast of its own, so swallowing it would leave the
    // operator staring at a dialog that looks like it worked.
    let imageBase64: string;
    try {
      const blob = await exportRedactedJpeg(raster, regions);
      imageBase64 = await blobToBase64(blob);
    } catch (error: unknown) {
      setExportError(
        error instanceof Error ? error.message : "The edit could not be applied to the image.",
      );
      return;
    }

    try {
      const padded = regions.map((r) => padRegion(r));
      await saveRedaction.mutateAsync({ photoId: photo.id, imageBase64, regions: padded });
      onOpenChange(false);
    } catch {
      /* toasted by the hook */
    }
  };

  const handleNoPlate = async () => {
    try {
      await markNoPlate.mutateAsync(photo.id);
      onOpenChange(false);
    } catch {
      /* toasted by the hook */
    }
  };

  const handleRestore = async () => {
    try {
      await restoreOriginal.mutateAsync(photo.id);
      onOpenChange(false);
    } catch {
      /* toasted by the hook */
    }
  };

  const naturalLabel = useMemo(
    () => (loadState === "ready" && naturalSize ? `${naturalSize.width} × ${naturalSize.height}` : null),
    [loadState, naturalSize],
  );

  const canConfirm = mode === "edit" && loadState === "ready" && regions.length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-3xl gap-4 border-[#f1f5f9] p-6 shadow-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Hide number plate
            {isRedacted && (
              <Badge variant="secondary" className="ml-1 text-[11px] font-normal">
                Currently hidden
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {mode === "view"
              ? `This is what customers see for ${vehicleReg}.`
              : `Drag a box over the number plate on this photo of ${vehicleReg}. The area is filled with solid black — it cannot be undone by the viewer.`}
          </DialogDescription>
        </DialogHeader>

        {/* ── image surface ── */}
        <div className="rounded-lg border border-[#f1f5f9] bg-[#f8fafc] p-3">
          {loadState === "error" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive/70" />
              <div>
                <p className="text-sm font-medium text-foreground">This photo could not be loaded</p>
                <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReloadNonce((n) => n + 1)}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          ) : loadState !== "ready" ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-xs">Loading photo…</p>
            </div>
          ) : (
            <div className="flex justify-center">
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={commitDraft}
                onPointerCancel={handlePointerCancel}
                onPointerLeave={handlePointerLeave}
                className={cn(
                  "block rounded-md bg-white select-none",
                  mode === "edit" && !busy ? "cursor-crosshair" : "cursor-default",
                )}
                style={{
                  maxWidth: "100%",
                  maxHeight: "58vh",
                  width: "auto",
                  height: "auto",
                  // Without this a drag on a phone scrolls the dialog instead of
                  // drawing a box.
                  touchAction: "none",
                }}
              />
            </div>
          )}
        </div>

        {/* ── status strip ── */}
        {mode === "edit" && loadState === "ready" && (
          <div className="space-y-2">
            {detectState === "running" && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Asking Trax to find the plate… you can start drawing now.
              </p>
            )}

            {detectState === "empty" && (
              <Alert className="border-[#f1f5f9] bg-[#f8fafc]">
                <Sparkles className="h-4 w-4" />
                <AlertTitle className="text-sm font-medium">No plate found automatically</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  Trax could not find a plate in this photo. Drag a box over it yourself, or mark it
                  as having no plate.
                </AlertDescription>
              </Alert>
            )}

            {detectState === "failed" && (
              <Alert className="border-[#f1f5f9] bg-[#f8fafc]">
                <Sparkles className="h-4 w-4" />
                <AlertTitle className="text-sm font-medium">Automatic detection unavailable</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  {detectMessage || "Trax could not be reached."} Drag a box over the plate yourself
                  to carry on.
                </AlertDescription>
              </Alert>
            )}

            {detectState === "found" && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Trax proposed a box. Check it covers the whole plate — remove it and drag your own if
                it does not.
              </p>
            )}

            {isMarkedNoPlate && (
              <Alert className="border-[#f1f5f9] bg-[#f8fafc]">
                <Square className="h-4 w-4" />
                <AlertTitle className="text-sm font-medium">Marked as having no plate</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  Customers see this photo unchanged. You can still cover an area below, or undo the
                  mark.
                </AlertDescription>
              </Alert>
            )}

            {exportError && (
              <Alert variant="destructive" className="border-destructive/40">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm font-medium">The edit was not saved</AlertTitle>
                <AlertDescription className="text-xs">{exportError}</AlertDescription>
              </Alert>
            )}

            {/* region list — remove is the way to "adjust" a box */}
            <div className="flex flex-wrap items-center gap-2">
              {regions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No areas marked yet. Drag across the number plate on the photo above.
                </p>
              ) : (
                regions.map((region, index) => (
                  <span
                    key={region.key}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#f1f5f9] bg-white px-2 py-1 text-xs"
                  >
                    <span className="h-2 w-2 rounded-[2px] bg-[#0f172a]" />
                    Area {index + 1}
                    <span className="text-muted-foreground">
                      {region.source === "trax" ? "· Trax" : "· drawn"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setRegions((prev) => prev.filter((r) => r.key !== region.key))
                      }
                      disabled={busy}
                      className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      aria-label={`Remove area ${index + 1}`}
                    >
                      ✕
                    </button>
                  </span>
                ))
              )}

              {regions.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setRegions([])}
                  disabled={busy}
                >
                  <Eraser className="mr-1 h-3 w-3" />
                  Clear all
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void runDetection()}
                disabled={detectState === "running" || busy}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                {detectState === "running" ? "Asking Trax…" : "Ask Trax again"}
              </Button>

              {naturalLabel && (
                <span className="ml-auto text-[11px] text-muted-foreground">{naturalLabel} px</span>
              )}
            </div>
          </div>
        )}

        {mode === "view" && (
          <p className="text-xs text-muted-foreground">
            The plate on this photo is covered with solid black. Restoring puts the original photo
            back for customers.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>

          {mode === "view" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setMode("edit")} disabled={busy}>
                Edit again
              </Button>
              <Button type="button" variant="destructive" onClick={handleRestore} disabled={busy}>
                {restoreOriginal.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="mr-1.5 h-4 w-4" />
                )}
                Restore original
              </Button>
            </>
          ) : (
            <>
              {isRedacted || isMarkedNoPlate ? (
                <Button type="button" variant="outline" onClick={handleRestore} disabled={busy}>
                  {restoreOriginal.isPending ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Undo2 className="mr-1.5 h-4 w-4" />
                  )}
                  Undo
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleNoPlate}
                  disabled={busy || loadState !== "ready"}
                >
                  {markNoPlate.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  No plate in this photo
                </Button>
              )}

              <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
                {saveRedaction.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                )}
                {regions.length > 1 ? `Hide ${regions.length} areas` : "Hide number plate"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PlateRedactionDialog;
