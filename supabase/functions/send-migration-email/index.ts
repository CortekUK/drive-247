// send-migration-email — super-admin-only, MANUAL send of the migration prompt
// email to an operator. Nothing here is automatic: the admin composes/edits the
// recipient, subject and body in the dashboard and presses send.
//
// GET-style action "preview" returns the tenant's default recipient + a
// prefilled template so the admin UI can populate the composer.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendEmail, getTenantBranding, wrapWithBrandedTemplate } from "../_shared/resend-service.ts";

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin")
    .eq("auth_user_id", userId)
    .single();
  return data?.is_super_admin === true;
}

const DEFAULT_SUBJECT = "Action needed: update your payment setup";

function defaultBody(operatorName: string, company: string, portalUrl: string): string {
  return `Hi ${operatorName},

We're upgrading how payments work on Drive247.

Stripe now requires rental platforms in our region to settle payments through a Stripe account that you own and control directly — rather than one managed on your behalf.

This is an upgrade for you:
• Customer payments land straight in your own account
• Full Stripe Dashboard — every payout and fee visible
• You control your payout schedule and bank details
• Faster access to your money

It takes about 3 minutes. Sign in to your dashboard and complete the two steps shown at the top of the screen:

${portalUrl}

As a thank you, we'll add 100 free credits to your ${company} account once both steps are complete.

If you have any questions, just reply to this email — we're happy to help.

— The Drive247 Team`;
}

/** Plain text → simple branded HTML (preserve the admin's line breaks). */
function toHtml(body: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;line-height:1.65;color:#1a1a2e">${esc(p).replace(/\n/g, "<br/>")}</p>`
    )
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px">${paragraphs}</div>`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (!(await verifySuperAdmin(supabase, user.id))) {
      return errorResponse("Only super admins can send migration emails", 403);
    }

    const { action = "send", tenantId, to, subject, body } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");

    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, slug, company_name, contact_email, admin_name")
      .eq("id", tenantId)
      .single();
    if (tErr || !tenant) return errorResponse("Tenant not found", 404);

    // Default recipient comes from the tenant's branding/contact email; the
    // admin can override it in the composer.
    let defaultTo = tenant.contact_email || null;
    let branding: any = null;
    try {
      branding = await getTenantBranding(tenantId, supabase);
      // Prefer the tenant's own branding contact email as the default recipient.
      // Ignore the library's global default so we never prefill support@drive-247.com.
      if (branding?.contactEmail && branding.contactEmail !== "support@drive-247.com") {
        defaultTo = branding.contactEmail;
      }
    } catch (_e) {
      // Branding is optional — fall back to tenants.contact_email.
    }

    const portalUrl = `https://${tenant.slug}.portal.drive-247.com`;
    const operatorName = tenant.admin_name || tenant.company_name || "there";

    if (action === "preview") {
      return jsonResponse({
        to: defaultTo,
        subject: DEFAULT_SUBJECT,
        body: defaultBody(operatorName, tenant.company_name ?? "your", portalUrl),
        portalUrl,
      });
    }

    // --- send ---
    const recipient = (to || defaultTo || "").trim();
    if (!recipient) return errorResponse("No recipient email — set one in the composer", 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      return errorResponse(`Invalid recipient email: ${recipient}`, 400);
    }

    const finalSubject = (subject || DEFAULT_SUBJECT).trim();
    const finalBody =
      (body && String(body).trim()) ||
      defaultBody(operatorName, tenant.company_name ?? "your", portalUrl);

    let html = toHtml(finalBody);
    try {
      if (branding) html = wrapWithBrandedTemplate(html, branding);
    } catch (_e) {
      // Unbranded fallback is fine.
    }

    const result = await sendEmail(recipient, finalSubject, html, supabase, tenantId);
    if (!(result as any)?.success) {
      return errorResponse(
        `Email send failed: ${(result as any)?.error ?? "unknown error"}`,
        502
      );
    }

    console.log(`[send-migration-email] sent to ${recipient} for tenant ${tenantId}`);
    return jsonResponse({ success: true, to: recipient, subject: finalSubject });
  } catch (error) {
    console.error("[send-migration-email] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal error", 500);
  }
});
