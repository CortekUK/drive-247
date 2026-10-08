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
  type RecoveryTenant,
} from "../_shared/abandoned-recovery.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_SENDS_PER_RUN = 50;
const LATE_LIMIT_MS = 2 * DAY;
const SAME_ADDRESS_COOLDOWN_MS = 7 * DAY;
const EXPIRE_AFTER_MS = 30 * DAY;

const TENANT_COLS =
  "id, slug, company_name, app_name, logo_url, primary_color, accent_color, contact_email, contact_phone, custom_booking_domain";

interface Settings {
  enabled: boolean;
  delay_minutes: number;
  tenant_scope: "all" | "selected";
  tenant_ids: string[];
  ai_instructions: string;
}

interface Row extends RecoveryBooking {
  tenant_id: string;
  status: string;
  email_status: string | null;
  started_at: string;
  last_activity_at: string;
  abandoned_at: string | null;
  unsubscribed_at: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = any;

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
      const { html, text } = renderRecoveryHtml(tenant, mail.subject, mail.body, null);
      const outcome = await sendTenantEmail({ tenant, to, subject: `[Test] ${mail.subject}`, html, text });
      return outcome.ok ? jsonResponse({ success: true, ...mail }) : errorResponse(outcome.detail || "Send failed", 502);
    }

    if (action !== "run") return errorResponse("Unknown action");

    /* ── the run ───────────────────────────────────────────────────────── */

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const counts = { converted: 0, abandoned: 0, sent: 0, failed: 0, skipped: 0, expired: 0 };

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

      const mail = await writeRecoveryEmail(tenant!, r, settings.ai_instructions);
      const { html, text } = renderRecoveryHtml(tenant!, mail.subject, mail.body, unsubscribeUrl(r.recovery_token));
      const outcome = await sendTenantEmail({
        tenant: tenant!,
        to: r.customer_email!,
        subject: mail.subject,
        html,
        text,
        replyTo: replyToFor(tenant!, r.recovery_token),
        headers: { "List-Unsubscribe": `<${unsubscribeUrl(r.recovery_token)}>` },
      });

      await supabase
        .from("abandoned_bookings")
        .update(
          outcome.ok
            ? {
              status: "emailed",
              email_subject: mail.subject,
              email_body: mail.body,
              email_sent_at: new Date().toISOString(),
              email_detail: mail.ai ? null : "Sent the standard message (AI unavailable)",
            }
            : { email_status: "failed", email_detail: outcome.detail ?? "Send failed", email_subject: mail.subject, email_body: mail.body },
        )
        .eq("id", r.id);
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
      if (outcome.ok) counts.sent++;
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
