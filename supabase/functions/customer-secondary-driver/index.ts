// @ts-nocheck — Deno edge function.
//
// The renter's side of secondary drivers: list, add, resend the verification
// link, remove. A secondary driver is verified and listed on the rental, nothing
// more. This function never touches agreements, Bonzah or money.
//
// Mutations bypass RLS via service_role, so ownership is enforced here: the
// caller must hold a customer_users row for the customer on the rental. Nothing
// about who the caller is comes from the request body. Changes are refused once
// the rental has left Pending or its keys have been handed over.
//
// Request body:
//   { action: "list" | "add" | "resend" | "remove", rental_id, driver_id?, name?, email?, phone? }
// Response (always 200 once authenticated, so the client can show the message):
//   { success: true, can_manage, drivers: [...] } | { success: false, error }
//
// Licence numbers and verification links are never returned. A renter holding
// the link could complete the check on the driver's behalf.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { sendAdditionalDriverInvite } from "../_shared/additional-driver-invite.ts";
import {
  canManageSecondaryDriver,
  MAX_INVITES_PER_RENTAL_PER_DAY,
  parseSecondaryDriverInput,
  RESEND_COOLDOWN_SECONDS,
} from "../_shared/secondary-driver-rules.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCKED_MESSAGE = "A secondary driver can only be changed while the rental is pending, before pick-up.";
const LIMIT_MESSAGE = "Too many verification emails have been sent for this rental today. Please try again tomorrow.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string): Response {
  return json({ success: false, error: message });
}

async function invitesToday(supabase: any, rentalId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("identity_verifications")
    .select("id", { count: "exact", head: true })
    .eq("rental_id", rentalId)
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function listDrivers(supabase: any, rentalId: string) {
  const { data, error } = await supabase
    .from("rental_additional_drivers")
    .select(
      "id, name, email, phone, verification_status, identity_verifications!rental_additional_drivers_identity_verification_id_fkey(qr_session_expires_at)",
    )
    .eq("rental_id", rentalId)
    .eq("listing_only", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const now = Date.now();
  return (data ?? []).map((row: any) => {
    const expiresAt = row.identity_verifications?.qr_session_expires_at;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      verification_status: row.verification_status,
      link_expired:
        row.verification_status === "pending" && !!expiresAt && new Date(expiresAt).getTime() < now,
    };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ success: false, error: "Missing authorization token" }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ success: false, error: "Invalid or expired token" }, 401);

    const body = await req.json().catch(() => ({}));
    const { action, rental_id: rentalId, driver_id: driverId } = body ?? {};
    if (typeof rentalId !== "string" || !UUID_PATTERN.test(rentalId)) return fail("Rental not found");

    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select("id, tenant_id, customer_id, status, cancellation_requested, customers:customer_id(email)")
      .eq("id", rentalId)
      .maybeSingle();
    if (rentalErr) throw new Error(rentalErr.message);
    if (!rental?.customer_id) return fail("Rental not found");

    // The same answer as a rental that does not exist, so an id cannot be probed.
    const { data: link, error: linkErr } = await supabase
      .from("customer_users")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("customer_id", rental.customer_id)
      .limit(1)
      .maybeSingle();
    if (linkErr) throw new Error(linkErr.message);
    if (!link) return fail("Rental not found");

    const { data: handover, error: handoverErr } = await supabase
      .from("rental_key_handovers")
      .select("id")
      .eq("rental_id", rentalId)
      .not("handed_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (handoverErr) throw new Error(handoverErr.message);

    const canManage = canManageSecondaryDriver({
      status: rental.status,
      cancellation_requested: rental.cancellation_requested,
      keysHandedOver: !!handover,
    });

    if (action === "list") {
      return json({ success: true, can_manage: canManage, drivers: await listDrivers(supabase, rentalId) });
    }

    if (action !== "add" && action !== "resend" && action !== "remove") return fail("Unknown action");
    if (!canManage) return fail(LOCKED_MESSAGE);

    if (action === "add") {
      const parsed = parseSecondaryDriverInput(body, rental.customers?.email);
      if (!parsed.ok) return fail(parsed.error);
      if ((await invitesToday(supabase, rentalId)) >= MAX_INVITES_PER_RENTAL_PER_DAY) return fail(LIMIT_MESSAGE);

      const { data: created, error: insertErr } = await supabase
        .from("rental_additional_drivers")
        .insert({
          rental_id: rentalId,
          tenant_id: rental.tenant_id,
          name: parsed.driver.name,
          email: parsed.driver.email,
          phone: parsed.driver.phone,
          listing_only: true,
        })
        .select("id, tenant_id, rental_id, name, email, listing_only")
        .single();
      if (insertErr) {
        // One index allows a single secondary driver; the other, one driver per email.
        if (insertErr.code === "23505") {
          return fail(
            insertErr.message?.includes("one_listing_only")
              ? "This rental already has a secondary driver. Remove them first to add someone else."
              : "That person is already a driver on this rental.",
          );
        }
        throw new Error(insertErr.message);
      }

      const invite = await sendAdditionalDriverInvite(supabase, created);
      if (!invite.ok) {
        // No link was created, so leave nothing behind for the renter to get stuck on.
        await supabase.from("rental_additional_drivers").delete().eq("id", created.id);
        console.error("[CustomerSecondaryDriver] invite failed:", invite.error);
        return fail("We could not start verification for this driver. Please try again.");
      }
      return json({
        success: true,
        email_sent: invite.emailSent,
        can_manage: canManage,
        drivers: await listDrivers(supabase, rentalId),
      });
    }

    // resend and remove act on an existing secondary driver on THIS rental.
    if (typeof driverId !== "string" || !UUID_PATTERN.test(driverId)) return fail("Driver not found");
    const { data: driver, error: driverErr } = await supabase
      .from("rental_additional_drivers")
      .select("id, tenant_id, rental_id, name, email, listing_only, verification_status, identity_verification_id")
      .eq("id", driverId)
      .eq("rental_id", rentalId)
      .eq("listing_only", true)
      .maybeSingle();
    if (driverErr) throw new Error(driverErr.message);
    if (!driver) return fail("Driver not found");

    if (action === "resend") {
      if (driver.verification_status === "verified") return fail("This driver is already verified.");
      if ((await invitesToday(supabase, rentalId)) >= MAX_INVITES_PER_RENTAL_PER_DAY) return fail(LIMIT_MESSAGE);

      if (driver.identity_verification_id) {
        const { data: last } = await supabase
          .from("identity_verifications")
          .select("created_at")
          .eq("id", driver.identity_verification_id)
          .maybeSingle();
        const elapsed = last?.created_at ? (Date.now() - new Date(last.created_at).getTime()) / 1000 : Infinity;
        if (elapsed < RESEND_COOLDOWN_SECONDS) {
          return fail(`Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)} seconds before sending another link.`);
        }
      }

      const invite = await sendAdditionalDriverInvite(supabase, driver);
      if (!invite.ok) {
        console.error("[CustomerSecondaryDriver] resend failed:", invite.error);
        return fail("We could not send a new link. Please try again.");
      }
      return json({
        success: true,
        email_sent: invite.emailSent,
        can_manage: canManage,
        drivers: await listDrivers(supabase, rentalId),
      });
    }

    // remove: kill any link still out there first, so it cannot open after the
    // driver has gone. identity_verifications keeps its record of past checks.
    const { error: retireErr } = await supabase
      .from("identity_verifications")
      .update({ qr_session_token: null })
      .eq("external_user_id", `additional_driver_${driver.id}`)
      .not("qr_session_token", "is", null);
    if (retireErr) throw new Error(retireErr.message);

    const { error: deleteErr } = await supabase.from("rental_additional_drivers").delete().eq("id", driver.id);
    if (deleteErr) throw new Error(deleteErr.message);
    return json({ success: true, can_manage: canManage, drivers: await listDrivers(supabase, rentalId) });
  } catch (error) {
    console.error("[CustomerSecondaryDriver] Fatal:", error);
    return json({ success: false, error: "Something went wrong. Please try again." });
  }
});
