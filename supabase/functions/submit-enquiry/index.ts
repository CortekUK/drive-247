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
  // Honeypot — bots tend to fill every field
  hpField?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DESCRIPTION = 2000;
const RATE_LIMIT_PER_HOUR = 5;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const body = (await req.json()) as EnquiryPayload;

    // ── Honeypot ─────────────────────────────────────────────────────────────
    if (body.hpField && body.hpField.trim().length > 0) {
      // Silent success — don't tell the bot it was caught
      return jsonResponse({ success: true });
    }

    // ── Resolve tenant ───────────────────────────────────────────────────────
    const slug = req.headers.get("x-tenant-slug") || body.tenantSlug || "";
    if (!slug) return errorResponse("Tenant could not be determined");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, slug, enquiries_enabled, admin_email, company_name")
      .eq("slug", slug.toLowerCase().trim())
      .maybeSingle();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found", 404);
    }
    if (tenant.enquiries_enabled === false) {
      return errorResponse("Enquiries are not accepted at this time", 409);
    }

    // ── Validate ────────────────────────────────────────────────────────────
    const name = (body.name ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = (body.phone ?? "").trim();
    const description = (body.description ?? "").trim();
    const startDate = (body.startDate ?? "").trim();
    const endDate = (body.endDate ?? "").trim();
    const vehicleId = body.vehicleId ?? null;
    const source = body.source === "customer_portal" ? "customer_portal" : "booking_site";

    if (!name) return errorResponse("Name is required");
    if (!email) return errorResponse("Email is required");
    if (!EMAIL_RE.test(email)) return errorResponse("Email is invalid");
    if (!phone) return errorResponse("Phone is required");
    if (!description) return errorResponse("Description is required");
    if (description.length > MAX_DESCRIPTION) {
      return errorResponse(`Description must be at most ${MAX_DESCRIPTION} characters`);
    }
    if (!ISO_DATE_RE.test(startDate) || !ISO_DATE_RE.test(endDate)) {
      return errorResponse("Start and end dates must be ISO format (YYYY-MM-DD)");
    }
    if (endDate < startDate) {
      return errorResponse("End date must be on or after start date");
    }

    // Vehicle (if provided) must belong to the same tenant and not be archived
    if (vehicleId) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, tenant_id, status")
        .eq("id", vehicleId)
        .maybeSingle();
      if (!vehicle || vehicle.tenant_id !== tenant.id) {
        return errorResponse("Selected vehicle is not available", 400);
      }
    }

    // ── IP & rate-limit ─────────────────────────────────────────────────────
    const fwd = req.headers.get("x-forwarded-for") || "";
    const ipAddress = fwd.split(",")[0]?.trim() || null;
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;

    if (ipAddress) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("enquiries")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ipAddress)
        .gte("created_at", since);

      if (count !== null && count >= RATE_LIMIT_PER_HOUR) {
        return errorResponse(
          "Too many enquiries from this address. Please try again later.",
          429,
        );
      }
    }

    // ── Try to link to an existing customer for this tenant ─────────────────
    let customerId: string | null = null;
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("email", email)
      .eq("tenant_id", tenant.id)
      .limit(1)
      .maybeSingle();
    if (existingCustomer?.id) customerId = existingCustomer.id;

    // ── Insert enquiry ──────────────────────────────────────────────────────
    const { data: inserted, error: insertError } = await supabase
      .from("enquiries")
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        vehicle_id: vehicleId,
        start_date: startDate,
        end_date: endDate,
        description,
        status: "new",
        source,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      console.error("submit-enquiry insert error:", insertError);
      return errorResponse("Failed to save enquiry. Please try again.", 500);
    }

    // ── Broadcast notification to tenant staff ──────────────────────────────
    const titleSnippet = name.length > 60 ? name.slice(0, 57) + "..." : name;
    const messageSnippet = description.length > 140
      ? description.slice(0, 137) + "..."
      : description;

    const { error: notifyError } = await supabase.from("notifications").insert({
      user_id: null,
      tenant_id: tenant.id,
      title: `New enquiry from ${titleSnippet}`,
      message: messageSnippet,
      type: "enquiry",
      link: `/enquiries?id=${inserted.id}`,
      metadata: {
        enquiryId: inserted.id,
        vehicleId: vehicleId ?? null,
        customerEmail: email,
        startDate,
        endDate,
      },
    });
    if (notifyError) {
      console.error("submit-enquiry notification insert failed (non-fatal):", notifyError);
    }

    // ── Optional staff email (fire-and-forget) ──────────────────────────────
    if (tenant.admin_email) {
      try {
        await supabase.functions.invoke("aws-ses-email", {
          body: {
            to: tenant.admin_email,
            subject: `New enquiry — ${name}`,
            html: `
              <p>You have received a new enquiry from your booking site.</p>
              <p><strong>Name:</strong> ${escapeHtml(name)}<br/>
              <strong>Email:</strong> ${escapeHtml(email)}<br/>
              <strong>Phone:</strong> ${escapeHtml(phone)}<br/>
              <strong>Requested dates:</strong> ${escapeHtml(startDate)} → ${escapeHtml(endDate)}</p>
              <p><strong>Message:</strong><br/>${escapeHtml(description).replace(/\n/g, "<br/>")}</p>
              <p>Open in the portal to respond.</p>
            `,
          },
        });
      } catch (emailErr) {
        console.error("submit-enquiry admin email failed (non-fatal):", emailErr);
      }
    }

    return jsonResponse({ success: true, enquiryId: inserted.id });
  } catch (error) {
    console.error("submit-enquiry function error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500,
    );
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
