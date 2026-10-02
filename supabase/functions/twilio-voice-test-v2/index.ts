// twilio-voice-test-v2 — ring the operator's own browser, for real.
//
// Ghulam, Oct 2 2026: the Twilio Calling connection test should end with the
// phone actually RINGING — the same incoming-call screen the Messages tab
// shows — not just a line of text saying it would.
//
//   ring-me  Places a call from the tenant's business number to the CALLER's
//            own browser softphone (`client:tenant_<app_user id>`, the identity
//            `manage-twilio-voice` get-token registers). The portal's
//            GlobalVoiceCallProvider receives it like any incoming call. When
//            answered, Twilio reads one short line and hangs up.
//
// A real call on the tenant's OWN Twilio account (a browser leg costs a
// fraction of a cent). Rings only the person who pressed Test — never another
// staff member, never a phone.
//
// v2 (V2_PLAN §7): a new function; `manage-twilio-voice` is not edited.
// ⚠️ ISOLATION: the tenant is the caller's own `app_users.tenant_id`; only a
// super admin may name one in the body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getTenantTwilioCredentials } from "../_shared/twilio-sms-client.ts";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization", 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await admin
      .from("app_users")
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("User not found", 403);

    const { action, tenantId: bodyTenantId } = await req.json();
    if (action !== "ring-me") return errorResponse(`Unknown action: ${action}. Supported: ring-me`);

    let tenantId: string | null = appUser.tenant_id;
    if (!tenantId) {
      if (appUser.is_super_admin && typeof bodyTenantId === "string") tenantId = bodyTenantId;
      else return errorResponse(appUser.is_super_admin ? "Super admins must specify a tenantId" : "User not associated with a tenant", 403);
    }
    if (!appUser.is_super_admin && !["head_admin", "admin"].includes(appUser.role)) {
      return errorResponse("Only an admin or head admin can place a test call.", 403);
    }

    const { data: tenant } = await admin
      .from("tenants")
      .select("twilio_phone_number, twilio_voice_enabled, company_name")
      .eq("id", tenantId)
      .single();
    if (!tenant?.twilio_voice_enabled) return errorResponse("Calling is switched off.");
    if (!tenant.twilio_phone_number) return errorResponse("There's no business number to ring from.");

    const creds = await getTenantTwilioCredentials(admin, tenantId);
    if (!creds.sid || !creds.authToken) return errorResponse("Twilio isn't connected.");

    const twiml =
      `<Response><Pause length="1"/>` +
      `<Say voice="Polly.Joanna">This is your Drive 2 4 7 test call. Calls to your business number ring right here. You can hang up now.</Say>` +
      `<Pause length="1"/><Hangup/></Response>`;

    const res = await fetch(`${TWILIO_API}/Accounts/${creds.sid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${creds.sid}:${creds.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: `client:tenant_${appUser.id}`,
        From: tenant.twilio_phone_number,
        Twiml: twiml,
        Timeout: "25",
      }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return errorResponse(data?.message || `Twilio answered ${res.status}`, 502);

    return jsonResponse({ success: true, callSid: data.sid, from: tenant.twilio_phone_number });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unexpected error", 500);
  }
});
