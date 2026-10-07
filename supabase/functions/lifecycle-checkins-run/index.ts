// lifecycle-checkins-run — the 14 / 30 / 60 / 90 lifecycle check-ins.
//
// Super admins plan the check-ins under Customer management → Lifecycle
// check-ins: "day N after signup → send this email" or "→ make a task for our
// team". This function, run hourly by pg_cron, finds every tenant whose day N
// has arrived and does it, ONCE:
//
//   who      production tenants (not tenant_type 'test'), status active, who
//            signed up AFTER the check-in was switched on (`active_since`) —
//            new tenants only, never the existing base
//   when     tenants.created_at + day_offset days has passed, and is no more
//            than LATE_LIMIT_DAYS ago (a step whose day was moved earlier, or
//            a long cron outage, is recorded as skipped, not sent weeks late)
//   once     lifecycle_checkin_runs is UNIQUE (checkin_id, tenant_id); the row
//            is claimed before the email goes out, so two overlapping runs can
//            never send twice. A failed send stays failed for a person to see.
//   email    to the tenant's notification / contact / admin address, from
//            Drive 247, in the same layout as Customer management's other mail
//   task     a row in admin_todos for that tenant, due today
//
// Called with the service-role bearer by cron, or by a super admin with
//   { action: "preview" }                 what would happen now, nothing sent
//   { action: "run" }                     run now
//   { action: "test", checkinId, to }     send one email check-in to `to`,
//                                         filled in with a sample tenant
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  emailBodyToPlainText,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from "../_shared/notification-email-layout-v2.ts";
import { renderBody } from "../customer-management-run/plain-text.ts";

/** Twins of customer-management-run's sender and brand — keep them in step. */
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
const MAX_ACTIONS_PER_RUN = 100;

interface Checkin {
  id: string;
  day_offset: number;
  kind: "email" | "task";
  label: string;
  subject: string | null;
  body: string | null;
  task_note: string | null;
  enabled: boolean;
  active_since: string | null;
}

interface Tenant {
  id: string;
  slug: string;
  company_name: string | null;
  created_at: string;
  contact_email: string | null;
  admin_email: string | null;
  notification_recipient_email: string | null;
}

const portalUrl = (slug: string) => `https://${slug}.portal.drive-247.com`;
const bookingUrl = (slug: string) => `https://${slug}.drive-247.com`;

function tenantEmail(t: Tenant): string | null {
  return t.notification_recipient_email?.trim() || t.contact_email?.trim() || t.admin_email?.trim() || null;
}

function vars(t: Tenant, recipient: string | null, c: Checkin): Record<string, string> {
  return {
    tenant_name: t.company_name || t.slug,
    tenant_slug: t.slug,
    tenant_admin_name: t.company_name || t.slug,
    tenant_contact_email: t.contact_email || "",
    sign_in_email: recipient || t.contact_email || "",
    portal_url: portalUrl(t.slug),
    booking_url: bookingUrl(t.slug),
    days_since_signup: String(c.day_offset),
  };
}

/** Unknown {{keys}} stay as written, so a typo is visible rather than blank. */
function fill(template: string, v: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => v[key.toLowerCase()] ?? whole);
}

function renderEmail(c: Checkin, v: Record<string, string>) {
  const subject = fill(c.subject ?? "", v).trim();
  const bodyHtml = sanitizeEmailBodyHtml(renderBody(c.body ?? "", (text) => fill(text, v)));
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
      if (!ok) return errorResponse("Only super admins can run lifecycle check-ins", 403);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = isCron ? "run" : (body?.action ?? "preview");

    // ── Test send: one email check-in, to one address, with a sample tenant ──
    if (action === "test") {
      const to = String(body?.to ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return errorResponse("A valid email address is required");
      const { data: c } = await supabase.from("lifecycle_checkins").select("*").eq("id", body?.checkinId).maybeSingle();
      if (!c) return errorResponse("Check-in not found", 404);
      if (c.kind !== "email") return errorResponse("Only email check-ins can be test-sent");
      const { data: sample } = await supabase
        .from("tenants")
        .select("id, slug, company_name, created_at, contact_email, admin_email, notification_recipient_email")
        .eq("slug", "northwind")
        .maybeSingle();
      const tenant: Tenant = sample ?? {
        id: "", slug: "your-company", company_name: "Your Company", created_at: new Date().toISOString(),
        contact_email: to, admin_email: null, notification_recipient_email: null,
      };
      const mail = renderEmail(c as Checkin, vars(tenant, to, c as Checkin));
      const outcome = await sendEmail(to, `[Test] ${mail.subject}`, mail.html, mail.text);
      return outcome.ok ? jsonResponse({ success: true }) : errorResponse(outcome.detail || "Send failed", 502);
    }

    if (action !== "run" && action !== "preview") return errorResponse("Unknown action");
    const dryRun = action === "preview";

    // ── Plan ────────────────────────────────────────────────────────────────
    const { data: checkins, error: cErr } = await supabase
      .from("lifecycle_checkins")
      .select("*")
      .eq("enabled", true)
      .not("active_since", "is", null);
    if (cErr) throw cErr;
    const active = (checkins ?? []) as Checkin[];
    if (active.length === 0) return jsonResponse({ success: true, dryRun, due: 0, results: [] });

    const earliest = active.map((c) => c.active_since!).sort()[0];
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, slug, company_name, created_at, contact_email, admin_email, notification_recipient_email, tenant_type, status")
      .gte("created_at", earliest)
      .eq("status", "active")
      .or("tenant_type.is.null,tenant_type.neq.test");
    if (tErr) throw tErr;

    const { data: done } = await supabase
      .from("lifecycle_checkin_runs")
      .select("checkin_id, tenant_id")
      .in("checkin_id", active.map((c) => c.id));
    const handled = new Set((done ?? []).map((r: any) => `${r.checkin_id}:${r.tenant_id}`));

    const now = Date.now();
    const due: { c: Checkin; t: Tenant; dueAt: Date; late: boolean }[] = [];
    for (const c of active) {
      const since = new Date(c.active_since!).getTime();
      for (const t of (tenants ?? []) as Tenant[]) {
        const signedUp = new Date(t.created_at).getTime();
        if (signedUp < since) continue; // new tenants only
        const dueAt = new Date(signedUp + c.day_offset * DAY_MS);
        if (dueAt.getTime() > now) continue;
        if (handled.has(`${c.id}:${t.id}`)) continue;
        due.push({ c, t, dueAt, late: now - dueAt.getTime() > LATE_LIMIT_DAYS * DAY_MS });
      }
    }
    due.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    const batch = due.slice(0, MAX_ACTIONS_PER_RUN);

    if (dryRun) {
      return jsonResponse({
        success: true,
        dryRun: true,
        due: due.length,
        results: batch.map(({ c, t, dueAt, late }) => ({
          tenant: t.company_name || t.slug,
          checkin: `Day ${c.day_offset}: ${c.label}`,
          kind: c.kind,
          to: c.kind === "email" ? tenantEmail(t) : null,
          due_at: dueAt.toISOString(),
          would: late ? "skip (more than 7 days late)" : c.kind === "email" ? (tenantEmail(t) ? "send email" : "skip (no email address)") : "create team task",
        })),
      });
    }

    // ── Act ─────────────────────────────────────────────────────────────────
    const results: Record<string, unknown>[] = [];
    for (const { c, t, dueAt, late } of batch) {
      const recipient = c.kind === "email" ? tenantEmail(t) : null;
      const mail = c.kind === "email" ? renderEmail(c, vars(t, recipient, c)) : null;
      const skip = late ? "More than 7 days late" : c.kind === "email" && !recipient ? "No email address on the tenant" : null;

      // Claim first: the unique key makes a concurrent run back off here.
      const { data: claim, error: claimErr } = await supabase
        .from("lifecycle_checkin_runs")
        .insert({
          checkin_id: c.id,
          tenant_id: t.id,
          status: skip ? "skipped" : c.kind === "email" ? "sent" : "task_created",
          to_email: recipient,
          subject: mail?.subject ?? null,
          detail: skip,
          due_at: dueAt.toISOString(),
        })
        .select("id")
        .single();
      if (claimErr) {
        if ((claimErr as { code?: string }).code === "23505") continue;
        throw claimErr;
      }
      if (skip) {
        results.push({ tenant: t.slug, checkin: c.label, status: "skipped", detail: skip });
        continue;
      }

      if (c.kind === "email") {
        const outcome = await sendEmail(recipient!, mail!.subject, mail!.html, mail!.text);
        if (!outcome.ok) {
          await supabase.from("lifecycle_checkin_runs").update({ status: "failed", detail: outcome.detail ?? null }).eq("id", claim.id);
        }
        results.push({ tenant: t.slug, checkin: c.label, status: outcome.ok ? "sent" : "failed", detail: outcome.detail });
      } else {
        const { data: todo, error: todoErr } = await supabase
          .from("admin_todos")
          .insert({
            tenant_id: t.id,
            title: `Day ${c.day_offset} check-in: ${c.label} — ${t.company_name || t.slug}`.slice(0, 200),
            description: c.task_note,
            priority: "medium",
            status: "not_started",
            due_date: new Date().toISOString().slice(0, 10),
          })
          .select("id")
          .single();
        await supabase
          .from("lifecycle_checkin_runs")
          .update(todoErr ? { status: "failed", detail: todoErr.message } : { todo_id: todo.id })
          .eq("id", claim.id);
        results.push({ tenant: t.slug, checkin: c.label, status: todoErr ? "failed" : "task_created", detail: todoErr?.message });
      }
    }

    console.log(`[LIFECYCLE-CHECKINS] due=${due.length} handled=${results.length}`);
    return jsonResponse({ success: true, dryRun: false, due: due.length, results });
  } catch (error) {
    console.error("lifecycle-checkins-run error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
