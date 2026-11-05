// @ts-nocheck — Deno edge function.
//
// Send (or resend) the ID-verification invite to a single additional driver.
//
// The session and the email live in _shared/additional-driver-invite.ts, which
// customer-secondary-driver uses too. This function is the staff doorway to it.
//
// Request body: { driver_id: string }
// Response: { success: true, verification_url } | { success: false, error }
//
// Auth: requires JWT; tenant ownership enforced via app_users.tenant_id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { sendAdditionalDriverInvite } from "../_shared/additional-driver-invite.ts";

interface RequestBody {
  driver_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth: resolve the caller's tenant_id from app_users via their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return softError("Missing authorization token");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return softError("Invalid or expired token");
    const { data: appUser } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return softError("User not found in app_users");

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const driverId = body?.driver_id;
    if (!driverId) return softError("driver_id is required");

    // Load the driver row.
    const { data: driver, error: driverErr } = await supabase
      .from("rental_additional_drivers")
      .select("id, tenant_id, name, email, rental_id, listing_only")
      .eq("id", driverId)
      .single();
    if (driverErr || !driver) return softError("Driver not found");
    if (!appUser.is_super_admin && appUser.tenant_id !== driver.tenant_id) {
      return softError("Not authorized for this driver");
    }

    const invite = await sendAdditionalDriverInvite(supabase, driver);
    if (!invite.ok) return softError(invite.error);

    return new Response(
      JSON.stringify({ success: true, verification_url: invite.verificationUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[SendAdditionalDriverInvite] Fatal:", error);
    return softError(error instanceof Error ? error.message : "Unknown error");
  }
});

// Return 200 with success:false so the Supabase JS client surfaces the message
// in `data.error` rather than throwing a generic "non-2xx" error.
function softError(message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
