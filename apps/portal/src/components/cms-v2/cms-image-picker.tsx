"use client";

/**
 * The picker behind every "Change image" handle on the live preview.
 *
 * The site marks an image with its CMS address and posts the address here when
 * the handle is pressed (see v2/apps/web/src/components/cms/edit-overlay.tsx).
 * This is the other half: choose a picture, and the caller writes the URL to
 * that address as a DRAFT, exactly the way a headline edit is written.
 *
 * It is built on `useCMSMedia`, the media library the field editor has always
 * used — same bucket, same `cms_media` rows, same 5 MB / JPG-PNG-WebP-SVG
 * rules. A second uploader would mean a second place for an operator's
 * pictures to live and a second set of limits to keep in step.
 *
 * Two things it deliberately does NOT do:
 *
 *  - delete. The library is shared across every page of the site, so a delete
 *    from a picker opened over one image can silently break another. Deleting
 *    stays where the whole library is visible.
 *  - write. The dialog reports a choice; the editor owns the write, which is
 *    what keeps the draft/publish behaviour in one place.
 */

import { useRef, useState } from "react";
import { ImageOff, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { useCMSMedia } from "@/hooks/use-cms-media";
import { cn } from "@/lib/utils";

export type ImageTarget = {
  /** e.g. `home.home_hero.hero_image`. The write address. */
  path: string;
  /** What is on the page right now, so the current picture reads as chosen. */
  src: string;
  /** The rendered alt text, shown so the operator knows which image this is. */
  alt?: string;
};

export function CmsImagePicker({
  target,
  onClose,
  onPick,
}: {
  /** Null when nothing is being changed — the dialog is closed. */
  target: ImageTarget | null;
  onClose: () => void;
  /** Chosen. An empty string means "put the shipped picture back". */
  onPick: (url: string) => void | Promise<void>;
}) {
  const { media, isLoading, uploadMediaAsync, isUploading } = useCMSMedia();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (url: string) => {
    setBusy(true);
    try {
      await onPick(url);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    // `uploadMediaAsync` already reports its own failures as a toast and
    // rejects; swallow the rejection so the dialog stays open on the picture
    // the operator still has, rather than closing on a write that never
    // happened.
    try {
      const uploaded: any = await uploadMediaAsync({ file, folder: "cms" });
      if (uploaded?.file_url) await choose(uploaded.file_url);
    } catch {
      /* reported by the hook */
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Change this image</DialogTitle>
          <DialogDescription>
            {target?.alt?.trim()
              ? `Currently: ${target.alt}`
              : "Pick one you have already uploaded, or add a new one."}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />

        <div className="max-h-[46vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading your images
            </div>
          ) : media.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <ImageOff className="size-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                You have not uploaded any images yet.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {media.map((item) => {
                const active = item.file_url === target?.src;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void choose(item.file_url)}
                    title={item.file_name}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-2xl bg-muted ring-1 transition-all",
                      active
                        ? "ring-2 ring-primary"
                        : "ring-foreground/5 hover:ring-foreground/20"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.file_url}
                      alt={item.alt_text ?? item.file_name}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                    {active && (
                      <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-1 text-[10px] font-medium text-primary-foreground">
                        On the page
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={isUploading || busy}
            onClick={() => fileInput.current?.click()}
          >
            {isUploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload a new image
          </Button>
          {/* Clearing is how an operator gets the shipped picture back: the
              site treats an empty value as "not set" and falls through to its
              own default, so this is a reset rather than a blank hole. */}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={busy || isUploading}
            onClick={() => void choose("")}
          >
            <Trash2 className="size-3.5" />
            Use the default
          </Button>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
