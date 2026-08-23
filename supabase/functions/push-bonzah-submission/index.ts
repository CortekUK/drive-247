// push-bonzah-submission — send an onboarding submission to Bonzah's External API.
//
// Replaces the manual step where we email the form to Brandon. It does NOT
// replace the whole round trip: their API is write-only, so activation and the
// credentials still come back by hand. send-bonzah-form-to-brandon is therefore
// KEPT, not deleted, and remains authoritative until this has been proven
// against a real key.
//
// DEFAULTS TO DRY RUN. A live push has to be asked for explicitly. Two things
// are missing that only Bonzah can supply — an API key and a per-tenant partner
// id — and in both cases this refuses LOUDLY rather than appearing to succeed.
// A silent skip on a compliance submission is the worst possible failure: it
// looks exactly like success right up until an operator cannot insure a car.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  mapSubmissionToBonzah,
  putSubmission,
  bonzahExternalKey,
  sha256Hex,
  BONZAH_EXTERNAL_BASE,
} from "../_shared/bonzah-external.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let pushId: string | null = null;

  try {
    // ── super admin only ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: userErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userErr || !user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await supabase
      .from("app_users").select("id, is_active, is_super_admin")
      .eq("auth_user_id", user.id).maybeSingle();
    if (!appUser?.is_active || appUser?.is_super_admin !== true) {
      return errorResponse("Only super admins can push a submission to Bonzah", 403);
    }

    const body = await req.json().catch(() => ({}));
    const submissionId = body?.submissionId;
    // Live has to be asked for. Anything other than an explicit true is a dry run.
    const live = body?.live === true;
    if (!submissionId) return errorResponse("submissionId is required", 400);

    const { data: sub } = await supabase
      .from("bonzah_onboarding_submissions")
      .select("id, tenant_id, status, data")
      .eq("id", submissionId)
      .maybeSingle();
    if (!sub) return errorResponse("Submission not found", 404);

    const { data: tenant } = await supabase
      .from("tenants").select("id, company_name, bonzah_partner_id")
      .eq("id", sub.tenant_id).maybeSingle();
    if (!tenant) return errorResponse("Tenant not found", 404);

    const mapped = mapSubmissionToBonzah((sub.data ?? {}) as Record<string, unknown>);
    const serialised = JSON.stringify({ step: 6, data: mapped.payload });
    const hash = await sha256Hex(serialised);

    // Open the ledger row before anything can fail, so a push that dies halfway
    // still leaves a trace. The payload itself is NEVER stored — it carries bank
    // account and routing numbers, EIN and a date of birth, and an audit table
    // that quietly becomes a second copy of that is worse than no audit.
    const { data: pushRow } = await supabase
      .from("bonzah_api_pushes")
      .insert({
        tenant_id: tenant.id,
        submission_id: sub.id,
        partner_id: tenant.bonzah_partner_id ?? null,
        mode: live ? "live" : "dry_run",
        status: "pending",
        payload_sha256: hash,
        payload_field_count: mapped.fieldCount,
        requested_by: appUser.id,
      })
      .select("id")
      .single();
    pushId = pushRow?.id ?? null;

    const finish = async (patch: Record<string, unknown>) => {
      if (!pushId) return;
      await supabase.from("bonzah_api_pushes")
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq("id", pushId);
    };

    // ── DRY RUN: show exactly what would go, create nothing at Bonzah ───────
    if (!live) {
      await finish({
        status: "success",
        validation_errors: [
          ...mapped.missingRequired.map((f) => ({ field: f, reason: "required by Bonzah, not filled" })),
          ...mapped.warnings,
        ],
      });
      return jsonResponse({
        mode: "dry_run",
        pushId,
        endpoint: `${BONZAH_EXTERNAL_BASE}/partners/${tenant.bonzah_partner_id ?? "<PARTNER_ID_NOT_SET>"}/submission`,
        partnerIdConfigured: !!tenant.bonzah_partner_id,
        apiKeyConfigured: !!bonzahExternalKey(),
        payloadSha256: hash,
        fieldCount: mapped.fieldCount,
        // The point of a dry run: what would go wrong BEFORE anything is sent.
        // Their server takes `data` as an opaque object, so a bad enum or a
        // missing required field does not bounce — it stalls in underwriting.
        missingRequired: mapped.missingRequired,
        warnings: mapped.warnings,
        // Safe to return to a super admin who can already read the submission,
        // and it is the point of a dry run. Card number, expiry and CVC are not
        // in here at all — Bonzah marks them optional, so they are never sent.
        payload: mapped.payload,
      });
    }

    // ── LIVE: both prerequisites must be present. Refuse loudly. ────────────
    const apiKey = bonzahExternalKey();
    if (!apiKey) {
      await finish({ status: "blocked", error_code: "missing_api_key" });
      return jsonResponse({
        error: "BONZAH_EXTERNAL_API_KEY is not configured. Ask Bonzah for the External API key and set it as a Supabase secret before pushing live.",
        code: "missing_api_key",
        pushId,
      }, 409);
    }
    if (!tenant.bonzah_partner_id) {
      await finish({ status: "blocked", error_code: "missing_partner_id" });
      return jsonResponse({
        error: `No Bonzah partner id is set for ${tenant.company_name}. Bonzah issues these out of band — their API has no endpoint to create or look one up.`,
        code: "missing_partner_id",
        pushId,
      }, 409);
    }

    // A live push is BLOCKED by its own validation. The previous version
    // computed missingRequired and warnings, wrote them to the ledger, and then
    // transmitted regardless — so every gap and every bad enum would have gone
    // to an underwriter the moment a key existed. An incomplete insurance
    // submission is not a smaller version of a complete one; it is a different
    // thing, and it is the operator who carries the consequence.
    //
    // force:true exists for the case where Bonzah has told us a gap is
    // acceptable. It is recorded on the ledger so that decision has a name
    // against it.
    if (mapped.missingRequired.length > 0 && body?.force !== true) {
      await finish({
        status: "blocked",
        error_code: "incomplete_submission",
        validation_errors: [
          ...mapped.missingRequired.map((f) => ({ field: f, reason: "required by Bonzah, not filled" })),
          ...mapped.warnings,
        ],
      });
      return jsonResponse({
        error: `${mapped.missingRequired.length} field(s) Bonzah requires are not filled. Resolve them with the operator, or pass force:true if Bonzah has confirmed the gap is acceptable.`,
        code: "incomplete_submission",
        missingRequired: mapped.missingRequired,
        warnings: mapped.warnings,
        pushId,
      }, 409);
    }

    const result = await putSubmission(tenant.bonzah_partner_id, apiKey, mapped.payload);

    if (!result.ok) {
      await finish({
        status: "failed",
        http_status: result.httpStatus ?? null,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
      });
      return jsonResponse({
        error: result.errorMessage ?? "Bonzah rejected the submission",
        code: result.errorCode,
        httpStatus: result.httpStatus,
        pushId,
      }, 502);
    }

    await finish({ status: "success", http_status: result.httpStatus ?? null });

    // Deliberately does NOT advance submission status. Their API cannot tell us
    // the submission was accepted for underwriting, only that the write landed —
    // moving the status here would claim knowledge we do not have.
    return jsonResponse({
      mode: "live",
      pushId,
      httpStatus: result.httpStatus,
      fieldCount: mapped.fieldCount,
      payloadSha256: hash,
      note: "Delivered to Bonzah. Activation and API credentials still come back manually — their API is write-only.",
    });
  } catch (err) {
    console.error("[push-bonzah-submission] failed:", err);
    if (pushId) {
      await supabase.from("bonzah_api_pushes").update({
        status: "failed",
        error_code: "unhandled",
        error_message: (err as { message?: string })?.message ?? "unhandled",
        finished_at: new Date().toISOString(),
      }).eq("id", pushId);
    }
    return errorResponse((err as { message?: string })?.message ?? "Push failed", 500);
  }
});
