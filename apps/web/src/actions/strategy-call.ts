"use server";

import { cookies, headers } from "next/headers";
import { normalizeReferralCode, REFERRAL_COOKIE } from "@/lib/referral-cookie";
import { getStrategyCallAdminClient } from "@/lib/strategy-call/supabase-admin";
import {
  createStrategyCallSessionToken,
  hashStrategyCallSubmissionSource,
  hashStrategyCallSessionToken,
  resolveStrategyCallPepper,
  STRATEGY_CALL_SESSION_COOKIE,
  STRATEGY_CALL_SESSION_TTL_SECONDS,
} from "@/lib/strategy-call/session-token";
import { validateStrategyCallSubmission } from "@/lib/strategy-call/validation";

export type StrategyCallState =
  | { success: false; message: string }
  | { success: true; message: string; sessionId: string }
  | null;

/**
 * contact_requests.company_name and .city_state for a new lead. Never throws.
 * Until 20261121090000 adds city_state, the company name is saved on its own.
 */
async function saveBusinessDetails(
  supabase: ReturnType<typeof getStrategyCallAdminClient>,
  contactRequestId: string,
  companyName: string | null,
  cityState: string | null,
): Promise<void> {
  const company = companyName ? { company_name: companyName } : {};
  try {
    let { error } = await supabase
      .from("contact_requests")
      .update({ ...company, ...(cityState ? { city_state: cityState } : {}) })
      .eq("id", contactRequestId);
    if (error && cityState && /city_state/.test(error.message ?? "") && companyName) {
      ({ error } = await supabase.from("contact_requests").update(company).eq("id", contactRequestId));
    }
    if (error) {
      console.warn("Strategy-call company and city not saved (non-fatal)", { code: error.code });
    }
  } catch {
    console.warn("Strategy-call company and city not saved (non-fatal)");
  }
}

export async function submitStrategyCallAction(
  _prev: StrategyCallState,
  formData: FormData
): Promise<StrategyCallState> {
  const validation = validateStrategyCallSubmission(formData);
  if (!validation.ok) {
    return { success: false, message: validation.message };
  }

  const pepper = resolveStrategyCallPepper();
  if (!pepper) {
    // Name both variables: this failure took a production outage to diagnose
    // precisely because the log said "pepper" while the deploy was in fact
    // missing the service-role key the whole feature depends on.
    console.error(
      "Strategy-call capture unavailable: set STRATEGY_CALL_SESSION_PEPPER, " +
        "or SUPABASE_SERVICE_ROLE_KEY which it is derived from",
    );
    return {
      success: false,
      message: "Something went wrong. Please try again.",
    };
  }

  const input = validation.value;
  const rawToken = createStrategyCallSessionToken();
  let tokenHash: string;
  try {
    tokenHash = hashStrategyCallSessionToken(rawToken, pepper);
  } catch {
    console.error("Strategy-call capture unavailable: invalid session security config");
    return {
      success: false,
      message: "Something went wrong. Please try again.",
    };
  }

  try {
    const supabase = getStrategyCallAdminClient();
    const requestHeaders = await headers();
    const networkSource =
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      requestHeaders.get("x-real-ip")?.trim() ||
      `unknown:${(requestHeaders.get("user-agent") || "unknown").slice(0, 120)}`;
    const submissionRateKey = hashStrategyCallSubmissionSource(
      networkSource,
      pepper
    );
    const expiresAt = new Date(
      Date.now() + STRATEGY_CALL_SESSION_TTL_SECONDS * 1000
    ).toISOString();
    const { data: createdRows, error: createError } = await supabase.rpc(
      "create_strategy_call_session",
      {
        p_contact_name: input.name,
        p_email: input.email,
        p_phone: input.phone,
        p_fleet_size: input.fleetSize,
        p_current_platform: input.currentPlatform,
        p_main_booking_source: input.mainBookingSource,
        p_budget: input.budget,
        p_readiness: input.readiness,
        p_token_hash: tokenHash,
        p_submission_rate_key: submissionRateKey,
        p_expires_at: expiresAt,
      }
    );
    const created = createdRows?.[0];

    if (createError || !created?.session_id) {
      console.error("Strategy-call transactional persistence failed", {
        code: createError?.code ?? "missing_row",
      });
      return {
        success: false,
        message: "Something went wrong. Please try again.",
      };
    }

    const cookieStore = await cookies();

    // A Drive247 promo / referral code the visitor carries (/r/{code}) rides
    // along with the lead, so sales can put it on the payment link they send.
    // Best effort: the lead is saved either way, and whether the code is still
    // usable is checked when the link is made, not here.
    const promoCode = normalizeReferralCode(cookieStore.get(REFERRAL_COOKIE)?.value);
    if (promoCode && created.contact_request_id) {
      const { error: promoError } = await supabase
        .from("contact_requests")
        .update({ promo_code: promoCode })
        .eq("id", created.contact_request_id);
      if (promoError) {
        console.warn("Strategy-call promo code not saved (non-fatal)", { code: promoError.code });
      }
    }

    // The rental company and its city and state, so the team can look the
    // business up. Written after the RPC (which stores company_name as
    // "Unknown") rather than through it, so the live RPC is left as it is.
    // Best effort, like the promo code: the lead is saved either way.
    if (created.contact_request_id && (input.companyName || input.cityState)) {
      await saveBusinessDetails(supabase, created.contact_request_id, input.companyName, input.cityState);
    }

    cookieStore.set(STRATEGY_CALL_SESSION_COOKIE, rawToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: STRATEGY_CALL_SESSION_TTL_SECONDS,
      priority: "high",
    });

    // Deliberately no email here. A verified persisted booking is the only
    // event that can trigger the confirmation lifecycle.
    return {
      success: true,
      message: "You're in — pick a time that works.",
      // This UUID is non-secret and can be forwarded as GHL custom tracking.
      // The raw bearer token remains cookie-only.
      sessionId: created.session_id,
    };
  } catch (error) {
    console.error("Strategy-call capture failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return {
      success: false,
      message: "Something went wrong. Please try again.",
    };
  }
}
