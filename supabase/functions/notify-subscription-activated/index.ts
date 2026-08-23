// notify-subscription-activated — tell BOTH sides a subscription went live.
//
// Called (fire-and-forget) by subscription-webhook once a link has actually
// settled. Nothing here can affect settlement: it is invoked after the money
// state is already correct, and every failure path returns 200 with a reason.
//
// Two recipients, deliberately:
//   · the OPERATOR, because someone who paid through a link never passes through
//     the portal's success screen and otherwise gets no confirmation at all.
//   · SALES, because George needs to know a deal closed without watching a
//     dashboard. The push notification already fires from the audit row; this is
//     the durable copy he can forward.
//
// verify_jwt = false because the webhook invokes it server-side with the service
// role. It is NOT anonymously useful: it accepts only a linkId/subscriptionId it
// then re-reads, and sends only to addresses it looks up itself. Nothing a
// caller supplies reaches a recipient.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { escapeHtml, portalBaseUrl } from "../_shared/subscription-link.ts";

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: (currency || "usd").toUpperCase(),
    }).format((minor ?? 0) / 100);
  } catch {
    return `${((minor ?? 0) / 100).toFixed(2)} ${(currency || "usd").toUpperCase()}`;
  }
}

function shell(bodyHtml: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#334155">
  <div style="font-size:22px;font-weight:600;color:#0f172a;margin-bottom:24px">Drive<span style="color:#6366f1">247</span></div>
  ${bodyHtml}
</div>`.trim();
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { linkId } = await req.json().catch(() => ({}));
    if (!linkId) return jsonResponse({ skipped: "no linkId" });

    const { data: link } = await supabase
      .from("subscription_links")
      .select("id, tenant_id, status, paid_at, amount_snapshot, currency_snapshot, interval_snapshot, plan_name_snapshot, sent_to, subscription_row_id")
      .eq("id", linkId)
      .maybeSingle();

    // Only ever announce a link that genuinely settled. The settler enforces the
    // invariant; this is the second reading of it.
    if (!link || link.status !== "paid") {
      return jsonResponse({ skipped: "link is not paid" });
    }

    // Idempotence: one announcement per link, claimed with a conditional UPDATE
    // so two concurrent webhook deliveries cannot both send.
    const { data: claimed } = await supabase
      .from("subscription_links")
      .update({ activation_notified_at: new Date().toISOString() })
      .eq("id", link.id)
      .is("activation_notified_at", null)
      .select("id");
    if (!claimed || claimed.length === 0) {
      return jsonResponse({ skipped: "already notified" });
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, slug, company_name, contact_email")
      .eq("id", link.tenant_id)
      .maybeSingle();

    const { data: sub } = await supabase
      .from("tenant_subscriptions")
      .select("current_period_end, plan_name, amount, currency, interval")
      .eq("id", link.subscription_row_id)
      .maybeSingle();

    const company = tenant?.company_name ?? "your account";
    const planName = sub?.plan_name || link.plan_name_snapshot || "Subscription";
    const amount = money(Number(sub?.amount ?? link.amount_snapshot ?? 0),
                         String(sub?.currency ?? link.currency_snapshot ?? "usd"));
    const per = (sub?.interval ?? link.interval_snapshot) === "year" ? "year" : "month";
    const renews = sub?.current_period_end
      ? new Date(sub.current_period_end).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : null;
    const portal = tenant?.slug ? portalBaseUrl(tenant.slug) : null;

    const results: Record<string, unknown> = {};

    // ── the operator ────────────────────────────────────────────────────────
    // Prefer the address that actually received the link; fall back to the
    // tenant's contact email. They may differ — the buyer is not always the
    // address on file — and the person who paid is the one owed a receipt.
    const operatorTo = link.sent_to || tenant?.contact_email || null;
    if (operatorTo) {
      const html = shell(`
  <p style="font-size:16px;color:#0f172a;margin:0 0 16px">Your subscription is active</p>
  <p style="margin:0 0 16px;line-height:1.6">
    Thank you &mdash; <strong style="color:#0f172a">${escapeHtml(company)}</strong> is now set up on Drive247.
  </p>
  <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:16px;margin:0 0 20px">
    <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Plan</span><strong style="color:#0f172a">${escapeHtml(planName)}</strong></div>
    <div style="display:flex;justify-content:space-between;margin-top:6px"><span style="color:#64748b">Amount</span><strong style="color:#0f172a">${amount} / ${per}</strong></div>
    ${renews ? `<div style="display:flex;justify-content:space-between;margin-top:6px"><span style="color:#64748b">Renews</span><strong style="color:#0f172a">${escapeHtml(renews)}</strong></div>` : ""}
  </div>
  <p style="margin:0 0 24px;line-height:1.6">
    Your login details were sent to you separately. There is nothing else you need to do &mdash;
    sign in whenever you are ready.
  </p>
  ${portal ? `<a href="${portal}" style="display:block;text-align:center;background:#0f172a;color:#fff;text-decoration:none;padding:14px 20px;border-radius:8px;font-weight:500">Go to your portal</a>` : ""}
  <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.6">Stripe has emailed your payment receipt separately.</p>`);

      const r = await sendResendEmail({
        to: operatorTo,
        subject: `Your Drive247 subscription is active${tenant?.company_name ? ` — ${tenant.company_name}` : ""}`,
        html,
        text: `Your subscription is active.\n\n${planName} — ${amount} per ${per}${renews ? `, renews ${renews}` : ""}.\n\n${portal ? `Portal: ${portal}\n\n` : ""}Your login details were sent separately. Stripe has emailed your receipt.`,
        idempotencyKey: `sublink-active-op-${link.id}`,
      }, supabase);
      results.operator = { to: operatorTo, success: r?.success === true, error: r?.error ?? null };
    } else {
      results.operator = { skipped: "no recipient address" };
    }

    // ── sales ───────────────────────────────────────────────────────────────
    // .limit(1).single(), matching onboarding-daily-digest — admin_settings holds
    // FOUR rows on this project, so .maybeSingle() errors and silently reports
    // "no recipients", which is how a notification nobody receives looks exactly
    // like a notification nobody asked for.
    const { data: settings } = await supabase
      .from("admin_settings")
      .select("onboarding_digest_emails")
      .limit(1)
      .single();
    const salesTo: string[] = (settings?.onboarding_digest_emails ?? []).filter(Boolean);
    if (salesTo.length > 0) {
      const html = shell(`
  <p style="font-size:16px;color:#0f172a;margin:0 0 16px">Subscription activated</p>
  <p style="margin:0 0 16px;line-height:1.6">
    <strong style="color:#0f172a">${escapeHtml(company)}</strong> paid their subscription link${link.sent_to ? ` (sent to ${escapeHtml(link.sent_to)})` : ""}.
  </p>
  <div style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:16px;margin:0 0 12px">
    <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Plan</span><strong style="color:#0f172a">${escapeHtml(planName)}</strong></div>
    <div style="display:flex;justify-content:space-between;margin-top:6px"><span style="color:#64748b">Amount</span><strong style="color:#0f172a">${amount} / ${per}</strong></div>
    ${renews ? `<div style="display:flex;justify-content:space-between;margin-top:6px"><span style="color:#64748b">Renews</span><strong style="color:#0f172a">${escapeHtml(renews)}</strong></div>` : ""}
  </div>
  <p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Sent by the Drive247 platform. Manage recipients on the admin Onboarding page.</p>`);

      const r = await sendResendEmail({
        to: salesTo,
        subject: `Subscription activated — ${company}`,
        html,
        text: `${company} paid their subscription link.\n\n${planName} — ${amount} per ${per}${renews ? `, renews ${renews}` : ""}.`,
        idempotencyKey: `sublink-active-sales-${link.id}`,
      }, supabase);
      results.sales = { count: salesTo.length, success: r?.success === true, error: r?.error ?? null };
    } else {
      results.sales = { skipped: "no digest recipients configured" };
    }

    return jsonResponse({ success: true, linkId: link.id, results });
  } catch (err) {
    console.error("[notify-subscription-activated] failed:", err);
    // Never surface a failure to the webhook — the money is already correct and
    // a retry storm over an email is worse than a missing email.
    return jsonResponse({ success: false, error: (err as { message?: string })?.message ?? "failed" });
  }
});
