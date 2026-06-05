/**
 * submit-enquiry — REPOINTED to write into `leads` per Spec Section 8.2 + 9.1.
 *
 * The quick-enquiry path is the lighter alternative to /apply (no driver details,
 * no documents, no financial info — just contact + dates + free-text description).
 * Both write to the same `leads` table; differentiated by `source` column:
 *   - source='application' — full 7-step Apply form (submit-application)
 *   - source='quick_enquiry' — this function
 *
 * Behaviour:
 *  - Honeypot check (silent success)
 *  - Tenant resolution by slug; rejects if lead_management_enabled = false
 *  - Lightweight validation
 *  - Rate-limit by IP (5/hour, mirrors prior pattern, now using leads.ip_address)
 *  - Dedup: if same tenant + (phone or email) has a non-terminal lead, append submission
 *  - Insert lead with stage='new', source='quick_enquiry'
 *  - Insert conversation row
 *  - lead.created emits automatically via DB trigger
 *  - Tenant admin notification (broadcast + email — kept for parity with old behaviour)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface EnquiryPayload {
  tenantSlug?: string;
  name?: string;
  email?: string;
  phone?: string;
  vehicleId?: string | null;
  startDate?: string;
  endDate?: string;
  description?: string;
  source?: "booking_site" | "customer_portal";
  hpField?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DESCRIPTION = 2000;
const RATE_LIMIT_PER_HOUR = 5;

const NON_TERMINAL_STAGES = [
  "new",
  "contacted",
  "docs_requested",
  "docs_submitted",
  "docs_verified",
  "docs_failed",
  "approved",
  "vehicle_offered",
  "offer_accepted",
  "agreement_sent",
  "agreement_signed",
  "deposit_paid",
  "pickup_scheduled",
  "waitlist",
];

function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as EnquiryPayload;

    if (body.hpField && body.hpField.trim().length > 0) {
      return jsonResponse({ success: true, leadId: null });
    }

    const slug = (req.headers.get("x-tenant-slug") || body.tenantSlug || "").toLowerCase().trim();
    if (!slug) return errorResponse("Tenant could not be determined");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, slug, lead_management_enabled, enquiries_enabled, admin_email, company_name")
      .eq("slug", slug)
      .maybeSingle();

    if (tErr || !tenant) return errorResponse("Tenant not found", 404);
    // Accept if either flag is enabled — lead_management_enabled supersedes enquiries_enabled.
    // Reject only if both are explicitly off.
    if (tenant.lead_management_enabled === false && tenant.enquiries_enabled === false) {
      return errorResponse("Enquiries are not accepted at this time", 409);
    }

    const name = (body.name ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = (body.phone ?? "").trim();
    const description = (body.description ?? "").trim();
    const startDate = (body.startDate ?? "").trim();
    const endDate = (body.endDate ?? "").trim();
    const vehicleId = body.vehicleId ?? null;
    const sourceMeta = body.source === "customer_portal" ? "customer_portal" : "booking_site";

    if (!name) return errorResponse("Name is required");
    if (!email || !EMAIL_RE.test(email)) return errorResponse("Valid email is required");
    if (!phone) return errorResponse("Phone is required");
    if (!description) return errorResponse("Description is required");
    if (description.length > MAX_DESCRIPTION) {
      return errorResponse(`Description must be at most ${MAX_DESCRIPTION} characters`);
    }
    if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
      return errorResponse("Start and end dates must be ISO format (YYYY-MM-DD)");
    }
    if (endDate < startDate) return errorResponse("End date must be on or after start date");

    if (vehicleId) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, tenant_id")
        .eq("id", vehicleId)
        .maybeSingle();
      if (!vehicle || vehicle.tenant_id !== tenant.id) {
        return errorResponse("Selected vehicle is not available", 400);
      }
    }

    const fwd = req.headers.get("x-forwarded-for") || "";
    const ipAddress = fwd.split(",")[0]?.trim() || null;
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;

    if (ipAddress) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ipAddress)
        .gte("created_at", since);
      if (count !== null && count >= RATE_LIMIT_PER_HOUR) {
        return errorResponse("Too many enquiries from this address. Please try again later.", 429);
      }
    }

    // Try to link to existing customer (preserve prior behaviour)
    let customerId: string | null = null;
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("email", email)
      .eq("tenant_id", tenant.id)
      .limit(1)
      .maybeSingle();
    if (existingCustomer?.id) customerId = existingCustomer.id;

    const applicationData = {
      description,
      submissions: [{ submittedAt: new Date().toISOString(), source: "quick_enquiry", sourceMeta }],
    };

    // Dedup
    const phoneNorm = normalisePhone(phone);
    const { data: existing } = await supabase
      .from("leads")
      .select("id, application_data")
      .eq("tenant_id", tenant.id)
      .or(`phone_normalised.eq.${phoneNorm},email_lower.eq.${email}`)
      .in("stage", NON_TERMINAL_STAGES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const data = (existing.application_data ?? {}) as Record<string, unknown>;
      const submissions = Array.isArray(data.submissions)
        ? [...(data.submissions as unknown[])]
        : [];
      submissions.push({
        submittedAt: new Date().toISOString(),
        source: "quick_enquiry",
        sourceMeta,
        payload: { description, startDate, endDate, vehicleId },
      });
      await supabase
        .from("leads")
        .update({
          application_data: { ...data, submissions },
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      return jsonResponse({ success: true, leadId: existing.id, status: "duplicate_merged" });
    }

    // Insert new lead
    const { data: inserted, error: insertErr } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        full_name: name,
        email,
        phone,
        application_data: applicationData,
        vehicle_id: vehicleId,
        start_date: startDate,
        end_date: endDate,
        stage: "new",
        source: "quick_enquiry",
        source_metadata: { channel: sourceMeta },
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("submit-enquiry leads insert error:", insertErr);
      return errorResponse("Failed to save enquiry. Please try again.", 500);
    }

    // Insert conversation
    await supabase.from("conversations").insert({
      tenant_id: tenant.id,
      lead_id: inserted.id,
    });

    // Insert lead_activity
    await supabase.from("lead_activity").insert({
      tenant_id: tenant.id,
      lead_id: inserted.id,
      actor_type: "lead",
      event_type: "quick_enquiry_submitted",
      payload: { sourceMeta, vehicleId, startDate, endDate },
    });

    // Broadcast notification to tenant staff (preserve prior behaviour; route to /leads now)
    const titleSnippet = name.length > 60 ? name.slice(0, 57) + "..." : name;
    const messageSnippet = description.length > 140 ? description.slice(0, 137) + "..." : description;
    await supabase.from("notifications").insert({
      user_id: null,
      tenant_id: tenant.id,
      title: `New enquiry from ${titleSnippet}`,
      message: messageSnippet,
      type: "enquiry",
      link: `/leads/${inserted.id}`,
      metadata: {
        leadId: inserted.id,
        vehicleId: vehicleId ?? null,
        customerEmail: email,
        startDate,
        endDate,
      },
    });

    // Optional admin email via Resend (fire-and-forget — never block the response)
    if (tenant.admin_email) {
      try {
        const { sendResendEmail, getTenantBranding, wrapWithBrandedTemplate } = await import("../_shared/resend-service.ts");
        const branding = await getTenantBranding(tenant.id, supabase);
        const inner = `
          <tr><td style="padding:30px;color:#333;line-height:1.6;font-size:15px;">
            <p>You have received a new enquiry from your booking site.</p>
            <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
            <strong>Email:</strong> ${escapeHtml(email)}<br/>
            <strong>Phone:</strong> ${escapeHtml(phone)}<br/>
            <strong>Requested dates:</strong> ${escapeHtml(startDate)} → ${escapeHtml(endDate)}</p>
            <p><strong>Message:</strong><br/>${escapeHtml(description).replace(/\n/g, "<br/>")}</p>
            <p>Open in the portal to respond.</p>
          </td></tr>`;
        const html = wrapWithBrandedTemplate(inner, branding);
        await sendResendEmail(
          {
            to: tenant.admin_email,
            subject: `New enquiry — ${name}`,
            html,
            tenantId: tenant.id,
          },
          supabase,
        );
      } catch (emailErr) {
        console.error("submit-enquiry admin email failed (non-fatal):", emailErr);
      }
    }

    return jsonResponse({ success: true, leadId: inserted.id, enquiryId: inserted.id });
  } catch (error) {
    console.error("submit-enquiry function error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
  }
});
