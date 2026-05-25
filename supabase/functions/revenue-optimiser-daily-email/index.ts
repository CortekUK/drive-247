/**
 * revenue-optimiser-daily-email — Spec §8.8.
 *
 * Daily cron after `revenue-optimiser-generate`. For each tenant with ≥1 pending
 * recommendation today, emails the tenant admin (Resend, tenant branding) with:
 *   - Headline: "Your fleet this morning — N opportunities worth +$X/mo"
 *   - Bullet list of top recommendations
 *   - Link back to /revenue
 *   - This week's outcomes summary if any new ones landed
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  sendResendEmail,
  getTenantBranding,
  wrapWithBrandedTemplate,
} from "../_shared/resend-service.ts";

interface SettingsRow {
  tenant_id: string;
  notify_daily_summary: boolean;
  enabled: boolean;
}

interface TenantRow {
  id: string;
  admin_email: string | null;
  contact_email: string | null;
  company_name: string | null;
  slug: string | null;
}

interface RecRow {
  id: string;
  recommended_price: number;
  current_price: number;
  projected_revenue_delta_monthly: number | null;
  confidence: string;
  vehicle: { reg: string | null; make: string | null; model: string | null } | null;
}

interface OutcomeRow {
  outcome: string;
  net_revenue_delta: number | null;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: settingsRaw } = await supabase
      .from("revenue_optimiser_settings")
      .select("tenant_id, notify_daily_summary, enabled")
      .eq("enabled", true)
      .eq("notify_daily_summary", true);
    const settings = (settingsRaw ?? []) as SettingsRow[];

    const summary = { tenants: settings.length, emails_sent: 0, emails_skipped: 0, errors: [] as string[] };
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);

    for (const s of settings) {
      try {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("id, admin_email, contact_email, company_name, slug")
          .eq("id", s.tenant_id)
          .maybeSingle();
        const t = tenant as TenantRow | null;
        const toEmail = t?.admin_email ?? t?.contact_email;
        if (!t || !toEmail) {
          summary.emails_skipped++;
          continue;
        }

        const { data: recsRaw } = await supabase
          .from("pricing_recommendations")
          .select("id, recommended_price, current_price, projected_revenue_delta_monthly, confidence, vehicle:vehicles(reg, make, model)")
          .eq("tenant_id", s.tenant_id)
          .eq("status", "pending")
          .gte("created_at", todayStart.toISOString())
          .order("projected_revenue_delta_monthly", { ascending: false })
          .limit(8);
        const recs = (recsRaw ?? []) as unknown as RecRow[];

        if (recs.length === 0) {
          summary.emails_skipped++;
          continue;
        }

        const totalProjected = recs.reduce(
          (sum, r) => sum + Number(r.projected_revenue_delta_monthly ?? 0),
          0,
        );

        // Outcomes that landed in the last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const { data: outcomesRaw } = await supabase
          .from("pricing_recommendation_outcomes")
          .select("outcome, net_revenue_delta")
          .eq("tenant_id", s.tenant_id)
          .gte("measured_at", sevenDaysAgo);
        const outcomes = (outcomesRaw ?? []) as OutcomeRow[];
        const positiveCount = outcomes.filter((o) => o.outcome === "positive").length;
        const totalDelta = outcomes.reduce((sum, o) => sum + Number(o.net_revenue_delta ?? 0), 0);

        const branding = await getTenantBranding(s.tenant_id, supabase);
        const portalBase = `https://${t.slug ?? "app"}.portal.drive-247.com`;

        const bulletRows = recs.map((r) => {
          const v = r.vehicle;
          const direction = r.recommended_price >= r.current_price ? "+" : "-";
          const diff = Math.abs(r.recommended_price - r.current_price);
          return `
            <li style="margin-bottom:8px;">
              <strong>${v?.make ?? ""} ${v?.model ?? ""}</strong>${v?.reg ? ` · ${v.reg}` : ""} —
              Weekly ${fmtMoney(r.current_price)} → ${fmtMoney(r.recommended_price)}
              <span style="color:#16a34a;">(${direction}${fmtMoney(diff)} per booking)</span>
              ${r.projected_revenue_delta_monthly ? ` · ${fmtMoney(Number(r.projected_revenue_delta_monthly))}/mo projected` : ""}
              <span style="color:#737373;font-size:12px;"> · ${r.confidence} confidence</span>
            </li>`;
        }).join("");

        const outcomesBlock = outcomes.length > 0 ? `
          <p style="margin-top:24px;font-size:13px;color:#404040;">
            <strong>This week's outcomes:</strong>
            ${positiveCount} of ${outcomes.length} measured applies were positive.
            Net measured impact: <strong style="color:${totalDelta >= 0 ? "#16a34a" : "#dc2626"};">${fmtMoney(totalDelta)}</strong>.
          </p>` : "";

        const inner = `
          <tr><td style="padding:30px;color:#333;line-height:1.6;font-size:15px;">
            <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#080812;">
              Your fleet this morning — ${recs.length} opportunit${recs.length === 1 ? "y" : "ies"} worth ${fmtMoney(totalProjected)}/mo projected.
            </p>
            <p style="margin:0 0 16px;">
              Revenue Optimiser found ${recs.length} pricing opportunit${recs.length === 1 ? "y" : "ies"} for ${t.company_name ?? "your fleet"}:
            </p>
            <ul style="margin:0;padding-left:18px;color:#404040;font-size:14px;">${bulletRows}</ul>
            <p style="margin-top:24px;">
              <a href="${portalBase}/revenue"
                 style="display:inline-block;background:#6366f1;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:500;">
                Review and apply
              </a>
            </p>
            ${outcomesBlock}
            <p style="margin-top:24px;font-size:11px;color:#737373;">
              Recommendations are computed from your fleet's own history. Each one stays valid for 7 days.
              You can mute the daily summary in Revenue Optimiser → Settings.
            </p>
          </td></tr>`;
        const html = wrapWithBrandedTemplate(inner, branding);

        const result = await sendResendEmail(
          {
            to: toEmail,
            subject: `Your fleet this morning — ${recs.length} opportunit${recs.length === 1 ? "y" : "ies"} worth ${fmtMoney(totalProjected)}/mo`,
            html,
            tenantId: s.tenant_id,
            replyTo: branding.contactEmail,
          },
          supabase,
        );
        if (result.success) {
          summary.emails_sent++;
        } else {
          summary.errors.push(`${s.tenant_id}: ${result.error}`);
        }
      } catch (err) {
        summary.errors.push(`${s.tenant_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("revenue-optimiser-daily-email error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
