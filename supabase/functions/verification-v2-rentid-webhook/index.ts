/**
 * verification-v2-rentid-webhook · feat-003 (spec 08.11 to 08.13).
 *
 * One address for every company: /functions/v1/verification-v2-rentid-webhook/<session check id>
 * (verify_jwt = false; RentID signs its own requests). The check comes from OUR id in the URL, matched
 * against the request_id RentID sends; the result is then read from RentID, never taken from the body.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { pollPremium } from "../_shared/verification/premium.ts";
import { verifyWebhook } from "../_shared/verification/rentid.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  if (!(await verifyWebhook(raw, req.headers.get("x-rentid-signature") ?? ""))) {
    return new Response("bad signature", { status: 401 });
  }
  const checkId = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!UUID.test(checkId)) return new Response("ok", { status: 200 });
  let body: any = {};
  try { body = JSON.parse(raw); } catch { /* signed but not JSON: nothing to do */ }
  const requestId = body?.data?.request_id ?? body?.request_id ?? null;

  const work = (async () => {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: check } = await sb.from("verification_session_checks").select("id, provider_ref, result").eq("id", checkId).maybeSingle();
    if (!check || check.result !== "pending" || !check.provider_ref) return; // finished already (08.13)
    if (requestId && requestId !== check.provider_ref) return;          // not this check's request
    await pollPremium(sb, check.id, check.provider_ref);
  })().catch((e) => console.error("[rentid-webhook]", String((e as Error)?.message ?? e)));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return new Response("ok", { status: 200 });
});
