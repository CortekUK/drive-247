// =============================================================================
// onboarding-call-ics: the "Add to calendar" file for one onboarding call
// (feat-001 spec 07.22). Opened from the booked screen and the emails, so it
// needs no login: the booking's random ics_token is the key.
//
//   GET ?t=<ics_token>  the invite, text/calendar, shown inline so an iPhone
//                       opens it straight in Calendar
//
// Unknown or malformed token: 404. Anything but GET: 405.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCallIcs, type CallEmailPayload } from "../_shared/onboarding-call-emails.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response(null, { status: 405 });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!UUID.test(token)) return new Response(null, { status: 404 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: b } = await supabase
    .from("onboarding_call_bookings")
    .select("id, sequence, ics_token, name, email, starts_at, ends_at, status, customer_timezone, tenant_id")
    .eq("ics_token", token)
    .maybeSingle();
  if (!b) return new Response(null, { status: 404 });

  const [{ data: s }, { data: t }] = await Promise.all([
    supabase.from("onboarding_call_settings").select("host_name, host_email, timezone, meeting_url").eq("id", true).maybeSingle(),
    supabase.from("tenants").select("company_name, slug").eq("id", b.tenant_id).maybeSingle(),
  ]);

  const payload: CallEmailPayload = {
    booking_id: b.id,
    sequence: b.sequence,
    ics_token: b.ics_token,
    name: b.name,
    email: b.email,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    customer_timezone: b.customer_timezone,
    company_name: t?.company_name ?? t?.slug ?? "",
    slug: t?.slug ?? "",
    host_name: s?.host_name ?? "Bryan",
    host_email: s?.host_email ?? null,
    host_timezone: s?.timezone ?? "America/New_York",
    meeting_url: s?.meeting_url ?? null,
  };
  const method = b.status === "cancelled" ? "CANCEL" : "REQUEST";

  return new Response(buildCallIcs(payload, method, false), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="drive247-onboarding-call.ics"',
      "Cache-Control": "no-store",
    },
  });
});
