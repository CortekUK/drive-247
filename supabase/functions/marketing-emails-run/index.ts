// marketing-emails-run — the marketing instruction "course" for new v2 operators.
//
// Super admins write the lessons under Customer management → Marketing
// Instructions Emails. This function, run hourly by pg_cron, sends each lesson
// to each tenant ONCE:
//
//   who      v2 tenants (portal_experience 'v2', or the northwind canary),
//            not tenant_type 'test', status active, who signed up AFTER the
//            lesson was switched on (`active_since`) — new tenants only
//   when     signup + day_offset days. With `send_weekday` set, moved to the
//            first such weekday on or after that day, at 9:00 in the tenant's
//            own time zone (tenants.timezone) — "every Monday" lessons.
//            More than LATE_LIMIT_DAYS late → recorded as skipped, not sent.
//   once     marketing_email_runs is UNIQUE (email_id, tenant_id); claimed
//            before sending so overlapping runs never double-send. A failed
//            send stays failed for a person to look at.
//
// Called with the service-role bearer by cron, or by a super admin with
//   { action: "preview" }               what is due now, nothing sent
//   { action: "test", emailId, to }     send one lesson to `to`, sample tenant
//
// Sender, layout and {{variables}} match lifecycle-checkins-run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  emailBodyToPlainText,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from "../_shared/notification-email-layout-v2.ts";
import { renderBody } from "../customer-management-run/plain-text.ts";

const PLATFORM_SENDER = "Drive 247 <noreply@drive-247.com>";
const PLATFORM_EMAIL_BRAND: EmailLayoutBrand = {
  companyName: "Drive 247",
  logoUrl: null,
  primaryColor: "#1a1a1a",
  accentColor: "#C5A572",
  contactEmail: "support@drive-247.com",
  contactPhone: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LATE_LIMIT_DAYS = 7;
const MAX_SENDS_PER_RUN = 100;
const SEND_HOUR_LOCAL = 9;
const CANARY_SLUG = "northwind";

interface Lesson {
  id: string;
  day_offset: number;
  send_weekday: number | null;
  label: string;
  subject: string;
  body: string;
  active_since: string | null;
}

interface Tenant {
  id: string;
  slug: string;
  company_name: string | null;
  created_at: string;
  timezone: string | null;
  contact_email: string | null;
  admin_email: string | null;
  notification_recipient_email: string | null;
}

const portalUrl = (slug: string) => `https://${slug}.portal.drive-247.com`;
const bookingUrl = (slug: string) => `https://${slug}.drive-247.com`;

function tenantEmail(t: Tenant): string | null {
  return t.notification_recipient_email?.trim() || t.contact_email?.trim() || t.admin_email?.trim() || null;
}

function vars(t: Tenant, recipient: string | null, l: Lesson): Record<string, string> {
  return {
    tenant_name: t.company_name || t.slug,
    tenant_slug: t.slug,
    tenant_admin_name: t.company_name || t.slug,
    tenant_contact_email: t.contact_email || "",
    sign_in_email: recipient || t.contact_email || "",
    portal_url: portalUrl(t.slug),
    booking_url: bookingUrl(t.slug),
    days_since_signup: String(l.day_offset),
  };
}

function fill(template: string, v: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => v[key.toLowerCase()] ?? whole);
}

function renderEmail(l: Lesson, v: Record<string, string>) {
  const subject = fill(l.subject, v).trim();
  const bodyHtml = sanitizeEmailBodyHtml(renderBody(l.body, (text) => fill(text, v)));
  const html = renderNotificationEmailHtml({ bodyHtml, brand: PLATFORM_EMAIL_BRAND, preheader: subject });
  return { subject, html, text: emailBodyToPlainText(bodyHtml) };
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; detail?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, detail: "RESEND_API_KEY is not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: PLATFORM_SENDER, to: [to], subject, html, text }),
    });
    if (res.ok) return { ok: true };
    const parsed = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, detail: parsed?.message?.slice(0, 200) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/* ── Time zones ─────────────────────────────────────────────────────────── */

/** Wall-clock parts of `instant` in `tz`. */
function localParts(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")),
    min: Number(get("minute")),
    s: Number(get("second")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

/** The UTC instant of y-m-d hh:00 on the wall clock in `tz`. */
function wallTimeToUtc(y: number, m: number, d: number, hour: number, tz: string): number {
  let guess = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 2; i++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    guess -= asUtc - Date.UTC(y, m - 1, d, hour);
  }
  return guess;
}

function validTz(tz: string | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** When lesson `l` is due for a tenant who signed up at `signedUp`. */
function dueAt(l: Lesson, signedUp: number, tzRaw: string | null): number {
  const base = signedUp + l.day_offset * DAY_MS;
  if (l.send_weekday == null) return base;
  const tz = validTz(tzRaw);
  const p = localParts(base, tz);
  const shift = (l.send_weekday - p.weekday + 7) % 7;
  // Calendar arithmetic on the local date, then 9:00 local on that day.
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + shift));
  return wallTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), SEND_HOUR_LOCAL, tz);
}

/* ── Handler ────────────────────────────────────────────────────────────── */

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
      if (!ok) return errorResponse("Only super admins can run marketing emails", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = isCron ? "run" : (body?.action ?? "preview");
    const tenantCols = "id, slug, company_name, created_at, timezone, contact_email, admin_email, notification_recipient_email";

    if (action === "test") {
      const to = String(body?.to ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return errorResponse("A valid email address is required");
      const { data: l } = await supabase.from("marketing_emails").select("*").eq("id", body?.emailId).maybeSingle();
      if (!l) return errorResponse("Lesson not found", 404);
      const { data: sample } = await supabase.from("tenants").select(tenantCols).eq("slug", CANARY_SLUG).maybeSingle();
      const tenant: Tenant = sample ?? {
        id: "", slug: "your-company", company_name: "Your Company", created_at: new Date().toISOString(), timezone: null,
        contact_email: to, admin_email: null, notification_recipient_email: null,
      };
      const mail = renderEmail(l as Lesson, vars(tenant, to, l as Lesson));
      const outcome = await sendEmail(to, `[Test] ${mail.subject}`, mail.html, mail.text);
      return outcome.ok ? jsonResponse({ success: true }) : errorResponse(outcome.detail || "Send failed", 502);
    }

    if (action !== "run" && action !== "preview") return errorResponse("Unknown action");
    const dryRun = action === "preview";

    const { data: lessonsRaw, error: lErr } = await supabase
      .from("marketing_emails")
      .select("*")
      .eq("enabled", true)
      .not("active_since", "is", null);
    if (lErr) throw lErr;
    const lessons = (lessonsRaw ?? []) as Lesson[];
    if (lessons.length === 0) return jsonResponse({ success: true, dryRun, due: 0, results: [] });

    const earliest = lessons.map((l) => l.active_since!).sort()[0];
    const { data: tenantsRaw, error: tErr } = await supabase
      .from("tenants")
      .select(`${tenantCols}, tenant_type, status, portal_experience`)
      .gte("created_at", earliest)
      .eq("status", "active")
      .or("tenant_type.is.null,tenant_type.neq.test")
      .or(`portal_experience.eq.v2,slug.eq.${CANARY_SLUG}`);
    if (tErr) throw tErr;
    const tenants = (tenantsRaw ?? []) as Tenant[];

    const { data: done } = await supabase
      .from("marketing_email_runs")
      .select("email_id, tenant_id")
      .in("email_id", lessons.map((l) => l.id));
    const handled = new Set((done ?? []).map((r: any) => `${r.email_id}:${r.tenant_id}`));

    const now = Date.now();
    const due: { l: Lesson; t: Tenant; at: number; late: boolean }[] = [];
    for (const l of lessons) {
      const since = new Date(l.active_since!).getTime();
      for (const t of tenants) {
        const signedUp = new Date(t.created_at).getTime();
        if (signedUp < since) continue; // new tenants only
        if (handled.has(`${l.id}:${t.id}`)) continue;
        const at = dueAt(l, signedUp, t.timezone);
        if (at > now) continue;
        due.push({ l, t, at, late: now - at > LATE_LIMIT_DAYS * DAY_MS });
      }
    }
    due.sort((a, b) => a.at - b.at);
    const batch = due.slice(0, MAX_SENDS_PER_RUN);

    if (dryRun) {
      return jsonResponse({
        success: true,
        dryRun: true,
        due: due.length,
        results: batch.map(({ l, t, at, late }) => ({
          tenant: t.company_name || t.slug,
          lesson: l.label,
          to: tenantEmail(t),
          due_at: new Date(at).toISOString(),
          would: late ? "skip (more than 7 days late)" : tenantEmail(t) ? "send" : "skip (no email address)",
        })),
      });
    }

    const results: Record<string, unknown>[] = [];
    for (const { l, t, at, late } of batch) {
      const recipient = tenantEmail(t);
      const mail = renderEmail(l, vars(t, recipient, l));
      const skip = late ? "More than 7 days late" : !recipient ? "No email address on the tenant" : null;

      const { data: claim, error: claimErr } = await supabase
        .from("marketing_email_runs")
        .insert({
          email_id: l.id,
          tenant_id: t.id,
          status: skip ? "skipped" : "sent",
          to_email: recipient,
          subject: mail.subject,
          detail: skip,
          due_at: new Date(at).toISOString(),
        })
        .select("id")
        .single();
      if (claimErr) {
        if ((claimErr as { code?: string }).code === "23505") continue;
        throw claimErr;
      }
      if (skip) {
        results.push({ tenant: t.slug, lesson: l.label, status: "skipped", detail: skip });
        continue;
      }
      const outcome = await sendEmail(recipient!, mail.subject, mail.html, mail.text);
      if (!outcome.ok) {
        await supabase.from("marketing_email_runs").update({ status: "failed", detail: outcome.detail ?? null }).eq("id", claim.id);
      }
      results.push({ tenant: t.slug, lesson: l.label, status: outcome.ok ? "sent" : "failed", detail: outcome.detail });
    }

    console.log(`[MARKETING-EMAILS] due=${due.length} handled=${results.length}`);
    return jsonResponse({ success: true, dryRun: false, due: due.length, results });
  } catch (error) {
    console.error("marketing-emails-run error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
