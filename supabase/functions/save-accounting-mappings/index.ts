/**
 * save-accounting-mappings — bulk upsert mapping rows.
 *
 * Spec §13. Operator changes account/tax codes on the mapping UI → clicks
 * Save → we UPSERT each row by (tenant, provider, event_type) or by the
 * payment_account sentinel.
 *
 * No retroactive changes to already-synced events — new lines on new
 * invoices use the new mapping; existing invoices stay untouched.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface MappingInput {
  /** One of the financial_event_type enum values, or null if this is the payment-account sentinel. */
  event_type?: string | null;
  /** When event_type is null, must set is_payment_account_sentinel=true. */
  is_payment_account_sentinel?: boolean;
  external_account_code: string;
  external_account_name?: string | null;
  external_tax_code?: string | null;
  external_tax_rate?: number | null;
}

interface Payload {
  provider?: "xero" | "zoho";
  mappings?: MappingInput[];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    if (!body.provider || !["xero", "zoho"].includes(body.provider)) {
      return errorResponse("provider is required ('xero' or 'zoho')", 400);
    }
    if (!Array.isArray(body.mappings) || body.mappings.length === 0) {
      return errorResponse("mappings[] is required (at least one)", 400);
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
      return errorResponse("Only admin or head_admin can save mappings", 403);
    }
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    const summary = { upserted_event_mappings: 0, upserted_payment_account: 0, errors: [] as string[] };

    for (const m of body.mappings) {
      if (!m.external_account_code || m.external_account_code.length === 0) {
        summary.errors.push("missing external_account_code");
        continue;
      }
      try {
        if (m.is_payment_account_sentinel) {
          await supabase
            .from("accounting_account_mappings")
            .upsert({
              tenant_id: tenantId,
              provider: body.provider,
              event_type: null,
              is_payment_account_sentinel: true,
              external_account_code: m.external_account_code,
              external_account_name: m.external_account_name ?? null,
              external_tax_code: null,
              external_tax_rate: null,
              is_default: false,
            }, { onConflict: "tenant_id,provider", ignoreDuplicates: false });
          summary.upserted_payment_account++;
        } else if (m.event_type) {
          await supabase
            .from("accounting_account_mappings")
            .upsert({
              tenant_id: tenantId,
              provider: body.provider,
              event_type: m.event_type,
              is_payment_account_sentinel: false,
              external_account_code: m.external_account_code,
              external_account_name: m.external_account_name ?? null,
              external_tax_code: m.external_tax_code ?? null,
              external_tax_rate: m.external_tax_rate ?? null,
              is_default: false,
            }, { onConflict: "tenant_id,provider,event_type", ignoreDuplicates: false });
          summary.upserted_event_mappings++;
        } else {
          summary.errors.push("mapping has neither event_type nor is_payment_account_sentinel");
        }
      } catch (err) {
        summary.errors.push(`${m.event_type ?? "payment_account"}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    console.error("save-accounting-mappings error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
