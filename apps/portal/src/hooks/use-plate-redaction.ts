"use client";

/**
 * Per-photo number-plate redaction.
 *
 * The operator picks one vehicle photo, marks where the plate is, and the
 * browser paints an opaque rectangle over it. This hook is only the transport:
 * asking Trax where the plate might be, and persisting the three outcomes an
 * operator can reach (redacted / no plate here / put the original back).
 *
 * The actual pixels are painted client-side — see plate-redaction-dialog.tsx.
 * Nothing here ever blurs: a blur is reversible, a filled rectangle is not.
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";

/* ────────────────────────────── types ────────────────────────────── */

/**
 * A rectangle expressed as RATIOS of the image (0-1), never pixels.
 *
 * The dialog shows the photo at whatever size fits the screen, which is not
 * the size the photo is painted at. Storing pixels would mean the box the
 * operator drew and the box we fill could drift apart on a different screen.
 */
export interface PlateRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Present only on Trax-proposed regions. */
  confidence?: number;
}

/** Values `vehicle_photos.redaction_status` can hold. */
export type RedactionStatus = "none" | "redacted" | "no_plate";

export interface DetectPlateResult {
  regions: PlateRegion[];
  /** False when Trax ran fine and simply found nothing. Not an error. */
  found: boolean;
  /** Optional human-readable note from the detector. */
  message?: string;
}

export interface DetectPlateVars {
  photoId: string;
  /**
   * The decoded photo's natural size. NOT sent to the server — it is kept
   * client-side so that a box which comes back in pixels rather than ratios can
   * still be converted instead of silently dropped.
   */
  imageWidth?: number;
  imageHeight?: number;
}

export interface SaveRedactionVars {
  photoId: string;
  /** Bare base64 JPEG — NO `data:image/jpeg;base64,` prefix. */
  imageBase64: string;
  /** The regions actually painted, padding included, as ratios. */
  regions: PlateRegion[];
}

/** What `save-photo-redaction` answers with on every action. */
export interface SaveRedactionResult {
  success: boolean;
  photoId: string;
  redaction_status: RedactionStatus | string;
  redacted_url?: string | null;
  original_url?: string | null;
}

/**
 * The wire shape for a region.
 *
 * `save-photo-redaction` validates `{x, y, w, h}` field by field and rejects
 * the whole request if any is missing — sending `width`/`height` fails with a
 * 400 that reads like a malformed box rather than a naming mismatch. Everything
 * inside this app speaks `width`/`height`; the translation happens here, once,
 * at the boundary.
 */
interface WireRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

function toWireRegion(region: PlateRegion): WireRegion {
  return { x: region.x, y: region.y, w: region.width, h: region.height };
}

/* ─────────────────────── response normalisation ─────────────────────── */

const MIN_REGION_RATIO = 0.005;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function pickNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = typeof c === "string" ? Number(c) : c;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Accepts the handful of shapes a box can plausibly arrive in and returns
 * ratios. Written tolerantly on purpose: the detector is a separate service,
 * and a box silently dropped because it said `w` instead of `width` would look
 * exactly like "Trax found nothing" — the one message we must not fake.
 */
function normalizeRegion(raw: unknown, imgW: number, imgH: number): PlateRegion | null {
  if (!raw) return null;

  let x: number | null = null;
  let y: number | null = null;
  let w: number | null = null;
  let h: number | null = null;
  let confidence: number | undefined;

  if (Array.isArray(raw) && raw.length >= 4) {
    [x, y, w, h] = raw.map((v) => Number(v));
  } else if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    confidence = pickNumber(r.confidence, r.score) ?? undefined;

    const box = (r.box ?? r.bbox ?? r.bounding_box ?? r.boundingBox) as unknown;
    if (box && (Array.isArray(box) || typeof box === "object")) {
      const inner = normalizeRegion(box, imgW, imgH);
      if (inner) return confidence === undefined ? inner : { ...inner, confidence };
    }

    x = pickNumber(r.x, r.left, r.x1, r.x_min, r.xMin);
    y = pickNumber(r.y, r.top, r.y1, r.y_min, r.yMin);
    w = pickNumber(r.width, r.w);
    h = pickNumber(r.height, r.h);

    if (w === null) {
      const x2 = pickNumber(r.x2, r.right, r.x_max, r.xMax);
      if (x2 !== null && x !== null) w = x2 - x;
    }
    if (h === null) {
      const y2 = pickNumber(r.y2, r.bottom, r.y_max, r.yMax);
      if (y2 !== null && y !== null) h = y2 - y;
    }
  }

  if (x === null || y === null || w === null || h === null) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;

  // Anything above 1 cannot be a ratio, so it is pixel space. Without the
  // natural size we cannot convert it, and guessing would put a black box in
  // the wrong place — drop it and let the operator draw instead.
  const looksLikePixels = x > 1.5 || y > 1.5 || w > 1.5 || h > 1.5;
  if (looksLikePixels) {
    if (!imgW || !imgH) return null;
    x /= imgW;
    w /= imgW;
    y /= imgH;
    h /= imgH;
  }

  // Tolerate a box given right-to-left / bottom-to-top.
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }

  const nx = clamp01(x);
  const ny = clamp01(y);
  const nw = Math.min(1 - nx, Math.max(0, w));
  const nh = Math.min(1 - ny, Math.max(0, h));

  if (nw < MIN_REGION_RATIO || nh < MIN_REGION_RATIO) return null;

  return confidence === undefined
    ? { x: nx, y: ny, width: nw, height: nh }
    : { x: nx, y: ny, width: nw, height: nh, confidence };
}

export function normalizeDetectResponse(
  payload: unknown,
  imageWidth?: number,
  imageHeight?: number,
): DetectPlateResult {
  const body = (payload ?? {}) as Record<string, unknown>;

  const rawList = Array.isArray(payload)
    ? payload
    : (body.regions as unknown[]) ??
      (body.plates as unknown[]) ??
      (body.detections as unknown[]) ??
      ((body.data as Record<string, unknown> | undefined)?.regions as unknown[]) ??
      [];

  const imgW = imageWidth || pickNumber(body.image_width, body.imageWidth) || 0;
  const imgH = imageHeight || pickNumber(body.image_height, body.imageHeight) || 0;

  const regions = (Array.isArray(rawList) ? rawList : [])
    .map((r) => normalizeRegion(r, imgW, imgH))
    .filter((r): r is PlateRegion => r !== null);

  return {
    regions,
    found: regions.length > 0,
    message: typeof body.message === "string" ? body.message : undefined,
  };
}

/* ──────────────────────────── invoke helper ──────────────────────────── */

/**
 * `supabase.functions.invoke` RESOLVES with `{ data, error }` — it does not
 * throw. Every failure here has to be checked by hand or it disappears and the
 * UI cheerfully reports success on a photo that was never redacted.
 */
async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    throw new Error(await describeInvokeError(error, name));
  }
  if (data && typeof data === "object" && (data as any).error) {
    throw new Error(String((data as any).error));
  }
  return data as T;
}

/**
 * Both functions answer a refusal with `{ error: "<why>" }` and a 4xx, and those
 * reasons are the useful ones ("Forbidden for this tenant", "Image is too
 * large…"). supabase-js buries them: on a non-2xx it hands back a
 * FunctionsHttpError whose `.message` is the generic "Edge Function returned a
 * non-2xx status code" and whose `.context` is the raw Response. Read the body.
 */
async function describeInvokeError(error: unknown, name: string): Promise<string> {
  const fallback = (error as any)?.message || `${name} failed`;
  const context = (error as any)?.context;

  if (context && typeof context.json === "function") {
    try {
      const parsed = await context.clone().json();
      if (parsed?.error) return String(parsed.error);
      if (parsed?.message) return String(parsed.message);
    } catch {
      /* not JSON, or the body was already consumed — fall through */
    }
  }
  if (typeof context?.error === "string") return context.error;

  return fallback;
}

/* ─────────────────────────────── the hook ─────────────────────────────── */

/**
 * @param tenantIdOverride use when the caller already has the tenant id in hand
 *        (e.g. it was passed down as a prop); otherwise TenantContext is used.
 */
export function usePlateRedaction(tenantIdOverride?: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const tenantId = tenantIdOverride || tenant?.id;

  /**
   * The gallery, the vehicle record and both fleet lists all render photo URLs,
   * so all four have to be refreshed or the operator sees the old image until a
   * hard reload. The dialog is not told the vehicle id, so these are deliberate
   * prefix invalidations.
   */
  const invalidatePhotoQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["vehicle-photos"] });
    queryClient.invalidateQueries({ queryKey: ["vehicle"] });
    queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
  }, [queryClient]);

  const detectRegions = useMutation<DetectPlateResult, Error, DetectPlateVars>({
    mutationFn: async ({ photoId, imageWidth, imageHeight }) => {
      if (!photoId) throw new Error("Photo ID is required");

      if (!tenantId) throw new Error("No tenant in context");

      const payload = await invokeFunction<unknown>("detect-plate-regions", {
        photoId,
        tenantId,
      });

      return normalizeDetectResponse(payload, imageWidth, imageHeight);
    },
    // Deliberately no success toast: "found nothing" is the usual answer and is
    // shown inline as guidance, not as a result worth interrupting for.
  });

  const saveRedaction = useMutation<SaveRedactionResult, Error, SaveRedactionVars>({
    mutationFn: async ({ photoId, imageBase64, regions }) => {
      if (!photoId) throw new Error("Photo ID is required");
      if (!tenantId) throw new Error("No tenant in context");
      if (!imageBase64) throw new Error("Nothing to upload — the image did not render");
      if (!regions.length) throw new Error("Mark at least one area before saving");

      return invokeFunction<SaveRedactionResult>("save-photo-redaction", {
        action: "redact",
        photoId,
        tenantId,
        imageBase64,
        regions: regions.map(toWireRegion),
      });
    },
    onSuccess: () => {
      invalidatePhotoQueries();
      toast({
        title: "Number plate hidden",
        description: "Customers will now see the edited photo.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not save the edit",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const markNoPlate = useMutation<SaveRedactionResult, Error, string>({
    mutationFn: async (photoId) => {
      if (!photoId) throw new Error("Photo ID is required");
      if (!tenantId) throw new Error("No tenant in context");

      return invokeFunction<SaveRedactionResult>("save-photo-redaction", {
        action: "no_plate",
        photoId,
        tenantId,
      });
    },
    onSuccess: () => {
      invalidatePhotoQueries();
      toast({
        title: "Marked as having no plate",
        description: "This photo will be shown to customers unchanged.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not update this photo",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const restoreOriginal = useMutation<SaveRedactionResult, Error, string>({
    mutationFn: async (photoId) => {
      if (!photoId) throw new Error("Photo ID is required");
      if (!tenantId) throw new Error("No tenant in context");

      return invokeFunction<SaveRedactionResult>("save-photo-redaction", {
        action: "restore",
        photoId,
        tenantId,
      });
    },
    onSuccess: () => {
      invalidatePhotoQueries();
      toast({
        title: "Original photo restored",
        description: "The number plate is visible again.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not restore the original",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    detectRegions,
    saveRedaction,
    markNoPlate,
    restoreOriginal,
    isDetecting: detectRegions.isPending,
    isSaving: saveRedaction.isPending,
    isMarkingNoPlate: markNoPlate.isPending,
    isRestoring: restoreOriginal.isPending,
    isBusy:
      detectRegions.isPending ||
      saveRedaction.isPending ||
      markNoPlate.isPending ||
      restoreOriginal.isPending,
    invalidatePhotoQueries,
  };
}

export default usePlateRedaction;
