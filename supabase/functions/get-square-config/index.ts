// get-square-config — the three values a Square card form needs in the browser.
//
// Mirrors get-stripe-config, and exists for the same reason: the client cannot
// hard-code these. The application id differs between sandbox and production,
// and the LOCATION id is per-merchant — it comes from the tenant's own OAuth
// connection, so no build-time constant could ever be right.
//
// WHAT IS AND IS NOT SAFE TO RETURN
//
// applicationId and locationId are PUBLIC by design: Square's Web Payments SDK
// takes both in browser JavaScript, exactly as Stripe's publishable key is
// public. The ACCESS TOKEN is not, and is never read here — this function calls
// square_get_tokens only for location_id and never selects, logs or returns the
// credential itself.
//
// No JWT: the booking site takes payments from renters who have no account, the
// same audience get-stripe-config already serves unauthenticated. It returns
// nothing that is not already public, and it refuses any tenant that is not
// active and on Square.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import type { SquareMode } from "../_shared/payments/types.ts";

/** Sandbox and production are separate application registrations. */
function applicationIdFor(mode: SquareMode): string | undefined {
  return mode === "live"
    ? Deno.env.get("SQUARE_LIVE_APP_ID")
    : Deno.env.get("SQUARE_TEST_APP_ID");
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { tenantSlug, tenantId } = await req.json().catch(() => ({}));
    if (!tenantSlug && !tenantId) {
      return errorResponse("Missing required parameter: tenantSlug or tenantId");
    }

    let query = supabase
      .from("tenants")
      .select("id, slug, payment_provider, square_mode, currency_code, company_name");
    query = tenantSlug ? query.eq("slug", tenantSlug) : query.eq("id", tenantId);

    const { data: tenant, error } = await query.eq("status", "active").single();
    if (error || !tenant) return errorResponse("Tenant not found", 404);

    // Answering for a Stripe tenant would invite a caller to render a Square
    // card form for money that must go down the other rail.
    if (tenant.payment_provider !== "square") {
      return errorResponse(
        `Tenant ${tenant.slug} takes payments through ${tenant.payment_provider ?? "stripe"}, not Square.`,
        409,
      );
    }

    const mode = ((tenant.square_mode as SquareMode) ?? "test");
    const applicationId = applicationIdFor(mode);
    if (!applicationId) {
      return errorResponse(
        `Square is not configured on the server for ${mode} mode (SQUARE_${mode === "live" ? "LIVE" : "TEST"}_APP_ID is missing).`,
        503,
      );
    }

    // location_id comes from the tenant's OWN connection. A card form cannot be
    // rendered without it, and it is the one value that proves this tenant has
    // actually completed the Square connect flow.
    const { data: conn } = await supabase.rpc("square_get_tokens", {
      p_tenant_id: tenant.id,
      p_square_mode: mode,
    });
    const row = Array.isArray(conn) ? conn[0] : conn;
    if (!row?.location_id) {
      return errorResponse(
        "This business has not finished connecting its Square account yet, so card payments are unavailable.",
        409,
      );
    }

    return jsonResponse({
      applicationId,
      locationId: row.location_id,
      mode,
      // The location's currency, not the tenant's: Square bills in the
      // location's currency and will not convert.
      currency: String(row.location_currency ?? tenant.currency_code ?? "USD").toUpperCase(),
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.company_name,
    });
  } catch (err) {
    console.error("[get-square-config]", err);
    return errorResponse(err instanceof Error ? err.message : "Failed to get Square configuration", 500);
  }
});
