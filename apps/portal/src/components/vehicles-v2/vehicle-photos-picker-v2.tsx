"use client";

/**
 * The photos step of the v2 add-vehicle dialog (Ghulam, Oct 7 2026: "a more
 * good way of putting in the photos").
 *
 *   ┌──────────────┐ ┌─────┐ ┌─────┐
 *   │              │ │  2  │ │  3  │
 *   │    Cover     │ └─────┘ └─────┘
 *   │              │ ┌─────┐ ┌─────┐
 *   └──────────────┘ │  4  │ │  5  │
 *                    └─────┘ └─────┘
 *
 * The cover has its own big slot, because it is the one customers see first
 * on the booking site; four more sit beside it. Every empty slot is a button.
 * Drop files anywhere on the picker to add them; drag one photo onto another
 * to swap them; "Make cover" moves a photo into the big slot. Past five, the
 * last slot says how many more there are — every photo still uploads.
 *
 * Presentation only: the dialog owns the list (and its object URLs) and does
 * the upload exactly as before.
 */

import { useRef, useState } from "react";
import { ImagePlus, Plus, Star, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type PickedPhoto = { file: File; url: string };

const SIDE_SLOTS = 4;
const ACCENT_TEXT = "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]";

export function VehiclePhotosPickerV2({
  photos,
  error,
  onAdd,
  onRemove,
  onReorder,
}: {
  photos: PickedPhoto[];
  error?: string | null;
  onAdd: (files: FileList | null) => void;
  onRemove: (url: string) => void;
  /** The whole list, in its new order (index 0 is the cover). */
  onReorder: (next: PickedPhoto[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const choose = () => fileRef.current?.click();

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= photos.length || to >= photos.length) return;
    const next = photos.slice();
    [next[from], next[to]] = [next[to], next[from]];
    onReorder(next);
  };

  /** A slot's drop: a photo dragged from another slot swaps; files are added. */
  const dropOn = (to: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (dragFrom !== null) {
      move(dragFrom, to);
      setDragFrom(null);
      return;
    }
    onAdd(e.dataTransfer.files);
  };

  const extra = Math.max(0, photos.length - 1 - SIDE_SLOTS);

  /** One photo tile: the image, hover actions, draggable. */
  const tile = (i: number, big: boolean) => {
    const p = photos[i];
    const lastShown = !big && i === SIDE_SLOTS && extra > 0;
    return (
      <div
        key={p.url}
        draggable
        onDragStart={(e) => {
          setDragFrom(i);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => setDragFrom(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={dropOn(i)}
        className={cn(
          "group relative size-full cursor-grab overflow-hidden rounded-2xl border border-foreground/10 bg-muted/30 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 active:cursor-grabbing motion-reduce:animate-none",
          dragFrom === i && "opacity-40",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt="" draggable={false} className="size-full object-cover" />

        {big && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-foreground">
            <Star className="size-3 fill-current text-amber-500" /> Cover
          </span>
        )}

        {lastShown && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-medium text-white">
            +{extra} more
          </span>
        )}

        {/* Hover actions — fade only, per the motion standard. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 p-1.5 opacity-0 transition-opacity duration-200 ease-in group-hover:opacity-100 group-hover:ease-out group-focus-within:opacity-100 motion-reduce:transition-none">
          {!big ? (
            <button
              type="button"
              onClick={() => move(i, 0)}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-background/95 px-2 text-[10px] font-medium text-foreground hover:bg-background"
            >
              <Star className="size-2.5" /> Make cover
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => onRemove(p.url)}
            className="flex size-6 items-center justify-center rounded-full bg-background/95 text-foreground hover:bg-background"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    );
  };

  /** An empty slot: a button that opens the file picker, and a drop target. */
  const empty = (big: boolean, key: string) => (
    <button
      key={key}
      type="button"
      onClick={choose}
      onDragOver={(e) => e.preventDefault()}
      onDrop={dropOn(-1)}
      className={cn(
        "flex size-full flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] border-dashed bg-background/60 text-muted-foreground transition-colors duration-200 hover:border-primary/50 hover:text-foreground motion-reduce:transition-none",
        big && error ? "border-destructive/50" : "border-foreground/15",
      )}
    >
      {big ? (
        <>
          <span className={cn("flex size-11 items-center justify-center rounded-full bg-primary/10", ACCENT_TEXT)}>
            <ImagePlus className="size-5" />
          </span>
          <span className="text-sm font-medium text-foreground">Cover photo</span>
          <span className="text-[11px]">Drop it here, or click to choose</span>
        </>
      ) : (
        <Plus className="size-4" />
      )}
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onAdd(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (dragFrom === null) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (dragFrom === null) onAdd(e.dataTransfer.files);
        }}
        className="relative grid h-[176px] grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2.5"
      >
        <div className="min-h-0">{photos[0] ? tile(0, true) : empty(true, "cover")}</div>
        <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-2.5">
          {Array.from({ length: SIDE_SLOTS }, (_, k) => {
            const i = k + 1;
            return <div key={i} className="min-h-0">{photos[i] ? tile(i, false) : empty(false, `e${i}`)}</div>;
          })}
        </div>

        {/* Files dragged over the picker: one accent wash, faded in. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.06] text-sm font-medium opacity-0 backdrop-blur-[1px] transition-opacity duration-200 ease-in motion-reduce:transition-none",
            dragOver && "opacity-100 ease-out",
            ACCENT_TEXT,
          )}
        >
          Drop to add
        </div>
      </div>

      <span className={cn("min-h-[18px] px-0.5 text-[11px] leading-[18px]", error ? "text-destructive" : "text-muted-foreground")}>
        {error ??
          (photos.length
            ? `${photos.length} photo${photos.length === 1 ? "" : "s"} · drag to reorder, or hover one to make it the cover`
            : "JPG, PNG or WebP, up to 5 MB each")}
      </span>
    </div>
  );
}
