/**
 * prepare-hero-car — turns an operator's photo of their car into a showroom
 * car for the booking site's hero (Template 2). The work is in pipeline.ts;
 * this file is the door: who may call it, where the photo comes from, and
 * where the result goes.
 *
 * POST { tenantId, imageUrl }
 *   imageUrl  the original photo, already uploaded to the `cms-media` bucket
 *             by the portal's media picker (only that bucket is accepted, so
 *             this can never be pointed at an arbitrary URL)
 *
 * → { image_url, width, height, name, paint, color, issues }
 *   image_url  the cut-out, saved to cms-media/hero-cars/<tenant>/ and listed
 *              in the tenant's media library like any upload
 *
 * Nothing is published: the portal shows the result next to the original and
 * the operator chooses to use it. Spends OpenAI credit, so staff only, behind
 * the subscription gate, as generate-review-summary is.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { errorResponse, handleCors, jsonResponse } from "../_shared/cors.ts";
import { requireActiveSubscription } from "../_shared/subscription-gate.ts";
import { authorizeTenantAccess } from "../_shared/tenant-auth.ts";
import { prepareHeroCar } from "./pipeline.ts";

const BUCKET = "cms-media";
const MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return errorResponse("Image processing is not configured", 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { tenantId, imageUrl } = await req.json().catch(() => ({}));
    if (!tenantId) return errorResponse("tenantId is required", 400);
    if (typeof imageUrl !== "string") return errorResponse("imageUrl is required", 400);

    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);
    const gate = await requireActiveSubscription(supabase, tenantId);
    if (gate) return gate;

    // Only a photo already in our own media bucket.
    const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`;
    if (!imageUrl.startsWith(publicPrefix)) return errorResponse("imageUrl must be a cms-media upload", 400);
    const path = decodeURIComponent(imageUrl.slice(publicPrefix.length).split("?")[0]);
    const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
    if (downloadError || !file) return errorResponse("Could not read the photo", 400);
    if (!PHOTO_TYPES.includes(file.type)) return errorResponse("The photo must be a JPG, PNG or WebP", 400);
    if (file.size > MAX_BYTES) return errorResponse("The photo must be 10 MB or smaller", 400);

    const car = await prepareHeroCar(new Uint8Array(await file.arrayBuffer()), file.type, apiKey);

    // The read found no car: nothing is saved or offered, only the reason.
    if (car.issues.includes("no_car")) {
      return jsonResponse({ image_url: null, name: "", paint: "", color: car.color, issues: car.issues });
    }

    const outPath = `hero-cars/${tenantId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(outPath, car.png, { contentType: "image/png", cacheControl: "31536000", upsert: false });
    if (uploadError) throw uploadError;
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(outPath);

    const { data: appUser } = await supabase.from("app_users").select("id").eq("auth_user_id", user.id).maybeSingle();
    await supabase.from("cms_media").insert({
      file_name: `${car.name || "hero-car"}-cutout.png`,
      file_url: publicUrl,
      file_size: car.png.length,
      mime_type: "image/png",
      alt_text: [car.paint, car.name].filter(Boolean).join(" ") || "Car",
      folder: "hero-cars",
      uploaded_by: appUser?.id ?? null,
      tenant_id: tenantId,
    });

    return jsonResponse({
      image_url: publicUrl,
      width: car.width,
      height: car.height,
      name: car.name,
      paint: car.paint,
      color: car.color,
      issues: car.issues,
    });
  } catch (error) {
    console.error("prepare-hero-car:", error);
    return errorResponse(error instanceof Error ? error.message : "Could not prepare the car", 500);
  }
});
