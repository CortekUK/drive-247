// abandoned-recovery-run — finds abandoned bookings and sends the AI follow-up.
//
// Run every 10 minutes by pg_cron (service-role bearer). Each run:
//   1. converted  open sessions whose renter went on to book (paid or approved
//                 rental — see abandoned_bookings_find_conversions) are closed
//                 as converted; converted_after_email marks a recovery
//   2. abandoned  in_progress sessions idle for `delay_minutes` become abandoned
//   3. email      each new abandoned session gets ONE AI-written email, unless:
//                 recovery is off · tenant not in scope · no email address ·
//                 unsubscribed · that address got one from this tenant in the
//                 last 7 days · it went idle more than 48 hours ago
//   4. expired    sessions 30 days old that never converted
//
// Super admins (JWT) can also call:
//   { action: "preview", id }            write the email for a session, send nothing
//   { action: "test", id, to }           send that email to `to` only
//   { action: "ask", tenantId, question } answer a question from the tenant's FAQs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  answerFromFaqs,
  renderRecoveryHtml,
  replyToFor,
  sendTenantEmail,
  unsubscribeUrl,
  writeRecoveryEmail,
  type RecoveryBooking,
  type RecoverySequence,
  type RecoveryTenant,
} from "../_shared/abandoned-recovery.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_SENDS_PER_RUN = 50;
const LATE_LIMIT_MS = 2 * DAY;
const SAME_ADDRESS_COOLDOWN_MS = 7 * DAY;
const EXPIRE_AFTER_MS = 30 * DAY;
const FOLLOW_UP_EVERY_MS = DAY;

const TENANT_COLS =
  "id, slug, company_name, app_name, logo_url, primary_color, accent_color, contact_email, contact_phone, custom_booking_domain, booking_v2_enabled, custom_site_eligible";

interface Settings {
  enabled: boolean;
  delay_minutes: number;
  tenant_scope: "all" | "selected";
  tenant_ids: string[];
  ai_instructions: string;
  /** Emails per abandoned booking: the first, then one a day (1–7). */
  max_emails: number;
}

interface Row extends RecoveryBooking {
  tenant_id: string;
  status: string;
  email_status: string | null;
  started_at: string;
  last_activity_at: string;
  abandoned_at: string | null;
  unsubscribed_at: string | null;
  email_count: number;
  last_email_at: string | null;
  next_email_at: string | null;
  last_reply_at: string | null;
  email_sent_at: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Write, send and log one recovery email (the first or a follow-up). */
async function sendRecovery(supabase: Db, tenant: RecoveryTenant, r: Row, settings: Settings, seq: RecoverySequence) {
  const mail = await writeRecoveryEmail(tenant, r, settings.ai_instructions, seq);
  const { html, text } = renderRecoveryHtml(tenant, mail.subject, mail.body, unsubscribeUrl(r.recovery_token), mail.link);
  const outcome = await sendTenantEmail({
    tenant,
    to: r.customer_email!,
    subject: mail.subject,
    html,
    text,
    replyTo: replyToFor(tenant, r.recovery_token),
    headers: { "List-Unsubscribe": `<${unsubscribeUrl(r.recovery_token)}>` },
  });
  await supabase.from("abandoned_recovery_messages").insert({
    abandoned_booking_id: r.id,
    tenant_id: r.tenant_id,
    direction: "outbound",
    kind: "recovery",
    subject: mail.subject,
    body: mail.body,
    status: outcome.ok ? "sent" : "failed",
    detail: outcome.ok ? outcome.id ?? null : outcome.detail ?? null,
  });
  return { mail, outcome };
}

async function tenantsById(supabase: Db, ids: string[]): Promise<Map<string, RecoveryTenant>> {
  const out = new Map<string, RecoveryTenant>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("tenants").select(TENANT_COLS).in("id", [...new Set(ids)]);
  if (error) throw error;
  for (const t of data ?? []) out.set(t.id, t as RecoveryTenant);
  return out;
}

async function loadFaqs(supabase: Db, tenantId: string) {
  const { data } = await supabase
    .from("faqs")
    .select("id, question, answer, is_active")
    .eq("tenant_id", tenantId)
    .order("display_order", { ascending: true })
    .limit(200);
  return (data ?? [])
    .filter((f: any) => f.is_active !== false && f.question && f.answer)
    .map((f: any) => ({ id: f.id, question: String(f.question), answer: String(f.answer) }));
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isCron = bearer === serviceKey;
    if (!isCron) {
      const { data: { user } } = await supabase.auth.getUser(bearer);
      if (!user) return errorResponse("Unauthorized", 401);
      const { data: admins } = await supabase.from("app_users").select("is_super_admin, is_active").eq("auth_user_id", user.id);
      const ok = Array.isArray(admins) && admins.some((u: any) => u.is_super_admin === true && u.is_active !== false);
      if (!ok) return errorResponse("Only super admins can run abandoned recovery", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = isCron ? "run" : (body?.action ?? "");

    const { data: settingsRow } = await supabase.from("abandoned_recovery_settings").select("*").eq("id", 1).maybeSingle();
    const settings: Settings = {
      enabled: settingsRow?.enabled ?? false,
      delay_minutes: settingsRow?.delay_minutes ?? 60,
      tenant_scope: settingsRow?.tenant_scope ?? "selected",
      tenant_ids: settingsRow?.tenant_ids ?? [],
      ai_instructions: settingsRow?.ai_instructions ?? "",
      max_emails: Math.min(7, Math.max(1, Number(settingsRow?.max_emails) || 1)),
    };

    /* ── super-admin tools ─────────────────────────────────────────────── */

    if (action === "ask") {
      const question = String(body?.question ?? "").trim();
      if (!question) return errorResponse("Type a question");
      const tenants = await tenantsById(supabase, [String(body?.tenantId ?? "")]);
      const tenant = tenants.values().next().value as RecoveryTenant | undefined;
      if (!tenant) return errorResponse("Tenant not found", 404);
      const faqs = await loadFaqs(supabase, tenant.id);
      const result = await answerFromFaqs(
        tenant,
        { customer_name: "Sarah", vehicle_name: null, pickup_date: null, dropoff_date: null },
        question,
        faqs,
      );
      return jsonResponse({
        success: true,
        faqCount: faqs.length,
        ...result,
        faqsUsed: faqs.filter((f: { id: string }) => result.faqIds.includes(f.id)),
      });
    }

    if (action === "preview" || action === "test") {
      const { data: row } = await supabase.from("abandoned_bookings").select("*").eq("id", body?.id).maybeSingle();
      if (!row) return errorResponse("Session not found", 404);
      const tenant = (await tenantsById(supabase, [row.tenant_id])).get(row.tenant_id);
      if (!tenant) return errorResponse("Tenant not found", 404);
      const mail = await writeRecoveryEmail(tenant, row as Row, settings.ai_instructions);
      if (action === "preview") return jsonResponse({ success: true, ...mail });
      const to = String(body?.to ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return errorResponse("A valid email address is required");
      const { html, text } = renderRecoveryHtml(tenant, mail.subject, mail.body, null, mail.link);
      const outcome = await sendTenantEmail({ tenant, to, subject: `[Test] ${mail.subject}`, html, text });
      return outcome.ok ? jsonResponse({ success: true, ...mail }) : errorResponse(outcome.detail || "Send failed", 502);
    }

    if (action !== "run") return errorResponse("Unknown action");

    /* ── the run ───────────────────────────────────────────────────────── */

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const counts = { converted: 0, abandoned: 0, sent: 0, followUps: 0, stopped: 0, failed: 0, skipped: 0, expired: 0 };

    const { data: openRaw, error: openErr } = await supabase
      .from("abandoned_bookings")
      .select("*")
      .in("status", ["in_progress", "abandoned", "emailed"])
      .order("last_activity_at", { ascending: true })
      .limit(2000);
    if (openErr) throw openErr;
    let open = (openRaw ?? []) as Row[];

    // 1. Converted?
    if (open.length > 0) {
      const { data: conv, error: convErr } = await supabase.rpc("abandoned_bookings_find_conversions", { p_ids: open.map((r) => r.id) });
      if (convErr) throw convErr;
      const converted = new Map<string, string>((conv ?? []).map((c: any) => [c.abandoned_id, c.rental_id]));
      for (const r of open.filter((r) => converted.has(r.id))) {
        await supabase
          .from("abandoned_bookings")
          .update({
            status: "converted",
            converted_at: nowIso,
            converted_rental_id: converted.get(r.id),
            converted_after_email: r.email_status === "sent",
          })
          .eq("id", r.id)
          .neq("status", "converted");
        counts.converted++;
      }
      open = open.filter((r) => !converted.has(r.id));
    }

    // 2. Abandoned?
    const idleBefore = now - settings.delay_minutes * MINUTE;
    for (const r of open) {
      if (r.status === "in_progress" && new Date(r.last_activity_at).getTime() < idleBefore) {
        await supabase.from("abandoned_bookings").update({ status: "abandoned", abandoned_at: nowIso }).eq("id", r.id).eq("status", "in_progress");
        r.status = "abandoned";
        r.abandoned_at = nowIso;
        counts.abandoned++;
      }
    }

    // 3. Email.
    const toDecide = open.filter((r) => r.status === "abandoned" && r.email_status === null);
    const tenants = await tenantsById(supabase, toDecide.map((r) => r.tenant_id));

    // Who got a recovery email recently, or unsubscribed, per tenant+address?
    const emails = [...new Set(toDecide.map((r) => r.customer_email).filter(Boolean))] as string[];
    const recent = new Set<string>();
    const unsubscribed = new Set<string>();
    if (emails.length > 0) {
      const { data: history } = await supabase
        .from("abandoned_bookings")
        .select("tenant_id, customer_email, email_sent_at, unsubscribed_at")
        .in("customer_email", emails)
        .or(`email_sent_at.gte.${new Date(now - SAME_ADDRESS_COOLDOWN_MS).toISOString()},unsubscribed_at.not.is.null`);
      for (const h of history ?? []) {
        const key = `${h.tenant_id}:${String(h.customer_email).toLowerCase()}`;
        if (h.unsubscribed_at) unsubscribed.add(key);
        if (h.email_sent_at) recent.add(key);
      }
    }

    let sends = 0;
    for (const r of toDecide) {
      if (sends >= MAX_SENDS_PER_RUN) break;
      const tenant = tenants.get(r.tenant_id);
      const key = `${r.tenant_id}:${(r.customer_email ?? "").toLowerCase()}`;
      const inScope = settings.tenant_scope === "all" || settings.tenant_ids.includes(r.tenant_id);
      const skip = !settings.enabled
        ? "Recovery emails were off"
        : !inScope
        ? "Tenant not included in recovery"
        : !tenant
        ? "Tenant not found"
        : !r.customer_email
        ? "Left before giving an email address"
        : r.unsubscribed_at || unsubscribed.has(key)
        ? "Renter unsubscribed"
        : recent.has(key)
        ? "Already sent this address a reminder in the last 7 days"
        : now - new Date(r.last_activity_at).getTime() > LATE_LIMIT_MS
        ? "Went idle more than 48 hours ago"
        : null;

      if (skip) {
        await supabase.from("abandoned_bookings").update({ email_status: "skipped", email_detail: skip }).eq("id", r.id).is("email_status", null);
        counts.skipped++;
        continue;
      }

      // Claim it first, so an overlapping run can never send twice.
      const { data: claimed } = await supabase
        .from("abandoned_bookings")
        .update({ email_status: "sent", email_detail: null })
        .eq("id", r.id)
        .is("email_status", null)
        .select("id");
      if (!claimed || claimed.length === 0) continue;
      sends++;
      recent.add(key);

      const { mail, outcome } = await sendRecovery(supabase, tenant!, r, settings, { attempt: 1, total: settings.max_emails });
      const sentAt = new Date().toISOString();

      await supabase
        .from("abandoned_bookings")
        .update(
          outcome.ok
            ? {
              status: "emailed",
              email_subject: mail.subject,
              email_body: mail.body,
              email_sent_at: sentAt,
              email_detail: mail.ai ? null : "Sent the standard message (AI unavailable)",
              email_count: 1,
              last_email_at: sentAt,
              next_email_at: settings.max_emails > 1 ? new Date(Date.parse(sentAt) + FOLLOW_UP_EVERY_MS).toISOString() : null,
            }
            : { email_status: "failed", email_detail: outcome.detail ?? "Send failed", email_subject: mail.subject, email_body: mail.body },
        )
        .eq("id", r.id);
      if (outcome.ok) counts.sent++;
      else counts.failed++;
    }

    // 3b. Follow-ups: one a day after the first, until max_emails have gone —
    //     or the renter acts. "Acts" = booked (step 1 already took those out),
    //     came back to the booking (any tracked activity after the last email,
    //     which includes opening the email's resume link), replied, or
    //     unsubscribed. Any of those ends the sequence for good; coming back
    //     and leaving again does not restart it.
    const due = open.filter(
      (r) => r.status === "emailed" && r.next_email_at !== null && Date.parse(r.next_email_at) <= now,
    );
    const dueTenants = await tenantsById(supabase, due.map((r) => r.tenant_id));
    for (const r of due) {
      if (sends >= MAX_SENDS_PER_RUN) break;
      const tenant = dueTenants.get(r.tenant_id);
      const sentSoFar = r.email_count || 1;
      const lastEmail = Date.parse(r.last_email_at ?? r.email_sent_at ?? r.next_email_at!);
      const inScope = settings.tenant_scope === "all" || settings.tenant_ids.includes(r.tenant_id);
      const stop = r.unsubscribed_at
        ? "Unsubscribed"
        : r.last_reply_at && Date.parse(r.last_reply_at) > lastEmail
        ? "Replied to the email"
        : Date.parse(r.last_activity_at) > lastEmail
        ? "Came back to the booking"
        : sentSoFar >= settings.max_emails
        ? `All ${sentSoFar} emails sent`
        : !settings.enabled
        ? "Recovery emails were turned off"
        : !inScope
        ? "Tenant no longer included in recovery"
        : !tenant || !r.customer_email
        ? "Nowhere to send it"
        : null;

      // Claim: only the run that clears next_email_at may act on it.
      const { data: claimed } = await supabase
        .from("abandoned_bookings")
        .update({ next_email_at: null, ...(stop ? { follow_up_stopped: stop } : {}) })
        .eq("id", r.id)
        .eq("next_email_at", r.next_email_at)
        .select("id");
      if (!claimed || claimed.length === 0) continue;
      if (stop) {
        counts.stopped++;
        continue;
      }

      sends++;
      const attempt = sentSoFar + 1;
      const { outcome } = await sendRecovery(supabase, tenant!, r, settings, { attempt, total: settings.max_emails });
      const sentAt = new Date().toISOString();
      await supabase
        .from("abandoned_bookings")
        .update(
          outcome.ok
            ? {
              email_count: attempt,
              last_email_at: sentAt,
              next_email_at: attempt < settings.max_emails ? new Date(Date.parse(sentAt) + FOLLOW_UP_EVERY_MS).toISOString() : null,
              follow_up_stopped: attempt >= settings.max_emails ? `All ${attempt} emails sent` : null,
            }
            // A failed follow-up ends the sequence rather than retrying every
            // ten minutes into a mailbox that refuses it.
            : { follow_up_stopped: `Email ${attempt} failed: ${outcome.detail ?? "send failed"}` },
        )
        .eq("id", r.id);
      if (outcome.ok) counts.followUps++;
      else counts.failed++;
    }

    // 4. Expired.
    const { data: expired } = await supabase
      .from("abandoned_bookings")
      .update({ status: "expired" })
      .in("status", ["abandoned", "emailed"])
      .lt("started_at", new Date(now - EXPIRE_AFTER_MS).toISOString())
      .select("id");
    counts.expired = expired?.length ?? 0;

    console.log(`[ABANDONED-RECOVERY] ${JSON.stringify(counts)}`);
    return jsonResponse({ success: true, ...counts });
  } catch (error) {
    console.error("abandoned-recovery-run error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
