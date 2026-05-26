/**
 * list-accounting-tax-rates — proxies provider.listTaxRates() for the
 * mapping UI's tax-rate dropdowns. Spec §13.4.
 *
 * Same auth + caller shape as list-accounting-accounts.
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
      return errorResponse("Only admin or head_admin can read tax rates", 403);
    }
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    try {
      const provider = await getProvider(supabase, tenantId, body.provider);
      const taxRates = await provider.listTaxRates();
      return jsonResponse({ ok: true, taxRates });
    } catch (err) {
      if (err instanceof ProviderError) {
        return errorResponse(err.message, err.statusCode ?? 500);
      }
      throw err;
    }
  } catch (err) {
    console.error("list-accounting-tax-rates error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
