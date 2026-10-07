// webinar-register — one-click registration from the v2 portal's webinar popup.
//
//   1. checks the caller's tenant is in the webinar's audience (v2, published,
//      not ended, all-minus-excluded or selected) — the same rule as
//      webinar_tenant_eligible() in SQL
//   2. records the registration: ONE per tenant per webinar (unique key); a
//      second click is a no-op that still answers success
//   3. emails the confirmation to the person who clicked (their sign-in email,
//      else the tenant's contact address): title, date and time in the
//      tenant's time zone, the Google Meet link and an "add to calendar" link.
//      A send that failed earlier is retried on the next click.
//
// The registration stands even if the email fails; the admin tab shows the
// email status per tenant.
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

function validTz(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function formatWhen(iso: string, tz: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d),
    time: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d),
  };
}

const calStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function calendarLink(w: { title: string; description: string | null; starts_at: string; duration_minutes: number; meet_url: string }): string {
  const start = new Date(w.starts_at);
  const end = new Date(start.getTime() + w.duration_minutes * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: w.title,
    dates: `${calStamp(start)}/${calStamp(end)}`,
    details: `${w.description ? `${w.description}\n\n` : ""}Join: ${w.meet_url}`,
    location: w.meet_url,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
    if (!user) return errorResponse("Unauthorized", 401);
    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, email, name, is_active")
      .eq("auth_user_id", user.id)
      .not("tenant_id", "is", null)
      .maybeSingle();
    if (!appUser || appUser.is_active === false) return errorResponse("Unauthorized", 401);

    const { webinarId } = await req.json().catch(() => ({}));
    if (!webinarId) return errorResponse("webinarId is required");

    const { data: w } = await supabase.from("webinars").select("*").eq("id", webinarId).maybeSingle();
    const ended = w ? new Date(w.starts_at).getTime() + w.duration_minutes * 60_000 < Date.now() : true;
    if (!w || w.status !== "published" || ended) return errorResponse("This webinar is no longer open for registration", 409);
    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name, slug, timezone, contact_email, notification_recipient_email, portal_experience")
      .eq("id", appUser.tenant_id)
      .maybeSingle();
    // Same rule as webinar_tenant_eligible() in SQL: v2 only, then the audience.
    const onV2 = tenant?.portal_experience === "v2" || tenant?.slug === "northwind";
    const inAudience = w.audience === "selected"
      ? (w.target_tenant_ids ?? []).includes(appUser.tenant_id)
      : !(w.excluded_tenant_ids ?? []).includes(appUser.tenant_id);
    if (!tenant || !onV2 || !inAudience) return errorResponse("This webinar isn't available for your account", 403);
    const recipient = appUser.email?.trim() || tenant?.notification_recipient_email?.trim() || tenant?.contact_email?.trim() || null;

    // ── Register (once) ─────────────────────────────────────────────────────
    let { data: reg } = await supabase
      .from("webinar_registrations")
      .select("id, email_status")
      .eq("webinar_id", w.id)
      .eq("tenant_id", appUser.tenant_id)
      .maybeSingle();
    let already = !!reg;
    if (!reg) {
      const { data: inserted, error } = await supabase
        .from("webinar_registrations")
        .insert({ webinar_id: w.id, tenant_id: appUser.tenant_id, app_user_id: appUser.id, email: recipient })
        .select("id, email_status")
        .single();
      if (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
        already = true;
        ({ data: reg } = await supabase
          .from("webinar_registrations")
          .select("id, email_status")
          .eq("webinar_id", w.id)
          .eq("tenant_id", appUser.tenant_id)
          .single());
      } else {
        reg = inserted;
      }
    }

    // ── Confirmation email (first time, or retry after a failure) ───────────
    let emailStatus = reg!.email_status as string;
    if (emailStatus !== "sent") {
      if (!recipient) {
        emailStatus = "failed";
        await supabase.from("webinar_registrations").update({ email_status: "failed", email_detail: "No email address" }).eq("id", reg!.id);
      } else {
        const tz = validTz(tenant?.timezone || w.timezone);
        const when = formatWhen(w.starts_at, tz);
        const name = appUser.name?.trim().split(/\s+/)[0] || tenant?.company_name || "there";
        const subject = `You're registered: ${w.title}`;
        const body = [
          `Hi ${name},`,
          "",
          `You're registered for "${w.title}". Here are the details:`,
          "",
          `- Date: ${when.date}`,
          `- Time: ${when.time} (${w.duration_minutes} minutes)`,
          `- Join on Google Meet: ${w.meet_url}`,
          "",
          ...(w.description ? [w.description, ""] : []),
          `Add it to your calendar: ${calendarLink(w)}`,
          "",
          "We'll see you there.",
          "",
          "The Drive 247 team",
        ].join("\n");
        const bodyHtml = sanitizeEmailBodyHtml(renderBody(body, (t) => t));
        const html = renderNotificationEmailHtml({ bodyHtml, brand: PLATFORM_EMAIL_BRAND, preheader: `${when.date}, ${when.time}` });
        const outcome = await sendEmail(recipient, subject, html, emailBodyToPlainText(bodyHtml));
        emailStatus = outcome.ok ? "sent" : "failed";
        await supabase
          .from("webinar_registrations")
          .update({ email_status: emailStatus, email_detail: outcome.ok ? null : outcome.detail ?? null, email: recipient })
          .eq("id", reg!.id);
      }
    }

    return jsonResponse({ success: true, already, emailStatus, email: recipient, meetUrl: w.meet_url });
  } catch (error) {
    console.error("webinar-register error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
