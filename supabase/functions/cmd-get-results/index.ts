// @ts-nocheck - Deno Edge Function
//
// cmd-get-results — Fetches live verification results + license document for
// display in the portal CMD tab. Returns license-only fields per the
// product scope; insurance/carrier data is intentionally dropped before
// returning. Per Modives compliance, the caller MUST NOT persist this response.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { cmdFetch } from "../_shared/modives-client.ts";

interface LicenseInfo {
  licenseNumber?: string | null;
  licenseExpiryDate?: string | null;
  licenseHolderFullName?: string | null;
  licenseHolderDOB?: string | null;
  licenseAddress?: string | null;
  licenseCity?: string | null;
  licenseState?: string | null;
  licenseZipCode?: string | null;
  documentURLs?: string[] | null;
}

interface CmdGetResultsResponse {
  ok: boolean;
  status?: string | null;
  disposition?: string | null;
  license?: LicenseInfo;
  rawStatusTimestamp?: string | null;
  error?: string;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { applicantVerificationId } = await req.json();
    if (!applicantVerificationId) {
      return errorResponse("applicantVerificationId is required", 400);
    }

    // Parallel fetch: high-level results + license document
    const [resultsResp, licenseResp] = await Promise.allSettled([
      cmdFetch<{ result: Record<string, unknown>; isSuccess?: boolean }>(
        `/api/app/modives/verification-results/${applicantVerificationId}`,
        { method: "GET" }
      ),
      cmdFetch<{ result: LicenseInfo; isSuccess?: boolean }>(
        `/api/app/modives/get-license-document/${applicantVerificationId}`,
        { method: "GET" }
      ),
    ]);

    let status: string | null = null;
    let disposition: string | null = null;
    let rawStatusTimestamp: string | null = null;
    if (resultsResp.status === "fulfilled") {
      const r = resultsResp.value as any;
      const inner = r?.result ?? r;
      if (inner && typeof inner === "object") {
        status = (inner.status as string | undefined) ?? null;
        disposition = (inner.disposition as string | undefined) ?? null;
        rawStatusTimestamp = (inner.timeStamp as string | undefined) ?? null;
      }
    } else {
      console.warn("[cmd-get-results] verification-results failed:", resultsResp.reason);
    }

    let license: LicenseInfo | undefined;
    if (licenseResp.status === "fulfilled") {
      const r = licenseResp.value as any;
      const inner = (r?.result ?? r) as LicenseInfo | undefined;
      if (inner) {
        // Trim to license-only fields — intentionally drop anything carrier related.
        license = {
          licenseNumber: inner.licenseNumber ?? null,
          licenseExpiryDate: inner.licenseExpiryDate ?? null,
          licenseHolderFullName: inner.licenseHolderFullName ?? null,
          licenseHolderDOB: inner.licenseHolderDOB ?? null,
          licenseAddress: inner.licenseAddress ?? null,
          licenseCity: inner.licenseCity ?? null,
          licenseState: inner.licenseState ?? null,
          licenseZipCode: inner.licenseZipCode ?? null,
          documentURLs: inner.documentURLs ?? null,
        };
      }
    } else {
      console.warn("[cmd-get-results] get-license-document failed:", licenseResp.reason);
    }

    return jsonResponse(<CmdGetResultsResponse>{
      ok: true,
      status,
      disposition,
      license,
      rawStatusTimestamp,
    });
  } catch (err: any) {
    console.error("[cmd-get-results] error:", err);
    return errorResponse(err?.message ?? "Internal error", 500);
  }
});
