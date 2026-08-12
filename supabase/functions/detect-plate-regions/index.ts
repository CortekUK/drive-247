// @ts-nocheck - Deno Edge Function, not Node.js TypeScript
//
// detect-plate-regions
//
// Finds candidate licence-plate regions in a vehicle photo using AWS
// Rekognition DetectText, and returns their bounding boxes as ratios of the
// image so a client can draw or mask over them.
//
// READ THIS BEFORE TUNING THE HEURISTIC ------------------------------------
// Measured on 8 real photos from this platform, DetectText found ZERO plates.
// It did find unrelated background text (a shop sign reading "CINEBISTRO").
// "Nothing found" is therefore the normal, correct, common answer — this
// function must never invent a region to look useful. A false positive means
// a customer's photo gets painted over in the wrong place, which is worse
// than returning nothing and letting a human draw the box.
// --------------------------------------------------------------------------
//
// Request:  POST { photoId: string, tenantId: string }
// Response: {
//   found: boolean,
//   regions: [{ x, y, w, h, text, confidence, matchedReg }],  // x/y/w/h are 0-1 ratios
//   allWords: [{ text, confidence, x, y, w, h }],             // everything OCR saw
//   reg: string | null
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  detectText,
  uint8ArrayToBase64,
  REKOGNITION_MAX_IMAGE_BYTES,
} from '../_shared/aws-rekognition.ts';

interface DetectPlateRequest {
  photoId?: string;
  tenantId?: string;
}

// --- Heuristic tuning knobs (all deliberately conservative) ----------------

/** Plate-shaped token length bounds, measured on the normalised token. */
const PLATE_MIN_CHARS = 4;
const PLATE_MAX_CHARS = 8;

/**
 * An exact match against the vehicle's own registration is strong evidence on
 * its own, so we accept it even when the OCR was unsure about the glyphs.
 */
const MIN_CONFIDENCE_EXACT_MATCH = 50;

/**
 * A plate-*shaped* token is a guess. Anything below this is background noise
 * (reflections, tyre sidewall text, distant signage) far more often than it is
 * a plate, so hold it to a much higher bar.
 */
const MIN_CONFIDENCE_HEURISTIC = 80;

/**
 * Require a plate-shaped candidate to contain at least one LETTER as well as
 * at least one digit. This is stricter than "contains a digit" and it is the
 * single most effective false-positive filter available here: without it,
 * "2024" (a windscreen year sticker), "1500" (a trim badge) and "0800"
 * (a phone number on a garage banner) all qualify as plates.
 *
 * Trade-off: it will miss all-numeric plates used in some jurisdictions. Those
 * still get returned in `allWords`, so a human can pick them. If a tenant with
 * numeric-only plates appears, flip this to false — do not loosen the length
 * or confidence bounds instead.
 */
const REQUIRE_LETTER_IN_PLATE = true;

/**
 * Normalise a plate string for comparison: uppercase, then drop everything
 * that is not A-Z or 0-9.
 *
 * The brief says "spaces and hyphens", and this strips a superset of that.
 * That is intentional — real registrations are stored with all sorts of
 * punctuation ("AB12 CDE", "AB-12-CDE", "AB12·CDE") and OCR adds its own
 * (periods around the plate's separator dot), so anchoring on the
 * alphanumerics is the only stable comparison.
 */
function normalisePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Is this raw OCR token shaped like a licence plate?
 *
 * Applied to the RAW detected text as well as the normalised form: a token
 * containing currency symbols, slashes or commas ("$1,299", "12/03") is not a
 * plate even though its alphanumerics might normalise into plate-shaped
 * nonsense. Only spaces and hyphens are tolerated as internal punctuation.
 */
function isPlateShaped(rawText: string): boolean {
  // Reject anything with punctuation a plate would not carry.
  if (!/^[A-Za-z0-9 -]+$/.test(rawText)) return false;

  const normalised = normalisePlate(rawText);

  if (normalised.length < PLATE_MIN_CHARS || normalised.length > PLATE_MAX_CHARS) return false;
  if (!/[0-9]/.test(normalised)) return false;
  if (REQUIRE_LETTER_IN_PLATE && !/[A-Z]/.test(normalised)) return false;

  return true;
}

/* ───────────────────── edge cases: skew, OCR drift, split plates ─────────────
 * Measured reality: on eight real photos from this platform Rekognition found
 * ZERO plates. Everything below widens the net for the cases where a plate IS
 * legible but the naive comparison misses it. None of it makes automatic
 * redaction safe — a human still confirms — it only reduces how often the
 * operator has to draw the box by hand.
 */

/**
 * Collapse the glyph pairs OCR genuinely confuses on plates.
 *
 * A plate is read at an angle, in poor light, on a dirty surface. "HU23 YWB"
 * comes back as "HUZ3 YW8" and an exact compare says "not this car" — so we
 * would show the operator nothing and make them draw the box on a plate the
 * detector actually found. Both sides are collapsed to the same canonical
 * alphabet before comparing.
 *
 * This is for MATCHING ONLY. The text shown to the operator is always the raw
 * detection, never the canonicalised form, so nobody is told we read something
 * we did not.
 */
function canonicalisePlate(value: string): string {
  return normalisePlate(value)
    .replace(/[O]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[Z]/g, '2')
    .replace(/[G]/g, '6')
    .replace(/[Q]/g, '0')
    .replace(/[D]/g, '0');
}

/** Axis-aligned cover of a word, using the ROTATED polygon when present. */
function coverOf(w: { box: { Left: number; Top: number; Width: number; Height: number }; polygon?: Array<{ X: number; Y: number }> }) {
  const bb = { x: w.box.Left, y: w.box.Top, w: w.box.Width, h: w.box.Height };
  if (!w.polygon || w.polygon.length < 3) return { ...bb, skewed: false };

  const xs = w.polygon.map((p) => p.X);
  const ys = w.polygon.map((p) => p.Y);
  const px = Math.min(...xs), py = Math.min(...ys);
  const pw = Math.max(...xs) - px, ph = Math.max(...ys) - py;

  // Union of both, because each can clip where the other does not: the
  // axis-aligned box is Rekognition's own estimate, the polygon is the measured
  // quad. Covering both is the only option that cannot leave a corner readable.
  const x = Math.min(bb.x, px), y = Math.min(bb.y, py);
  const cover = {
    x, y,
    w: Math.max(bb.x + bb.w, px + pw) - x,
    h: Math.max(bb.y + bb.h, py + ph) - y,
  };

  // A rotated quad fills less of its own bounding box than an upright one. That
  // ratio is a usable skew signal, and skewed text needs more slack because the
  // glyph corners sit furthest from the centre.
  const quadArea = Math.abs(
    w.polygon.reduce((acc, p, i) => {
      const q = w.polygon![(i + 1) % w.polygon!.length];
      return acc + (p.X * q.Y - q.X * p.Y);
    }, 0) / 2
  );
  const boxArea = cover.w * cover.h;
  const fill = boxArea > 0 ? quadArea / boxArea : 1;
  return { ...cover, skewed: fill < 0.86 };
}

/** Grow a region. Skewed plates get more, because their corners overhang most. */
function padRegion(r: { x: number; y: number; w: number; h: number }, skewed: boolean) {
  const f = skewed ? 0.16 : 0.08;
  const dx = r.w * f, dy = r.h * f;
  return {
    x: Math.max(0, r.x - dx),
    y: Math.max(0, r.y - dy),
    w: Math.min(1 - Math.max(0, r.x - dx), r.w + dx * 2),
    h: Math.min(1 - Math.max(0, r.y - dy), r.h + dy * 2),
  };
}

/** Union of two regions. */
function unionRegion(a: any, b: any) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Rebuild a plate that OCR split across words.
 *
 * "AB12 CDE" frequently returns as two WORD detections. Comparing each against
 * the full reg matches neither, so the plate is found and then discarded. This
 * joins horizontally-adjacent, vertically-aligned words and re-tests the
 * concatenation, covering the union of their boxes.
 *
 * Adjacency is required so we cannot staple together two unrelated words from
 * opposite ends of the photo just because their letters happen to concatenate
 * into the registration.
 */
function mergeSplitPlate(words: any[], canonReg: string) {
  if (!canonReg) return null;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < Math.min(i + 4, words.length); j++) {
      const a = words[i], b = words[j];
      const ca = coverOf(a), cb = coverOf(b);

      const sameLine = Math.abs((ca.y + ca.h / 2) - (cb.y + cb.h / 2)) < Math.max(ca.h, cb.h) * 0.6;
      const gap = cb.x - (ca.x + ca.w);
      const adjacent = gap > -0.01 && gap < Math.max(ca.w, cb.w) * 0.8;
      if (!sameLine || !adjacent) continue;

      if (canonicalisePlate(a.text + b.text) === canonReg) {
        return {
          region: unionRegion(ca, cb),
          skewed: ca.skewed || cb.skewed,
          text: `${a.text} ${b.text}`,
          confidence: Math.min(a.confidence, b.confidence),
        };
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // ---------------------------------------------------------------------
    // 1. AUTH. This function mutates nothing, but it reads tenant-owned rows
    //    and each call costs real money at AWS, so it is gated as tightly as
    //    a write. Pattern mirrors supabase/functions/admin-reset-password.
    // ---------------------------------------------------------------------
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Unauthorized', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Anon client carrying the caller's JWT — used only to establish identity.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for reading the photo/vehicle rows. Tenant scoping is
    // enforced explicitly below rather than leaning on RLS, because we need to
    // distinguish "not yours" (403) from "does not exist" (404) — RLS collapses
    // both into an empty result.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error('detect-plate-regions: invalid session', userError);
      return errorResponse('Invalid session', 401);
    }

    // app_users allows `auth.uid() = auth_user_id` self-read under RLS, so the
    // caller's own client is enough to fetch their own row.
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('id, role, is_active, tenant_id, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError || !appUser) {
      console.error('detect-plate-regions: app_users lookup failed', appUserError);
      return errorResponse('User not found', 403);
    }

    if (!appUser.is_active) {
      return errorResponse('Account is deactivated', 403);
    }

    // ---------------------------------------------------------------------
    // 2. Validate the request body.
    // ---------------------------------------------------------------------
    let body: DetectPlateRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body', 400);
    }

    const photoId = typeof body.photoId === 'string' ? body.photoId.trim() : '';
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';

    if (!photoId || !tenantId) {
      return errorResponse('photoId and tenantId are required', 400);
    }

    // Super admins may act across tenants; everyone else is pinned to their own.
    const isSuperAdmin = appUser.is_super_admin === true;
    // Role gate. `role` was selected but never read, so ops/viewer could spend
    // AWS Rekognition calls on any photo in their tenant. Mirrors the gate in
    // save-photo-redaction so the button and the API agree on who may act.
    const ALLOWED_ROLES = ['head_admin', 'admin', 'manager'];
    if (!isSuperAdmin && !ALLOWED_ROLES.includes(appUser.role)) {
      return errorResponse('Your role cannot edit vehicle photos.', 403);
    }

    if (!isSuperAdmin && appUser.tenant_id !== tenantId) {
      console.warn(
        `detect-plate-regions: user ${appUser.id} (tenant ${appUser.tenant_id}) tried tenant ${tenantId}`
      );
      return errorResponse('Forbidden for this tenant', 403);
    }

    // ---------------------------------------------------------------------
    // 3. Load the photo and its vehicle's registration.
    // ---------------------------------------------------------------------
    const { data: photo, error: photoError } = await supabaseAdmin
      .from('vehicle_photos')
      .select('id, photo_url, original_url, tenant_id, vehicle_id')
      .eq('id', photoId)
      .maybeSingle();

    if (photoError) {
      console.error('detect-plate-regions: photo lookup failed', photoError);
      return errorResponse('Failed to load photo', 500);
    }
    if (!photo) {
      return errorResponse('Photo not found', 404);
    }

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .select('id, reg, tenant_id')
      .eq('id', photo.vehicle_id)
      .maybeSingle();

    if (vehicleError) {
      console.error('detect-plate-regions: vehicle lookup failed', vehicleError);
      return errorResponse('Failed to load vehicle', 500);
    }
    if (!vehicle) {
      return errorResponse('Vehicle not found for this photo', 404);
    }

    // vehicle_photos.tenant_id is nullable, so fall back to the parent vehicle's
    // tenant. An orphan photo whose owner cannot be established is rejected
    // rather than assumed to belong to the caller.
    const owningTenantId = photo.tenant_id ?? vehicle.tenant_id ?? null;
    if (!owningTenantId) {
      return errorResponse('Photo has no owning tenant', 403);
    }
    if (owningTenantId !== tenantId) {
      console.warn(
        `detect-plate-regions: photo ${photoId} belongs to tenant ${owningTenantId}, not ${tenantId}`
      );
      return errorResponse('Photo does not belong to this tenant', 403);
    }

    // ---------------------------------------------------------------------
    // 4. Fetch the image bytes.
    //    Prefer original_url: once a photo has been redacted, photo_url may
    //    point at the already-masked copy, and re-detecting on a masked image
    //    finds nothing. original_url is null until a first redaction happens,
    //    hence the fallback.
    // ---------------------------------------------------------------------
    const imageUrl = photo.original_url || photo.photo_url;
    if (!imageUrl) {
      return errorResponse('Photo has no image URL', 422);
    }

    let imageBytes: Uint8Array;
    try {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        console.error('detect-plate-regions: image download failed', imageResponse.status, imageUrl);
        return errorResponse(`Failed to download photo (HTTP ${imageResponse.status})`, 502);
      }
      imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
    } catch (err) {
      console.error('detect-plate-regions: image download threw', err);
      return errorResponse('Failed to download photo', 502);
    }

    if (imageBytes.length === 0) {
      return errorResponse('Downloaded photo was empty', 502);
    }

    // Bail before base64-encoding: AWS would reject it anyway, and encoding a
    // huge buffer just to be told so wastes memory and wall time.
    if (imageBytes.length > REKOGNITION_MAX_IMAGE_BYTES) {
      return errorResponse(
        `Photo is ${(imageBytes.length / 1024 / 1024).toFixed(1)}MB — Rekognition accepts up to 5MB`,
        413
      );
    }

    console.log(
      `detect-plate-regions: photo=${photoId} tenant=${tenantId} reg=${vehicle.reg ?? '(none)'} bytes=${imageBytes.length}`
    );

    // ---------------------------------------------------------------------
    // 5. OCR.
    // ---------------------------------------------------------------------
    const ocr = await detectText(uint8ArrayToBase64(imageBytes));

    if (!ocr.ok) {
      // A Rekognition failure is an infrastructure problem, not "no plate here".
      // Surfacing it as found:false would quietly train users to trust an
      // answer we never actually computed.
      console.error('detect-plate-regions: DetectText failed:', ocr.error);
      return errorResponse(ocr.error || 'Text detection failed', 502);
    }

    console.log(
      `detect-plate-regions: OCR returned ${ocr.words.length} word(s): ` +
        ocr.words.map((w) => w.text).join(' | ')
    );

    // ---------------------------------------------------------------------
    // 6. Match. Two independent paths, and the response says which fired.
    // ---------------------------------------------------------------------
    const normalisedReg = vehicle.reg ? normalisePlate(vehicle.reg) : '';
    // Canonical form collapses the glyphs OCR confuses, so a plate read as
    // "HUZ3 YW8" still matches HU23 YWB instead of being silently discarded.
    const canonReg = vehicle.reg ? canonicalisePlate(vehicle.reg) : '';

    const regions = ocr.words
      .map((word) => {
        const normalisedWord = normalisePlate(word.text);

        // Path A: the OCR word IS this vehicle's registration. High trust.
        // Exact first, then the OCR-tolerant comparison — an angled or dirty
        // plate rarely comes back character-perfect, and treating that as "not
        // this car" is the difference between finding the plate and not.
        const matchedReg =
          normalisedReg.length > 0 &&
          normalisedWord.length > 0 &&
          (normalisedWord === normalisedReg ||
            (canonReg.length > 0 && canonicalisePlate(word.text) === canonReg));

        if (matchedReg) {
          if (word.confidence < MIN_CONFIDENCE_EXACT_MATCH) return null;
        } else {
          // Path B: merely plate-shaped. A guess — held to a higher bar and
          // flagged so the UI can present it as "is this it?" rather than
          // applying it automatically.
          if (!isPlateShaped(word.text)) return null;
          if (word.confidence < MIN_CONFIDENCE_HEURISTIC) return null;
        }

        // Cover the union of the axis-aligned box and the rotated polygon, then
        // pad — more when the quad says the plate is skewed, because that is
        // when the glyph corners sit furthest outside a straight rectangle.
        const cover = coverOf(word);
        const padded = padRegion(cover, cover.skewed);

        return {
          // Still 0-1 ratios, NOT pixels: the caller multiplies by rendered size.
          x: padded.x,
          y: padded.y,
          w: padded.w,
          h: padded.h,
          skewed: cover.skewed,
          text: word.text,
          confidence: Math.round(word.confidence * 100) / 100,
          matchedReg,
        };
      })
      .filter((r) => r !== null)
      // Exact registration matches first, then by confidence, so a consumer
      // that only takes regions[0] takes the most trustworthy one.
      .sort((a, b) => {
        if (a.matchedReg !== b.matchedReg) return a.matchedReg ? -1 : 1;
        return b.confidence - a.confidence;
      });

    // Split plates: "AB12 CDE" often returns as two WORDs, so neither matches
    // the full registration on its own and the plate is found then thrown away.
    // Only added when nothing already matched exactly, so this can never
    // displace a cleaner single-word hit.
    if (!regions.some((r: any) => r.matchedReg)) {
      const merged = mergeSplitPlate(ocr.words, canonReg);
      if (merged) {
        const padded = padRegion(merged.region, merged.skewed);
        regions.unshift({
          x: padded.x, y: padded.y, w: padded.w, h: padded.h,
          skewed: merged.skewed,
          text: merged.text,
          confidence: Math.round(merged.confidence * 100) / 100,
          matchedReg: true,
        } as any);
      }
    }

    // Every word OCR saw, for debugging and for a manual-pick UI. Same ratio
    // coordinate space as `regions`.
    const allWords = ocr.words.map((word) => ({
      text: word.text,
      confidence: Math.round(word.confidence * 100) / 100,
      x: word.box.Left,
      y: word.box.Top,
      w: word.box.Width,
      h: word.box.Height,
    }));

    const exactCount = regions.filter((r) => r.matchedReg).length;
    console.log(
      `detect-plate-regions: photo=${photoId} → ${regions.length} region(s) ` +
        `(${exactCount} exact reg match, ${regions.length - exactCount} plate-shaped guess)`
    );

    return jsonResponse({
      found: regions.length > 0,
      regions,
      allWords,
      reg: vehicle.reg ?? null,
    });
  } catch (error) {
    console.error('detect-plate-regions: unexpected error', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
});
