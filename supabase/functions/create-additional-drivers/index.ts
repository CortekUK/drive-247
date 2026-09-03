// @ts-nocheck — Deno edge function, not Node.
//
// Bulk-insert additional driver rows for a rental.
//
// Mutations bypass RLS via service_role; tenant ownership is enforced inside
// the function by reading the rental row and matching against the caller's
// app_users.tenant_id. The actual Veriff session + email sending is delegated
// to `send-additional-driver-invite` (one call per driver) so the rental form
// can fire-and-forget while the rental insert completes.
//
// Request body:
//   { rental_id: string, drivers: [{ name, email?, phone? }, ...] }
// Response:
//   { success: true, drivers: [{ id, name, email, phone, verification_status, signing_status }, ...] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

interface DriverInput {
  name: string;
  email?: string;
  phone?: string;
}

interface RequestBody {
  rental_id: string;
  drivers: DriverInput[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth: resolve the caller's tenant from app_users via their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return jsonError(401, "Missing authorization token");
    }
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return jsonError(401, "Invalid or expired token");

    const { data: appUser } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return jsonError(403, "User not found in app_users");

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const rentalId = body?.rental_id;
    const drivers = Array.isArray(body?.drivers) ? body.drivers : [];
    if (!rentalId) return jsonError(400, "rental_id is required");
    if (drivers.length === 0) return jsonError(400, "drivers array must not be empty");

    // Validate inputs before any DB writes — match DB CHECK constraint.
    const trimmed = drivers.map((d) => ({
      name: (d?.name ?? "").trim(),
      email: d?.email ? d.email.trim().toLowerCase() : null,
      phone: d?.phone ? d.phone.trim() : null,
    }));
    for (const d of trimmed) {
      if (!d.name) return jsonError(400, "Each driver must have a name");
      if (!d.email && !d.phone) {
        return jsonError(400, `Driver ${d.name} must have an email or phone`);
      }
    }
    // Reject duplicate emails within the same request — DB unique index would
    // catch it but with a less friendly error.
    const emails = trimmed.map((d) => d.email).filter(Boolean) as string[];
    if (new Set(emails).size !== emails.length) {
      return jsonError(400, "Each driver email must be unique");
    }

    // Fetch the rental for tenant ownership + reject if it's a duplicate of
    // the primary customer's email.
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select("id, tenant_id, customers(email)")
      .eq("id", rentalId)
      .single();
    if (rentalErr || !rental) return jsonError(404, "Rental not found");
    if (!appUser.is_super_admin && appUser.tenant_id !== rental.tenant_id) {
      return jsonError(403, "Not authorized for this rental");
    }
    const primaryEmail = (rental as any).customers?.email?.toLowerCase();
    if (primaryEmail) {
      for (const d of trimmed) {
        if (d.email && d.email === primaryEmail) {
          return jsonError(400, "Additional driver cannot have the same email as the primary customer");
        }
      }
    }

    // Insert rows in a single batch — partial failure would be confusing
    // (some drivers created, others not). Postgres transaction-per-INSERT is
    // enough: if one fails, none commit.
    const rows = trimmed.map((d) => ({
      rental_id: rentalId,
      tenant_id: rental.tenant_id,
      name: d.name,
      email: d.email,
      phone: d.phone,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from("rental_additional_drivers")
      .insert(rows)
      .select("id, name, email, phone, verification_status, signing_status");

    if (insertErr) {
      // Map the unique-email violation to a friendly message.
      if ((insertErr as any).code === "23505") {
        return jsonError(409, "One of these drivers is already on this rental");
      }
      return jsonError(500, insertErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, drivers: inserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[CreateAdditionalDrivers] Fatal:", error);
    return jsonError(500, error instanceof Error ? error.message : "Unknown error");
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
