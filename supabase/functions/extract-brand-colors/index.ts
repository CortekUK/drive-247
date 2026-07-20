// =============================================================================
// extract-brand-colors — reusable brand-colour preview endpoint.
//
// Turns George's free-text "Business Colours" answer into a concrete
// { primary, secondary, accent, palette, style } set via the shared
// extractBrandColorsFromText() helper (OpenAI + deterministic fallback).
//
// Used by the admin Sales onboarding dialog ("preview colours") and future
// re-branding flows. JWT required; caller must be a super admin or sales agent.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { extractBrandColorsFromText } from "../_shared/brand-colors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    // Verify the caller's JWT with the anon client.
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    // Confirm the caller is an active super admin or sales agent.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: caller } = await supabase
      .from("app_users")
      .select("is_active, is_super_admin, is_sales_agent")
      .eq("auth_user_id", user.id)
      .single();

    if (!caller?.is_active || !(caller.is_super_admin || caller.is_sales_agent)) {
      return errorResponse("Forbidden", 403);
    }

    const { description, tenantId } = await req.json();
    if (!description || typeof description !== "string" || !description.trim()) {
      return errorResponse("description is required", 400);
    }

    const colors = await extractBrandColorsFromText(description, tenantId ?? null);
    return jsonResponse({ colors });
  } catch (error) {
    console.error("[extract-brand-colors] error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
  }
});
