// milestones-run — milestone celebration emails for v2 operators.
//
// Super admins set the milestones under Customer management → Milestone
// Celebrations (e.g. 10 bookings, 5 cars). This function, run every 15 minutes
// by pg_cron, counts each v2 tenant's bookings / fleet / customers and, when a
// tenant crosses a switched-on milestone, emails them ONCE:
//
//   who      v2 tenants (portal_experience 'v2', or the northwind canary),
//            not tenant_type 'test', status active
//   when     the first run after their count reaches the threshold
//   already  a tenant who was already past the threshold BEFORE the milestone
//            was switched on (counting only rows created before `active_since`)
//            is logged as skipped — "already reached" — and not emailed
//   once     milestone_achievements is UNIQUE (milestone_id, tenant_id);
//            claimed before sending so overlapping runs never double-send
//
// Called with the service-role bearer by cron, or by a super admin with
//   { action: "overview" }                  every v2 tenant's counts + what is due
//   { action: "test", milestoneId, to }     send one milestone email to `to`
//
// Sender, layout and {{variables}} match marketing-emails-run.
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

const MAX_SENDS_PER_RUN = 100;
const CANARY_SLUG = "northwind";

type Metric = "bookings" | "completed_rentals" | "fleet_size" | "customers";
const METRIC_LABEL: Record<Metric, string> = {
  bookings: "bookings",
  completed_rentals: "completed rentals",
  fleet_size: "cars in your fleet",
  customers: "customers",
};

interface Milestone {
  id: string;
  metric: Metric;
  threshold: number;
  label: string;
  subject: string;
  body: string;
  enabled: boolean;
  active_since: string | null;
}

interface Tenant {
  id: string;
  slug: string;
  company_name: string | null;
  contact_email: string | null;
  admin_email: string | null;
  notification_recipient_email: string | null;
}

type Counts = Record<Metric, number>;

const portalUrl = (slug: string) => `https://${slug}.portal.drive-247.com`;
const bookingUrl = (slug: string) => `https://${slug}.drive-247.com`;

function tenantEmail(t: Tenant): string | null {
  return t.notification_recipient_email?.trim() || t.contact_email?.trim() || t.admin_email?.trim() || null;
}

function vars(t: Tenant, m: Milestone, current: number): Record<string, string> {
  return {
    tenant_name: t.company_name || t.slug,
    tenant_slug: t.slug,
    tenant_contact_email: t.contact_email || "",
    portal_url: portalUrl(t.slug),
    booking_url: bookingUrl(t.slug),
    milestone_value: String(m.threshold),
    metric_label: METRIC_LABEL[m.metric],
    current_value: String(current),
  };
}

function fill(template: string, v: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => v[key.toLowerCase()] ?? whole);
}

function renderEmail(m: Milestone, v: Record<string, string>) {
  const subject = fill(m.subject, v).trim();
  const bodyHtml = sanitizeEmailBodyHtml(renderBody(m.body, (text) => fill(text, v)));
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

// deno-lint-ignore no-explicit-any
async function countsFor(supabase: any, tenantIds: string[], before: string | null): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>();
  if (tenantIds.length === 0) return out;
  const { data, error } = await supabase.rpc("milestone_metric_counts", { p_tenant_ids: tenantIds, p_before: before });
  if (error) throw error;
  for (const r of data ?? []) {
    out.set(r.tenant_id, {
      bookings: r.bookings ?? 0,
      completed_rentals: r.completed_rentals ?? 0,
      fleet_size: r.fleet_size ?? 0,
      customers: r.customers ?? 0,
    });
  }
  return out;
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
      if (!ok) return errorResponse("Only super admins can run milestone celebrations", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = isCron ? "run" : (body?.action ?? "overview");
    const tenantCols = "id, slug, company_name, contact_email, admin_email, notification_recipient_email";

    if (action === "test") {
      const to = String(body?.to ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return errorResponse("A valid email address is required");
      const { data: m } = await supabase.from("milestones").select("*").eq("id", body?.milestoneId).maybeSingle();
      if (!m) return errorResponse("Milestone not found", 404);
      const { data: sample } = await supabase.from("tenants").select(tenantCols).eq("slug", CANARY_SLUG).maybeSingle();
      const tenant: Tenant = sample ?? {
        id: "", slug: "your-company", company_name: "Your Company", contact_email: to, admin_email: null, notification_recipient_email: null,
      };
      const mail = renderEmail(m as Milestone, vars(tenant, m as Milestone, (m as Milestone).threshold));
      const outcome = await sendEmail(to, `[Test] ${mail.subject}`, mail.html, mail.text);
      return outcome.ok ? jsonResponse({ success: true }) : errorResponse(outcome.detail || "Send failed", 502);
    }

    if (action !== "run" && action !== "overview") return errorResponse("Unknown action");

    const { data: tenantsRaw, error: tErr } = await supabase
      .from("tenants")
      .select(`${tenantCols}, tenant_type, status, portal_experience`)
      .eq("status", "active")
      .or("tenant_type.is.null,tenant_type.neq.test")
      .or(`portal_experience.eq.v2,slug.eq.${CANARY_SLUG}`);
    if (tErr) throw tErr;
    const tenants = (tenantsRaw ?? []) as Tenant[];

    const { data: milestonesRaw, error: mErr } = await supabase.from("milestones").select("*");
    if (mErr) throw mErr;
    const all = (milestonesRaw ?? []) as Milestone[];
    const live = all.filter((m) => m.enabled && m.active_since);

    const counts = await countsFor(supabase, tenants.map((t) => t.id), null);

    const { data: done } = await supabase.from("milestone_achievements").select("milestone_id, tenant_id");
    const handled = new Set((done ?? []).map((r: any) => `${r.milestone_id}:${r.tenant_id}`));

    const due: { m: Milestone; t: Tenant; value: number }[] = [];
    for (const m of live) {
      for (const t of tenants) {
        const value = counts.get(t.id)?.[m.metric] ?? 0;
        if (value < m.threshold) continue;
        if (handled.has(`${m.id}:${t.id}`)) continue;
        due.push({ m, t, value });
      }
    }

    if (action === "overview") {
      const enabledByMetric = (metric: Metric) =>
        live.filter((m) => m.metric === metric).sort((a, b) => a.threshold - b.threshold);
      return jsonResponse({
        success: true,
        due: due.length,
        tenants: tenants
          .map((t) => {
            const c = counts.get(t.id) ?? { bookings: 0, completed_rentals: 0, fleet_size: 0, customers: 0 };
            const next = (["bookings", "completed_rentals", "fleet_size", "customers"] as Metric[])
              .map((metric) => {
                const n = enabledByMetric(metric).find((m) => m.threshold > c[metric]);
                return n ? { metric, label: n.label, threshold: n.threshold, current: c[metric] } : null;
              })
              .filter(Boolean);
            return { id: t.id, name: t.company_name || t.slug, slug: t.slug, counts: c, next };
          })
          .sort((a, b) => b.counts.bookings - a.counts.bookings),
        dueRows: due.map(({ m, t, value }) => ({ tenant: t.company_name || t.slug, milestone: m.label, value, to: tenantEmail(t) })),
      });
    }

    // Was the tenant already past it when the milestone was switched on?
    // One count per distinct active_since, over only the tenants in question.
    const beforeCounts = new Map<string, Map<string, Counts>>();
    for (const since of new Set(due.map((d) => d.m.active_since!))) {
      const ids = [...new Set(due.filter((d) => d.m.active_since === since).map((d) => d.t.id))];
      beforeCounts.set(since, await countsFor(supabase, ids, since));
    }

    const results: Record<string, unknown>[] = [];
    for (const { m, t, value } of due.slice(0, MAX_SENDS_PER_RUN)) {
      const before = beforeCounts.get(m.active_since!)?.get(t.id)?.[m.metric] ?? 0;
      const recipient = tenantEmail(t);
      const mail = renderEmail(m, vars(t, m, value));
      const skip = before >= m.threshold
        ? "Already reached before this milestone was switched on — not emailed"
        : !recipient
        ? "No email address on the tenant"
        : null;

      const { data: claim, error: claimErr } = await supabase
        .from("milestone_achievements")
        .insert({
          milestone_id: m.id,
          tenant_id: t.id,
          metric_value: value,
          status: skip ? "skipped" : "sent",
          to_email: recipient,
          subject: mail.subject,
          detail: skip,
        })
        .select("id")
        .single();
      if (claimErr) {
        if ((claimErr as { code?: string }).code === "23505") continue;
        throw claimErr;
      }
      if (skip) {
        results.push({ tenant: t.slug, milestone: m.label, status: "skipped", detail: skip });
        continue;
      }
      const outcome = await sendEmail(recipient!, mail.subject, mail.html, mail.text);
      await supabase
        .from("milestone_achievements")
        .update(outcome.ok ? { email_sent_at: new Date().toISOString() } : { status: "failed", detail: outcome.detail ?? null })
        .eq("id", claim.id);
      results.push({ tenant: t.slug, milestone: m.label, status: outcome.ok ? "sent" : "failed", detail: outcome.detail });
    }

    console.log(`[MILESTONES] due=${due.length} handled=${results.length}`);
    return jsonResponse({ success: true, due: due.length, results });
  } catch (error) {
    console.error("milestones-run error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
