import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

async function getAppUser(supabase: any, authUserId: string) {
  const { data } = await supabase
    .from("app_users")
    .select("id, is_super_admin")
    .eq("auth_user_id", authUserId)
    .single();

  return data;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    // Auth client to verify the caller
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    // Service role client for mutations (bypasses RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate caller is super admin
    const appUser = await getAppUser(supabase, user.id);
    if (!appUser || appUser.is_super_admin !== true) {
      return errorResponse("Only super admins can manage the global blacklist", 403);
    }

    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "list":
        return await handleList(supabase, body);
      case "get":
        return await handleGet(supabase, body);
      case "whitelist":
        return await handleWhitelist(supabase, body, appUser.id);
      case "re-blacklist":
        return await handleReBlacklist(supabase, body);
      case "stats":
        return await handleStats(supabase);
      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Error in manage-global-blacklist:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});

async function handleList(supabase: any, body: any) {
  const { search } = body;

  let query = supabase
    .from("v_global_blacklist_details")
    .select("*")
    .order("created_at", { ascending: false });

  if (search) {
    query = query.ilike("email", `%${search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return jsonResponse({ success: true, entries: data || [] });
}

async function handleGet(supabase: any, body: any) {
  const { email } = body;
  if (!email) return errorResponse("email is required");

  const { data, error } = await supabase
    .from("v_global_blacklist_details")
    .select("*")
    .eq("email", email)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("Blacklist entry not found", 404);
    }
    throw error;
  }

  return jsonResponse({ success: true, entry: data });
}

async function handleWhitelist(supabase: any, body: any, appUserId: string) {
  const { email, reason } = body;
  if (!email) return errorResponse("email is required");
  if (!reason) return errorResponse("reason is required");

  const { data, error } = await supabase
    .from("global_blacklist")
    .update({
      is_whitelisted: true,
      whitelist_reason: reason,
      whitelisted_by: appUserId,
      whitelisted_at: new Date().toISOString(),
    })
    .eq("email", email)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("Blacklist entry not found", 404);
    }
    throw error;
  }

  return jsonResponse({ success: true, entry: data });
}

async function handleReBlacklist(supabase: any, body: any) {
  const { email } = body;
  if (!email) return errorResponse("email is required");

  const { data, error } = await supabase
    .from("global_blacklist")
    .update({
      is_whitelisted: false,
      whitelist_reason: null,
      whitelisted_by: null,
      whitelisted_at: null,
    })
    .eq("email", email)
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return errorResponse("Blacklist entry not found", 404);
    }
    throw error;
  }

  return jsonResponse({ success: true, entry: data });
}

async function handleStats(supabase: any) {
  const { data: allEntries, error } = await supabase
    .from("global_blacklist")
    .select("is_whitelisted, created_at");

  if (error) throw error;

  const entries = allEntries || [];
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const totalEntries = entries.length;
  const totalBlacklisted = entries.filter(
    (e: any) => e.is_whitelisted === false
  ).length;
  const totalWhitelisted = entries.filter(
    (e: any) => e.is_whitelisted === true
  ).length;
  const recentAdditions = entries.filter(
    (e: any) => new Date(e.created_at) >= sevenDaysAgo
  ).length;

  return jsonResponse({
    success: true,
    stats: {
      totalBlacklisted,
      totalWhitelisted,
      totalEntries,
      recentAdditions,
    },
  });
}
