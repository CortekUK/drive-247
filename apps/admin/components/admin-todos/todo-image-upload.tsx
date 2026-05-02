"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export interface UploadedImage {
  image_url: string;
  image_path: string;
}

interface Props {
  imageUrl: string | null;
  imagePath: string | null;
  onChange: (next: UploadedImage | null) => void | Promise<void>;
  className?: string;
}

/**
 * Upload widget for a single todo image. Public bucket (`todo-images`).
 * Replaces the existing image atomically: uploads new → calls onChange(new) →
 * removes old (caller is expected to persist the row first; on success we
 * delete the prior storage object here).
 */
export function TodoImageUpload({ imageUrl, imagePath, onChange, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Only JPG, PNG, or WebP images are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image is too large (max 5 MB).");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const newPath = `todos/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("todo-images")
        .upload(newPath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("todo-images").getPublicUrl(newPath);
      const previousPath = imagePath;
      await onChange({ image_url: pub.publicUrl, image_path: newPath });
      // Delete old object after the new one is committed.
      if (previousPath) {
        const { error: delErr } = await supabase.storage.from("todo-images").remove([previousPath]);
        if (delErr) console.warn("Could not remove old todo image:", delErr.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeImage = async () => {
    if (!imagePath) {
      await onChange(null);
      return;
    }
    setBusy(true);
    const previousPath = imagePath;
    await onChange(null);
    const { error } = await supabase.storage.from("todo-images").remove([previousPath]);
    if (error) console.warn("Could not remove todo image:", error.message);
    setBusy(false);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      {imageUrl ? (
        <div className="relative group rounded-md overflow-hidden border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Todo cover"
            className="w-full max-h-64 object-cover"
          />
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={pickFile} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Replace"}
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={removeImage} disabled={busy}>
              <X className="w-3.5 h-3.5 mr-1" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md border border-dashed border-border hover:border-primary hover:bg-muted/30 transition text-muted-foreground text-left"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <ImagePlus className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1 text-xs">
            <span className="text-foreground">Add cover image</span>
            <span className="ml-2 text-[10px]">JPG · PNG · WebP, up to 5 MB</span>
          </span>
        </button>
      )}
    </div>
  );
}
