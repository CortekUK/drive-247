// =============================================================================
// admin-create-sales-agent — create a least-privilege "sales agent" login.
//
// Sales agents can onboard new rental companies via the admin Sales tab but are
// NOT super admins and carry no tenant_id. Only a PRIMARY super admin may create
// them. The sales scope comes entirely from the is_sales_agent flag; the row's
// role stays a valid existing value ('viewer').
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

interface CreateSalesAgentRequest {
  email: string;
  name: string;
  password: string;
}

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

    // Service-role client for privileged reads/writes.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Caller must be an active PRIMARY super admin.
    const { data: caller } = await supabase
      .from("app_users")
      .select("is_active, is_super_admin, is_primary_super_admin")
      .eq("auth_user_id", user.id)
      .single();

    if (!caller?.is_active || !caller.is_super_admin || !caller.is_primary_super_admin) {
      return errorResponse("Only a primary super admin can create sales agents", 403);
    }

    const { email, name, password }: CreateSalesAgentRequest = await req.json();

    if (!email || !email.trim()) return errorResponse("email is required", 400);
    if (!name || !name.trim()) return errorResponse("name is required", 400);
    if (!password || password.length < 6) {
      return errorResponse("password must be at least 6 characters", 400);
    }

    const normalizedEmail = email.trim();

    // Guard against duplicate accounts (never hand out creds that won't work).
    // Case-insensitive: `ilike` narrows, then verify exactly in JS so a legal
    // underscore in the address can't wildcard-match a different account.
    const { data: emailMatches } = await supabase
      .from("app_users")
      .select("id, email")
      .ilike("email", normalizedEmail);
    const emailTaken = (emailMatches || []).some(
      (u: { email: string | null }) => (u.email || "").toLowerCase() === normalizedEmail.toLowerCase(),
    );

    if (emailTaken) {
      return errorResponse("An account already exists for this email", 409);
    }

    // Create the auth user.
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: name.trim(), role: "sales_agent" },
    });

    if (createError || !newUser.user) {
      console.error("[admin-create-sales-agent] Failed to create auth user:", createError);
      return errorResponse(createError?.message || "Failed to create user", 400);
    }

    const authUserId = newUser.user.id;

    // Create the app_users profile. Sales scope comes from is_sales_agent; the
    // role must stay a valid existing value, hence 'viewer'.
    const { error: appUserError } = await supabase
      .from("app_users")
      .insert({
        auth_user_id: authUserId,
        email: normalizedEmail,
        name: name.trim(),
        role: "viewer",
        is_super_admin: false,
        is_bonzah_partner: false,
        is_sales_agent: true,
        tenant_id: null,
        is_active: true,
        must_change_password: true,
      });

    if (appUserError) {
      console.error("[admin-create-sales-agent] Failed to create app_user, rolling back auth user:", appUserError);
      try {
        await supabase.auth.admin.deleteUser(authUserId);
      } catch (cleanupErr) {
        console.error("[admin-create-sales-agent] Rollback of auth user failed:", cleanupErr);
      }
      return errorResponse("Failed to create sales agent profile", 500);
    }

    console.log("[admin-create-sales-agent] Created sales agent:", normalizedEmail);
    return jsonResponse({ success: true, email: normalizedEmail });
  } catch (error) {
    console.error("[admin-create-sales-agent] Unexpected error:", error);
    return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
  }
});
