// send-bonzah-update-email
// Branded email to an operator when their Bonzah application needs a couple of
// updates before it can be activated. Framed as friendly next steps — never as
// blame or a rejection. Invoked by bonzah-partner-review on reject.
// Input: { submissionId }. Auth: JWT; caller must be a Bonzah partner or super admin.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  sendResendEmail,
  getTenantBranding,
  wrapWithBrandedTemplate,
  getTenantAdminEmail,
} from "../_shared/resend-service.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user } } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (!user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("is_bonzah_partner, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (!(appUser?.is_bonzah_partner || appUser?.is_super_admin)) {
      return errorResponse("Forbidden", 403);
    }

    const { submissionId } = await req.json().catch(() => ({}));
    if (!submissionId) return errorResponse("submissionId is required", 400);

    const { data: submission } = await supabase
      .from("bonzah_onboarding_submissions")
      .select("tenant_id, business_trade_name, primary_contact_email, primary_contact_first_name, reject_reason")
      .eq("id", submissionId)
      .single();
    if (!submission) return errorResponse("Submission not found", 404);

    const branding = await getTenantBranding(submission.tenant_id, supabase);
    const adminEmail = await getTenantAdminEmail(submission.tenant_id, supabase);
    const to = submission.primary_contact_email || adminEmail;
    if (!to) return errorResponse("No recipient email available", 400);

    const firstName = submission.primary_contact_first_name || "there";
    const reasonBlock = submission.reject_reason
      ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 16px;margin:16px 0;">
           <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">What to update</p>
           <p style="margin:0;font-size:14px;line-height:1.6;color:#1e3a8a;">${esc(submission.reject_reason)}</p>
         </div>`
      : "";

    const content = `
    <tr><td style="padding:32px 30px;">
      <div style="display:inline-block;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700;padding:5px 12px;border-radius:999px;margin-bottom:14px;">ALMOST THERE</div>
      <h2 style="margin:0 0 12px;font-size:20px;color:#080812;">A couple of quick updates, ${esc(firstName)}</h2>
      <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#404040;">
        Thanks for getting your Bonzah application in. To finish activating your
        coverage, we just need a small update from you.
      </p>
      ${reasonBlock}
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#080812;">Next step</p>
      <ul style="margin:0 0 18px;padding-left:18px;font-size:14px;line-height:1.7;color:#404040;">
        <li>Open your portal and go to <strong>Settings → Insurance</strong>.</li>
        <li>Update the item above and re-submit — it only takes a minute.</li>
        <li>We'll review the update and get Bonzah switched on for you.</li>
      </ul>
      <p style="margin:0;font-size:13px;color:#737373;">
        Happy to help if anything's unclear — just reply to this email.
      </p>
    </td></tr>`;

    const html = wrapWithBrandedTemplate(content, branding);
    const result = await sendResendEmail(
      {
        to,
        subject: `A quick update to finish your Bonzah setup — ${branding.companyName}`,
        html,
        tenantId: submission.tenant_id,
      },
      supabase,
    );

    if (!result.success) return errorResponse(`Email failed: ${result.error}`, 500);
    return jsonResponse({ success: true, sent_to: to, simulated: result.simulated ?? false });
  } catch (error) {
    console.error("[send-bonzah-update-email] error:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
