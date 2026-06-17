// platform-rental-notify
// Fired by the AFTER INSERT trigger on public.rentals (via pg_net).
// Sends the super-admin a per-rental "verdict" email summarising whether the
// tenant's integrations were live-ready at the moment the rental was created.
//
// Auth: verify_jwt = false. Internal caller proves itself with the
// x-platform-secret header, verified against private.platform_config via the
// platform_verify_secret() RPC (service-role only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { sendResendEmail } from "../_shared/resend-service.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALERT_EMAIL = Deno.env.get("PLATFORM_ALERT_EMAIL") ?? "ilyasghulam35@gmail.com";
const ADMIN_APP_URL = (Deno.env.get("ADMIN_APP_URL") ?? "https://admin.drive-247.com").replace(/\/$/, "");

type Severity = "ok" | "warning" | "critical";

const SEV = {
  ok:       { emoji: "🟢", label: "All systems live", color: "#16a34a", bg: "#ecfdf5" },
  warning:  { emoji: "🟡", label: "Needs attention",  color: "#d97706", bg: "#fffbeb" },
  critical: { emoji: "🔴", label: "Action required",  color: "#dc2626", bg: "#fef2f2" },
} as const;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

function integrationRow(name: string, ok: boolean, detail: string) {
  const dot = ok ? "🟢" : "🔴";
  const color = ok ? "#16a34a" : "#dc2626";
  return `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#080812;">${dot}&nbsp;${esc(name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:${color};text-align:right;font-weight:600;">${esc(detail)}</td>
    </tr>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // --- authenticate the internal caller ---
  const secret = req.headers.get("x-platform-secret") ?? "";
  const { data: authorized, error: authErr } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
  if (authErr || authorized !== true) {
    return new Response("Unauthorized", { status: 401 });
  }

  // --- input ---
  let rentalId: string | undefined;
  try { rentalId = (await req.json())?.rental_id; } catch { /* ignore */ }
  if (!rentalId) return new Response("rental_id required", { status: 400 });

  // --- fetch the rental + related context ---
  const { data: rental, error } = await supabase
    .from("rentals")
    .select(`
      id, rental_number, status, payment_status, source, rental_period_type,
      start_date, end_date, created_at, health_severity, creation_context,
      tenant:tenants ( id, company_name, slug, tenant_type ),
      customer:customers ( name, email, phone ),
      vehicle:vehicles ( make, model, year, reg )
    `)
    .eq("id", rentalId)
    .single();

  if (error || !rental) {
    console.error("rental fetch failed", error);
    return new Response("rental not found", { status: 404 });
  }

  const tenant = (rental as any).tenant ?? {};
  const customer = (rental as any).customer ?? {};
  const vehicle = (rental as any).vehicle ?? {};
  const ctx = (rental as any).creation_context ?? {};
  const severity: Severity = (rental.health_severity as Severity) ?? "ok";
  const sev = SEV[severity] ?? SEV.ok;

  const reasons: string[] = Array.isArray(ctx.reasons) ? ctx.reasons : [];
  const company = tenant.company_name ?? "Unknown tenant";
  const ref = rental.rental_number ?? rental.id?.slice(0, 8);
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle";

  const headline =
    severity === "ok"
      ? "all systems live"
      : reasons[0] ?? `${reasons.length || "an"} issue at creation`;

  const subject = `${sev.emoji} [Drive247] ${company} · ${ref} · ${headline}`;

  // per-integration block from the frozen snapshot
  const s = ctx.stripe ?? {}, b = ctx.boldsign ?? {}, z = ctx.bonzah ?? {}, u = ctx.subscription ?? {};
  const integrations = [
    integrationRow("Stripe Connect", !!s.live_ready, s.live_ready ? "live" : `${s.mode ?? "?"}${s.onboarding_complete ? "" : " · onboarding incomplete"}`),
    integrationRow("BoldSign e-sign", !!b.live_ready, b.live_ready ? "live" : `${b.rental_mode ?? b.tenant_mode ?? "?"}${b.has_live_brand ? "" : " · no live brand"}`),
    z.enabled
      ? integrationRow("Bonzah insurance", !!z.live_ready, z.live_ready ? "live" : `${z.mode ?? "?"}${z.insurance_on_rental ? " · policy purchased" : ""}`)
      : integrationRow("Bonzah insurance", true, "not in use"),
    integrationRow("Subscription", !!u.ok, u.ok ? `${u.plan ?? "active"} · live` : `${u.status ?? "none"}`),
  ].join("");

  const reasonsBlock = reasons.length
    ? `<div style="margin:18px 0 0;padding:14px 16px;background:${sev.bg};border-radius:10px;">
         <div style="font-size:12px;font-weight:700;color:${sev.color};text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Why this needs your eyes</div>
         <ul style="margin:0;padding-left:18px;color:#404040;font-size:13px;line-height:1.7;">
           ${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}
         </ul>
       </div>`
    : `<div style="margin:18px 0 0;padding:14px 16px;background:${sev.bg};border-radius:10px;font-size:13px;color:${sev.color};font-weight:600;">✅ Every integration was live-ready at creation. Nothing to do.</div>`;

  const html = `
  <!DOCTYPE html><html><head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:'DM Sans',-apple-system,Segoe UI,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #f1f5f9;border-radius:16px;overflow:hidden;">
          <!-- verdict banner -->
          <tr><td style="background:${sev.bg};padding:22px 28px;border-bottom:1px solid #f1f5f9;">
            <div style="font-size:13px;color:#737373;letter-spacing:.5px;text-transform:uppercase;">Platform rental monitor</div>
            <div style="font-size:22px;font-weight:700;color:${sev.color};margin-top:4px;">${sev.emoji}&nbsp;${esc(sev.label)}</div>
          </td></tr>
          <!-- rental summary -->
          <tr><td style="padding:24px 28px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#080812;">
              <tr><td style="padding:6px 0;color:#737373;width:130px;">Tenant</td><td style="padding:6px 0;font-weight:600;">${esc(company)}${tenant.tenant_type ? ` <span style="color:#737373;font-weight:400;">(${esc(tenant.tenant_type)})</span>` : ""}</td></tr>
              <tr><td style="padding:6px 0;color:#737373;">Rental ref</td><td style="padding:6px 0;font-weight:600;">${esc(ref)}</td></tr>
              <tr><td style="padding:6px 0;color:#737373;">Customer</td><td style="padding:6px 0;">${esc(customer.name ?? "—")}${customer.email ? ` · ${esc(customer.email)}` : ""}</td></tr>
              <tr><td style="padding:6px 0;color:#737373;">Vehicle</td><td style="padding:6px 0;">${esc(vehicleName)}${vehicle.reg ? ` · ${esc(vehicle.reg)}` : ""}</td></tr>
              <tr><td style="padding:6px 0;color:#737373;">Dates</td><td style="padding:6px 0;">${esc(fmtDate(rental.start_date))} → ${esc(fmtDate(rental.end_date))}</td></tr>
              <tr><td style="padding:6px 0;color:#737373;">Status</td><td style="padding:6px 0;">${esc(rental.status ?? "—")}${rental.payment_status ? ` · payment ${esc(rental.payment_status)}` : ""}${rental.source ? ` · via ${esc(rental.source)}` : ""}</td></tr>
            </table>
          </td></tr>
          <!-- integrations -->
          <tr><td style="padding:8px 28px 0;">
            <div style="font-size:12px;font-weight:700;color:#080812;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Integration readiness at creation</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${integrations}</table>
          </td></tr>
          <!-- reasons -->
          <tr><td style="padding:0 28px;">${reasonsBlock}</td></tr>
          <!-- cta -->
          <tr><td style="padding:24px 28px 28px;">
            <a href="${ADMIN_APP_URL}/admin/platform-rentals?ref=${encodeURIComponent(ref ?? "")}"
               style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px;">
               View in super admin →</a>
          </td></tr>
          <tr><td style="padding:0 28px 26px;font-size:11px;color:#9ca3af;">
            Automated alert from the Drive247 platform monitor · sent on every rental creation across all tenants.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;

  const result = await sendResendEmail(
    { to: ALERT_EMAIL, subject, html, fromName: "Drive247 Platform" },
    supabase,
  );

  return new Response(JSON.stringify({ ok: result.success, severity, simulated: result.simulated ?? false }), {
    headers: { "Content-Type": "application/json" },
    status: result.success ? 200 : 502,
  });
});
