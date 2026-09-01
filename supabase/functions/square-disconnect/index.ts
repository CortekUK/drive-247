// square-disconnect
// -----------------
// Ends a tenant's Square connection from the operator's own Settings page.
//
// JWT-verified. `use-square-connection.ts` has invoked this function since the
// Square settings panel shipped; the function itself did not exist, so every
// Disconnect click returned a 404 that the hook surfaced as "Failed to
// disconnect Square". This is that function.
//
// THREE STEPS, AND THE ORDER IS LOAD-BEARING
//
//   1. Revoke the grant at Square. Needs the access token, which step 2
//      destroys — so it cannot be moved after it.
//   2. `square_clear_tokens` deletes both Vault secrets and flips the row to
//      'revoked'. It is the ONLY sanctioned way to remove those secrets; the
//      raw tokens live in Vault and are never in a column.
//   3. Report. A Square-side failure is reported but does NOT abort step 2 —
//      see below.
//
// WHY A FAILED REVOKE STILL CLEARS LOCALLY
//
// The operator's intent is "stop using Square". If Square is unreachable and we
// abort, we leave a connection the portal shows as live, backed by tokens we
// have decided to stop honouring, and the operator clicks Disconnect again into
// the same error. Clearing locally is the state that matches their intent and
// is recoverable: a stale grant at Square is inert once we hold no tokens, and
// the merchant can revoke from Square's own dashboard. The reverse order is not
// recoverable — tokens deleted with the grant live is identical, but tokens
// KEPT with the operator believing they are gone is a live credential nobody is
// watching. The response says which of the two happened.
//
// THE ROW IS NEVER DELETED, only flipped to 'revoked'. `square-webhook`'s
// resolveTenant maps merchant_id -> tenant_id, and a refund that settles after
// the operator walked away must still find its tenant. This mirrors
// handleRevocationEvent in square-webhook, which is the same transition
// arriving from the other direction (the merchant revoking at Square).
//
// MODE-SCOPED. `uq_square_connections_active` is UNIQUE(tenant_id, square_mode)
// WHERE status='active', so one active sandbox and one active production
// connection coexist by design. Disconnecting sandbox must not take live
// payments down with it, so the mode is required and never defaulted.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { squareBaseUrl } from "../_shared/payments/square-client.ts";
import { SquareMode } from "../_shared/payments/types.ts";

/** tenants.id is uuid; a non-uuid reaches Postgres as 22P02 and surfaces as an
 *  opaque 500. Reject it here with a sentence a human can act on. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Square's own revoke endpoint. Short: the operator is waiting on the click,
 *  and step 2 is what actually protects them. */
const REVOKE_TIMEOUT_MS = 6_000;

interface DisconnectRequest {
  tenantId?: unknown;
  mode?: unknown;
}

type AuthorizeResult =
  | { ok: true; appUserId: string }
  | { ok: false; response: Response };

/**
 * Authorize the caller for this tenant. Only a super admin, or a
 * head_admin/admin belonging to THIS tenant, may end a Square connection.
 *
 * Identical to square-oauth-start's check, deliberately — including the
 * `is_active` test BEFORE the role test. Deactivation does not invalidate an
 * already-issued JWT (admin-deactivate-user's only revocation attempt is a
 * global signOut wrapped in a try/catch that merely warns), so the row-level
 * check is the only thing that stops a revoked admin. Disconnect is destructive
 * in a way Connect is not: it stops a live merchant taking money.
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
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !user) {
    return { ok: false, response: errorResponse("Unauthorized", 401) };
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, is_super_admin, tenant_id, role, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const refusal = errorResponse("Not authorized to disconnect Square for this tenant", 403);

  // A booking customer authenticates against auth.users but has no app_users
  // row at all — the most likely holder of a stray project JWT.
  if (!appUser) return { ok: false, response: refusal };

  if (appUser.is_active !== true) {
    console.warn(
      `[square-disconnect] refused deactivated app_user ${appUser.id} for tenant ${tenantId}`,
    );
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

/** The app credentials for this mode. Mode fans out into BOTH the authorize
 *  host and the credential pair; a token minted in one is worthless in the
 *  other, and so is a revoke sent to the wrong host. */
function appCredentials(mode: SquareMode): { applicationId: string; applicationSecret: string } {
  const prefix = mode === "live" ? "SQUARE_LIVE" : "SQUARE_TEST";
  const applicationId = Deno.env.get(`${prefix}_APP_ID`) ?? "";
  const applicationSecret = Deno.env.get(`${prefix}_APP_SECRET`) ?? "";
  if (!applicationId || !applicationSecret) {
    throw new Error(`Missing ${prefix}_APP_ID / ${prefix}_APP_SECRET for ${mode} mode`);
  }
  return { applicationId, applicationSecret };
}

/**
 * Ask Square to revoke the grant.
 *
 * On squareBaseUrl, NOT the authorize host. The two diverge in sandbox
 * (connect.squareupsandbox.com vs app.squareupsandbox.com) and revoke is a
 * server-to-server API call like the token exchange, not a consent screen —
 * sending it to the browser-facing host is the same mistake that produced a
 * blank page for /oauth2/authorize on the API host.
 *
 * Authenticated with `Client APPLICATION_SECRET`, not the merchant's bearer
 * token — that is what Square's revoke endpoint requires, and it is why this
 * still works when the access token is already expired.
 *
 * `revoke_only_access_token: false` kills the refresh token too. Revoking only
 * the access token would leave the refresh token live, and a grant that can
 * mint new access tokens has not been disconnected in any sense the operator
 * would recognise.
 *
 * Returns a human-readable failure string rather than throwing: the caller
 * decides what to do with it, and that decision (continue) is deliberate.
 */
async function revokeAtSquare(
  mode: SquareMode,
  merchantId: string,
  accessToken: string | null,
): Promise<{ revoked: boolean; detail?: string }> {
  let applicationId: string;
  let applicationSecret: string;
  try {
    ({ applicationId, applicationSecret } = appCredentials(mode));
  } catch (err) {
    // Platform misconfiguration, not the merchant's problem. Local clear still
    // runs, so the operator is not stuck behind our missing env var.
    return { revoked: false, detail: err instanceof Error ? err.message : String(err) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
  try {
    const response = await fetch(`${squareBaseUrl(mode)}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Client ${applicationSecret}`,
      },
      body: JSON.stringify({
        client_id: applicationId,
        merchant_id: merchantId,
        // Belt and braces: Square accepts either identifier, and a merchant_id
        // that has drifted still resolves via the token.
        ...(accessToken ? { access_token: accessToken } : {}),
        revoke_only_access_token: false,
      }),
      signal: controller.signal,
    });

    if (response.ok) return { revoked: true };

    // Never log or echo the body wholesale — it can contain the credential we
    // just sent. Status plus Square's error code is enough to act on.
    let code = "";
    try {
      const body = await response.json();
      code = body?.errors?.[0]?.code ?? body?.type ?? "";
    } catch {
      /* non-JSON body — the status alone carries the signal */
    }
    return {
      revoked: false,
      detail: `Square returned ${response.status}${code ? ` (${code})` : ""}`,
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      revoked: false,
      detail: aborted ? `Square did not respond within ${REVOKE_TIMEOUT_MS}ms` : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  try {
    let body: DisconnectRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId || !UUID_RE.test(tenantId)) {
      return errorResponse("tenantId must be a uuid", 400);
    }

    // Required, never defaulted — see the mode-scoping note in the header.
    const mode = body.mode === "live" || body.mode === "test" ? (body.mode as SquareMode) : null;
    if (!mode) {
      return errorResponse("mode must be 'test' or 'live'", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = await authorize(req, supabase, tenantId);
    if (!auth.ok) return auth.response;

    // Read the tokens BEFORE clearing them — step 1 needs the access token, and
    // the RPC is the only way to read it. Filters on status='active' itself, so
    // no row means there is nothing active to disconnect.
    const { data: tokenData, error: tokenError } = await supabase.rpc("square_get_tokens", {
      p_tenant_id: tenantId,
      p_square_mode: mode,
    });
    if (tokenError) {
      return errorResponse(`Could not read the Square connection: ${tokenError.message}`, 500);
    }

    const tokenRow = (Array.isArray(tokenData) ? tokenData[0] : tokenData) as
      | { access_token?: string | null; merchant_id?: string | null }
      | null
      | undefined;

    if (!tokenRow) {
      // Already disconnected, or never connected in this mode. Idempotent by
      // design: the operator's goal is "not connected", which already holds.
      // A 404 here would make a double-click look like a failure.
      return jsonResponse({
        ok: true,
        alreadyDisconnected: true,
        message: "This Square connection is already disconnected.",
      });
    }

    const merchantId = tokenRow.merchant_id ?? "";
    const revoke = merchantId
      ? await revokeAtSquare(mode, merchantId, tokenRow.access_token ?? null)
      : { revoked: false, detail: "No merchant id on the connection" };

    if (!revoke.revoked) {
      console.warn(
        `[square-disconnect] tenant ${tenantId} (${mode}): Square revoke failed — ${revoke.detail}. Clearing locally anyway.`,
      );
    }

    // Deletes both Vault secrets and flips status. `last_error` is surfaced
    // verbatim by the portal, so it says who did it and what is true now —
    // including, honestly, when the grant may still be live at Square.
    const note = revoke.revoked
      ? "Disconnected from Settings. The Square authorisation was revoked."
      : "Disconnected from Settings. Square could not be reached to revoke the " +
        "authorisation, so it may still appear in your Square account — remove " +
        "it there if you want it gone. We no longer hold any credentials for it.";

    const { error: clearError } = await supabase.rpc("square_clear_tokens", {
      p_tenant_id: tenantId,
      p_square_mode: mode,
      p_new_status: "revoked",
      p_error: note,
    });

    if (clearError) {
      // This one DOES fail the request. We still hold the tokens, so the
      // operator is not disconnected and must not be told they are.
      console.error(`[square-disconnect] square_clear_tokens failed: ${clearError.message}`);
      return errorResponse(
        `Could not clear the stored Square credentials: ${clearError.message}`,
        500,
      );
    }

    console.log(
      `[square-disconnect] tenant ${tenantId} (${mode}) disconnected by app_user ${auth.appUserId}; square_revoked=${revoke.revoked}`,
    );

    return jsonResponse({
      ok: true,
      revokedAtSquare: revoke.revoked,
      message: note,
    });
  } catch (err) {
    console.error("[square-disconnect] unhandled:", err);
    return errorResponse("Could not disconnect Square", 500);
  }
});
