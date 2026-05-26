/**
 * list-accounting-accounts — proxies provider.listAccounts() for the
 * Settings → Accounting → Configure mappings dropdowns.
 *
 * Spec §13.3.
 *
 * JWT-protected. Caller must be admin/head_admin/super-admin (settings UI
 * for non-managers / staff would have no use for this — the mapping save
 * flow rejects non-admins anyway).
 *
 * No in-memory cache here (Deno isolates die between invocations); React
 * Query on the portal side handles caching with a 5-min staleTime.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getProvider } from "../_shared/accounting/factory.ts";
import { ProviderError, ProviderName } from "../_shared/accounting/types.ts";

interface Payload { provider?: ProviderName }

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    if (!body.provider || !["xero", "zoho"].includes(body.provider)) {
      return errorResponse("provider is required ('xero' or 'zoho')", 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return errorResponse("Unauthorised", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);
    if (!appUser.is_super_admin && !["admin", "head_admin"].includes(appUser.role ?? "")) {
      return errorResponse("Only admin or head_admin can read accounts", 403);
    }
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    try {
      const provider = await getProvider(supabase, tenantId, body.provider);
      const accounts = await provider.listAccounts();
      return jsonResponse({ ok: true, accounts });
    } catch (err) {
      if (err instanceof ProviderError) {
        return errorResponse(err.message, err.statusCode ?? 500);
      }
      throw err;
    }
  } catch (err) {
    console.error("list-accounting-accounts error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
