// send-subscription-link-email — email a live subscription link to the prospect.
//
// The meeting's point was that George must not change tabs mid-call: he types
// the client's address, presses one button, and the link goes. So the template
// is composed here, not by the caller.
//
// SUPER ADMIN ONLY, and the caller supplies nothing that reaches the recipient
// except the address itself. The URL is not accepted from the request either —
// the plaintext token is unrecoverable once generated, so this function mints a
// FRESH link and sends that, which is also what makes "resend" mean something
// after the previous one expired.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { issueSubscriptionLink, escapeHtml, LINK_TTL_MS } from "../_shared/subscription-link.ts";

function money(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: (currency || "usd").toUpperCase(),
    }).format((amountMinor ?? 0) / 100);
  } catch {
    return `${((amountMinor ?? 0) / 100).toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: userError } =
      await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: appUser } = await supabase
      .from("app_users").select("id, is_active, is_super_admin")
      .eq("auth_user_id", user.id).maybeSingle();
    if (!appUser?.is_active || appUser?.is_super_admin !== true) {
      return errorResponse("Only super admins can send subscription links", 403);
    }

    const body = await req.json().catch(() => ({}));
    const tenantId = body?.tenantId;
    const toRaw = String(body?.to ?? "").trim();
    if (!tenantId) return errorResponse("tenantId is required", 400);

    // One recipient. A bulk field on a link that authorises a payment is not a
    // convenience worth having.
    if (!toRaw || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(toRaw)) {
      return errorResponse("A single valid email address is required", 400);
    }

    const issued = await issueSubscriptionLink(supabase, {
      tenantId, planId: body?.planId ?? null, createdBy: appUser.id,
    });
    if (!issued.ok) {
      return jsonResponse({ error: issued.message, code: issued.code }, issued.httpStatus);
    }
    if (issued.raced || !issued.url) {
      // Another admin holds the live link and we cannot recover its address.
      return jsonResponse({
        error: "Another admin just generated a link for this tenant. Revoke it first, then send.",
        code: "raced",
      }, 409);
    }

    const { data: tenant } = await supabase
      .from("tenants").select("company_name").eq("id", tenantId).maybeSingle();

    const company = escapeHtml(tenant?.company_name ?? "your account");
    const plan = issued.plan as { name?: string; amount?: number; currency?: string; interval?: string };
    const amount = money(Number(plan?.amount ?? 0), String(plan?.currency ?? "usd"));
    const per = plan?.interval === "year" ? "year" : "month";
    const hours = Math.round(LINK_TTL_MS / 3_600_000);
    const url = issued.url;

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#334155">
  <div style="font-size:22px;font-weight:600;color:#0f172a;margin-bottom:24px">Drive<span style="color:#6366f1">247</span></div>
  <p style="font-size:16px;color:#0f172a;margin:0 0 16px">Hi,</p>
  <p style="margin:0 0 16px;line-height:1.6">
    Here is the secure link to activate <strong style="color:#0f172a">${company}</strong> on Drive247.
  </p>
  <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:16px;margin:0 0 20px">
    <div style="display:flex;justify-content:space-between">
      <span style="color:#0f172a;font-weight:500">${escapeHtml(plan?.name ?? "Subscription")}</span>
      <strong style="color:#0f172a">${amount}</strong>
    </div>
    <div style="font-size:12px;color:#64748b;margin-top:4px">per ${per}, cancel any time</div>
  </div>
  <p style="margin:0 0 24px;line-height:1.6">
    You do not need to log in first &mdash; the link takes you straight to secure checkout.
    Payment is handled by Stripe; we never see your card details.
  </p>
  <a href="${url}" style="display:block;text-align:center;background:#6366f1;color:#fff;text-decoration:none;padding:14px 20px;border-radius:8px;font-weight:500">
    Activate your subscription
  </a>
  <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.6">
    This link expires in ${hours} hours and is personal to you &mdash; please do not forward it.
    If it has expired, just ask us for a new one.
  </p>
  <p style="font-size:12px;color:#94a3b8;margin:12px 0 0;word-break:break-all">
    If the button does not work, paste this into your browser:<br>${escapeHtml(url)}
  </p>
</div>`.trim();

    const text = [
      `Here is the secure link to activate ${tenant?.company_name ?? "your account"} on Drive247.`,
      ``,
      `${plan?.name ?? "Subscription"} — ${amount} per ${per}, cancel any time.`,
      ``,
      `Activate: ${url}`,
      ``,
      `You do not need to log in first. Payment is handled by Stripe.`,
      `This link expires in ${hours} hours and is personal to you — please do not forward it.`,
    ].join("\n");

    const sent = await sendResendEmail({
      to: toRaw,
      subject: `Activate your Drive247 subscription${tenant?.company_name ? ` — ${tenant.company_name}` : ""}`,
      html,
      text,
      // Keyed on the LINK, not the address: a double-click must not send twice,
      // but a genuine resend mints a new link and therefore a new key.
      idempotencyKey: `sublink-${issued.linkId}`,
    }, supabase);

    if (!sent?.success) {
      // The link exists and is payable; only delivery failed. Say exactly that,
      // so George falls back to pasting rather than assuming it went.
      return jsonResponse({
        error: `The link was created but the email did not send: ${sent?.error ?? "unknown error"}`,
        code: "email_failed",
        linkId: issued.linkId,
        url,
      }, 502);
    }

    // Record delivery on the row. sent_to is PII and stays here — it is never
    // copied into audit_logs.
    await supabase.from("subscription_links").update({
      sent_to: toRaw,
      sent_at: new Date().toISOString(),
      send_count: 1,
    }).eq("id", issued.linkId);

    return jsonResponse({
      success: true, linkId: issued.linkId, url,
      expiresAt: issued.expiresAt, sentTo: toRaw,
    });
  } catch (err) {
    console.error("[send-subscription-link-email] failed:", err);
    return errorResponse((err as { message?: string })?.message ?? "Failed to send", 500);
  }
});
