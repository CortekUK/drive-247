// =============================================================================
// onboarding-call-reminder — "your free onboarding call is still waiting".
//
// Step 3 of the Nov 2026 onboarding journey: a Portal V2 tenant that signed up
// more than 24 hours ago and has not booked its free 30-minute call with Brian
// gets ONE email about it. Brian's tracker (admin → Customer management →
// Onboarding calls) shows the same people, so he can reach out personally too.
//
// Who is due (all must hold):
//   - portal_experience = 'v2'
//   - created between 14 days and 24 hours ago
//   - latest subscription is trialing or active (a canceled test signup is not)
//   - not booked, not completed, card not hidden, never reminded
//
// Body:
//   { dry_run: true }        list who is due, send nothing
//   {}                       send to everyone due (pg_cron)
//   { tenant_id: "<uuid>" }  Brian's "Send reminder" for one tenant: skips the
//                            time window and the once-only rule, nothing else
//
// Auth: verify_jwt = false. x-platform-secret (pg_cron) or a super-admin JWT,
// the same scheme as onboarding-daily-digest. Everything else is 401.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";

const LOG = "[onboarding-call-reminder]";
const BOOKING_URL = "https://api.leadconnectorhq.com/widget/bookings/drive247-onboarding-call";
const DAY = 86_400_000;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

interface Due {
  tenant_id: string;
  slug: string;
  company_name: string;
  email: string;
}

function buildHtml(t: Due): string {
  const portal = `https://${t.slug}.portal.drive-247.com`;
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#080812;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #f1f5f9;border-radius:16px;" cellpadding="0" cellspacing="0">
      <tr><td style="padding:32px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6366f1;">Free onboarding call</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Let&rsquo;s get ${esc(t.company_name || "your rental business")} set up</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#404040;">
          Your Drive247 trial includes a complimentary 30-minute onboarding session with Brian. He&rsquo;ll walk you
          through Drive247, configure the essentials with you and help get your business ready to take bookings.
        </p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#404040;">Pick any time that suits you:</p>
        <p style="margin:0 0 24px;"><a href="${BOOKING_URL}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px;">Book Your Free Onboarding Call</a></p>
        <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#737373;">
          To make the 30 minutes count, before the call: add your first vehicle, upload your business logo and
          preview your rental website &mdash; all from <a href="${portal}" style="color:#6366f1;">your portal</a>.
        </p>
        <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#737373;">
          The call is optional &mdash; you can keep using Drive247 straight away.
        </p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // --- authenticate: platform secret (cron) or super-admin JWT (manual) ---
    let authorized = false;
    const secret = req.headers.get("x-platform-secret");
    if (secret) {
      const { data: ok, error: rpcError } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      if (rpcError) console.error(`${LOG} platform_verify_secret failed`, rpcError);
      authorized = ok === true;
    }
    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) {
          const { data: appUser } = await supabase
            .from("app_users")
            .select("is_super_admin, is_active")
            .eq("auth_user_id", user.id)
            .maybeSingle();
          authorized = appUser?.is_super_admin === true && appUser?.is_active !== false;
        }
      }
    }
    if (!authorized) return errorResponse("Unauthorized", 401);

    let body: { dry_run?: boolean; tenant_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      /* empty body = the cron run */
    }
    const dryRun = body.dry_run === true;
    const only = typeof body.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;

    // --- candidates ---
    let tq = supabase
      .from("tenants")
      .select("id, slug, company_name, contact_email, created_at")
      .eq("portal_experience", "v2");
    if (only) {
      tq = tq.eq("id", only);
    } else {
      tq = tq
        .lte("created_at", new Date(Date.now() - DAY).toISOString())
        .gte("created_at", new Date(Date.now() - 14 * DAY).toISOString());
    }
    const { data: tenants, error: tErr } = await tq;
    if (tErr) throw tErr;
    const ids = (tenants ?? []).map((t) => t.id);
    if (only && ids.length === 0) return errorResponse("That tenant is not on Portal V2.", 400);

    const [{ data: calls, error: cErr }, { data: subs, error: sErr }, { data: owners, error: oErr }] =
      ids.length
        ? await Promise.all([
            supabase.from("tenant_onboarding_calls").select("*").in("tenant_id", ids),
            supabase.from("tenant_subscriptions").select("tenant_id, status, created_at").in("tenant_id", ids)
              .order("created_at", { ascending: false }),
            supabase.from("app_users").select("tenant_id, email, role, is_active").in("tenant_id", ids)
              .eq("role", "head_admin"),
          ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    if (cErr) throw cErr;
    if (sErr) throw sErr;
    if (oErr) throw oErr;

    const callBy = new Map((calls ?? []).map((c: any) => [c.tenant_id, c]));
    const subBy = new Map<string, string>();
    for (const s of subs ?? []) if (!subBy.has(s.tenant_id)) subBy.set(s.tenant_id, String(s.status));
    const ownerBy = new Map<string, string>();
    for (const o of owners ?? []) if (o.email && o.is_active !== false && !ownerBy.has(o.tenant_id)) ownerBy.set(o.tenant_id, o.email);

    const due: Due[] = [];
    const skipped: { slug: string; reason: string }[] = [];
    for (const t of tenants ?? []) {
      const c: any = callBy.get(t.id);
      const sub = subBy.get(t.id);
      const email = (t.contact_email || ownerBy.get(t.id) || "").trim();
      const reason =
        c?.call_completed_at ? "call done"
        : c?.call_booked_at ? "already booked"
        : !only && c?.dismissed_at ? "card hidden"
        : !only && c?.reminder_sent_at ? "already reminded"
        : !only && sub !== "trialing" && sub !== "active" ? `subscription ${sub ?? "none"}`
        : !email ? "no email address"
        : null;
      if (reason) skipped.push({ slug: t.slug, reason });
      else due.push({ tenant_id: t.id, slug: t.slug, company_name: t.company_name ?? t.slug, email });
    }

    if (dryRun) return jsonResponse({ success: true, dry_run: true, due, skipped });

    const sent: string[] = [];
    const failed: { slug: string; error: string }[] = [];
    for (const t of due) {
      const result = await sendResendEmail({
        to: t.email,
        subject: "Your free onboarding call with Brian is waiting",
        html: buildHtml(t),
        fromName: "Drive247",
        tenantId: t.tenant_id,
        source: "onboarding-call-reminder",
        // Once per tenant for the automatic run; a manual resend is its own send.
        idempotencyKey: only
          ? `onboarding-call-reminder-${t.tenant_id}-${Date.now()}`
          : `onboarding-call-reminder-${t.tenant_id}`,
      });
      if (!result.success) {
        failed.push({ slug: t.slug, error: result.error || "unknown error" });
        continue;
      }
      const { error: upErr } = await supabase
        .from("tenant_onboarding_calls")
        .upsert({ tenant_id: t.tenant_id, reminder_sent_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      if (upErr) console.error(`${LOG} sent to ${t.slug} but could not record it:`, upErr.message);
      sent.push(t.slug);
    }

    console.log(`${LOG} sent ${sent.length}, failed ${failed.length}, skipped ${skipped.length}`);
    return jsonResponse({ success: failed.length === 0, sent, failed, skipped });
  } catch (err) {
    console.error(`${LOG} error`, err);
    return errorResponse(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});
