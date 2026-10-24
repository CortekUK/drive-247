'use client';

/**
 * Crop a profile photo to a circle — the portal's AvatarCropDialogV2
 * (apps/portal/src/components/shared/layout/avatar-crop-dialog-v2.tsx), the
 * same dialog and the same round frame, without its `react-easy-crop`
 * dependency: drag the picture to place it, the slider (or the wheel) to zoom.
 * The result is a 512px PNG clipped to the circle, as the portal uploads.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const FRAME = 300; // the circle's diameter on screen
const OUT = 512; // the uploaded picture's size

export function AvatarCropDialog({
  open,
  onOpenChange,
  imageSrc,
  onCropComplete,
  isUploading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageSrc: string | null;
  onCropComplete: (blob: Blob) => void;
  isUploading: boolean;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    setImg(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    if (!imageSrc) return;
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = imageSrc;
  }, [imageSrc]);

  // At zoom 1 the picture just covers the circle.
  const base = img ? FRAME / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : 0;
  const h = img ? img.naturalHeight * scale : 0;

  /** Keep the circle covered: the picture may not be dragged past its edge. */
  const clamp = (x: number, y: number, s = scale) => {
    if (!img) return { x: 0, y: 0 };
    const mx = Math.max(0, (img.naturalWidth * s - FRAME) / 2);
    const my = Math.max(0, (img.naturalHeight * s - FRAME) / 2);
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };

  const setZoomClamped = (z: number) => {
    const next = Math.min(3, Math.max(1, z));
    setZoom(next);
    setPan((p) => clamp(p.x, p.y, base * next));
  };

  const confirm = () => {
    if (!img) return;
    // The circle's top-left, in the picture's own pixels.
    const size = FRAME / scale;
    const sx = img.naturalWidth / 2 - pan.x / scale - size / 2;
    const sy = img.naturalHeight / 2 - pan.y / scale - size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
    canvas.toBlob((blob) => blob && onCropComplete(blob), 'image/png', 1);
  };

  const handleOpenChange = (next: boolean) => {
    if (!isUploading) onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle className="text-base">Crop Profile Photo</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Drag to reposition. Scroll or use the slider to zoom.
          </DialogDescription>
        </DialogHeader>

        <div
          className="relative h-[380px] w-full cursor-grab touch-none overflow-hidden bg-black/90 active:cursor-grabbing"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setPan(clamp(d.px + e.clientX - d.x, d.py + e.clientY - d.y));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => setZoomClamped(zoom - e.deltaY * 0.002)}
        >
          {img && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={{ width: w, height: h, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }}
            />
          )}
          {/* The round frame: everything outside it dimmed. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: FRAME,
              height: FRAME,
              border: '2px solid rgba(255,255,255,0.6)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
            }}
          />
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <ZoomOut className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoomClamped(Number(e.target.value))}
              aria-label="Zoom"
              className="h-1.5 flex-1 cursor-pointer accent-primary"
            />
            <ZoomIn className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </div>
        </div>

        <DialogFooter className="gap-2 px-5 pb-5 pt-0 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isUploading} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button onClick={confirm} disabled={isUploading || !img} className="flex-1 gap-2 sm:flex-none">
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Save Photo
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
