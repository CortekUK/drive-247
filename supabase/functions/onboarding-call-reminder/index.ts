// =============================================================================
// onboarding-call-reminder — the emails that invite a new customer to book
// their free 30-minute onboarding call with Bryan.
//
//   welcome    right after signup
//   reminder   24 hours after signup
//   follow_up  48-72 hours after signup
//
// Booking the call stops them. The rules are in _shared/onboarding-call-journey.ts.
// Bryan's tracker (admin → Customer management → Onboarding calls) shows the same
// people, so he can reach out personally too.
//
// Body:
//   { dry_run: true }        list who is due, send nothing
//   {}                       send everything due (pg_cron, every 5 minutes)
//   { tenant_id: "<uuid>" }  Bryan's "Send reminder" for one tenant: skips the
//                            timing rules, nothing else
//
// Auth: verify_jwt = false. x-platform-secret (pg_cron) or a super-admin JWT,
// the same scheme as onboarding-daily-digest. Everything else is 401.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { DRIVE247_SENDER } from "../_shared/drive247-email.ts";
import {
  buildJourneyHtml,
  JOURNEY_ENDS_MS,
  journeySubject,
  nextJourneyEmail,
  SENT_COLUMN,
  type JourneyEmail,
} from "../_shared/onboarding-call-journey.ts";

const LOG = "[onboarding-call-reminder]";

interface Due {
  tenant_id: string;
  slug: string;
  company_name: string;
  email: string;
  step: JourneyEmail;
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
    tq = only ? tq.eq("id", only) : tq.gte("created_at", new Date(Date.now() - JOURNEY_ENDS_MS).toISOString());
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
      const step: JourneyEmail | null = only
        ? "reminder"
        : nextJourneyEmail({
            tenantCreatedAt: t.created_at,
            subscriptionStatus: sub,
            callBookedAt: c?.call_booked_at,
            callCompletedAt: c?.call_completed_at,
            dismissedAt: c?.dismissed_at,
            callCancelledAt: c?.call_cancelled_at,
            callMissedAt: c?.call_missed_at,
            welcomeSentAt: c?.welcome_sent_at,
            reminderSentAt: c?.reminder_sent_at,
            followUpSentAt: c?.follow_up_sent_at,
          });
      const reason =
        c?.call_completed_at ? "call done"
        : c?.call_booked_at ? "already booked"
        : c?.call_cancelled_at || c?.call_missed_at ? "call cancelled or missed"
        : !only && c?.dismissed_at ? "card hidden"
        : !only && sub !== "trialing" && sub !== "active" ? `subscription ${sub ?? "none"}`
        : !step ? "nothing due yet"
        : !email ? "no email address"
        : null;
      if (reason || !step) skipped.push({ slug: t.slug, reason: reason ?? "nothing due yet" });
      else due.push({ tenant_id: t.id, slug: t.slug, company_name: t.company_name ?? t.slug, email, step });
    }

    if (dryRun) return jsonResponse({ success: true, dry_run: true, due, skipped });

    const sent: string[] = [];
    const failed: { slug: string; error: string }[] = [];
    for (const t of due) {
      const result = await sendResendEmail({
        to: t.email,
        subject: journeySubject(t.step),
        html: buildJourneyHtml(t.step, { slug: t.slug, companyName: t.company_name, email: t.email }),
        ...DRIVE247_SENDER,
        tenantId: t.tenant_id,
        source: "onboarding-call-reminder",
        // Once per tenant per email for the automatic run; a manual resend is its own send.
        idempotencyKey: only
          ? `onboarding-call-reminder-${t.tenant_id}-${Date.now()}`
          : t.step === "reminder"
            ? `onboarding-call-reminder-${t.tenant_id}`
            : `onboarding-call-${t.step}-${t.tenant_id}`,
      });
      if (!result.success) {
        failed.push({ slug: t.slug, error: result.error || "unknown error" });
        continue;
      }
      const { error: upErr } = await supabase
        .from("tenant_onboarding_calls")
        .upsert({ tenant_id: t.tenant_id, [SENT_COLUMN[t.step]]: new Date().toISOString() }, { onConflict: "tenant_id" });
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
