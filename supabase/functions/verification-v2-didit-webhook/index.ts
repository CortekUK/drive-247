/**
 * verification-v2-didit-webhook · feat-003 (spec 07.6 to 07.10).
 *
 * One address on Didit's side for every company (verify_jwt = false; Didit signs its own requests).
 * Order: check the signature and the SIGNED body timestamp → find OUR session by vendor_data (the company
 * comes from our row, never from the webhook) → fetch the decision from Didit (never trust the body) →
 * finish. Answers 2xx fast; the work carries on after the answer.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getDecision, verifyWebhook } from "../_shared/verification/didit.ts";
import { addEvent, finishStandard, OPEN } from "../_shared/verification/store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIDED = ["Approved", "Declined", "In Review"];

async function handle(parsed: any): Promise<void> {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ourId = String(parsed?.vendor_data ?? "");
  if (!UUID.test(ourId)) return;
  const { data: session } = await sb.from("verification_sessions")
    .select("id, tenant_id, status, didit_session_id").eq("id", ourId).maybeSingle();
  if (!session) return;
  if (session.didit_session_id && session.didit_session_id !== parsed.session_id) return; // not this session's check
  if (!OPEN.includes(session.status)) return; // finished, replaced or cancelled: nothing changes (07.9)

  const status = String(parsed?.status ?? "");
  const eventId = typeof parsed?.event_id === "string" ? parsed.event_id : undefined;
  if (status === "In Progress") {
    await addEvent(sb, session, "check_started", { provider: "didit" }, eventId); // once per Didit event (07.10)
    return;
  }
  if (!DECIDED.includes(status)) return; // Abandoned, Expired, Not Started…: our own clock ends the session

  const decision = await getDecision(parsed.session_id); // never the webhook's body (07.7)
  if (decision && DECIDED.includes(String(decision.status))) {
    await finishStandard(sb, session.id, decision, eventId);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return new Response("bad body", { status: 400 }); }
  if (!(await verifyWebhook(parsed, req.headers.get("x-signature-v2") ?? ""))) {
    return new Response("bad signature", { status: 401 });
  }
  const work = handle(parsed).catch((e) => console.error("[didit-webhook]", String((e as Error)?.message ?? e)));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return new Response("ok", { status: 200 });
});
