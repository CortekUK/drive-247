/**
 * save-photo-redaction
 *
 * Stores a licence-plate redaction for a vehicle photo. The actual blurring is
 * done in the operator's browser (canvas -> JPEG -> base64); this function only
 * persists the result. That split is deliberate: no image processing library has
 * to run in Deno, and the operator sees exactly what will be published before it
 * is published.
 *
 * Three actions:
 *   redact   - store the browser-produced blurred JPEG as a NEW storage object
 *              and point the row at it
 *   no_plate - operator reviewed the photo and there is no plate to hide
 *   restore  - undo a redaction, falling back to the untouched original
 *
 * This endpoint mutates CUSTOMER-VISIBLE assets, so auth is mandatory and is
 * modelled on admin-reset-password: Authorization header -> anon client ->
 * auth.getUser() -> app_users lookup -> active + tenant/super-admin + role gate.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const BUCKET = "vehicle-photos";

/** ~8MB decoded. Browser canvas JPEGs of a vehicle photo are well under this. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Guard against an unbounded jsonb blob being written by a hostile client. */
const MAX_REGIONS = 100;

/**
 * Roles permitted to alter published photos. `ops` and `viewer` are deliberately
 * absent — a redaction changes what customers see on the booking site, so it is
 * an editorial action, not a day-to-day operational one.
 *
 * Super admins bypass this list (see below) because they are provisioned with
 * `tenant_id = NULL` and no explicit role, which is the convention every other
 * admin edge function in this repo follows.
 */
const ALLOWED_ROLES = ["head_admin", "admin", "manager"];

type Action = "redact" | "no_plate" | "restore";

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RequestBody {
  photoId?: string;
  tenantId?: string;
  action?: Action;
  imageBase64?: string;
  regions?: Region[];
}

/**
 * Decode a base64 payload, tolerating the `data:image/jpeg;base64,` prefix that
 * `canvas.toDataURL()` produces so the client does not have to strip it.
 * Returns the raw bytes, or throws with a caller-facing message.
 */
function decodeJpegBase64(input: string): Uint8Array {
  const commaIdx = input.indexOf(",");
  const payload = input.startsWith("data:") && commaIdx !== -1
    ? input.slice(commaIdx + 1)
    : input;

  // Check the size BEFORE decoding — decoding first would allocate the very
  // buffer we are trying to refuse. base64 carries 3 bytes per 4 characters.
  const approxBytes = Math.floor((payload.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large (~${Math.round(approxBytes / 1024 / 1024)}MB). ` +
        `The maximum is ${MAX_IMAGE_BYTES / 1024 / 1024}MB — re-export the photo at a lower quality.`,
    );
  }

  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    throw new Error("imageBase64 is not valid base64 data.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Exact check now that we know the true length.
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large (${Math.round(bytes.length / 1024 / 1024)}MB). ` +
        `The maximum is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`,
    );
  }

  // JPEG magic bytes (FF D8 FF). We publish this object to a PUBLIC bucket, so
  // refuse anything that is not actually the image format we claim to serve.
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("imageBase64 must be a JPEG produced by the editor.");
  }

  return bytes;
}

/**
 * Coerce client-supplied regions into plain numbers. We store these in jsonb and
 * later replay them in the editor, so we keep only the four fields we know about
 * rather than persisting arbitrary client JSON.
 */
function normalizeRegions(raw: unknown): Region[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("regions must be a non-empty array of {x, y, w, h}.");
  }
  if (raw.length > MAX_REGIONS) {
    throw new Error(`Too many redaction regions (max ${MAX_REGIONS}).`);
  }

  return raw.map((r, i) => {
    const region = r as Partial<Region>;
    const nums = [region?.x, region?.y, region?.w, region?.h];
    if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(`Region ${i} is malformed — x, y, w and h must all be finite numbers.`);
    }
    return {
      x: region.x as number,
      y: region.y as number,
      w: region.w as number,
      h: region.h as number,
    };
  });
}

/**
 * Turn a public storage URL back into the object key so we can delete it.
 * Public URLs look like `.../storage/v1/object/public/vehicle-photos/<key>`.
 * Returns null when the URL does not belong to our bucket (e.g. an externally
 * hosted photo) — the caller treats that as "nothing to delete".
 */
function storageKeyFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const key = url.slice(idx + marker.length).split("?")[0];
  return key ? decodeURIComponent(key) : null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed. Use POST.", 405);
  }

  try {
    // ── 1. Authenticate ────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse("Unauthorized — missing bearer token.", 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Anon client carrying the caller's JWT — used only to resolve *who* they are.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for the storage write and the row update. Safe because
    // every authorization decision below is made explicitly before it is used.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return errorResponse("Invalid session — please sign in again.", 401);
    }

    const { data: appUser, error: appUserError } = await supabaseAdmin
      .from("app_users")
      .select("id, role, is_active, tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();

    if (appUserError || !appUser) {
      return errorResponse("No staff account is linked to this login.", 403);
    }

    if (!appUser.is_active) {
      return errorResponse("Your account is deactivated.", 403);
    }

    const isSuperAdmin = !!appUser.is_super_admin;

    // Role gate. Super admins are exempt: they carry `tenant_id = NULL` and no
    // tenant-scoped role, matching how every other admin function here checks.
    if (!isSuperAdmin && !ALLOWED_ROLES.includes(appUser.role)) {
      return errorResponse(
        "You do not have permission to edit published vehicle photos.",
        403,
      );
    }

    // ── 2. Parse and validate the body ─────────────────────────────────────
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Request body must be valid JSON.", 400);
    }

    const { photoId, tenantId, action, imageBase64 } = body;

    if (!photoId || typeof photoId !== "string") {
      return errorResponse("photoId is required.", 400);
    }
    if (!tenantId || typeof tenantId !== "string") {
      return errorResponse("tenantId is required.", 400);
    }
    if (action !== "redact" && action !== "no_plate" && action !== "restore") {
      return errorResponse("action must be one of 'redact', 'no_plate' or 'restore'.", 400);
    }

    // Caller must belong to the tenant they claim to act for (unless super admin).
    if (!isSuperAdmin && appUser.tenant_id !== tenantId) {
      return errorResponse("You cannot edit photos belonging to another tenant.", 403);
    }

    // ── 3. Load the photo and re-verify ownership from the row itself ──────
    // The client's tenantId is a claim, not proof. The row's own tenant_id is
    // the authority — without this a caller could pass their own tenantId while
    // naming a photoId from someone else's fleet.
    const { data: photo, error: photoError } = await supabaseAdmin
      .from("vehicle_photos")
      .select("id, vehicle_id, tenant_id, photo_url, original_url, redacted_url, redaction_status")
      .eq("id", photoId)
      .single();

    if (photoError || !photo) {
      return errorResponse("Photo not found.", 404);
    }

    if (photo.tenant_id !== tenantId) {
      return errorResponse("This photo does not belong to the specified tenant.", 403);
    }

    const nowIso = new Date().toISOString();

    // ── 4. Apply the action ────────────────────────────────────────────────

    if (action === "redact") {
      if (!imageBase64 || typeof imageBase64 !== "string") {
        return errorResponse("imageBase64 is required when action is 'redact'.", 400);
      }

      let regions: Region[];
      let bytes: Uint8Array;
      try {
        regions = normalizeRegions(body.regions);
        bytes = decodeJpegBase64(imageBase64);
      } catch (e) {
        return errorResponse((e as Error).message, 400);
      }

      // A NEW key every time. We never overwrite the original object: staff need
      // the untouched photo to re-do a redaction (a blur cannot be undone once
      // the pixels are gone), and the row's `original_url` would otherwise point
      // at an already-blurred file. A timestamp also busts any CDN cache from a
      // previous redaction of the same photo.
      const objectKey = `redacted/${photoId}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(objectKey, bytes, { contentType: "image/jpeg", upsert: false });

      if (uploadError) {
        console.error("save-photo-redaction: upload failed", uploadError);
        return errorResponse(
          `Could not store the redacted image: ${uploadError.message}`,
          502,
        );
      }

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from(BUCKET)
        .getPublicUrl(objectKey);

      // COALESCE(original_url, photo_url), computed here because PostgREST
      // cannot express it. On the FIRST redaction original_url is NULL so we
      // capture the true original; on a SECOND redaction it is already set and
      // we must NOT overwrite it, or "restore" would hand the customer the
      // previously blurred image instead of the real photo.
      const originalUrl = photo.original_url ?? photo.photo_url;

      // One UPDATE carrying all three columns. The table's CHECK requires
      // redaction_status='redacted' to have BOTH redacted_url and original_url
      // non-null; splitting this into two statements would trip the constraint
      // on the first one.
      const { error: updateError } = await supabaseAdmin
        .from("vehicle_photos")
        .update({
          original_url: originalUrl,
          redacted_url: publicUrl,
          redaction_status: "redacted",
          redaction_regions: regions,
          redacted_at: nowIso,
          redacted_by: appUser.id,
        })
        .eq("id", photoId);

      if (updateError) {
        // Roll the storage write back so a failed save does not leave an orphan
        // object sitting in a public bucket.
        await supabaseAdmin.storage.from(BUCKET).remove([objectKey]).catch(() => {});
        console.error("save-photo-redaction: row update failed", updateError);
        return errorResponse(`Could not save the redaction: ${updateError.message}`, 500);
      }

      // Best-effort cleanup of the redaction this one supersedes. Done AFTER the
      // update so the row never points at an object we have already deleted, and
      // tolerant of failure because the row — not storage — is the source of truth.
      const supersededKey = storageKeyFromPublicUrl(photo.redacted_url);
      if (supersededKey && supersededKey !== objectKey) {
        const { error: removeError } = await supabaseAdmin.storage
          .from(BUCKET)
          .remove([supersededKey]);
        if (removeError) {
          console.warn(
            "save-photo-redaction: could not delete superseded object",
            supersededKey,
            removeError.message,
          );
        }
      }

      await writeAudit(supabaseAdmin, {
        action: "vehicle_photo_redacted",
        actorId: appUser.id,
        tenantId: photo.tenant_id,
        entityId: photo.id,
        isSuperAdminAction: isSuperAdmin,
        details: {
          vehicle_id: photo.vehicle_id,
          previous_status: photo.redaction_status,
          region_count: regions.length,
          redacted_url: publicUrl,
          original_url: originalUrl,
          object_key: objectKey,
          superseded_object_key: supersededKey,
        },
      });

      return jsonResponse({
        success: true,
        photoId,
        redaction_status: "redacted",
        redacted_url: publicUrl,
        original_url: originalUrl,
      });
    }

    if (action === "no_plate") {
      // The operator reviewed the photo and confirmed there is no plate to hide.
      // Purely a review record — the URLs are left exactly as they are, because
      // nothing about the published image changed. The CHECK constraint only
      // governs the 'redacted' status, so this is unconstrained.
      const { error: updateError } = await supabaseAdmin
        .from("vehicle_photos")
        .update({
          redaction_status: "no_plate",
          redacted_at: nowIso,
          redacted_by: appUser.id,
        })
        .eq("id", photoId);

      if (updateError) {
        console.error("save-photo-redaction: no_plate update failed", updateError);
        return errorResponse(`Could not save the review: ${updateError.message}`, 500);
      }

      return jsonResponse({
        success: true,
        photoId,
        redaction_status: "no_plate",
      });
    }

    // action === 'restore'
    // Drop back to the untouched photo. `original_url` is deliberately left in
    // place: it is a record of which URL the true original lives at, and keeping
    // it means a later re-redaction still resolves the same original.
    //
    // redacted_at/redacted_by are cleared rather than stamped with the restore.
    // Leaving them set on a status='none' row would let the UI report a reviewer
    // and timestamp for a photo that is not redacted; who performed the restore
    // is captured properly in audit_logs below.
    const { error: restoreError } = await supabaseAdmin
      .from("vehicle_photos")
      .update({
        redaction_status: "none",
        redacted_url: null,
        redaction_regions: null,
        redacted_at: null,
        redacted_by: null,
      })
      .eq("id", photoId);

    if (restoreError) {
      console.error("save-photo-redaction: restore failed", restoreError);
      return errorResponse(`Could not restore the original: ${restoreError.message}`, 500);
    }

    // Delete the now-unreferenced blurred object. Best-effort and non-fatal: the
    // row has already been restored, and a leftover object in storage is a tidiness
    // problem, not a correctness one.
    const staleKey = storageKeyFromPublicUrl(photo.redacted_url);
    if (staleKey) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(BUCKET)
        .remove([staleKey]);
      if (removeError) {
        console.warn(
          "save-photo-redaction: could not delete restored-from object",
          staleKey,
          removeError.message,
        );
      }
    }

    await writeAudit(supabaseAdmin, {
      action: "vehicle_photo_redaction_restored",
      actorId: appUser.id,
      tenantId: photo.tenant_id,
      entityId: photo.id,
      isSuperAdminAction: isSuperAdmin,
      details: {
        vehicle_id: photo.vehicle_id,
        previous_status: photo.redaction_status,
        removed_redacted_url: photo.redacted_url,
        object_key: staleKey,
      },
    });

    return jsonResponse({
      success: true,
      photoId,
      redaction_status: "none",
    });
  } catch (error) {
    console.error("save-photo-redaction: unexpected error", error);
    return errorResponse("Internal server error", 500);
  }
});

/**
 * Append an audit_logs row. Column shape mirrors mark-invoice-paid /
 * update-manager-permissions: `actor_id` is app_users.id (NOT the auth uid), so
 * the table stays joinable to app_users.
 *
 * Never throws — the mutation it describes has already committed, and losing the
 * audit line must not turn a successful save into an error for the operator.
 */
async function writeAudit(
  client: ReturnType<typeof createClient>,
  entry: {
    action: string;
    actorId: string;
    tenantId: string | null;
    entityId: string;
    isSuperAdminAction: boolean;
    details: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("audit_logs").insert({
    action: entry.action,
    actor_id: entry.actorId,
    tenant_id: entry.tenantId,
    entity_type: "vehicle_photo",
    entity_id: entry.entityId,
    is_super_admin_action: entry.isSuperAdminAction,
    details: entry.details,
  });

  if (error) {
    console.warn("save-photo-redaction: audit log insert failed", error.message);
  }
}
