import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getTenantBranding,
  wrapWithBrandedTemplate,
  sendEmail,
  type TenantBranding,
} from "../_shared/resend-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

// send-toll-report — email a customer a statement of their toll charges plus a
// single "Pay now" button. Money is handled entirely by the PROVEN checkout path:
// the caller (portal) first mints the pay-link via create-checkout-session
// (targetCategories:['Fine'], which the webhook settles against the customer's
// Fine ledger charges) and passes the resulting URL here as payUrl. This function
// is EMAIL-ONLY — it never touches payments/ledger — so it carries no money-path
// risk. JWT-protected (staff-invoked); intentionally NOT in the verify_jwt=false list.

interface TollLine {
  date?: string | null;
  description: string;
  amount: number;
}

interface TollReportRequest {
  tenantId: string;
  customerEmail: string;
  customerName?: string;
  tolls: TollLine[];
  total: number;
  currencyCode?: string;
  payUrl: string;
  periodLabel?: string;
}

const DEFAULT_BRANDING: TenantBranding = {
  companyName: "Drive 247",
  logoUrl: null,
  primaryColor: "#1a1a1a",
  accentColor: "#6366f1",
  contactEmail: "support@drive-247.com",
  contactPhone: null,
  slug: "drive247",
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildTollReportHtml(
  data: TollReportRequest,
  branding: TenantBranding,
  currency: string,
): string {
  const accent = branding.accentColor || "#6366f1";
  const rows = data.tolls
    .map(
      (t) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#555;white-space:nowrap;">${escapeHtml(t.date ?? "")}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(t.description)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;white-space:nowrap;">${formatCurrency(t.amount, currency)}</td>
      </tr>`,
    )
    .join("");

  return `
    <tr><td style="padding:0 0 16px;">
      <h2 style="margin:0 0 6px;font-size:20px;color:#111;">Toll charges${data.periodLabel ? ` — ${escapeHtml(data.periodLabel)}` : ""}</h2>
      <p style="margin:0;color:#555;font-size:14px;line-height:1.5;">Hi ${escapeHtml(data.customerName || "there")}, here is a summary of your outstanding toll charges. You can pay the total securely using the button below.</p>
    </td></tr>
    <tr><td>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:8px;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#666;">Date</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#666;">Description</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#666;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="background:#f8f9fa;">
            <td style="padding:12px;font-weight:700;" colspan="2">Total due</td>
            <td style="padding:12px;text-align:right;font-weight:700;white-space:nowrap;">${formatCurrency(data.total, currency)}</td>
          </tr>
        </tbody>
      </table>
    </td></tr>
    <tr><td style="padding:20px 0;text-align:center;">
      <a href="${escapeHtml(data.payUrl)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Pay ${formatCurrency(data.total, currency)} now</a>
      <p style="margin:14px 0 0;color:#999;font-size:12px;">If the button doesn't work, copy this link into your browser:<br/><span style="color:#6366f1;word-break:break-all;">${escapeHtml(data.payUrl)}</span></p>
    </td></tr>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: TollReportRequest = await req.json();

    if (
      !data.customerEmail ||
      !data.payUrl ||
      !Array.isArray(data.tolls) ||
      data.tolls.length === 0 ||
      !(Number(data.total) > 0)
    ) {
      return json(
        { success: false, error: "customerEmail, payUrl, a positive total, and at least one toll are required" },
        400,
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let currency = data.currencyCode || "USD";
    if (!data.currencyCode && data.tenantId) {
      const { data: t } = await supabase
        .from("tenants")
        .select("currency_code")
        .eq("id", data.tenantId)
        .single();
      if (t?.currency_code) currency = t.currency_code;
    }

    const branding = data.tenantId
      ? await getTenantBranding(data.tenantId, supabase)
      : DEFAULT_BRANDING;

    const html = wrapWithBrandedTemplate(buildTollReportHtml(data, branding, currency), branding);
    const subject = `Your toll charges — ${formatCurrency(data.total, currency)} due`;

    const result = await sendEmail(data.customerEmail, subject, html, supabase, data.tenantId);

    return json({ success: true, email: result });
  } catch (e: any) {
    console.error("send-toll-report error:", e?.message ?? e);
    return json({ success: false, error: e?.message || "Unknown error" }, 500);
  }
});
