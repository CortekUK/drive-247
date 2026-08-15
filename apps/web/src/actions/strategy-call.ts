"use server";

import { cookies, headers } from "next/headers";
import { getStrategyCallAdminClient } from "@/lib/strategy-call/supabase-admin";
import {
  createStrategyCallSessionToken,
  hashStrategyCallSubmissionSource,
  hashStrategyCallSessionToken,
  STRATEGY_CALL_SESSION_COOKIE,
  STRATEGY_CALL_SESSION_TTL_SECONDS,
} from "@/lib/strategy-call/session-token";
import { validateStrategyCallSubmission } from "@/lib/strategy-call/validation";

export type StrategyCallState =
  | { success: false; message: string }
  | { success: true; message: string; sessionId: string }
  | null;

export async function submitStrategyCallAction(
  _prev: StrategyCallState,
  formData: FormData
): Promise<StrategyCallState> {
  const validation = validateStrategyCallSubmission(formData);
  if (!validation.ok) {
    return { success: false, message: validation.message };
  }

  const pepper = process.env.STRATEGY_CALL_SESSION_PEPPER;
  if (!pepper) {
    console.error("Strategy-call capture unavailable: session pepper is missing");
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
