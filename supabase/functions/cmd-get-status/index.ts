// @ts-nocheck - Deno Edge Function
//
// cmd-get-status — Thin proxy for GET /api/app/modives/verification-status/{id}.
// Used by the portal during link-sent → verifying polling. The webhook is the
// source of truth, but polling smooths over webhook delivery latency.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cmdFetch } from "../_shared/modives-client.ts";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { applicantVerificationId } = await req.json();
    if (!applicantVerificationId) {
      return errorResponse("applicantVerificationId is required", 400);
    }

    const data = await cmdFetch(
      `/api/app/modives/verification-status/${applicantVerificationId}`,
      { method: "GET" }
    );

    return jsonResponse({ ok: true, status: data });
  } catch (err: any) {
    console.error("[cmd-get-status] error:", err);
    return errorResponse(err?.message ?? "Internal error", 500);
  }
});
