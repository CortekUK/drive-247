// bonzah-partner-review
// A Bonzah partner (is_bonzah_partner) approves or rejects an operator's Bonzah
// onboarding submission.
//
//  approve: { submissionId, username, password, message? }
//    → verify creds live → write tenant creds + integration_bonzah=true +
//      bonzah_mode='live' → submission approved + partner_message + activated_at
//      → 'approved' + 'activated' events → broadcast notification → active email
//  reject:  { submissionId, reason }
//    → submission rejected + reject_reason → 'rejected' event → notification →
//      "what to update" email
//
// Auth: JWT required; caller must have app_users.is_bonzah_partner = true.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function invokeFn(name: string, body: unknown, bearer: string) {
  return await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const authClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Gate: caller must be a Bonzah partner.
    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, is_bonzah_partner")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser || appUser.is_bonzah_partner !== true) {
      return errorResponse("Forbidden — Bonzah partner access required", 403);
    }
    const partnerId = appUser.id;

    const body = await req.json().catch(() => ({}));
    const { submissionId, action } = body;
    if (!submissionId || !["approve", "reject"].includes(action)) {
      return errorResponse("submissionId and a valid action (approve|reject) are required", 400);
    }

    const { data: submission, error: subError } = await supabase
      .from("bonzah_onboarding_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();
    if (subError || !submission) return errorResponse("Submission not found", 404);

    const tenantId = submission.tenant_id;
    const now = new Date().toISOString();

    // ── REJECT ───────────────────────────────────────────────────────────────
    if (action === "reject") {
      const reason = (body.reason || "").trim();
      if (!reason) return errorResponse("A reason is required to send back", 400);

      const { error: upErr } = await supabase
        .from("bonzah_onboarding_submissions")
        .update({
          status: "rejected",
          reject_reason: reason,
          reviewed_by: partnerId,
          reviewed_at: now,
        })
        .eq("id", submissionId);
      if (upErr) return errorResponse(`Update failed: ${upErr.message}`, 500);

      await supabase.from("bonzah_submission_events").insert({
        submission_id: submissionId,
        tenant_id: tenantId,
        actor_type: "partner",
        actor_id: partnerId,
        event_type: "rejected",
        note: reason,
      });

      await supabase.from("notifications").insert({
        tenant_id: tenantId,
        user_id: null,
        title: "Bonzah application — a few updates needed",
        message: reason,
        type: "general",
        link: "/settings?tab=insurance",
        metadata: { kind: "bonzah_rejected", submission_id: submissionId },
      });

      // Branded "what to update" email (Phase 5); best-effort.
      invokeFn("send-bonzah-update-email", { submissionId }, token).catch(() => {});

      return jsonResponse({ success: true, status: "rejected" });
    }

    // ── APPROVE ────────────────────────────────────────────────────────────────
    const username = (body.username || "").trim();
    const password = (body.password || "").trim();
    const message = (body.message || "").trim();
    if (!username || !password) {
      return errorResponse("username and password are required to activate", 400);
    }

    // Capture current mode to revert if verification fails.
    const { data: tenantBefore } = await supabase
      .from("tenants")
      .select("bonzah_mode")
      .eq("id", tenantId)
      .single();
    const previousMode = tenantBefore?.bonzah_mode ?? "test";

    // Switch to live first so verification actually authenticates the live creds.
    await supabase.from("tenants").update({ bonzah_mode: "live" }).eq("id", tenantId);

    // Verify the credentials via the shared verify function.
    const verifyRes = await invokeFn(
      "bonzah-verify-credentials",
      { username, password, tenantId },
      token,
    );
    const verifyJson = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || verifyJson?.valid !== true) {
      // Roll back mode; do not approve.
      await supabase.from("tenants").update({ bonzah_mode: previousMode }).eq("id", tenantId);
      return errorResponse(
        verifyJson?.error || "Bonzah credentials could not be verified",
        400,
      );
    }

    // Persist credentials and enable the integration.
    const { error: tErr } = await supabase
      .from("tenants")
      .update({
        bonzah_username: username,
        bonzah_password: password,
        integration_bonzah: true,
        bonzah_mode: "live",
      })
      .eq("id", tenantId);
    if (tErr) {
      await supabase.from("tenants").update({ bonzah_mode: previousMode }).eq("id", tenantId);
      return errorResponse(`Failed to activate: ${tErr.message}`, 500);
    }

    const { error: sErr } = await supabase
      .from("bonzah_onboarding_submissions")
      .update({
        status: "approved",
        partner_message: message || null,
        activated_at: now,
        reviewed_by: partnerId,
        reviewed_at: now,
      })
      .eq("id", submissionId);
    if (sErr) return errorResponse(`Failed to update submission: ${sErr.message}`, 500);

    await supabase.from("bonzah_submission_events").insert([
      {
        submission_id: submissionId,
        tenant_id: tenantId,
        actor_type: "partner",
        actor_id: partnerId,
        event_type: "approved",
        note: message || null,
      },
      {
        submission_id: submissionId,
        tenant_id: tenantId,
        actor_type: "system",
        event_type: "activated",
        note: "Bonzah integration activated (live mode).",
      },
    ]);

    await supabase.from("notifications").insert({
      tenant_id: tenantId,
      user_id: null,
      title: "Bonzah is active 🎉",
      message: message || "Your Bonzah insurance integration is now live.",
      type: "general",
      link: "/settings?tab=insurance",
      metadata: { kind: "bonzah_approved", submission_id: submissionId },
    });

    // Branded "Bonzah is active" email (Phase 5); best-effort.
    invokeFn("send-bonzah-active-email", { submissionId }, token).catch(() => {});

    return jsonResponse({ success: true, status: "approved" });
  } catch (error) {
    console.error("[bonzah-partner-review] error:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
