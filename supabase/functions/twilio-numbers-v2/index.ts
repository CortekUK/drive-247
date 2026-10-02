// twilio-numbers-v2 — find, buy, or pick the operator's Twilio number.
//
// Ghulam, Oct 2 2026: from the Twilio Messages and Twilio Calling dialogs an
// operator should be able to BUY a number, or use one they already own, and
// have it connected and checked in one go. Twilio stays bring-your-own: every
// call here runs on the operator's OWN account with their own credentials,
// and Twilio bills them for the number directly. Drive247 never holds a
// number of its own.
//
// Actions:
//   verify  { accountSid?, authToken? }
//           Checks the credentials and lists the numbers already on the
//           account, with what each can do (SMS / voice) and whether it is
//           already pointed at Drive247. Saves nothing.
//   search  { accountSid?, authToken?, country, areaCode?, contains?, voice? }
//           Up to 6 local numbers Twilio has for sale, plus the monthly price
//           when Twilio's pricing API answers. Buys nothing.
//   buy     { accountSid?, authToken?, phoneNumber, need? }
//           Buys the number on the operator's account with the inbound-SMS
//           webhook already set, then stores the connection exactly as
//           `manage-twilio-connection` `connect` does.
//   connect { accountSid?, authToken?, phoneNumber, need? }
//           Uses a number the operator already owns: confirms it is on the
//           account and can do what is needed (`need` = "sms" | "voice"),
//           points its SMS webhook at Drive247, and stores the connection.
//
// Either way, if calling is already switched on for the tenant, the new
// number's voice webhook is pointed at Drive247 too (what
// `manage-twilio-voice` `setup` does to a number) — the voice app and API key
// belong to the ACCOUNT, so swapping the number must not silently stop calls.
//
// Credentials: when `accountSid` + `authToken` are omitted, the ones already
// stored for the tenant are used — that is how a connected operator swaps to a
// new number without typing their token again. A token typed here is only
// stored by `buy` or `connect`, never by verify or search.
//
// v2 (V2_PLAN §7): a new function — `manage-twilio-connection` is called, not
// edited. ⚠️ ISOLATION: the tenant is the caller's own `app_users.tenant_id`;
// only a super admin may name one in the body. Every query is scoped by it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getTenantTwilioCredentials, validateTenantConnection } from "../_shared/twilio-sms-client.ts";

const TWILIO_API = "https://api.twilio.com/2010-04-01";
const SUPPORTED_COUNTRIES = ["US", "CA", "GB"];

async function twilio(
  url: string,
  sid: string,
  token: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, string>,
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Twilio answered ${res.status}`);
  return data;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await admin
      .from("app_users")
      .select("tenant_id, role, is_super_admin")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("User not found", 403);

    const { action, tenantId: bodyTenantId, ...params } = await req.json();

    let tenantId: string | null = appUser.tenant_id;
    if (!tenantId) {
      if (appUser.is_super_admin && typeof bodyTenantId === "string") tenantId = bodyTenantId;
      else return errorResponse(appUser.is_super_admin ? "Super admins must specify a tenantId" : "User not associated with a tenant", 403);
    }
    if (!appUser.is_super_admin && !["head_admin", "admin"].includes(appUser.role)) {
      return errorResponse("Only an admin or head admin can manage the Twilio number.", 403);
    }

    // Typed credentials win; otherwise the stored ones.
    let sid: string = typeof params.accountSid === "string" ? params.accountSid.trim() : "";
    let token: string = typeof params.authToken === "string" ? params.authToken.trim() : "";
    if (!sid || !token) {
      const stored = await getTenantTwilioCredentials(admin, tenantId);
      sid = stored.sid;
      token = stored.authToken;
      if (!sid || !token) return errorResponse("Enter your Twilio Account SID and Auth Token first.");
    }

    const check = await validateTenantConnection(sid, token);
    if (!check.valid) return errorResponse(`Twilio didn't accept those details: ${check.error}`);
    if (check.status !== "active") return errorResponse(`This Twilio account is "${check.status}" — it must be active.`);

    const inboundSmsUrl = `${supabaseUrl}/functions/v1/twilio-inbound-sms`;
    const fns = `${supabaseUrl}/functions/v1`;

    // Store the number exactly as `manage-twilio-connection` `connect` does, so
    // nothing downstream can tell a bought number from a connected one — and
    // carry calling over to it when calling is on.
    const store = async (number: { sid: string; phone_number: string }) => {
      const { data: t } = await admin.from("tenants").select("twilio_voice_enabled").eq("id", tenantId).single();
      if (t?.twilio_voice_enabled) {
        try {
          await twilio(`${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers/${number.sid}.json`, sid, token, "POST", {
            VoiceUrl: `${fns}/twilio-voice-inbound`,
            VoiceMethod: "POST",
            VoiceApplicationSid: "",
            StatusCallback: `${fns}/twilio-voice-status`,
            StatusCallbackMethod: "POST",
          });
        } catch (e) {
          console.warn("[twilio-numbers-v2] could not carry calling over:", e instanceof Error ? e.message : e);
        }
      }
      return admin
        .from("tenants")
        .update({
          twilio_account_sid: sid,
          twilio_auth_token: token,
          twilio_phone_number: number.phone_number,
          twilio_phone_number_sid: number.sid,
          integration_twilio_sms: true,
          twilio_connection_verified_at: new Date().toISOString(),
        } as any)
        .eq("id", tenantId);
    };

    switch (action) {
      case "verify": {
        const data = await twilio(`${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`, sid, token);
        const numbers = (data?.incoming_phone_numbers ?? []).map((n: any) => ({
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          sms: !!n.capabilities?.sms,
          voice: !!n.capabilities?.voice,
          pointedAtDrive247: n.sms_url === inboundSmsUrl,
        }));
        return jsonResponse({ success: true, friendlyName: check.friendlyName, numbers });
      }

      case "search": {
        const country = String(params.country || "US").toUpperCase();
        if (!SUPPORTED_COUNTRIES.includes(country)) return errorResponse(`Numbers can be bought here for ${SUPPORTED_COUNTRIES.join(", ")}.`);

        const q = new URLSearchParams({ SmsEnabled: "true", PageSize: "6" });
        if (params.voice) q.set("VoiceEnabled", "true");
        const areaCode = String(params.areaCode || "").replace(/\D/g, "");
        if (areaCode && country !== "GB") q.set("AreaCode", areaCode);
        const contains = String(params.contains || "").replace(/[^\dA-Za-z*]/g, "");
        if (contains) q.set("Contains", contains);

        const data = await twilio(
          `${TWILIO_API}/Accounts/${sid}/AvailablePhoneNumbers/${country}/Local.json?${q}`,
          sid,
          token,
        );
        const numbers = (data?.available_phone_numbers ?? []).map((n: any) => ({
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name,
          locality: n.locality || null,
          region: n.region || null,
          sms: !!(n.capabilities?.SMS ?? n.capabilities?.sms),
          voice: !!(n.capabilities?.voice ?? n.capabilities?.Voice),
        }));

        // Best effort — a missing price must never block a search.
        let monthlyPrice: string | null = null;
        try {
          const pricing = await twilio(`https://pricing.twilio.com/v1/PhoneNumbers/Countries/${country}`, sid, token);
          const local = (pricing?.phone_number_prices ?? []).find((p: any) => p.number_type === "local");
          if (local?.current_price) monthlyPrice = `${local.current_price} ${pricing.price_unit ?? "USD"}`;
        } catch (_) { /* price stays unknown */ }

        return jsonResponse({ success: true, numbers, monthlyPrice });
      }

      case "buy": {
        const phoneNumber = String(params.phoneNumber || "").trim();
        if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) return errorResponse("Pick a number to buy.");

        const bought = await twilio(`${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json`, sid, token, "POST", {
          PhoneNumber: phoneNumber,
          FriendlyName: "Drive247",
          SmsUrl: inboundSmsUrl,
          SmsMethod: "POST",
        });

        const { error: updateError } = await store(bought);
        if (updateError) {
          // The number is bought and on their account either way — say so, so
          // they connect it as their own rather than buying a second one.
          return errorResponse(
            `Twilio sold you ${bought.phone_number}, but I couldn't save it here (${updateError.message}). Connect it with "Use a number I have".`,
            500,
          );
        }

        return jsonResponse({
          success: true,
          friendlyName: check.friendlyName,
          phoneNumber: bought.phone_number,
          capabilities: bought.capabilities ?? null,
        });
      }

      case "connect": {
        const phoneNumber = String(params.phoneNumber || "").trim();
        if (!phoneNumber) return errorResponse("Pick a number to connect.");
        const data = await twilio(
          `${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
          sid,
          token,
        );
        const n = data?.incoming_phone_numbers?.[0];
        if (!n) return errorResponse(`${phoneNumber} isn't on this Twilio account.`);
        if (!n.capabilities?.sms) return errorResponse(`${n.phone_number} can't send texts — pick a number with SMS.`);
        if (params.need === "voice" && !n.capabilities?.voice) {
          return errorResponse(`${n.phone_number} can't take calls — pick a number with voice.`);
        }

        await twilio(`${TWILIO_API}/Accounts/${sid}/IncomingPhoneNumbers/${n.sid}.json`, sid, token, "POST", {
          SmsUrl: inboundSmsUrl,
          SmsMethod: "POST",
        });

        const { error: updateError } = await store(n);
        if (updateError) return errorResponse(`I couldn't save the connection: ${updateError.message}`, 500);

        return jsonResponse({
          success: true,
          friendlyName: check.friendlyName,
          phoneNumber: n.phone_number,
          capabilities: n.capabilities ?? null,
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}. Supported: verify, search, buy, connect`);
    }
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unexpected error", 500);
  }
});
