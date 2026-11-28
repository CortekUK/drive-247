// =============================================================================
// onboarding-call-mailer: sends the onboarding call's queued emails, once each
// (feat-001 spec 08). The database queues them in the same transaction as the
// booking change (onboarding_call_emails); this only sends what is there.
//
// Body:
//   {}                 queue due reminders, then send what is pending
//   { dry_run: true }  list what is due and pending, change nothing
//   { flush: true }    send what is pending only
//
// Auth: verify_jwt = false. x-platform-secret (pg_cron) or a super-admin JWT
// for {} and dry_run. Any signed-in user for flush, since it only sends what
// an action already queued. Everything else is 401.
//
// ONBOARDING_CALL_ONLY_TO (comma list): when set, any other recipient is
// recorded as skipped. Set on staging so a test never reaches a real company.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { DRIVE247_SENDER } from "../_shared/drive247-email.ts";
import { buildCallEmail, isHostKind, type CallEmailKind, type CallEmailPayload } from "../_shared/onboarding-call-emails.ts";

const LOG = "[onboarding-call-mailer]";
const MAX_ATTEMPTS = 5;
const COMPANY_KINDS_THAT_NEED_A_LIVE_CALL: CallEmailKind[] = ["reminder_day", "reminder_hour"];

interface Row {
  id: string;
  booking_id: string;
  kind: CallEmailKind;
  recipient: string;
  payload: CallEmailPayload;
  attempts: number;
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let body: { dry_run?: boolean; flush?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    let isPlatform = false;
    let isSuperAdmin = false;
    let isSignedIn = false;
    const secret = req.headers.get("x-platform-secret");
    if (secret) {
      const { data: ok } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      isPlatform = ok === true;
    }
    if (!isPlatform) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) {
          isSignedIn = true;
          const { data: appUser } = await supabase
            .from("app_users")
            .select("is_super_admin, is_active")
            .eq("auth_user_id", user.id)
            .maybeSingle();
          isSuperAdmin = appUser?.is_super_admin === true && appUser?.is_active !== false;
        }
      }
    }
    const canRunAll = isPlatform || isSuperAdmin;
    if (!canRunAll && !(isSignedIn && body.flush)) return errorResponse("Unauthorized", 401);

    if (body.dry_run) {
      if (!canRunAll) return errorResponse("Unauthorized", 401);
      const [{ data: due }, { data: pending }] = await Promise.all([
        supabase.rpc("onboarding_call_due_reminders"),
        supabase.from("onboarding_call_emails").select("id, kind, recipient, status, created_at").in("status", ["pending", "sending"]),
      ]);
      return jsonResponse({ dry_run: true, due: due ?? [], pending: pending ?? [] });
    }

    let queued = 0;
    if (canRunAll && !body.flush) {
      const { data, error } = await supabase.rpc("onboarding_call_queue_reminders");
      if (error) console.error(`${LOG} queue reminders failed`, error);
      queued = Number(data) || 0;
    }

    const onlyTo = (Deno.env.get("ONBOARDING_CALL_ONLY_TO") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const links = {
      portalRoot: (Deno.env.get("PORTAL_ROOT_DOMAIN") || "portal.drive-247.com").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
      functionsBase: `${Deno.env.get("SUPABASE_URL")}/functions/v1`,
      adminBase: Deno.env.get("ADMIN_APP_URL") || "https://admin.drive-247.com",
    };

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const finish = (id: string, patch: Record<string, unknown>) =>
      supabase.from("onboarding_call_emails").update(patch).eq("id", id);
    // A failed row stays "sending" until this run ends, so it is tried again on the next run, not straight away.
    const retryLater: Array<{ id: string; patch: Record<string, unknown> }> = [];

    for (let round = 0; round < 10; round++) {
      const { data: rows, error } = await supabase.rpc("onboarding_call_claim_emails", { p_limit: 20 });
      if (error) throw error;
      const batch = (rows ?? []) as Row[];
      if (batch.length === 0) break;

      for (const row of batch) {
        // A reminder for a call that is no longer booked at that time is not sent.
        if (COMPANY_KINDS_THAT_NEED_A_LIVE_CALL.includes(row.kind)) {
          const { data: b } = await supabase
            .from("onboarding_call_bookings")
            .select("status, starts_at")
            .eq("id", row.booking_id)
            .maybeSingle();
          const sameTime = b && new Date(b.starts_at).getTime() === new Date(row.payload.starts_at).getTime();
          if (!b || b.status !== "booked" || !sameTime) {
            await finish(row.id, { status: "skipped", error: "The call is no longer booked at this time" });
            skipped++;
            continue;
          }
        }
        if (!row.recipient) {
          await finish(row.id, { status: "skipped", error: isHostKind(row.kind) ? "No host email set" : "No recipient" });
          skipped++;
          continue;
        }
        if (onlyTo.length && !onlyTo.includes(row.recipient.toLowerCase())) {
          await finish(row.id, { status: "skipped", error: "Not on the test list" });
          skipped++;
          continue;
        }

        const email = buildCallEmail(row.kind, row.payload, links);
        const result = await sendResendEmail({
          ...DRIVE247_SENDER,
          to: row.recipient,
          subject: email.subject,
          html: email.html,
          idempotencyKey: `onboarding-call:${row.id}`,
          source: "onboarding-call-mailer",
          notificationKey: `onboarding_call_${row.kind}`,
          attachments: email.ics
            ? [{
                filename: email.ics.filename,
                content: base64(email.ics.content),
                contentType: `text/calendar; charset=utf-8; method=${email.ics.method}`,
              }]
            : undefined,
        });

        if (result.success) {
          await finish(row.id, { status: "sent", sent_at: new Date().toISOString(), error: null });
          sent++;
        } else {
          const attempts = row.attempts + 1;
          retryLater.push({
            id: row.id,
            patch: { status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, error: String(result.error ?? "Send failed").slice(0, 500) },
          });
          failed++;
          console.error(`${LOG} send failed`, row.kind, row.id, result.error);
        }
      }
    }

    for (const r of retryLater) await finish(r.id, r.patch);

    return jsonResponse({ queued, sent, skipped, failed });
  } catch (e) {
    console.error(`${LOG} error`, e);
    return errorResponse((e as Error).message ?? "Mailer failed", 500);
  }
});
