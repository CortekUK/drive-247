// @ts-nocheck — Deno edge function.
//
// Send (or resend) the ID-verification invite to a single additional driver.
//
// Creates a Veriff session (vendorData = the additional-driver row ID so the
// webhook can route the result back), persists the verification_url +
// identity_verification_id on the row, and emails the link to the driver.
// The agreement signing email is sent separately by the BoldSign flow when
// the document is generated — this function only handles ID verification.
//
// Request body: { driver_id: string }
// Response: { success: true, verification_url: string }
//
// Auth: requires JWT; tenant ownership enforced via app_users.tenant_id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, getTenantBranding, wrapWithBrandedTemplate } from "../_shared/resend-service.ts";

interface RequestBody {
  driver_id: string;
}

interface VeriffSessionResult {
  sessionUrl: string;
  sessionToken: string;
  sessionId: string;
}

interface VeriffOutcome {
  ok: boolean;
  session?: VeriffSessionResult;
  /** Surfaced to the client so the operator sees WHY Veriff failed. */
  errorStatus?: number;
  errorBody?: string;
}

async function createVeriffSession(
  apiKey: string,
  baseUrl: string,
  driverName: string,
  vendorData: string,
  documentType?: string,
): Promise<VeriffOutcome> {
  const firstName = (driverName || "").trim().split(/\s+/)[0] || "Additional";
  const lastName = (driverName || "").trim().split(/\s+/).slice(1).join(" ") || "Driver";

  const requestBody: any = {
    verification: {
      person: { firstName, lastName },
      vendorData,
    },
  };
  if (documentType) {
    const veriffDocTypeMap: Record<string, string> = {
      driving_license: "DRIVERS_LICENSE",
      passport: "PASSPORT",
      id_card: "ID_CARD",
    };
    if (veriffDocTypeMap[documentType]) {
      requestBody.verification.document = { type: veriffDocTypeMap[documentType] };
    }
  }

  console.log("[SendInvite] Veriff request:", JSON.stringify({ baseUrl, vendorData, firstName, lastName, documentType }));

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AUTH-CLIENT": apiKey },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SendInvite] Veriff fetch threw:", msg);
    return { ok: false, errorStatus: 0, errorBody: `fetch error: ${msg}` };
  }

  const bodyText = await res.text();
  if (!res.ok) {
    console.error("[SendInvite] Veriff non-OK:", res.status, bodyText);
    return { ok: false, errorStatus: res.status, errorBody: bodyText.slice(0, 500) };
  }

  let data: any;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    console.error("[SendInvite] Veriff response not JSON:", bodyText.slice(0, 500));
    return { ok: false, errorStatus: 200, errorBody: `non-JSON response: ${bodyText.slice(0, 200)}` };
  }

  const url = data?.verification?.url;
  const sessionId = data?.verification?.id;
  // Veriff sometimes omits sessionToken; the id works as fallback for webhook matching.
  const sessionToken = data?.verification?.sessionToken || sessionId;

  if (!url || !sessionId) {
    console.error("[SendInvite] Veriff response missing url/id:", JSON.stringify(data));
    return { ok: false, errorStatus: 200, errorBody: "Veriff response missing url or id" };
  }

  return { ok: true, session: { sessionUrl: url, sessionToken, sessionId } };
}

function inviteEmailHtml(driverName: string, verificationUrl: string, companyName: string): string {
  return `
    <p>Hi ${escapeHtml(driverName)},</p>
    <p>You have been added as an additional driver on a vehicle rental with <strong>${escapeHtml(companyName)}</strong>.</p>
    <p>To complete the process, please verify your driving licence using the secure link below. The same link works on mobile and desktop.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${verificationUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">
        Verify Your Licence
      </a>
    </p>
    <p>You will also receive a separate email shortly to sign the rental agreement.</p>
    <p style="color:#737373;font-size:12px;">If the button doesn't work, copy and paste this URL into your browser:<br/>${verificationUrl}</p>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization token");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonError(401, "Invalid or expired token");
    const { data: appUser } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return jsonError(403, "User not found in app_users");

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const driverId = body?.driver_id;
    if (!driverId) return jsonError(400, "driver_id is required");

    // Load the driver row + tenant settings
    const { data: driver, error: driverErr } = await supabase
      .from("rental_additional_drivers")
      .select("id, tenant_id, name, email, rental_id")
      .eq("id", driverId)
      .single();
    if (driverErr || !driver) return jsonError(404, "Driver not found");
    if (!appUser.is_super_admin && appUser.tenant_id !== driver.tenant_id) {
      return jsonError(403, "Not authorized");
    }
    if (!driver.email) {
      return jsonError(400, "Cannot send email — driver has no email address");
    }

    const VERIFF_API_KEY = Deno.env.get("VERIFF_API_KEY") || Deno.env.get("NEXT_PUBLIC_VERIFF_API_KEY");
    const VERIFF_BASE_URL = Deno.env.get("VERIFF_BASE_URL") || "https://stationapi.veriff.com";
    if (!VERIFF_API_KEY) return jsonError(500, "Veriff is not configured");

    const { data: tenant } = await supabase
      .from("tenants")
      .select("verification_document_type, company_name")
      .eq("id", driver.tenant_id)
      .single();

    // Create a Veriff session keyed on the driver row id (not a customer id).
    const outcome = await createVeriffSession(
      VERIFF_API_KEY,
      VERIFF_BASE_URL,
      driver.name,
      `additional_driver_${driver.id}`,
      tenant?.verification_document_type || undefined,
    );
    if (!outcome.ok || !outcome.session) {
      // Return 200 with success:false so the Supabase JS client surfaces our
      // error body in `data.error` instead of throwing a generic non-2xx error.
      const detail = `Veriff [${outcome.errorStatus ?? "?"}]: ${outcome.errorBody ?? "unknown"}`;
      console.error("[SendInvite] Veriff session creation failed:", detail);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to create Veriff session — ${detail}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const session = outcome.session;

    // Persist a verification record. customer_id is NULL because this is per
    // additional-driver — webhooks key off the vendorData prefix.
    // Use 'pending' for status (matches the table default and what veriff-webhook
    // expects on the unverified → completed transition).
    const { data: verification, error: vErr } = await supabase
      .from("identity_verifications")
      .insert({
        tenant_id: driver.tenant_id,
        provider: "veriff",
        session_id: session.sessionId,
        verification_token: session.sessionToken,
        external_user_id: `additional_driver_${driver.id}`,
        status: "pending",
        review_status: "pending",
        verification_url: session.sessionUrl,
      })
      .select()
      .single();
    if (vErr) {
      console.error("[SendInvite] identity_verifications insert failed:", vErr);
      return jsonError(500, `Verification insert failed: ${vErr.message}`);
    }

    // Stamp the driver row with the verification linkage and URL for resend.
    const { error: drvUpdErr } = await supabase
      .from("rental_additional_drivers")
      .update({
        identity_verification_id: verification.id,
        verification_url: session.sessionUrl,
        verification_status: "pending",
      })
      .eq("id", driver.id);
    if (drvUpdErr) {
      console.error("[SendInvite] driver row update failed:", drvUpdErr);
      // Non-fatal — the verification row exists, link can still be retrieved.
    }

    // Send the invite email. Non-fatal: if Resend fails the verification row
    // is still good — the operator can resend manually.
    try {
      const branding = await getTenantBranding(driver.tenant_id, supabase);
      const companyName = tenant?.company_name || branding?.company_name || "Drive247";
      const html = wrapWithBrandedTemplate(
        inviteEmailHtml(driver.name, session.sessionUrl, companyName),
        branding,
      );
      await sendEmail(
        driver.email,
        `Verify your driving licence for the upcoming rental`,
        html,
        supabase,
        driver.tenant_id,
      );
    } catch (mailErr) {
      console.error("[SendAdditionalDriverInvite] email error:", mailErr);
    }

    return new Response(
      JSON.stringify({ success: true, verification_url: session.sessionUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[SendAdditionalDriverInvite] Fatal:", error);
    return jsonError(500, error instanceof Error ? error.message : "Unknown error");
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
