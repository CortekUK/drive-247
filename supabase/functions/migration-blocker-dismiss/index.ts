// migration-blocker-dismiss — operator dismisses the SOFT migration prompt.
//
// Records the dismissal time (the prompt reappears 24h later) and increments a
// counter so the admin can see how many times an operator has put it off.
// Only ever applies to the soft prompt: a hard prompt is not dismissible, so a
// call for a hard-blocked tenant is rejected rather than silently honoured.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();

    // A normal operator may only ever dismiss their OWN tenant's prompt, so the
    // tenant is derived from the caller and any body value is ignored. A super
    // admin has tenant_id = NULL (by design) and can be viewing any tenant's
    // portal, so for them we accept the tenant from the body.
    let tenantId: string | null = appUser?.tenant_id ?? null;
    if (!tenantId && appUser?.is_super_admin === true) {
      const body = await req.json().catch(() => ({}));
      tenantId = body?.tenantId ?? null;
    }
    if (!tenantId) return errorResponse("No tenant for this user", 403);

    const { data: tenant, error: tErr } = await supabase
      .from("tenants")
      .select("migration_blocker, migration_blocker_dismiss_count")
      .eq("id", tenantId)
      .single();
    if (tErr || !tenant) return errorResponse("Tenant not found", 404);

    if (tenant.migration_blocker !== "soft") {
      return errorResponse("This prompt cannot be dismissed", 400);
    }

    const { error: updErr } = await supabase
      .from("tenants")
      .update({
        migration_blocker_dismissed_at: new Date().toISOString(),
        migration_blocker_dismiss_count: (tenant.migration_blocker_dismiss_count || 0) + 1,
      })
      .eq("id", tenantId);
    if (updErr) return errorResponse(updErr.message, 500);

    return jsonResponse({ success: true, nextShowInHours: 24 });
  } catch (error) {
    console.error("[migration-blocker-dismiss] Error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal error", 500);
  }
});
