// send-bonzah-form-to-brandon
// Emails a tenant's latest Bonzah onboarding form submission (all sections +
// links to uploaded files) to the Bonzah contact (Brandon), then stamps
// brandon_sent_at on the tenant's onboarding checklist.
//
// Auth: JWT required; caller must be a super admin.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const fmt = (v: unknown) =>
  v === undefined || v === null || v === "" ? "—" : String(v);

type Entry = [string, unknown];

function sectionRows(entries: Entry[]): string {
  return entries
    .map(
      ([label, value]) => `
    <tr>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#737373;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#080812;">${esc(fmt(value))}</td>
    </tr>`,
    )
    .join("");
}

function fileLinks(files: { url?: string; name?: string }[] | undefined, title: string): string {
  if (!Array.isArray(files) || files.length === 0) return "";
  const items = files
    .map(
      (f) =>
        `<li style="font-size:13px;padding:2px 0;"><a href="${esc(f.url)}" style="color:#6366f1;">${esc(f.name || "file")}</a></li>`,
    )
    .join("");
  return `<p style="margin:10px 0 2px;font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;">${esc(title)}</p><ul style="margin:2px 0 0;padding-left:18px;">${items}</ul>`;
}

function section(title: string, entries: Entry[], extras = ""): string {
  return `
  <div style="margin-top:24px;">
    <div style="background:#eef2ff;padding:8px 12px;border-radius:6px;font-size:13px;font-weight:700;color:#3f3f82;text-transform:uppercase;letter-spacing:0.04em;">${esc(title)}</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px;">${sectionRows(entries)}</table>
    ${extras}
  </div>`;
}

function longText(title: string, value: unknown): string {
  if (!value) return "";
  return `<p style="margin:10px 0 2px;font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;">${esc(title)}</p><p style="margin:2px 0 0;font-size:13px;color:#080812;white-space:pre-wrap;">${esc(value)}</p>`;
}

function buildEmailHtml(submission: any, tenantName: string): string {
  const d = submission.data || {};
  const files = submission.file_urls || {};

  const additionalUsers: Entry[] = (Array.isArray(d.additional_users) ? d.additional_users : []).flatMap(
    (u: any, i: number): Entry[] => [
      [`Additional #${i + 1} — Name`, u.full_name],
      [`Additional #${i + 1} — Email`, u.email],
      [`Additional #${i + 1} — Phone`, u.phone],
      [`Additional #${i + 1} — DOB`, u.date_of_birth],
      [`Additional #${i + 1} — Years Driving`, u.years_driving],
      [`Additional #${i + 1} — Marital Status`, u.marital_status],
    ],
  );

  const body = [
    section(
      "Business",
      [
        ["Trade Name", d.business_trade_name],
        ["Legal Name", d.business_legal_name],
        ["Business Address", d.business_address],
        ["City / State", `${d.city || ""} ${d.state || ""}`.trim()],
        ["Country / Postal", `${d.country || ""} ${d.postal_code || ""}`.trim()],
        ["Business Phone", d.business_phone],
        ["Alt. Phone", d.alternative_business_phone],
        ["EIN / Tax ID", d.ein],
        ["Company Type", d.company_type],
        ["Start Date", d.business_start_date],
        ["Website", d.company_website],
      ],
      fileLinks(files.business_logo, "Business Logo"),
    ),
    section(
      "Operations",
      [
        ["States Served", d.states_where_you_do_business],
        ["Licensed Everywhere", d.licensed_in_all_locations],
        ["Adheres to Auto Licensing", d.adhering_to_license_requirements],
        ["Years in Auto Rental", d.years_in_private_auto_rental],
        ["Years on Turo", d.years_on_turo],
      ],
      longText("Business Owners", d.business_owners),
    ),
    section(
      "Contacts",
      [
        ["Primary Name", `${d.primary_first_name || ""} ${d.primary_last_name || ""}`.trim()],
        ["Primary Email", d.primary_email],
        ["Primary Phone", d.primary_phone],
        ["Primary DOB", d.primary_date_of_birth],
        ["Primary Years Driving", d.primary_years_driving],
        ["Primary Marital Status", d.primary_marital_status],
        ...additionalUsers,
      ],
      fileLinks(files.driver_licenses, "Driver's Licenses") +
        fileLinks(files.additional_users_spreadsheet, "Additional Users Spreadsheet"),
    ),
    section("Banking", [
      ["Account Holder", d.bank_account_name],
      ["Account Type", d.bank_account_type],
      ["Bank", d.bank_name],
      ["Routing #", d.routing_number],
      ["Account #", d.account_number],
      ["Bank Address", d.bank_account_address],
      ["Card Number", d.credit_card_number],
      ["Card Expiry", d.card_expiration_date],
      ["Card CVC", d.card_security_code],
      ["Name on Card", d.card_name],
      ["Card Billing Address", d.card_billing_address],
      ["Starting Balance", d.desired_starting_balance],
      ["RMS", d.rental_management_system],
      ["Embed Bonzah on Site", d.explore_embedding_bonzah],
    ]),
    section(
      "Insurance",
      [
        ["Current Carrier", d.current_insurance_carrier],
        ["Rental Agreement Timestamp", d.rental_agreement_has_timestamp],
        ["Vehicles Have GPS", d.vehicles_have_gps],
        ["GPS Brand", d.gps_brand],
        ["Vehicles in Company Name", d.vehicles_registered_in_company_name],
        ["Salvage Vehicles", d.any_vehicles_salvage],
        ["For Hire / TNC", d.rent_for_hire],
        ["Used Outside Rentals", d.vehicles_used_outside_rentals],
        ["Had Commercial Auto Losses", d.had_commercial_auto_losses],
        ["Has Loss Summary", d.has_loss_summary],
      ],
      longText("What can we help you with?", d.what_can_we_help_with) +
        fileLinks(files.fleet_insurance_policy, "Fleet Insurance Policy") +
        fileLinks(files.rental_agreement_file, "Rental Agreement") +
        fileLinks(files.loss_runs_file, "Loss Runs") +
        fileLinks(files.vehicle_schedule_file, "Vehicle Schedule") +
        fileLinks(files.loss_history_file, "Loss History"),
    ),
    section(
      "Policies",
      [
        ["Drivers Need Valid License", d.require_drivers_valid_license],
        ["Check Employee Driving Records", d.check_employee_driving_records],
        ["Storage Security", d.vehicle_storage_security],
        ["Delivers / Picks Up", d.deliver_or_pickup],
        ["Min Age Renters", d.minimum_age_renters],
        ["Rents > 30 Days", d.rent_more_than_30_days],
        ["Avg Rental Duration", d.average_rental_duration],
        ["Photocopy Driver IDs", d.photocopy_driver_ids],
        ["Require Renter Insurance", d.require_renters_primary_insurance],
        ["Verify Renter Insurance", d.verify_renter_insurance],
        ["% Renters w/ Insurance", d.pct_renters_with_insurance],
        ["Retain Insurance Proof", d.retain_renter_insurance_proof],
      ],
      longText("Renter Screening Process", d.renter_screening_process) +
        longText("Stolen / Converted Vehicle", d.renter_stolen_vehicle) +
        longText("Payment Methods", d.payment_methods) +
        longText("Cash / App + Card on File", d.cash_app_card_on_file) +
        longText("OTC Insurance Products", d.offers_otc_insurance) +
        longText("Maintenance Program", d.vehicle_maintenance_program) +
        longText("Inspection Process", d.inspect_vehicles) +
        longText("Other Businesses", d.own_other_businesses) +
        longText("What Else?", d.what_else_should_we_know) +
        fileLinks(files.additional_information_file, "Additional Information"),
    ),
    section("Underwriting", [
      ["Accidents/Claims (3 yrs)", d.uw_accidents_past_3_years],
      ["Canceled Policy", d.uw_canceled_policy],
      ["Insurance Fraud Conviction", d.uw_insurance_fraud],
      ["DUI / Reckless / Multiple Violations", d.uw_dui_violations],
      ["Invalid License Drivers", d.uw_invalid_license_drivers],
      ["Salvage Title", d.uw_salvage_title],
      ["Performance Modified", d.uw_modified_for_performance],
      ["Used for Other Purposes", d.uw_other_use],
    ]),
    section("Signature", [
      ["Confirms Accuracy", d.declare_complete_accurate ? "Yes" : "—"],
      ["Confirms Authorization", d.declare_authorized ? "Yes" : "—"],
      ["Authorizes Bonzah", d.declare_authorize_bonzah ? "Yes" : "—"],
      ["Agrees to User Agreement", d.agree_user_agreement ? "Yes" : "—"],
    ]),
  ].join("");

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;background:#ffffff;">
    <div style="background:#0f172a;border-radius:10px;padding:20px 24px;">
      <h1 style="margin:0;font-size:18px;color:#ffffff;">Bonzah Business Partner Application</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#c8c8dc;">
        ${esc(submission.business_trade_name || tenantName)} · submitted ${esc(new Date(submission.submitted_at).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }))}
      </p>
    </div>
    ${body}
    <p style="margin-top:28px;font-size:12px;color:#737373;">Sent from the Drive247 platform on behalf of ${esc(tenantName)}.</p>
  </div>`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("is_super_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (appUser?.is_super_admin !== true) return errorResponse("Forbidden", 403);

    const { tenant_id } = await req.json();
    if (!tenant_id) return errorResponse("tenant_id required", 400);

    const { data: settings } = await supabase
      .from("admin_settings")
      .select("bonzah_brandon_email")
      .limit(1)
      .single();
    const brandonEmail = settings?.bonzah_brandon_email;
    if (!brandonEmail) {
      return errorResponse(
        "Brandon's email is not configured. Set it in the Onboarding page settings first.",
        400,
      );
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name, slug")
      .eq("id", tenant_id)
      .single();
    if (!tenant) return errorResponse("Tenant not found", 404);

    const { data: submission } = await supabase
      .from("bonzah_onboarding_submissions")
      .select("*")
      .eq("tenant_id", tenant_id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!submission) {
      return errorResponse("This tenant has not submitted a Bonzah onboarding form yet.", 400);
    }

    const html = buildEmailHtml(submission, tenant.company_name);
    const result = await sendResendEmail({
      to: brandonEmail,
      subject: `Bonzah Application — ${submission.business_trade_name || tenant.company_name}`,
      html,
      fromName: "Drive247 Onboarding",
    });

    if (!result.success) {
      return errorResponse(`Email failed: ${result.error || "unknown error"}`, 500);
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await supabase
      .from("tenant_onboarding_checklist")
      .upsert({ tenant_id, brandon_sent_at: now }, { onConflict: "tenant_id" });
    if (upsertError) console.error("checklist stamp failed", upsertError);

    return jsonResponse({ success: true, sent_to: brandonEmail, brandon_sent_at: now, simulated: result.simulated ?? false });
  } catch (err) {
    console.error("send-bonzah-form-to-brandon error", err);
    return errorResponse(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});
