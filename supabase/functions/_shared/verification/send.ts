// feat-003: sending the renter's link by email or text (spec 05.2, 05.5, 05.18).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { emailBodyToPlainText, escapeEmailHtml, renderNotificationEmailHtml } from "../notification-email-layout-v2.ts";
import { getTenantTwilioCredentials, normalizePhoneNumber, sendTenantSMS } from "../twilio-sms-client.ts";

type Sb = SupabaseClient;

export interface SendResult { ok: boolean; delivered: boolean; error?: string }

/** Addresses on reserved test domains are never handed to a mail provider (evals use @drive-247.test). */
export function isTestAddress(email: string): boolean {
  return /\.(test|example|invalid|localhost)$/i.test(email.split("@")[1] ?? "");
}

function untilLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric", timeZone: "UTC", timeZoneName: "short" });
}

export async function sendLinkEmail(sb: Sb, tenantId: string, to: string, customerName: string, url: string, expiresAt: string): Promise<SendResult> {
  if (isTestAddress(to)) return { ok: true, delivered: false };
  const { data: t } = await sb.from("tenants")
    .select("slug, company_name, logo_url, primary_color, accent_color, contact_email, contact_phone, phone").eq("id", tenantId).single();
  if (!t?.slug) return { ok: false, delivered: false, error: "Company not found" };
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, delivered: false, error: "Email isn't set up on the server" };

  const company = (t.company_name || "Drive 247").trim();
  const first = customerName.trim().split(/\s+/)[0] || "there";
  const bodyHtml = `
<p>Hi ${escapeEmailHtml(first)},</p>
<p>${escapeEmailHtml(company)} needs to verify your driving licence before your rental. It takes about a minute on your phone: a photo of the front and back of your licence, and a short selfie.</p>
<p><a href="${escapeEmailHtml(url)}">Verify my licence</a></p>
<p>This link works until ${escapeEmailHtml(untilLabel(expiresAt))}.</p>
<p>If you weren't expecting this, you can ignore this email.</p>`;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const html = renderNotificationEmailHtml({
    bodyHtml,
    brand: {
      companyName: company, logoUrl: text(t.logo_url), primaryColor: text(t.primary_color), accentColor: text(t.accent_color),
      contactEmail: text(t.contact_email), contactPhone: text(t.contact_phone) ?? text(t.phone),
    },
    preheader: "About a minute on your phone: your licence and a selfie.",
  });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${company} <${t.slug}@drive-247.com>`, to: [to], subject: `Verify your licence for ${company}`,
      html, text: emailBodyToPlainText(bodyHtml), headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
    }),
  });
  if (!res.ok) {
    console.error("[verification] email failed", res.status);
    return { ok: false, delivered: false, error: "The email could not be sent" };
  }
  return { ok: true, delivered: true };
}

export async function smsAvailable(sb: Sb, tenantId: string): Promise<boolean> {
  const { data } = await sb.from("tenants").select("integration_twilio_sms").eq("id", tenantId).single();
  return !!data?.integration_twilio_sms;
}

export async function sendLinkSms(sb: Sb, tenantId: string, phone: string, company: string, url: string): Promise<SendResult> {
  const creds = await getTenantTwilioCredentials(sb, tenantId);
  if (!creds.isConfigured) return { ok: false, delivered: false, error: "Texts are not switched on for this company" };
  const body = `${company}: please verify your driving licence for your rental. It takes about a minute: ${url}`;
  const r = await sendTenantSMS(creds, normalizePhoneNumber(phone), body);
  return r.success ? { ok: true, delivered: true } : { ok: false, delivered: false, error: r.error ?? "The text could not be sent" };
}
