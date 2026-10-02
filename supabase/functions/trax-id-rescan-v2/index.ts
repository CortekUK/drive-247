// @ts-nocheck - This is a Deno Edge Function, not Node.js TypeScript
/**
 * trax-id-rescan-v2 — run Trax ID again on the documents ALREADY on file.
 *
 * The customer does nothing: the licence images and selfie stored on the
 * verification row are re-read (ai-document-ocr) and re-matched
 * (ai-face-match), and the result is written back onto the SAME row. Sending
 * the customer a new link to upload fresh photos is a different action
 * (create-ai-verification-session), which ends in a scan of its own.
 *
 * A new function rather than a mode on `process-ai-verification` (V2_PLAN §7:
 * never change an existing function's behaviour). That one is tied to a live
 * customer session, and it differs from a re-scan in two ways that matter:
 *
 *  - It writes `status`. The `on_identity_verified_notify` trigger fires on
 *    `UPDATE OF status` and EMAILS THE OPERATOR "identity verified". A re-scan
 *    the operator just asked for must not email them, so `status` is never in
 *    this function's update — not even unchanged, because `UPDATE OF status`
 *    fires on the column being SET, not on it changing.
 *  - `trigger_sync_verified_name` renames the CUSTOMER to the name read off
 *    the licence on any GREEN update. An operator may have corrected that name
 *    since; a re-scan must not undo it, so the customer's name is read first
 *    and put back if the trigger moved it.
 *
 * Tenant isolation is enforced here (RLS is off on these tables — V2_PLAN §5):
 * the caller must be an active app user of the verification's tenant, or a
 * super admin.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";

async function callFn(name: string, body: unknown) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    /* ── who is asking ─────────────────────────────────────────────────── */
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Not signed in", 401);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Not signed in", 401);

    const { verificationId } = await req.json();
    if (!verificationId) return errorResponse("verificationId is required", 400);

    const { data: v, error: vError } = await supabase
      .from("identity_verifications")
      .select("id, tenant_id, customer_id, provider, verification_provider, document_front_url, document_back_url, selfie_image_url, face_image_url")
      .eq("id", verificationId)
      .maybeSingle();
    if (vError) throw vError;
    if (!v || !v.tenant_id) return errorResponse("Verification not found", 404);

    // Several app_users rows can share one auth user (one per tenant).
    const { data: appUsers } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin, is_active")
      .eq("auth_user_id", user.id);
    const allowed = (appUsers ?? []).some(
      (u: any) => u.is_active !== false && (u.is_super_admin === true || u.tenant_id === v.tenant_id),
    );
    // Same answer as "not found": do not confirm another tenant's row exists.
    if (!allowed) return errorResponse("Verification not found", 404);

    if (v.provider === "cmd" || v.verification_provider === "cmd") {
      return errorResponse("CheckMyDriver checks cannot be re-scanned by Trax", 400);
    }

    const front = v.document_front_url;
    const back = v.document_back_url || undefined;
    const selfie = v.selfie_image_url || v.face_image_url;
    if (!front || !selfie) return errorResponse("There are no documents on file to scan again", 400);

    /* ── the customer's name, before the triggers can touch it ────────── */
    let nameBefore: string | null = null;
    if (v.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("name")
        .eq("id", v.customer_id)
        .eq("tenant_id", v.tenant_id)
        .maybeSingle();
      nameBefore = c?.name ?? null;
    }

    /* ── the scan — same two calls, same verdict rules as the live flow ── */
    const now = new Date().toISOString();
    const ocr = await callFn("ai-document-ocr", { documentFrontUrl: front, documentBackUrl: back });

    let update: Record<string, unknown>;
    let result: "verified" | "rejected" | "review_required";

    if (!ocr?.ok) {
      result = "rejected";
      update = {
        review_status: "completed",
        review_result: "RED",
        rejection_reason: `OCR extraction failed: ${ocr?.error ?? "unknown error"}`,
        ai_face_match_result: "error",
        verification_completed_at: now,
        updated_at: now,
      };
    } else {
      const data = ocr.extractedData;
      const face = await callFn("ai-face-match", { documentImageUrl: front, selfieImageUrl: selfie });

      if (!face?.ok) {
        result = "rejected";
        update = {
          review_status: "completed",
          review_result: "RED",
          rejection_reason: `Face matching failed: ${face?.detail || face?.error || "unknown error"}`,
          ai_ocr_data: data,
          ai_face_match_result: "error",
          verification_completed_at: now,
          updated_at: now,
        };
      } else {
        const reviewResult = face.isMatch ? "GREEN" : face.needsReview ? "RETRY" : "RED";
        result = face.isMatch ? "verified" : face.needsReview ? "review_required" : "rejected";
        update = {
          review_status: "completed",
          review_result: reviewResult,
          rejection_reason: reviewResult === "RED" ? "Face does not match document photo" : null,
          verification_completed_at: now,
          ai_ocr_data: data,
          first_name: data?.firstName || null,
          last_name: data?.lastName || null,
          date_of_birth: data?.dateOfBirth || null,
          document_type: data?.documentType || null,
          document_number: data?.documentNumber || null,
          document_country: data?.documentCountry || null,
          document_expiry_date: data?.documentExpiry || null,
          ai_face_match_score: face.similarity ? face.similarity / 100 : null,
          ai_face_match_result: face.isMatch ? "match" : face.needsReview ? "pending" : "no_match",
          updated_at: now,
        };
      }
    }

    // NOTE: no `status` key — see the header. Scoped by id AND tenant.
    const { error: updError } = await supabase
      .from("identity_verifications")
      .update(update)
      .eq("id", v.id)
      .eq("tenant_id", v.tenant_id);
    if (updError) throw updError;

    /* ── put the customer's name back if the GREEN trigger moved it ────── */
    if (v.customer_id && nameBefore !== null) {
      const { data: c } = await supabase
        .from("customers")
        .select("name")
        .eq("id", v.customer_id)
        .eq("tenant_id", v.tenant_id)
        .maybeSingle();
      if (c && c.name !== nameBefore) {
        await supabase
          .from("customers")
          .update({ name: nameBefore })
          .eq("id", v.customer_id)
          .eq("tenant_id", v.tenant_id);
      }
    }

    return jsonResponse({ ok: true, result });
  } catch (err) {
    console.error("trax-id-rescan-v2:", err);
    return errorResponse(err instanceof Error ? err.message : "Re-scan failed", 500);
  }
});
