// set-square-mode
// ---------------
// Moves a tenant between Square's sandbox and production environments by
// flipping `tenants.square_mode`.
//
// WHY THIS EXISTS
//
// `square_mode` is `NOT NULL DEFAULT 'test'` and its CHECK permits 'live', but
// until now NOTHING in the portal or the admin app ever wrote it — a grep of
// both apps returns no write site. So every Square tenant was permanently in
// sandbox and no real payment could be taken by any route. This is SQ-23.
//
// WHY IT IS A SEPARATE FUNCTION AND NOT A CLIENT UPDATE
//
// The flip decides whether a customer's card is really charged. It needs a
// server-side authorisation check and a readiness gate, and neither survives
// being written in the browser against a table the anon role can reach.
//
// THE ORDER THAT MAKES THIS SAFE: CONNECT FIRST, FLIP SECOND
//
// square-oauth-start already accepts an explicit `mode` and deliberately
// tolerates connecting in one mode while the tenant sits in another — its own
// comment describes the resulting row as "unusable until someone flips
// tenants.square_mode to match". That tolerance is the whole design:
//
//   1. connect production while the tenant is still 'test'  (nothing changes for
//      customers — the tenant keeps transacting on sandbox)
//   2. Square verifies the merchant and we record the location + currency
//   3. flip to 'live' HERE, gated on that verified row
//
// Flipping first would leave a window where the tenant is live with no live
// connection, and every payment in that window fails at Square.
//
// GOING BACK TO 'test' IS NEVER GATED. It is the de-risking direction — it stops
// real money moving. A gate there would mean an operator watching live payments
// fail could not retreat, which is the one moment they most need to.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SquareMode } from "../_shared/payments/types.ts";

/** tenants.id is uuid; a non-uuid reaches Postgres as 22P02 and surfaces as an
 *  opaque 500. Reject it here with a sentence a human can act on. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SetModeRequest {
  tenantId?: unknown;
  mode?: unknown;
}

type AuthorizeResult =
  | { ok: true; appUserId: string }
  | { ok: false; response: Response };

/**
 * Only a super admin, or a head_admin/admin of THIS tenant, may change the mode.
 *
 * Same shape as square-oauth-start's check, including the `is_active` test
 * BEFORE the role test: deactivation does not invalidate an already-issued JWT,
 * so the row-level check is the only thing that stops a revoked admin.
 */
async function authorize(
  req: Request,
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AuthorizeResult> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false, response: errorResponse("Missing authorization header", 401) };
  }

  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userError || !user) {
    return { ok: false, response: errorResponse("Unauthorized", 401) };
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, is_super_admin, tenant_id, role, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const refusal = errorResponse("Not authorized to change Square mode for this tenant", 403);
  if (!appUser) return { ok: false, response: refusal };
  if (appUser.is_active !== true) {
    console.warn(`[set-square-mode] refused deactivated app_user ${appUser.id}`);
    return { ok: false, response: refusal };
  }

  const isSuperAdmin = appUser.is_super_admin === true;
  const canManageOwnTenant =
    appUser.tenant_id === tenantId &&
    (appUser.role === "head_admin" || appUser.role === "admin");

  if (isSuperAdmin || canManageOwnTenant) {
    return { ok: true, appUserId: appUser.id as string };
  }
  return { ok: false, response: refusal };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    let body: SetModeRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId || !UUID_RE.test(tenantId)) {
      return errorResponse("tenantId must be a uuid", 400);
    }

    const mode = body.mode === "live" || body.mode === "test" ? (body.mode as SquareMode) : null;
    if (!mode) return errorResponse("mode must be 'test' or 'live'", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await authorize(req, supabase, tenantId);
    if (!auth.ok) return auth.response;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, payment_provider, square_mode, currency_code, company_name")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantError) return errorResponse(`Could not read the tenant: ${tenantError.message}`, 500);
    if (!tenant) return errorResponse("Tenant not found", 404);

    // Square mode is meaningless on a Stripe tenant, and setting it there would
    // leave a misleading value behind if that tenant is ever inspected.
    if (tenant.payment_provider !== "square") {
      return errorResponse(
        `This tenant takes payments through ${tenant.payment_provider}, not Square, so it has no Square mode to set.`,
        409,
      );
    }

    if (tenant.square_mode === mode) {
      // Idempotent: the caller's goal already holds. A 409 here would make a
      // double-click look like a failure.
      return jsonResponse({ ok: true, mode, unchanged: true });
    }

    // ---- the gate ---------------------------------------------------------
    //
    // Only guards the move TO live. See the header for why the retreat to test
    // is deliberately ungated.
    if (mode === "live") {
      const { data: liveConnections, error: connError } = await supabase
        .from("square_connections")
        .select("status, location_id, location_currency, merchant_id, business_name")
        .eq("tenant_id", tenantId)
        .eq("square_mode", "live")
        .eq("status", "active");

      if (connError) {
        return errorResponse(`Could not read the Square connection: ${connError.message}`, 500);
      }

      const connection = (liveConnections ?? [])[0];
      if (!connection) {
        return errorResponse(
          "No active production Square connection. Connect the live Square account first, " +
            "then switch to live — connecting afterwards would leave this tenant live with " +
            "no account to charge.",
          409,
        );
      }

      // The same composite the OAuth callback checks. Re-checked here rather
      // than trusted because the connection may have been made days ago and a
      // merchant can deactivate a location at any time.
      if (!connection.location_id) {
        return errorResponse(
          "The production Square account has no location cleared for card processing yet. " +
            "Sort that out in your Square dashboard, then reconnect.",
          409,
        );
      }

      const tenantCurrency = String(tenant.currency_code ?? "").toUpperCase();
      const locationCurrency = String(connection.location_currency ?? "").toUpperCase();
      if (!tenantCurrency || !locationCurrency || tenantCurrency !== locationCurrency) {
        // Square binds currency to the LOCATION and will not convert, so a
        // mismatch 400s every payment this tenant would ever take. Refusing here
        // turns that into one clear message instead of a stream of failed
        // charges against real customers.
        return errorResponse(
          `The production Square location bills in ${locationCurrency || "an unknown currency"} ` +
            `but this tenant is configured for ${tenantCurrency || "an unknown currency"}. ` +
            "Square cannot convert — connect a location in the tenant's currency before going live.",
          409,
        );
      }
    }

    const { error: updateError } = await supabase
      .from("tenants")
      .update({ square_mode: mode })
      .eq("id", tenantId);

    if (updateError) {
      return errorResponse(`Could not change the Square mode: ${updateError.message}`, 500);
    }

    // Loud on purpose: this line is the audit trail for the moment a tenant
    // started charging real cards.
    console.log(
      `[set-square-mode] tenant ${tenantId} (${tenant.company_name}) ${tenant.square_mode} -> ${mode} by app_user ${auth.appUserId}`,
    );

    return jsonResponse({ ok: true, mode, previousMode: tenant.square_mode });
  } catch (err) {
    console.error("[set-square-mode] unhandled:", err);
    return errorResponse("Could not change the Square mode", 500);
  }
});
