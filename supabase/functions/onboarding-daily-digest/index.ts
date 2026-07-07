// onboarding-daily-digest
// Daily email to the Drive247 team listing every production tenant that is
// not yet fully onboarded, with the state of all 8 checklist items.
// Recipients come from admin_settings.onboarding_digest_emails.
//
// Auth: verify_jwt = false. Callers prove themselves either with the
// x-platform-secret header (pg_cron) or a super-admin JWT ("send now" button).

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";

const ADMIN_APP_URL = (Deno.env.get("ADMIN_APP_URL") ?? "https://admin.drive-247.com").replace(/\/$/, "");

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

interface OnboardingRow {
  tenant_id: string;
  slug: string;
  company_name: string;
  contact_email: string | null;
  created_at: string;
  branding_done: boolean;
  subscription_done: boolean;
  bonzah_done: boolean;
  bonzah_form_submitted: boolean;
  bonzah_form_status: string | null;
  brandon_sent: boolean;
  excluded: boolean;
}

const ITEMS: { key: keyof OnboardingRow; label: string }[] = [
  { key: "branding_done", label: "Branding" },
  { key: "subscription_done", label: "Subscription" },
  { key: "bonzah_done", label: "Bonzah" },
];

const doneCount = (r: OnboardingRow) => ITEMS.filter((i) => r[i.key] === true).length;
const isFullyOnboarded = (r: OnboardingRow) => doneCount(r) === ITEMS.length;

function cell(ok: boolean): string {
  return `<td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;">${ok ? "✅" : "❌"}</td>`;
}

function buildDigestHtml(pending: OnboardingRow[], onboardedCount: number): string {
  const headerCells = ITEMS.map(
    (i) =>
      `<th style="padding:8px 6px;border-bottom:2px solid #e0e7ff;background:#eef2ff;font-size:10px;color:#3f3f82;text-transform:uppercase;letter-spacing:0.03em;white-space:nowrap;">${esc(i.label)}</th>`,
  ).join("");

  const rows = pending
    .map((r) => {
      const n = doneCount(r);
      const daysOld = Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000));
      return `
      <tr>
        <td style="padding:8px 10px 8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#080812;white-space:nowrap;">
          <strong>${esc(r.company_name)}</strong><br/>
          <span style="font-size:11px;color:#737373;">${esc(r.slug)} · ${daysOld}d old</span>
        </td>
        ${ITEMS.map((i) => cell(r[i.key] === true)).join("")}
        <td style="padding:8px 6px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px;font-weight:700;color:${n >= ITEMS.length ? "#16a34a" : n >= 2 ? "#d97706" : "#dc2626"};white-space:nowrap;">${n}/${ITEMS.length}</td>
      </tr>`;
    })
    .join("");

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;background:#ffffff;">
    <div style="background:#0f172a;border-radius:10px;padding:20px 24px;">
      <h1 style="margin:0;font-size:18px;color:#ffffff;">Drive247 · Onboarding Status</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#c8c8dc;">
        ${pending.length} tenant${pending.length === 1 ? "" : "s"} still in onboarding · ${onboardedCount} fully onboarded
      </p>
    </div>

    ${
      pending.length === 0
        ? `<p style="margin-top:24px;font-size:14px;color:#16a34a;font-weight:600;">🎉 Every tenant is fully onboarded — nothing pending today.</p>`
        : `
    <div style="overflow-x:auto;margin-top:20px;">
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="padding:8px 10px 8px 0;border-bottom:2px solid #e0e7ff;background:#eef2ff;font-size:10px;color:#3f3f82;text-transform:uppercase;text-align:left;">Tenant</th>
            ${headerCells}
            <th style="padding:8px 6px;border-bottom:2px solid #e0e7ff;background:#eef2ff;font-size:10px;color:#3f3f82;text-transform:uppercase;">Progress</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
    }

    <p style="margin-top:24px;">
      <a href="${ADMIN_APP_URL}/admin/onboarding" style="display:inline-block;background:#6366f1;color:#ffffff;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Open Onboarding Dashboard</a>
    </p>
    <p style="margin-top:16px;font-size:11px;color:#737373;">
      Sent daily by the Drive247 platform. Manage recipients on the admin Onboarding page.
    </p>
  </div>`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- authenticate: platform secret (cron) or super-admin JWT (manual) ---
    let authorized = false;
    const secret = req.headers.get("x-platform-secret");
    if (secret) {
      const { data: ok, error: rpcError } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      if (rpcError) console.error("platform_verify_secret rpc failed", rpcError);
      authorized = ok === true;
    }
    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const supabaseAuth = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        const { data: { user } } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) {
          const { data: appUser } = await supabase
            .from("app_users")
            .select("is_super_admin")
            .eq("auth_user_id", user.id)
            .single();
          authorized = appUser?.is_super_admin === true;
        }
      }
    }
    if (!authorized) return errorResponse("Unauthorized", 401);

    // --- recipients ---
    const { data: settings } = await supabase
      .from("admin_settings")
      .select("onboarding_digest_emails")
      .limit(1)
      .single();
    const recipients: string[] = (settings?.onboarding_digest_emails ?? []).filter(Boolean);
    if (recipients.length === 0) {
      return jsonResponse({ success: false, message: "No digest recipients configured" });
    }

    // --- status rows ---
    const { data: rows, error } = await supabase
      .from("v_tenant_onboarding_status")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const all = (rows ?? []) as OnboardingRow[];
    const tracked = all.filter((r) => !r.excluded);
    const pending = tracked.filter((r) => !isFullyOnboarded(r));
    const onboardedCount = tracked.length - pending.length;

    const today = new Date().toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
    const result = await sendResendEmail({
      to: recipients,
      subject: `Onboarding Status ${today} — ${pending.length} tenant${pending.length === 1 ? "" : "s"} pending`,
      html: buildDigestHtml(pending, onboardedCount),
      fromName: "Drive247 Onboarding",
    });

    if (!result.success) {
      return errorResponse(`Email failed: ${result.error || "unknown error"}`, 500);
    }

    return jsonResponse({
      success: true,
      recipients,
      pending: pending.length,
      onboarded: onboardedCount,
      simulated: result.simulated ?? false,
    });
  } catch (err) {
    console.error("onboarding-daily-digest error", err);
    return errorResponse(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});
