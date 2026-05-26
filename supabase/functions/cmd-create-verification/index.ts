// @ts-nocheck - Deno Edge Function
//
// cmd-create-verification
// -----------------------
// 1. POST /api/app/modives/verification — returns a verificationId
// 2. GET  /api/app/modives/verification-detail/{verificationId} — returns the
//    applicantVerificationReqGuidId we need for subsequent calls + the magic link
// 3. POST /api/app/modives/consumer-magic-link with refKey=applicantVerificationReqGuidId
//    — returns the magic link URL
// 4. Persist the IDs + link in identity_verifications (provider='cmd')
// 5. Fan out the magic link via SES email / SNS SMS / WhatsApp per the
//    channels[] array on the request.
//
// Per Modives compliance ("integration provider shall not store any information
// it receives from Modives API Services"), we do NOT persist carrier or policy
// data. Only IDs, status enum, and the magic link itself (so we can re-send).
//
// Bhopan at Modives configured this Drive247 account to NOT auto-email
// consumers, so the link delivery is entirely on our side.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  cmdFetch,
  getModivesAuthKey,
  getModivesConfig,
  type ModivesApplicantInput,
} from "../_shared/modives-client.ts";

type Channel = "email" | "sms" | "whatsapp";

interface CreateVerificationRequest {
  customerId: string;
  channels: Channel[];
  applicant: ModivesApplicantInput;
  leaseTermDays?: number;
  leaseStartDate?: string;
  metaData?: string;
}

interface CreateVerificationResponse {
  ok: boolean;
  verificationRowId?: string;
  applicantVerificationId?: string;
  modivesVerificationId?: string;
  magicLink?: string;
  deliveredVia?: Channel[];
  deliveryErrors?: Record<string, string>;
  error?: string;
}

function extractIdFromDictResult(
  result: unknown,
  keys: string[]
): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const obj = result as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) return v;
  }
  return undefined;
}

function unwrapResult(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const obj = payload as Record<string, unknown>;
  if (obj.result && typeof obj.result === "object") {
    return obj.result as Record<string, unknown>;
  }
  return obj;
}

async function deliverMagicLink(
  supabase: any,
  customer: { id: string; name: string | null; email: string | null; phone: string | null; tenant_id: string | null },
  magicLink: string,
  channels: Channel[]
): Promise<{ delivered: Channel[]; errors: Record<string, string> }> {
  const delivered: Channel[] = [];
  const errors: Record<string, string> = {};
  const customerName = customer.name || "there";

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width:560px; margin:0 auto; padding:24px; color:#111827;">
      <h2 style="margin:0 0 12px; font-size:20px;">Verify your driver's license</h2>
      <p style="margin:0 0 16px; line-height:1.55; color:#374151;">
        Hi ${customerName},
      </p>
      <p style="margin:0 0 16px; line-height:1.55; color:#374151;">
        Please complete your driver's license verification by clicking the secure link below. It only takes a couple of minutes.
      </p>
      <p style="margin:24px 0;">
        <a href="${magicLink}" style="display:inline-block; padding:12px 22px; background:#6366f1; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:600;">Verify my license</a>
      </p>
      <p style="margin:0 0 8px; font-size:12px; color:#6b7280;">Or paste this URL into your browser:</p>
      <p style="margin:0 0 24px; font-size:12px; word-break:break-all; color:#6b7280;">${magicLink}</p>
      <p style="margin:0; font-size:12px; color:#9ca3af;">This link is valid for about 7 days. If you didn't request this, you can safely ignore the message.</p>
    </div>`;

  const smsText = `Hi ${customerName}, please verify your driver's license here: ${magicLink} (valid for 7 days).`;

  if (channels.includes("email") && customer.email) {
    try {
      const { error } = await supabase.functions.invoke("aws-ses-email", {
        body: {
          to: customer.email,
          subject: "Verify your driver's license",
          html: emailHtml,
        },
      });
      if (error) throw error;
      delivered.push("email");
    } catch (e: any) {
      errors.email = e?.message ?? String(e);
      console.error("[cmd-create-verification] email send failed:", e);
    }
  }

  if (channels.includes("sms") && customer.phone) {
    try {
      const { error } = await supabase.functions.invoke("aws-sns-sms", {
        body: {
          phoneNumber: customer.phone,
          message: smsText,
        },
      });
      if (error) throw error;
      delivered.push("sms");
    } catch (e: any) {
      errors.sms = e?.message ?? String(e);
      console.error("[cmd-create-verification] SMS send failed:", e);
    }
  }

  if (channels.includes("whatsapp") && customer.phone && customer.tenant_id) {
    try {
      const { error } = await supabase.functions.invoke("send-signing-whatsapp", {
        body: {
          customerPhone: customer.phone,
          message: smsText,
          tenantId: customer.tenant_id,
        },
      });
      if (error) throw error;
      delivered.push("whatsapp");
    } catch (e: any) {
      errors.whatsapp = e?.message ?? String(e);
      console.error("[cmd-create-verification] WhatsApp send failed:", e);
    }
  }

  return { delivered, errors };
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = (await req.json()) as CreateVerificationRequest;
    const { customerId, channels = ["email"], applicant, leaseTermDays = 1, leaseStartDate, metaData } = body;

    if (!customerId) return errorResponse("customerId is required", 400);
    if (!applicant) return errorResponse("applicant is required", 400);

    // Surface missing env vars early with an actionable message instead of
    // letting the underlying fetch error bubble up as a generic 500.
    const requiredEnvs = [
      "MODIVES_BASE_URL",
      "MODIVES_CLIENT_ID",
      "MODIVES_CLIENT_SECRET",
      "MODIVES_SUBSCRIPTION_KEY",
      "MODIVES_AUTH_KEY",
    ];
    const missingEnvs = requiredEnvs.filter((k) => !Deno.env.get(k));
    if (missingEnvs.length) {
      return errorResponse(
        `Modives integration is not configured — missing env vars: ${missingEnvs.join(", ")}. Set them in Supabase → Project Settings → Edge Functions → Secrets.`,
        503
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: customer, error: customerErr } = await supabase
      .from("customers")
      .select("id, name, email, phone, tenant_id")
      .eq("id", customerId)
      .single();
    if (customerErr || !customer) {
      return errorResponse("Customer not found", 404);
    }

    const cfg = await getModivesConfig(supabase, "test");
    if (!cfg?.dealer_guid) {
      return errorResponse(
        "CheckMyDriver setup is incomplete — dealerGuid is missing. Ask the Modives team (Bhopan/Sunit) for the test-environment dealerGuid, then run: UPDATE modives_config SET dealer_guid='<uuid>' WHERE environment='test';",
        503
      );
    }

    // ── Step 1: POST /verification ────────────────────────────────────────
    const startDateIso = leaseStartDate ?? new Date().toISOString();
    const createPayload = {
      dealerGuid: cfg.dealer_guid,
      acquisitionTypeId: "Rental",
      verificationTypeId: "Rental",
      isCPI: false,
      metaData: metaData ?? `drive247:${customer.id}`,
      leaseTerm: leaseTermDays,
      leaseStartDate: startDateIso,
      applicants: [applicant],
    };

    const created = await cmdFetch<{ result: Record<string, string>; isSuccess: boolean; message?: string }>(
      "/api/app/modives/verification",
      { method: "POST", body: createPayload }
    );

    const createdResult = unwrapResult(created);
    const verificationId = extractIdFromDictResult(createdResult, [
      "verificationId",
      "VerificationId",
      "id",
      "Id",
    ]);
    if (!verificationId) {
      console.error("[cmd-create-verification] no verificationId in response:", created);
      return errorResponse(`Modives did not return a verificationId: ${created?.message ?? "unknown"}`, 502);
    }

    // ── Step 2: GET /verification-detail/{verificationId} ─────────────────
    const detail = await cmdFetch<{ result: Record<string, unknown>; isSuccess?: boolean }>(
      `/api/app/modives/verification-detail/${verificationId}`,
      { method: "GET" }
    );
    const detailResult = unwrapResult(detail);
    // The applicantVerificationReqGuidId lives inside result.applicants[0] —
    // NOT at the top level. If we fall back to "any UUID string at top level"
    // we accidentally return the dealerGuid (which is also a top-level UUID).
    const applicants = (detailResult?.applicants ?? detailResult?.Applicants) as
      | Array<Record<string, unknown>>
      | undefined;
    const firstApplicant = Array.isArray(applicants) && applicants.length ? applicants[0] : undefined;
    const APPLICANT_ID_KEYS = [
      "applicantVerificationReqGuidId",
      "ApplicantVerificationReqGuidId",
      "applicantVerificationId",
    ];
    // First look inside applicants[0] (correct location per Modives schema).
    // Fall back to exact-key lookup on the top-level result (NOT the UUID
    // fallback — top-level has dealerGuid which would be a false positive).
    const applicantVerificationId =
      extractIdFromDictResult(firstApplicant, APPLICANT_ID_KEYS) ??
      (firstApplicant ? undefined : (() => {
        if (!detailResult) return undefined;
        for (const k of APPLICANT_ID_KEYS) {
          const v = (detailResult as Record<string, unknown>)[k];
          if (typeof v === "string" && v.length > 0) return v;
        }
        return undefined;
      })());
    if (!applicantVerificationId) {
      console.error("[cmd-create-verification] no applicantVerificationReqGuidId in detail:", detail);
      return errorResponse("Modives did not return applicantVerificationReqGuidId", 502);
    }

    // ── Step 3: POST /consumer-magic-link ─────────────────────────────────
    const linkResp = await cmdFetch<{ result: Record<string, string> | string; isSuccess?: boolean }>(
      "/api/app/modives/consumer-magic-link",
      {
        method: "POST",
        body: { authKey: getModivesAuthKey(), refKey: applicantVerificationId },
      }
    );
    let magicLink: string | undefined;
    if (typeof linkResp?.result === "string") {
      magicLink = linkResp.result;
    } else {
      const lr = unwrapResult(linkResp);
      if (lr) {
        for (const v of Object.values(lr)) {
          if (typeof v === "string" && /^https?:\/\//.test(v)) {
            magicLink = v;
            break;
          }
        }
      }
    }
    if (!magicLink) {
      console.error("[cmd-create-verification] no magic link in response:", linkResp);
      return errorResponse("Modives did not return a magic link", 502);
    }

    // ── Step 4: Persist record (provider='cmd') ───────────────────────────
    const magicLinkExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: insertedVerification, error: insertErr } = await supabase
      .from("identity_verifications")
      .insert({
        customer_id: customer.id,
        tenant_id: customer.tenant_id,
        provider: "cmd",
        verification_provider: "cmd",
        external_user_id: customer.id,
        status: "pending",
        review_status: "pending",
        cmd_verification_id: verificationId,
        cmd_applicant_verification_id: applicantVerificationId,
        cmd_status: "LinkSent",
        cmd_license_status: "Pending",
        cmd_last_event_at: new Date().toISOString(),
        cmd_magic_link: magicLink,
        cmd_magic_link_expires_at: magicLinkExpiresAt,
        cmd_delivery_channels: channels,
        first_name: applicant.firstName,
        last_name: applicant.lastName,
        customer_email: applicant.applicantEmail,
        address: [applicant.addressLine1, applicant.addressLine2, applicant.city, applicant.state, applicant.zipCode]
          .filter(Boolean)
          .join(", "),
      })
      .select("id")
      .single();
    if (insertErr) {
      console.error("[cmd-create-verification] DB insert failed:", insertErr);
      return errorResponse(`DB insert failed: ${insertErr.message}`, 500);
    }

    // ── Step 5: Deliver magic link (best-effort, non-fatal) ───────────────
    const { delivered, errors: deliveryErrors } = await deliverMagicLink(
      supabase,
      customer,
      magicLink,
      channels
    );

    return jsonResponse(<CreateVerificationResponse>{
      ok: true,
      verificationRowId: insertedVerification.id,
      applicantVerificationId,
      modivesVerificationId: verificationId,
      magicLink,
      deliveredVia: delivered,
      deliveryErrors: Object.keys(deliveryErrors).length ? deliveryErrors : undefined,
    });
  } catch (err: any) {
    console.error("[cmd-create-verification] error:", err);
    return errorResponse(err?.message ?? "Internal error", 500);
  }
});
