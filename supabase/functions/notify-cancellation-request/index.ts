import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";

/**
 * Tell the Drive247 team that a tenant has asked to cancel their subscription.
 *
 * ── why this function exists at all ─────────────────────────────────────────
 *
 * The Billing page deliberately has no destructive "Cancel subscription"
 * button. A tenant asks, a human answers. That only works if the ask actually
 * reaches somebody, so the request lands in `go_live_requests` (the queue the
 * super admin dashboard already renders) AND this function emails the team.
 * Without the email the request sits in a list nobody is watching, which is the
 * dead end the flow was designed to avoid.
 *
 * ── shape borrowed from notify-feedback-submission ──────────────────────────
 *
 * Same three-part structure, for the same reasons: the caller's JWT identifies
 * them, a service-role client does the data work, and authorization is checked
 * HERE because that service-role read bypasses RLS — any signed-in user of this
 * project, including a booking-site customer, holds a valid JWT.
 *
 * Called fire-and-forget by the portal: the operator has already been told
 * their request was submitted (the row is committed by then), so no failure in
 * here may be surfaced to them, but every failure is logged loudly.
 */

const CANCELLATION_TYPE = "subscription_cancellation";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { requestId } = await req.json();
    if (!requestId) return errorResponse("requestId is required", 400);

    const { data: request, error: requestError } = await supabase
      .from("go_live_requests")
      .select("id, tenant_id, requested_by, integration_type, note, created_at, notified_at")
      .eq("id", requestId)
      .maybeSingle();

    if (requestError) {
      console.error("Failed to load request row:", requestError);
      return errorResponse("Failed to load request", 500);
    }
    if (!request) return errorResponse("Request not found", 404);

    /* This function speaks only for cancellations. Every other request type in
       this queue has its own handling, and a caller passing an arbitrary id
       must not be able to make the team an email about one. */
    if (request.integration_type !== CANCELLATION_TYPE) {
      return errorResponse("Not a cancellation request", 400);
    }

    // AuthZ — see the header note. The requester or a super admin, nobody else.
    const { data: caller } = await supabase
      .from("app_users")
      .select("id, is_super_admin, tenant_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const isRequester = !!caller?.id && caller.id === request.requested_by;
    if (!isRequester && !caller?.is_super_admin) {
      return errorResponse("Forbidden", 403);
    }

    /* Idempotency. Without it a retry — or the portal being reloaded mid-flight
       — re-mails the whole team list about one cancellation. */
    if (request.notified_at) {
      return jsonResponse({ success: true, alreadyNotified: true });
    }

    /* The team's address list, the same one the maintenance banner and the
       contact form use. Multiple `admin_settings` rows exist; the oldest is the
       one the admin dashboard edits. */
    const { data: settings } = await supabase
      .from("admin_settings")
      .select("notification_emails")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const recipients: string[] = (settings?.notification_emails ?? []).filter(
      (e: unknown): e is string => typeof e === "string" && e.includes("@"),
    );

    /* No recipients configured is a valid state, not an error — the request is
       still in the queue and still visible in the admin dashboard. Mark it
       notified so a later call does not keep retrying a list that is empty. */
    if (recipients.length === 0) {
      await supabase
        .from("go_live_requests")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", requestId);
      console.warn("Cancellation request with no configured recipients:", requestId);
      return jsonResponse({ success: true, skipped: true, reason: "no recipients configured" });
    }

    // `company_name`, NOT `name` — tenants has no bare `name` column.
    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name, slug")
      .eq("id", request.tenant_id)
      .maybeSingle();

    const { data: requester } = await supabase
      .from("app_users")
      .select("full_name, email")
      .eq("id", request.requested_by)
      .maybeSingle();

    /* What they are paying today, so whoever picks this up can open the
       conversation already knowing what is at stake. */
    const { data: subscription } = await supabase
      .from("tenant_subscriptions")
      .select("plan_name, status, current_period_end")
      .eq("tenant_id", request.tenant_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const adminUrl = Deno.env.get("ADMIN_APP_URL") || "https://admin.drive-247.com";
    const tenantName = tenant?.company_name || tenant?.slug || "Unknown tenant";
    const who = requester?.full_name || requester?.email || "Unknown user";
    const reason = (request.note || "").trim();

    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 0;color:#737373;width:130px;">${label}</td><td style="padding:6px 0;">${escapeHtml(value)}</td></tr>`;

    // Plain internal email — deliberately NOT tenant-branded. This goes to the
    // Drive247 team, not to the tenant's customers.
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #080812;">
        <h2 style="margin: 0 0 4px; font-size: 18px;">Subscription cancellation requested</h2>
        <p style="margin: 0 0 20px; color: #737373; font-size: 13px;">A tenant has asked to cancel. Nothing has been cancelled — this is a request for a person to answer.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          ${row("Tenant", tenantName)}
          ${row("Requested by", requester?.email ? `${who} (${requester.email})` : who)}
          ${subscription?.plan_name ? row("Current plan", subscription.plan_name) : ""}
          ${subscription?.status ? row("Status", subscription.status) : ""}
          ${subscription?.current_period_end ? row("Paid until", new Date(subscription.current_period_end).toDateString()) : ""}
          ${row("Requested at", new Date(request.created_at).toUTCString())}
        </table>
        ${
          reason
            ? `<div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #f1f5f9;border-radius:6px;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(reason)}</div>`
            : `<p style="margin:20px 0;color:#737373;font-size:13px;">No reason given.</p>`
        }
        <a href="${adminUrl}/admin/requests" style="display:inline-block;padding:10px 18px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;">Open Requests</a>
      </div>
    `;

    /* ONE email to the whole list. `sendResendEmail` takes an array, and its
       `idempotencyKey` means Resend itself will not re-deliver this request's
       mail for 24 hours even if the `notified_at` guard above is somehow
       raced. */
    const result = await sendResendEmail({
      to: recipients,
      subject: `Cancellation request — ${tenantName}`,
      html,
      idempotencyKey: `cancellation-${requestId}`,
    });

    /* This helper RETURNS failure rather than throwing, so the result has to be
       read. Treating the call itself as the success signal is how a total email
       outage stays invisible. */
    if (!result.success) {
      console.error("Cancellation email failed:", result.error, "request:", requestId);
      /* `notified_at` stays null so a retry can still reach the team. The
         request is already in the queue and visible in the admin dashboard
         either way — the email is the alert, not the record. */
      return jsonResponse({ success: false, error: result.error ?? "send failed" }, 200);
    }

    await supabase
      .from("go_live_requests")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", requestId);

    return jsonResponse({ success: true, recipients: recipients.length, simulated: !!result.simulated });
  } catch (error) {
    console.error("notify-cancellation-request failed:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", 500);
  }
});
