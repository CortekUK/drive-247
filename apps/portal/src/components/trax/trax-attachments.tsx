"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { probeChatCapabilities } from "@/hooks/use-chat";
import type { ChatAttachment, TraxAttachmentCapability } from "@/types/chat";

/**
 * File attachments for Trax — preparation, the capability gate, and the chip.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS REAL, AND WHAT IS HONESTLY LIMITED
 *
 * Files travel INLINE with the one chat turn they belong to: images as a
 * downscaled `data:` URL the model reads as vision input, text files as their
 * decoded text appended to the prompt. There is no bucket and no attachments
 * column, so nothing is stored — a reopened conversation shows only the
 * "[Attached: …]" note the function writes into the saved message.
 *
 * Nothing here is offered until the RUNNING chat function says it can take
 * files (`useTraxAttachmentCapability`). The deployed function parses its body
 * loosely, so an older build would accept a file, drop it, and reply as if it
 * had read it — the one outcome that must never happen on a screen that can
 * move money. Until a function that answers the probe is deployed, the attach
 * button is visibly switched off and paste/drop do nothing.
 *
 * Limits come from the function's answer, never from constants here, so the
 * two cannot disagree.
 */

/** Browsers report `.md`, `.csv` and `.json` inconsistently (often as ""). */
const EXTENSION_MIME: Record<string, string> = {
  txt: "text/plain",
  text: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** Extensions offered in the file picker alongside the mime types. */
export const ATTACH_EXTENSIONS = [".txt", ".csv", ".md", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif"];

/** Long edge, in pixels, an image is scaled down to before sending. */
const MAX_IMAGE_EDGE = 1600;
const JPEG_QUALITY = 0.85;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveMime(file: File, cap: TraxAttachmentCapability): string {
  const declared = (file.type || "").toLowerCase();
  if (cap.imageTypes.includes(declared) || cap.textTypes.includes(declared)) return declared;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME[ext] ?? declared;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not open the image"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Re-type a Blob so its `data:` URL prefix matches the declared mime exactly. */
function withType(blob: Blob, type: string): Blob {
  return blob.type === type ? blob : new Blob([blob], { type });
}

async function prepareImage(
  file: File,
  mimeType: string,
  cap: TraxAttachmentCapability,
): Promise<ChatAttachment | { error: string }> {
  const name = file.name || "image";

  /* GIFs are sent as they are: a canvas keeps only the first frame, which would
     quietly change what the operator attached. */
  if (mimeType === "image/gif") {
    if (file.size > cap.maxImageBytes) {
      return { error: `${name} is larger than ${formatBytes(cap.maxImageBytes)}.` };
    }
    return {
      id: crypto.randomUUID(),
      name,
      mimeType,
      size: file.size,
      kind: "image",
      dataUrl: await readAsDataUrl(withType(file, mimeType)),
    };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { error: `${name} couldn't be opened as an image.` };
  }

  const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  let jpeg: Blob | null = null;
  if (ctx) {
    /* JPEG has no alpha: paint a white ground first, or the transparent parts
       of a PNG (most screenshots of UI) come out black. */
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    jpeg = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
  }

  /* Keep the original when nothing was scaled and it is no bigger than the
     JPEG — a PNG screenshot of a table stays crisp enough for the model to read. */
  const keepOriginal = scale === 1 && file.size <= cap.maxImageBytes && (!jpeg || file.size <= jpeg.size);
  const chosen = keepOriginal ? withType(file, mimeType) : jpeg ? withType(jpeg, "image/jpeg") : null;

  if (!chosen) return { error: `${name} couldn't be prepared for sending.` };
  if (chosen.size > cap.maxImageBytes) {
    return { error: `${name} is still larger than ${formatBytes(cap.maxImageBytes)} after resizing.` };
  }

  return {
    id: crypto.randomUUID(),
    name,
    mimeType: chosen.type,
    size: chosen.size,
    kind: "image",
    dataUrl: await readAsDataUrl(chosen),
  };
}

async function prepareText(
  file: File,
  mimeType: string,
  cap: TraxAttachmentCapability,
): Promise<ChatAttachment | { error: string }> {
  const name = file.name || "file.txt";
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { error: `${name} couldn't be read.` };
  }
  /* A NUL character means binary content wearing a text extension (a renamed
     .xlsx, say). Sending it would hand the model noise and burn the budget. */
  if (text.includes("\u0000")) {
    return { error: `${name} doesn't look like a text file.` };
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  let truncated = false;
  if (encoded.length > cap.maxTextBytes) {
    // Cut on bytes, then drop a half-decoded trailing character.
    text = new TextDecoder("utf-8").decode(encoded.subarray(0, cap.maxTextBytes)).replace(/\uFFFD+$/, "");
    truncated = true;
  }

  return {
    id: crypto.randomUUID(),
    name,
    mimeType,
    size: encoder.encode(text).length,
    kind: "text",
    text,
    truncated,
  };
}

/** Prepare ONE file against the function's limits. */
export async function prepareAttachment(
  file: File,
  cap: TraxAttachmentCapability,
): Promise<ChatAttachment | { error: string }> {
  const mimeType = resolveMime(file, cap);
  if (cap.imageTypes.includes(mimeType)) return prepareImage(file, mimeType, cap);
  if (cap.textTypes.includes(mimeType)) return prepareText(file, mimeType, cap);
  return {
    error: `${file.name || "That file"}: this file type isn't supported yet. Try an image, CSV, text or JSON file.`,
  };
}

/**
 * Prepare several files and fold them into what is already attached, enforcing
 * the per-message count and total size. Files that do not fit are reported,
 * never silently dropped.
 */
export async function prepareAttachments(
  files: File[],
  existing: ChatAttachment[],
  cap: TraxAttachmentCapability,
): Promise<{ next: ChatAttachment[]; errors: string[] }> {
  const next = [...existing];
  const errors: string[] = [];
  let total = existing.reduce((sum, a) => sum + a.size, 0);

  for (const file of files) {
    if (next.length >= cap.maxFiles) {
      errors.push(`You can attach up to ${cap.maxFiles} files per message.`);
      break;
    }
    let result: ChatAttachment | { error: string };
    try {
      result = await prepareAttachment(file, cap);
    } catch {
      result = { error: `${file.name || "That file"} couldn't be read.` };
    }
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }
    if (total + result.size > cap.maxTotalBytes) {
      errors.push(`${result.name} would take this message over ${formatBytes(cap.maxTotalBytes)}.`);
      continue;
    }
    total += result.size;
    next.push(result);
  }

  return { next, errors };
}

/**
 * Does the running chat function accept attachments?
 *
 * One probe per tenant per session (`staleTime: Infinity`), and only once a
 * Trax thread is actually on screen — the panel mounts its thread lazily, so a
 * page load that never opens Trax never asks. A definite "no" is cached as
 * `null`; a probe that could not be made at all (no session, network) errors
 * and is asked again the next time a thread mounts.
 */
export function useTraxAttachmentCapability(enabled: boolean): {
  capability: TraxAttachmentCapability | null;
  isResolved: boolean;
} {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const query = useQuery({
    queryKey: ["trax-capabilities", tenantId],
    queryFn: () => probeChatCapabilities(tenantId as string),
    enabled: enabled && !!tenantId,
    staleTime: Infinity,
    retry: 0,
    refetchOnWindowFocus: false,
  });

  return {
    capability: query.data ?? null,
    isResolved: query.isFetched || query.isError,
  };
}

type ChipAttachment = Pick<ChatAttachment, "id" | "name" | "mimeType" | "size" | "kind" | "dataUrl"> & {
  truncated?: boolean;
};

/**
 * One attached file. Used in the composer tray (removable) and above a sent
 * message, where `notDelivered` marks a file the function did not confirm.
 *
 * No borders — surfaces are separated by tone, per the v2 "no lines" rule.
 */
export function AttachmentChip({
  attachment,
  onRemove,
  notDelivered = false,
  className,
}: {
  attachment: ChipAttachment;
  onRemove?: () => void;
  notDelivered?: boolean;
  className?: string;
}) {
  const isImage = attachment.kind === "image" && !!attachment.dataUrl;
  const label = notDelivered ? `${attachment.name} (not delivered)` : attachment.name;

  return (
    <div
      data-slot="trax-attachment"
      data-delivered={notDelivered ? "false" : undefined}
      className={cn(
        "group/chip relative flex max-w-full shrink-0 items-center",
        !isImage && "gap-2 rounded-2xl bg-muted/70 py-1.5 pl-1.5 pr-3",
        className,
      )}
      title={label}
    >
      {isImage ? (
        <span className="relative block size-14 overflow-hidden rounded-2xl bg-muted/70">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL; next/image cannot optimise it */}
          <img
            src={attachment.dataUrl}
            alt={label}
            className={cn("size-full object-cover", notDelivered && "opacity-40 grayscale")}
          />
          {notDelivered && (
            <span className="absolute inset-0 flex items-center justify-center text-destructive">
              <AlertCircle className="size-5" aria-hidden />
            </span>
          )}
        </span>
      ) : (
        <>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--chart-2)/0.24),hsl(var(--primary)/0.12))] text-primary dark:text-[hsl(var(--chart-1))]">
            <FileText className="size-4" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col text-left">
            <span className="max-w-[160px] truncate text-[12px] font-medium text-foreground">{attachment.name}</span>
            {notDelivered ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
                <AlertCircle className="size-3" aria-hidden />
                Not delivered
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {formatBytes(attachment.size)}
                {attachment.truncated ? " · truncated" : ""}
              </span>
            )}
          </span>
        </>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          className={cn(
            "absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground/80 text-background shadow-sm transition-opacity",
            "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/chip:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </div>
  );
}
