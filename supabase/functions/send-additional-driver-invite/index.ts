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

async function createVeriffSession(
  apiKey: string,
  baseUrl: string,
  driverName: string,
  vendorData: string,
  documentType?: string,
): Promise<VeriffSessionResult | null> {
  const requestBody: any = {
    verification: {
      person: {
        firstName: driverName?.split(" ")[0] || "Additional",
        lastName: driverName?.split(" ").slice(1).join(" ") || "Driver",
      },
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

  const res = await fetch(`${baseUrl}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-AUTH-CLIENT": apiKey },
    body: JSON.stringify(requestBody),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[SendAdditionalDriverInvite] Veriff error:", res.status, errText);
    return null;
  }
  const data = await res.json();
  return {
    sessionUrl: data?.verification?.url,
    sessionToken: data?.verification?.sessionToken,
    sessionId: data?.verification?.id,
  };
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
    const session = await createVeriffSession(
      VERIFF_API_KEY,
      VERIFF_BASE_URL,
      driver.name,
      `additional_driver_${driver.id}`,
      tenant?.verification_document_type || undefined,
    );
    if (!session) return jsonError(502, "Failed to create Veriff session");

    // Persist a verification record. customer_id is NULL because this is per
    // additional-driver — webhooks key off the vendorData prefix.
    const { data: verification, error: vErr } = await supabase
      .from("identity_verifications")
      .insert({
        tenant_id: driver.tenant_id,
        provider: "veriff",
        session_id: session.sessionId,
        verification_token: session.sessionToken,
        external_user_id: `additional_driver_${driver.id}`,
        status: "init",
        review_status: "init",
        verification_url: session.sessionUrl,
      })
      .select()
      .single();
    if (vErr) return jsonError(500, vErr.message);

    // Stamp the driver row with the verification linkage and URL for resend.
    await supabase
      .from("rental_additional_drivers")
      .update({
        identity_verification_id: verification.id,
        verification_url: session.sessionUrl,
        verification_status: "pending",
      })
      .eq("id", driver.id);

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
