/**
 * get-apply-form-config — Phase 4 scaffold.
 *
 * Public endpoint (verify_jwt=false). Resolves tenant by slug and returns
 * the operator-configured Apply form shape. Booking app calls this on /apply
 * page load and hides steps / marks extra fields required accordingly.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  tenantSlug?: string;
}

const DEFAULT_HIDDEN: string[] = [];
const DEFAULT_REQUIRED: Record<string, string[]> = {};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    const slug = (req.headers.get("x-tenant-slug") || body.tenantSlug || "").toLowerCase().trim();
    if (!slug) return errorResponse("tenantSlug required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, lead_management_enabled")
      .eq("slug", slug)
      .maybeSingle();
    if (!tenant) return errorResponse("Tenant not found", 404);
    if (tenant.lead_management_enabled === false) return errorResponse("Disabled", 403);

    const { data: cfg } = await supabase
      .from("apply_form_config")
      .select("hidden_steps, required_overrides, welcome_message")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    return jsonResponse({
      hiddenSteps: cfg?.hidden_steps ?? DEFAULT_HIDDEN,
      requiredOverrides: cfg?.required_overrides ?? DEFAULT_REQUIRED,
      welcomeMessage: cfg?.welcome_message ?? null,
    });
  } catch (err) {
    console.error("get-apply-form-config error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
