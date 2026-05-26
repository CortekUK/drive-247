// @ts-nocheck - Deno Edge Function
//
// cmd-poll-pending (verify_jwt = false)
// -------------------------------------
// Cron-driven fallback for when Modives' webhook hasn't been wired up to us.
// Hits Modives' verification-results endpoint for every pending CMD record,
// and mirrors the same DB updates the webhook would have applied.
//
// Idempotent: only processes identity_verifications rows where
// provider = 'cmd' AND cmd_license_status = 'Pending'. Drop the cron schedule
// and this function becomes a no-op when the webhook is configured.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cmdFetch } from "../_shared/modives-client.ts";

interface PendingRow {
  id: string;
  cmd_applicant_verification_id: string | null;
  cmd_license_status: string | null;
  cmd_status: string | null;
}

interface ModivesResults {
  result?: {
    status?: string;
    disposition?: string;
    timeStamp?: string;
  } | null;
  isSuccess?: boolean;
  message?: string;
}

function mapToLicenseStatus(status: string | undefined | null): string | null {
  if (!status) return null;
  // Modives returns mixed casing across endpoints — normalise to the
  // Pascal-case values that match what the webhook stores.
  const s = String(status).trim();
  const upper = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (["Valid", "Invalid", "Expired", "Pending"].includes(upper)) return upper;
  // Some endpoints return "Verified" instead of "Valid" — treat as Valid.
  if (s.toLowerCase() === "verified") return "Valid";
  if (s.toLowerCase() === "unverified") return "Invalid";
  return null;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pending, error: pendingErr } = await supabase
      .from("identity_verifications")
      .select("id, cmd_applicant_verification_id, cmd_license_status, cmd_status")
      .eq("provider", "cmd")
      .eq("cmd_license_status", "Pending")
      .not("cmd_applicant_verification_id", "is", null);

    if (pendingErr) {
      console.error("[cmd-poll-pending] failed to load pending rows:", pendingErr);
      return errorResponse(`DB load failed: ${pendingErr.message}`, 500);
    }

    const rows = (pending ?? []) as PendingRow[];
    if (rows.length === 0) {
      return jsonResponse({ ok: true, processed: 0, updated: 0 });
    }

    let updated = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      if (!row.cmd_applicant_verification_id) continue;
      try {
        const results = await cmdFetch<ModivesResults>(
          `/api/app/modives/verification-results/${row.cmd_applicant_verification_id}`,
          { method: "GET" }
        );

        // Modives returns isSuccess:false with message "Id is invalid or
        // verification is not yet completed" while the customer is still
        // working through the magic-link flow. Skip silently.
        if (!results?.isSuccess || !results.result) continue;

        const licenseStatus = mapToLicenseStatus(results.result.status);
        if (!licenseStatus || licenseStatus === row.cmd_license_status) continue;

        const update: Record<string, unknown> = {
          cmd_license_status: licenseStatus,
          cmd_last_event_at: new Date().toISOString(),
        };

        if (licenseStatus === "Valid") {
          update.status = "approved";
          update.review_status = "completed";
          update.review_result = "GREEN";
          update.verification_completed_at = new Date().toISOString();
        } else if (licenseStatus === "Invalid" || licenseStatus === "Expired") {
          update.status = "declined";
          update.review_status = "completed";
          update.review_result = "RED";
        }

        const { error: updErr } = await supabase
          .from("identity_verifications")
          .update(update)
          .eq("id", row.id);

        if (updErr) {
          errors.push({ id: row.id, error: updErr.message });
          continue;
        }

        // Log to the same audit table the webhook uses, so polled updates
        // show up alongside webhook events for troubleshooting.
        await supabase.from("cmd_webhook_events").insert({
          event_name: "polled-sync",
          object_type: "License",
          external_uuid: row.cmd_applicant_verification_id,
          payload: results as unknown,
          signature_header: null,
          signature_valid: true,
          processed: true,
          identity_verification_id: row.id,
        });

        updated++;
      } catch (e: any) {
        errors.push({ id: row.id, error: e?.message ?? String(e) });
        console.error(`[cmd-poll-pending] failed for ${row.id}:`, e);
      }
    }

    return jsonResponse({
      ok: true,
      processed: rows.length,
      updated,
      errors: errors.length ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[cmd-poll-pending] fatal:", err);
    return errorResponse(err?.message ?? "Internal error", 500);
  }
});
