import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "🐛 Bug",
  improvement: "🔧 Improvement",
  feature_request: "✨ Feature Request",
  note: "📝 Note",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Alert the Drive247 team that a portal operator filed feedback.
 *
 * Called fire-and-forget by the portal right after the insert. Everything here
 * is best-effort from the submitter's point of view — they have already been
 * told their feedback was received, so no failure in here may be surfaced to
 * them, but every failure must be logged loudly.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    // Client bound to the caller's JWT — used only to identify them.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    // Service role for the data work.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { feedbackId } = await req.json();
    if (!feedbackId) return errorResponse("feedbackId is required", 400);

    const { data: feedback, error: feedbackError } = await supabase
      .from("tenant_feedback")
      .select(
        "id, tenant_id, app_user_id, submitter_name, submitter_email, submitter_role, category, message, page_path, created_at, notified_at",
      )
      .eq("id", feedbackId)
      .maybeSingle();

    if (feedbackError) {
      console.error("Failed to load feedback row:", feedbackError);
      return errorResponse("Failed to load feedback", 500);
    }
    if (!feedback) return errorResponse("Feedback not found", 404);

    // AuthZ. The service-role read above bypasses RLS, so authorization has to
    // happen HERE or any signed-in user — including a booking-site customer,
    // who holds a perfectly valid JWT for this same project — could pull an
    // arbitrary feedback row's contents by guessing an id.
    const { data: caller } = await supabase
      .from("app_users")
      .select("id, is_super_admin")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const isOwner = !!caller?.id && caller.id === feedback.app_user_id;
    if (!isOwner && !caller?.is_super_admin) {
      return errorResponse("Forbidden", 403);
    }

    // Idempotency. Without this, a retry or a replayed request re-mails the
    // whole recipient list.
    if (feedback.notified_at) {
      return jsonResponse({ success: true, alreadyNotified: true });
    }

    const { data: recipients, error: recipientsError } = await supabase
      .from("tenant_feedback_recipients")
      .select("email");

    if (recipientsError) {
      console.error("Failed to load feedback recipients:", recipientsError);
      return errorResponse("Failed to load recipients", 500);
    }

    // No recipients configured is a valid state, not an error.
    if (!recipients || recipients.length === 0) {
      await supabase
        .from("tenant_feedback")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", feedbackId);
      return jsonResponse({ success: true, skipped: true, reason: "no recipients configured" });
    }

    // `company_name`, NOT `name` — the tenants table has no bare `name`
    // column, and selecting one 400s the whole query.
    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name, slug")
      .eq("id", feedback.tenant_id)
      .maybeSingle();

    const adminUrl = Deno.env.get("ADMIN_APP_URL") || "https://admin.drive-247.com";
    const categoryLabel = CATEGORY_LABELS[feedback.category] || feedback.category;
    const tenantName = tenant?.company_name || tenant?.slug || "Unknown tenant";
    const submitter = feedback.submitter_name || feedback.submitter_email || "Unknown user";

    const excerpt = feedback.message.length > 200
      ? `${feedback.message.slice(0, 200)}…`
      : feedback.message;

    // Plain internal email — deliberately NOT tenant-branded. This goes to the
    // Drive247 team, not to the tenant's customers.
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #080812;">
        <h2 style="margin: 0 0 4px; font-size: 18px;">New portal feedback</h2>
        <p style="margin: 0 0 20px; color: #737373; font-size: 13px;">${escapeHtml(categoryLabel)}</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #737373; width: 110px;">Tenant</td><td style="padding: 6px 0;">${escapeHtml(tenantName)}</td></tr>
          <tr><td style="padding: 6px 0; color: #737373;">From</td><td style="padding: 6px 0;">${escapeHtml(submitter)}${feedback.submitter_role ? ` (${escapeHtml(feedback.submitter_role)})` : ""}</td></tr>
          ${feedback.page_path ? `<tr><td style="padding: 6px 0; color: #737373;">Page</td><td style="padding: 6px 0;">${escapeHtml(feedback.page_path)}</td></tr>` : ""}
        </table>
        <div style="margin: 20px 0; padding: 14px 16px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 6px; font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(excerpt)}</div>
        <a href="${adminUrl}/admin/feedbacks" style="display: inline-block; padding: 10px 18px; background: #6366f1; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">Open Feedbacks</a>
      </div>
    `;

    const text = [
      `New portal feedback — ${categoryLabel}`,
      `Tenant: ${tenantName}`,
      `From: ${submitter}${feedback.submitter_role ? ` (${feedback.submitter_role})` : ""}`,
      feedback.page_path ? `Page: ${feedback.page_path}` : "",
      "",
      excerpt,
      "",
      `${adminUrl}/admin/feedbacks`,
    ].filter(Boolean).join("\n");

    // One send with every recipient rather than a loop — sendResendEmail takes
    // an array, and N sequential sends is N chances to trip a rate limit and
    // leave the list half-notified.
    const result = await sendResendEmail({
      to: recipients.map((r: { email: string }) => r.email),
      subject: `[${categoryLabel}] ${tenantName} — portal feedback`,
      html,
      text,
    });

    if (!result.success) {
      console.error("Failed to send feedback notification email:", result.error);
      return errorResponse(result.error || "Failed to send notification", 500);
    }

    // Only stamp once delivery actually succeeded, so a transient Resend
    // failure stays retryable rather than being silently swallowed forever.
    await supabase
      .from("tenant_feedback")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", feedbackId);

    return jsonResponse({ success: true, recipients: recipients.length });
  } catch (error) {
    console.error("notify-feedback-submission error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unexpected error",
      500,
    );
  }
});
