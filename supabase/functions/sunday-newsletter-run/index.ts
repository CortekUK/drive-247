// sunday-newsletter-run — the Drive 247 Sunday Newsletter for v2 operators.
//
// Super admins write and schedule issues under Customer management → Sunday
// Newsletter. pg_cron calls this hourly; it sends an issue only ON ITS SUNDAY:
//
//   who      v2 tenants (portal_experience 'v2', or the northwind canary),
//            status active, not tenant_type 'test', in the audience set in
//            newsletter_settings (all minus exclusions, or selected only),
//            not unsubscribed, with an email address
//   when     the issue's send_date (always a Sunday), from send_hour in the
//            tenant's own time zone until that Sunday ends there. A tenant
//            whose Sunday went by without a send (dispatcher off, outage) is
//            recorded as skipped — the newsletter never arrives on a Monday.
//   once     newsletter_deliveries is UNIQUE (issue_id, tenant_id), claimed
//            before sending so overlapping runs never double-send.
//   done     the issue becomes 'sent' once every tenant is handled, or two
//            days after its Sunday at the latest.
//
// Sections, in order: growth tip, Drive 247 tip, next webinar, product update,
// operator spotlight. Any left empty are left out. The webinar section can be
// filled automatically from the next published webinar the tenant is invited
// to (admin → Webinars). The spotlight is only included once its permission
// box is ticked.
//
// Super admins (JWT) can also call:
//   { action: "preview", issueId, tenantId? }   the rendered email, nothing sent
//   { action: "test", issueId, to }             send it to `to` only
//   { action: "status" }                        who would get next Sunday's issue
// GET ?unsubscribe=<delivery id>   the link in the footer (verify_jwt = false).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  emailBodyToPlainText,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from "../_shared/notification-email-layout-v2.ts";
import { plainTextToEmailHtml } from "../customer-management-run/plain-text.ts";

const PLATFORM_SENDER = "Drive 247 <noreply@drive-247.com>";
const PLATFORM_REPLY_TO = "support@drive-247.com";
const PLATFORM_EMAIL_BRAND: EmailLayoutBrand = {
  companyName: "Drive 247",
  logoUrl: null,
  primaryColor: "#1a1a1a",
  accentColor: "#C5A572",
  contactEmail: "support@drive-247.com",
  contactPhone: null,
};
const CANARY_SLUG = "northwind";
const DAY_MS = 24 * 60 * 60 * 1000;
const FINISH_AFTER_MS = 2 * DAY_MS;
const MAX_SENDS_PER_RUN = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Types ──────────────────────────────────────────────────────────────── */

interface Section {
  title?: string;
  body?: string;
}
interface Sections {
  growth_tip?: Section;
  drive247_tip?: Section;
  webinar?: Section & { mode?: "auto" | "custom" | "off" };
  product_update?: Section;
  spotlight?: Section & { permission?: boolean };
}

interface Issue {
  id: string;
  title: string;
  subject: string;
  preheader: string | null;
  intro: string | null;
  sections: Sections;
  send_date: string;
  status: string;
}

interface Settings {
  enabled: boolean;
  send_hour: number;
  audience: "all" | "selected";
  target_tenant_ids: string[];
  excluded_tenant_ids: string[];
}

interface Tenant {
  id: string;
  slug: string;
  company_name: string | null;
  timezone: string | null;
  contact_email: string | null;
  admin_email: string | null;
  notification_recipient_email: string | null;
}

interface Webinar {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  duration_minutes: number;
  audience: "all" | "selected";
  target_tenant_ids: string[];
  excluded_tenant_ids: string[];
}

const TENANT_COLS = "id, slug, company_name, timezone, contact_email, admin_email, notification_recipient_email";

const portalUrl = (slug: string) => `https://${slug}.portal.drive-247.com`;
const bookingUrl = (slug: string) => `https://${slug}.drive-247.com`;

function tenantEmail(t: Tenant): string | null {
  return t.notification_recipient_email?.trim() || t.contact_email?.trim() || t.admin_email?.trim() || null;
}

function inAudience(s: { audience: string; target_tenant_ids: string[]; excluded_tenant_ids: string[] }, tenantId: string) {
  return s.audience === "selected" ? s.target_tenant_ids.includes(tenantId) : !s.excluded_tenant_ids.includes(tenantId);
}

/* ── Time zones ─────────────────────────────────────────────────────────── */

function validTz(tz: string | null): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** The tenant's local date (YYYY-MM-DD) and hour right now. */
function localNow(now: number, tz: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/* ── Rendering ──────────────────────────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fill(template: string, v: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => v[key.toLowerCase()] ?? whole);
}

function vars(t: Tenant): Record<string, string> {
  return {
    tenant_name: t.company_name || t.slug,
    portal_url: portalUrl(t.slug),
    booking_url: bookingUrl(t.slug),
  };
}

const SECTION_LABELS: [keyof Sections, string][] = [
  ["growth_tip", "Growth tip"],
  ["drive247_tip", "Drive 247 tip"],
  ["webinar", "Next webinar"],
  ["product_update", "Product update"],
  ["spotlight", "Operator spotlight"],
];

function webinarFor(webinars: Webinar[], tenantId: string | null): Webinar | null {
  return webinars.find((w) => tenantId === null || inAudience(w, tenantId)) ?? null;
}

function webinarText(w: Webinar, tz: string): Section {
  const start = new Date(w.starts_at);
  const date = start.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const time = start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return {
    title: w.title,
    body:
      `${date} at ${time} · ${w.duration_minutes} minutes` +
      (w.description ? `\n\n${w.description}` : "") +
      `\n\nRegister with one click from your portal home: {{portal_url}}`,
  };
}

function renderIssue(issue: Issue, t: Tenant, webinars: Webinar[], unsubscribe: string | null) {
  const v = vars(t);
  const tz = validTz(t.timezone);
  const parts: string[] = [];
  if (issue.intro?.trim()) parts.push(plainTextToEmailHtml(fill(issue.intro, v)));

  for (const [key, label] of SECTION_LABELS) {
    let s: Section | undefined = issue.sections?.[key];
    if (key === "webinar") {
      const mode = issue.sections?.webinar?.mode ?? "auto";
      if (mode === "off") continue;
      if (mode === "auto") {
        const w = webinarFor(webinars, t.id || null);
        s = w ? webinarText(w, tz) : undefined;
      }
    }
    if (key === "spotlight" && !issue.sections?.spotlight?.permission) continue;
    if (!s || (!s.title?.trim() && !s.body?.trim())) continue;
    parts.push(`<hr>`);
    parts.push(`<p><strong>${escapeHtml(label.toUpperCase())}</strong></p>`);
    if (s.title?.trim()) parts.push(`<h2>${escapeHtml(fill(s.title.trim(), v))}</h2>`);
    if (s.body?.trim()) parts.push(plainTextToEmailHtml(fill(s.body, v)));
  }

  parts.push(`<hr>`);
  parts.push(
    `<p>Questions or ideas for the newsletter? Just reply to this email.</p>` +
      (unsubscribe
        ? `<p>You're getting the Drive 247 Sunday Newsletter as a Drive 247 operator. <a href="${escapeHtml(unsubscribe)}">Unsubscribe</a></p>`
        : ""),
  );

  const subject = fill(issue.subject, v).trim();
  const bodyHtml = sanitizeEmailBodyHtml(parts.join(""));
  const html = renderNotificationEmailHtml({
    bodyHtml,
    brand: PLATFORM_EMAIL_BRAND,
    preheader: issue.preheader?.trim() ? fill(issue.preheader, v) : subject,
  });
  return { subject, html, text: emailBodyToPlainText(bodyHtml) };
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  unsubscribe: string | null,
): Promise<{ ok: boolean; detail?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, detail: "RESEND_API_KEY is not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: PLATFORM_SENDER,
        to: [to],
        reply_to: PLATFORM_REPLY_TO,
        subject,
        html,
        text,
        ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}>` } } : {}),
      }),
    });
    if (res.ok) return { ok: true };
    const parsed = (await res.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, detail: parsed?.message?.slice(0, 200) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

const unsubscribeUrl = (deliveryId: string) =>
  `${Deno.env.get("SUPABASE_URL")}/functions/v1/sunday-newsletter-run?unsubscribe=${deliveryId}`;

function page(title: string, message: string, status = 200) {
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#080812;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">` +
    `<div style="max-width:420px;background:#fff;border:1px solid #f1f5f9;border-radius:12px;padding:32px;text-align:center">` +
    `<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#404040;font-size:14px;margin:0">${message}</p></div></body></html>`;
  return new Response(html, { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

/* ── Handler ────────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  try {
    // The footer's unsubscribe link: public, keyed by the delivery's id.
    if (req.method === "GET") {
      const id = new URL(req.url).searchParams.get("unsubscribe") ?? "";
      if (!UUID_RE.test(id)) return page("Link not recognised", "This unsubscribe link is not valid.", 400);
      const { data: d } = await supabase.from("newsletter_deliveries").select("tenant_id, to_email").eq("id", id).maybeSingle();
      if (!d) return page("Link not recognised", "This unsubscribe link is not valid.", 404);
      await supabase
        .from("newsletter_unsubscribes")
        .upsert({ tenant_id: d.tenant_id, email: d.to_email, unsubscribed_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      return page("You're unsubscribed", "You won't get the Drive 247 Sunday Newsletter any more.");
    }

    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isCron = bearer === serviceKey;
    if (!isCron) {
      const { data: { user } } = await supabase.auth.getUser(bearer);
      if (!user) return errorResponse("Unauthorized", 401);
      const { data: admins } = await supabase.from("app_users").select("is_super_admin, is_active").eq("auth_user_id", user.id);
      // deno-lint-ignore no-explicit-any
      const ok = Array.isArray(admins) && admins.some((u: any) => u.is_super_admin === true && u.is_active !== false);
      if (!ok) return errorResponse("Only super admins can run the newsletter", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = isCron ? "run" : (body?.action ?? "status");

    const { data: settingsRow } = await supabase.from("newsletter_settings").select("*").eq("id", 1).maybeSingle();
    const settings: Settings = {
      enabled: settingsRow?.enabled ?? false,
      send_hour: Number.isInteger(settingsRow?.send_hour) ? settingsRow.send_hour : 9,
      audience: settingsRow?.audience === "selected" ? "selected" : "all",
      target_tenant_ids: settingsRow?.target_tenant_ids ?? [],
      excluded_tenant_ids: settingsRow?.excluded_tenant_ids ?? [],
    };

    const now = Date.now();
    const { data: webinarsRaw } = await supabase
      .from("webinars")
      .select("id, title, description, starts_at, duration_minutes, audience, target_tenant_ids, excluded_tenant_ids")
      .eq("status", "published")
      .gt("starts_at", new Date(now).toISOString())
      .order("starts_at", { ascending: true })
      .limit(20);
    const webinars = (webinarsRaw ?? []) as Webinar[];

    /* ── super-admin tools ─────────────────────────────────────────────── */

    if (action === "preview" || action === "test") {
      const { data: issue } = await supabase.from("newsletter_issues").select("*").eq("id", body?.issueId).maybeSingle();
      if (!issue) return errorResponse("Issue not found", 404);
      let tenant: Tenant | null = null;
      if (body?.tenantId) {
        const { data } = await supabase.from("tenants").select(TENANT_COLS).eq("id", body.tenantId).maybeSingle();
        tenant = data as Tenant | null;
      }
      if (!tenant) {
        const { data } = await supabase.from("tenants").select(TENANT_COLS).eq("slug", CANARY_SLUG).maybeSingle();
        tenant = (data as Tenant | null) ?? {
          id: "", slug: "your-company", company_name: "Your Company", timezone: null,
          contact_email: null, admin_email: null, notification_recipient_email: null,
        };
      }
      const mail = renderIssue(issue as Issue, tenant, webinars, action === "test" ? "#unsubscribe" : null);
      if (action === "preview") return jsonResponse({ success: true, subject: mail.subject, html: mail.html, tenant: tenant.company_name || tenant.slug });
      const to = String(body?.to ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return errorResponse("A valid email address is required");
      const outcome = await sendEmail(to, `[Test] ${mail.subject}`, mail.html, mail.text, null);
      return outcome.ok ? jsonResponse({ success: true }) : errorResponse(outcome.detail || "Send failed", 502);
    }

    // Eligible v2 tenants, minus unsubscribes.
    const { data: tenantsRaw, error: tErr } = await supabase
      .from("tenants")
      .select(TENANT_COLS)
      .eq("status", "active")
      .or("tenant_type.is.null,tenant_type.neq.test")
      .or(`portal_experience.eq.v2,slug.eq.${CANARY_SLUG}`);
    if (tErr) throw tErr;
    const { data: unsubs } = await supabase.from("newsletter_unsubscribes").select("tenant_id");
    const unsubscribed = new Set((unsubs ?? []).map((u: { tenant_id: string }) => u.tenant_id));
    const audience = ((tenantsRaw ?? []) as Tenant[]).filter((t) => inAudience(settings, t.id));

    if (action === "status") {
      return jsonResponse({
        success: true,
        enabled: settings.enabled,
        recipients: audience.map((t) => ({
          tenant: t.company_name || t.slug,
          to: tenantEmail(t),
          timezone: validTz(t.timezone),
          will_get_it: !unsubscribed.has(t.id) && !!tenantEmail(t),
          why_not: unsubscribed.has(t.id) ? "Unsubscribed" : !tenantEmail(t) ? "No email address" : null,
        })),
      });
    }
    if (action !== "run") return errorResponse("Unknown action");

    /* ── the run ───────────────────────────────────────────────────────── */

    const counts = { sent: 0, failed: 0, skipped: 0, finished: 0 };
    if (!settings.enabled) {
      console.log("[SUNDAY-NEWSLETTER] dispatcher is off");
      return jsonResponse({ success: true, enabled: false, ...counts });
    }

    // Issues whose Sunday has started somewhere on Earth (UTC+14) and is not
    // long over.
    const horizon = new Date(now + DAY_MS).toISOString().slice(0, 10);
    const { data: issuesRaw, error: iErr } = await supabase
      .from("newsletter_issues")
      .select("*")
      .eq("status", "scheduled")
      .lte("send_date", horizon);
    if (iErr) throw iErr;
    const issues = (issuesRaw ?? []) as Issue[];

    let sends = 0;
    for (const issue of issues) {
      const { data: done } = await supabase.from("newsletter_deliveries").select("tenant_id").eq("issue_id", issue.id);
      const handled = new Set((done ?? []).map((d: { tenant_id: string }) => d.tenant_id));

      for (const t of audience) {
        if (sends >= MAX_SENDS_PER_RUN) break;
        if (handled.has(t.id)) continue;
        const local = localNow(now, validTz(t.timezone));
        if (local.date < issue.send_date) continue; // their Sunday hasn't come
        if (local.date === issue.send_date && local.hour < settings.send_hour) continue; // not yet the hour

        const recipient = tenantEmail(t);
        const skip = local.date > issue.send_date
          ? "Its Sunday went by before it could be sent"
          : unsubscribed.has(t.id)
          ? "Unsubscribed"
          : !recipient
          ? "No email address on the tenant"
          : null;

        // Claim first, so an overlapping run can never send twice.
        const { data: claim, error: claimErr } = await supabase
          .from("newsletter_deliveries")
          .insert({ issue_id: issue.id, tenant_id: t.id, status: skip ? "skipped" : "sent", to_email: recipient, detail: skip })
          .select("id")
          .single();
        if (claimErr) {
          if ((claimErr as { code?: string }).code === "23505") continue;
          throw claimErr;
        }
        handled.add(t.id);
        if (skip) {
          counts.skipped++;
          continue;
        }

        sends++;
        const unsub = unsubscribeUrl(claim.id);
        const mail = renderIssue(issue, t, webinars, unsub);
        const outcome = await sendEmail(recipient!, mail.subject, mail.html, mail.text, unsub);
        if (!outcome.ok) {
          await supabase.from("newsletter_deliveries").update({ status: "failed", detail: outcome.detail ?? null }).eq("id", claim.id);
          counts.failed++;
        } else {
          counts.sent++;
        }
      }

      const allHandled = audience.every((t) => handled.has(t.id));
      const longOver = now > Date.parse(`${issue.send_date}T00:00:00Z`) + FINISH_AFTER_MS;
      if (allHandled || longOver) {
        await supabase
          .from("newsletter_issues")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", issue.id)
          .eq("status", "scheduled");
        counts.finished++;
      }
    }

    console.log(`[SUNDAY-NEWSLETTER] ${JSON.stringify(counts)}`);
    return jsonResponse({ success: true, ...counts });
  } catch (error) {
    console.error("sunday-newsletter-run error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
