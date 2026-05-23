/**
 * submit-application — Spec Section 6.2 + 9.3
 *
 * Public endpoint (verify_jwt = false) that accepts a 7-step Apply form payload and:
 *  1. Validates payload (lightweight Deno-side; mirrors apps/booking/src/client-schemas/apply.ts)
 *  2. Honeypot — silent success if `hpField` is non-empty
 *  3. Rate-limits by IP (5 per hour, mirrors enquiries pattern)
 *  4. Resolves tenant by slug; rejects if !lead_management_enabled
 *  5. Runs check-blacklist-match synchronously; on hard match → creates lead with stage='blacklisted'
 *     (no SMS sent; no triggers fire side-effects)
 *  6. Runs compute-lead-score; sets lead_score + score_band + score_reason
 *  7. Dedup: if existing non-terminal lead with same tenant + phone_normalised or email_lower,
 *     append submission to application_data.submissions[]; return status='duplicate_merged'
 *  8. Inserts leads row, lead_documents rows for uploaded files, conversations row
 *  9. Emits lead.application_submitted into automation_event_queue
 *     (lead.created emits automatically via DB trigger)
 * 10. Sends acknowledgement SMS via aws-sns-sms (hardcoded template for V1)
 *
 * Returns: { leadId, status: 'received' | 'duplicate_merged' | 'blacklisted' }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface ApplyPayload {
  tenantSlug?: string;
  // Step 1
  fullName?: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  // Step 2
  licenceNumber?: string;
  licenceState?: string;
  licenceExpiry?: string;
  yearsDriving?: number;
  hasViolations?: boolean;
  violationsDescription?: string;
  // Step 3
  purpose?: string;
  ridesharePlatforms?: string[];
  neededByDate?: string;
  rentalLengthTarget?: string;
  vehicleInterestType?: "specific" | "class" | "any";
  vehicleId?: string;
  vehicleClass?: string;
  startDate?: string;
  endDate?: string;
  // Step 4
  canPayDeposit?: boolean;
  depositComfortAmount?: number;
  weeklyBudget?: number;
  // Step 5
  rentedBefore?: boolean;
  rentedFromUsBefore?: boolean;
  rideshareAccountActive?: boolean;
  rideshareTier?: string;
  // Step 6
  licencePhotoUrl?: string;
  selfieUrl?: string;
  rideshareProofUrl?: string;
  // Step 7
  termsAccepted?: boolean;
  marketingConsent?: boolean;
  // Honeypot
  hpField?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_LIMIT_PER_HOUR = 5;

const NON_TERMINAL_STAGES_FOR_DEDUP = [
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

interface ServiceClient {
  from: (table: string) => any;
  storage: any;
  functions: { invoke: (fn: string, options: { body: unknown }) => Promise<unknown> };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as ApplyPayload;

    // 1. Honeypot — return 200 received but do nothing
    if (body.hpField && body.hpField.trim().length > 0) {
      return jsonResponse({ leadId: null, status: "received" });
    }

    // 2. Resolve tenant
    const slug = (req.headers.get("x-tenant-slug") || body.tenantSlug || "").toLowerCase().trim();
    if (!slug) return errorResponse("Tenant could not be determined");

    const supabase: ServiceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("id, slug, lead_management_enabled, company_name, admin_email")
      .eq("slug", slug)
      .maybeSingle();
    if (tErr || !tenant) return errorResponse("Tenant not found", 404);
    if (tenant.lead_management_enabled === false) return errorResponse("Applications are not accepted at this time", 403);

    // 3. Validate required fields
    const fullName = (body.fullName ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const phone = (body.phone ?? "").trim();

    if (!fullName || fullName.length < 2) return errorResponse("Full name is required");
    if (!email || !EMAIL_RE.test(email)) return errorResponse("Valid email is required");
    if (!phone) return errorResponse("Phone is required");
    if (!body.startDate || !ISO_DATE_RE.test(body.startDate)) return errorResponse("Start date is invalid");
    if (!body.endDate || !ISO_DATE_RE.test(body.endDate)) return errorResponse("End date is invalid");
    if (body.endDate < body.startDate) return errorResponse("End date must be on or after start date");
    if (body.termsAccepted !== true) return errorResponse("You must accept the terms");

    // 4. Vehicle (if specific) must belong to tenant
    if (body.vehicleInterestType === "specific" && body.vehicleId) {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, tenant_id")
        .eq("id", body.vehicleId)
        .maybeSingle();
      if (!vehicle || vehicle.tenant_id !== tenant.id) {
        return errorResponse("Selected vehicle is not available", 400);
      }
    }

    // 5. IP + rate-limit
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
        return errorResponse("Too many applications from this address. Please try again later.", 429);
      }
    }

    // 6. Build application_data (everything minus identity + honeypot + tenantSlug)
    const {
      tenantSlug: _slug,
      fullName: _fn,
      email: _e,
      phone: _p,
      hpField: _hp,
      licencePhotoUrl,
      selfieUrl,
      rideshareProofUrl,
      ...applicationDataFields
    } = body;
    void _slug;
    void _fn;
    void _e;
    void _p;
    void _hp;

    const applicationData = {
      ...applicationDataFields,
      address: {
        line1: body.addressLine1,
        line2: body.addressLine2 ?? null,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country ?? "US",
      },
      submissions: [
        { submittedAt: new Date().toISOString(), source: "application" },
      ],
    };

    // 7. Blacklist check (synchronous)
    let blacklistMatchId: string | null = null;
    let isBlacklisted = false;
    try {
      const { data: bl } = await supabase.functions.invoke("check-blacklist-match", {
        body: {
          tenantId: tenant.id,
          phone,
          email,
          licenceNumber: body.licenceNumber,
          fullName,
        },
      }) as { data?: { matchType: string; entries: { id: string }[] } };
      if (bl?.matchType === "hard" && bl.entries.length > 0) {
        isBlacklisted = true;
        blacklistMatchId = bl.entries[0].id;
      }
    } catch (blErr) {
      // Non-fatal: log and continue (security: blacklist should fail-open per spec §6.7;
      // hard match always emits no SMS so worst case we send the welcome SMS to a borderline)
      console.error("check-blacklist-match invoke failed (non-fatal):", blErr);
    }

    // 8. Dedup: existing non-terminal lead for this tenant + phone or email?
    if (!isBlacklisted) {
      const phoneNorm = normalisePhone(phone);
      const { data: existing } = await supabase
        .from("leads")
        .select("id, application_data, stage")
        .eq("tenant_id", tenant.id)
        .or(`phone_normalised.eq.${phoneNorm},email_lower.eq.${email}`)
        .in("stage", NON_TERMINAL_STAGES_FOR_DEDUP)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        // Append submission to existing.application_data.submissions[]
        const existingData = (existing.application_data ?? {}) as Record<string, unknown>;
        const submissions = Array.isArray(existingData.submissions)
          ? [...(existingData.submissions as unknown[])]
          : [];
        submissions.push({
          submittedAt: new Date().toISOString(),
          source: "application",
          payload: applicationData,
        });
        await supabase
          .from("leads")
          .update({
            application_data: { ...existingData, submissions, latestSubmission: applicationData },
            last_activity_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        // Append a system event in the conversation
        const { data: conv } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", existing.id)
          .maybeSingle();
        if (conv?.id) {
          await supabase.from("conversation_messages").insert({
            tenant_id: tenant.id,
            conversation_id: conv.id,
            channel: "system",
            direction: "internal",
            sender_type: "system",
            body: `Submitted another application on ${new Date().toISOString().slice(0, 10)}.`,
            status: "sent",
          });
        }

        return jsonResponse({ leadId: existing.id, status: "duplicate_merged" });
      }
    }

    // 9. Compute lead score (skip for blacklisted)
    let leadScore: number | null = null;
    let scoreBand: string | null = null;
    let scoreReason: Record<string, unknown> | null = null;

    if (!isBlacklisted) {
      try {
        const { data: scored } = await supabase.functions.invoke("compute-lead-score", {
          body: { applicationData: { ...applicationData, licencePhotoUrl, selfieUrl, rideshareProofUrl } },
        }) as { data?: { score: number; band: string; reason: Record<string, unknown> } };
        if (scored) {
          leadScore = scored.score;
          scoreBand = scored.band;
          scoreReason = scored.reason;
        }
      } catch (scoreErr) {
        console.error("compute-lead-score invoke failed (non-fatal):", scoreErr);
      }
    }

    // 10. Insert lead
    const { data: insertedLead, error: insertErr } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenant.id,
        full_name: fullName,
        email,
        phone,
        application_data: applicationData,
        vehicle_id: body.vehicleInterestType === "specific" ? body.vehicleId ?? null : null,
        vehicle_class: body.vehicleClass ?? null,
        start_date: body.startDate,
        end_date: body.endDate,
        rental_type: body.rentalLengthTarget ?? null,
        stage: isBlacklisted ? "blacklisted" : "new",
        lead_score: leadScore,
        score_band: scoreBand,
        score_reason: scoreReason,
        source: "application",
        source_metadata: {
          purpose: body.purpose,
          ridesharePlatforms: body.ridesharePlatforms ?? [],
        },
        blacklist_match_id: blacklistMatchId,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select("id")
      .single();

    if (insertErr || !insertedLead) {
      console.error("submit-application leads insert error:", insertErr);
      return errorResponse("Failed to save application. Please try again.", 500);
    }

    const leadId = insertedLead.id;

    // 11. Insert lead_documents rows for uploaded files
    const docs: Array<{ document_type: string; file_url: string }> = [];
    if (licencePhotoUrl) docs.push({ document_type: "licence", file_url: licencePhotoUrl });
    if (selfieUrl) docs.push({ document_type: "selfie", file_url: selfieUrl });
    if (rideshareProofUrl) docs.push({ document_type: "rideshare_proof", file_url: rideshareProofUrl });

    if (docs.length > 0) {
      await supabase.from("lead_documents").insert(
        docs.map((d) => ({
          tenant_id: tenant.id,
          lead_id: leadId,
          document_type: d.document_type,
          file_url: d.file_url,
          uploaded_by_lead: true,
          verification_status: "uploaded",
        })),
      );
    }

    // 12. Insert conversation (one per lead)
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .insert({
        tenant_id: tenant.id,
        lead_id: leadId,
      })
      .select("id")
      .single();
    if (convErr) console.error("submit-application conversation insert (non-fatal):", convErr);

    // 13. Emit application_submitted event (lead.created already emitted by DB trigger)
    if (!isBlacklisted) {
      await supabase.rpc("notify_automation_event", {
        p_event_type: "lead.application_submitted",
        p_tenant_id: tenant.id,
        p_entity_type: "lead",
        p_entity_id: leadId,
        p_payload: {
          source: "application",
          score_band: scoreBand,
          vehicle_class: body.vehicleClass ?? null,
          start_date: body.startDate,
          end_date: body.endDate,
          application_data: applicationData,
        },
      });
    }

    // 14. Insert lead_activity record
    await supabase.from("lead_activity").insert({
      tenant_id: tenant.id,
      lead_id: leadId,
      actor_type: "lead",
      event_type: isBlacklisted ? "application_submitted_blacklisted" : "application_submitted",
      payload: { source: "application", score_band: scoreBand },
    });

    // 15. Send acknowledgement SMS (V1 hardcoded; templates in Stage 4)
    if (!isBlacklisted) {
      try {
        const ackBody = `Hi ${fullName.split(" ")[0]}, thanks for applying with ${tenant.company_name ?? "us"}. We'll be in touch shortly.`;
        await supabase.functions.invoke("aws-sns-sms", {
          body: {
            phoneNumber: phone,
            message: ackBody,
            tenantId: tenant.id,
          },
        });
        // Insert outbound conversation_message for visibility
        if (conv?.id) {
          await supabase.from("conversation_messages").insert({
            tenant_id: tenant.id,
            conversation_id: conv.id,
            channel: "sms",
            direction: "outbound",
            sender_type: "system",
            body: ackBody,
            status: "sent",
          });
        }
      } catch (smsErr) {
        console.error("submit-application acknowledgement SMS failed (non-fatal):", smsErr);
      }
    }

    return jsonResponse({
      leadId,
      status: isBlacklisted ? "blacklisted" : "received",
    });
  } catch (err) {
    console.error("submit-application error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal server error", 500);
  }
});
