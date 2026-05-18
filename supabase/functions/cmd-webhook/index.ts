// @ts-nocheck - Deno Edge Function
//
// cmd-webhook (verify_jwt = false)
// --------------------------------
// Receives webhook callbacks from Modives CheckMyDriver. Two object types
// arrive on the same endpoint:
//
//   object_type=Verification  → insurance status (LinkSent/Verifying/Verified/Unverified)
//   object_type=License       → license status   (Valid/Invalid/Expired)
//
// Per product scope (license-only UI), only License events drive the visible
// status. Insurance events are stored on the record but not surfaced.
//
// Every payload is logged to cmd_webhook_events (success or failure) for
// debugging and resync. Returns 200 OK on success, 400 if signature invalid
// (per Modives webhook spec).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors } from "../_shared/cors.ts";
import { verifyWebhookSignature } from "../_shared/modives-client.ts";

interface WebhookHeader {
  event_name?: string;
  object_type?: string;
  event_date_utc?: string;
  publish_date_utc?: string;
}

interface WebhookBody {
  uuid?: string;
  webhookresponseid?: number;
  meta_data?: string;
  lob?: number;
  carrier?: string | null;
  status?: string;
  disposition?: string;
  isMonitoring?: boolean;
  policystatus?: string;
  activestatus?: string;
  clientId?: string;
  creation_time?: string;
  last_update_time?: string;
}

interface WebhookPayload {
  Payload?: { Header?: WebhookHeader; Body?: WebhookBody };
  // Also support lower-case shape just in case
  payload?: { header?: WebhookHeader; body?: WebhookBody };
}

function normalizePayload(parsed: unknown): { header: WebhookHeader; body: WebhookBody } {
  const obj = parsed as WebhookPayload;
  const wrapper = obj?.Payload ?? obj?.payload ?? {};
  const header = (wrapper as any).Header ?? (wrapper as any).header ?? {};
  const body = (wrapper as any).Body ?? (wrapper as any).body ?? {};
  return { header, body };
}

function asPlainJsonOk(): Response {
  return new Response("OK", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

function asPlainJsonBadRequest(reason: string): Response {
  console.warn("[cmd-webhook] 400", reason);
  return new Response(reason, {
    status: 400,
    headers: { "Content-Type": "text/plain" },
  });
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // We need the raw body to verify HMAC — don't .json() it first
  const rawBody = await req.text();
  const signatureHeader =
    req.headers.get("modives-signature") ??
    req.headers.get("Modives-Signature");

  const sig = await verifyWebhookSignature(rawBody, signatureHeader);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e) {
    console.error("[cmd-webhook] body is not JSON:", rawBody.slice(0, 200));
  }

  const { header, body } = normalizePayload(parsed);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Log every payload (signature pass or fail) for debugging
  let auditId: string | null = null;
  try {
    const { data: audit, error: auditErr } = await supabase
      .from("cmd_webhook_events")
      .insert({
        event_name: header.event_name ?? null,
        object_type: header.object_type ?? null,
        external_uuid: body.uuid ?? null,
        payload: parsed ?? { raw: rawBody.slice(0, 4096) },
        signature_header: signatureHeader ?? null,
        signature_valid: sig.valid,
        processed: false,
        error: sig.valid ? null : sig.reason ?? "signature failed",
      })
      .select("id")
      .single();
    if (auditErr) {
      console.error("[cmd-webhook] failed to write audit:", auditErr);
    } else {
      auditId = audit?.id ?? null;
    }
  } catch (e) {
    console.error("[cmd-webhook] audit insert exception:", e);
  }

  if (!sig.valid) {
    return asPlainJsonBadRequest(`invalid signature: ${sig.reason ?? "unknown"}`);
  }
  if (!body?.uuid) {
    return asPlainJsonBadRequest("missing uuid in payload");
  }

  // Locate our local row by Modives' uuid (applicantVerificationReqGuidId)
  // For both insurance and license events the uuid points back to the same
  // applicant verification we created.
  const { data: ivRow, error: ivErr } = await supabase
    .from("identity_verifications")
    .select("id, status, cmd_status, cmd_license_status")
    .eq("cmd_applicant_verification_id", body.uuid)
    .maybeSingle();

  if (ivErr || !ivRow) {
    console.warn("[cmd-webhook] no local verification for uuid:", body.uuid, ivErr);
    if (auditId) {
      await supabase
        .from("cmd_webhook_events")
        .update({ error: "no matching identity_verifications row" })
        .eq("id", auditId);
    }
    // Still return 200 so Modives doesn't retry-storm; we have the audit row.
    return asPlainJsonOk();
  }

  const objectType = (header.object_type ?? "").toLowerCase();
  const status = body.status ?? body.disposition ?? null;
  const eventAt = header.event_date_utc ?? new Date().toISOString();

  // Apply the update based on which object_type fired
  const update: Record<string, unknown> = {
    cmd_last_event_at: eventAt,
  };

  if (objectType === "license") {
    // Surfaced in UI — Valid / Invalid / Expired / Pending
    update.cmd_license_status = status ?? "Pending";
    if (status === "Valid") {
      // Mark overall row approved when license is valid (matches AI flow norms)
      update.status = "approved";
      update.review_status = "completed";
      update.review_result = "GREEN";
      update.verification_completed_at = new Date().toISOString();
    } else if (status === "Invalid" || status === "Expired") {
      update.status = "declined";
      update.review_status = "completed";
      update.review_result = "RED";
    }
  } else if (objectType === "verification") {
    // Insurance side — store silently per product scope
    update.cmd_status = status ?? "Verifying";
  } else {
    // Unknown object_type — log and ack
    console.warn("[cmd-webhook] unknown object_type:", header.object_type);
  }

  const { error: updErr } = await supabase
    .from("identity_verifications")
    .update(update)
    .eq("id", ivRow.id);
  if (updErr) {
    console.error("[cmd-webhook] failed to update identity_verifications:", updErr);
    if (auditId) {
      await supabase
        .from("cmd_webhook_events")
        .update({ error: `update failed: ${updErr.message}` })
        .eq("id", auditId);
    }
    return asPlainJsonOk(); // still 200 — see comment above
  }

  if (auditId) {
    await supabase
      .from("cmd_webhook_events")
      .update({ processed: true, identity_verification_id: ivRow.id })
      .eq("id", auditId);
  }

  return asPlainJsonOk();
});
