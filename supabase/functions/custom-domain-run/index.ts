// custom-domain-run — keeps checking self-serve custom domains until they are live.
//
// Called every 5 minutes by the pg_cron job `custom-domain-run` with the
// service role key (migration 20261015120000). Nobody else may call it.
//
// DNS can take minutes to hours, so the operator's "I've added them" is only
// the first check. Every pending domain is re-checked here; the first time one
// is live the operator gets an email (checkAndRecord), and one still not live
// after a week is marked `error` with what is missing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkAndRecord, loadVercelConfig } from "../_shared/custom-domain.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== serviceKey) return errorResponse("Forbidden", 403);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });

  await loadVercelConfig(db);
  const { data: rows, error } = await db
    .from("tenants")
    .select("id, custom_booking_domain, custom_domain_status, custom_domain_requested_at")
    .eq("custom_domain_status", "pending")
    .not("custom_booking_domain", "is", null)
    .order("custom_domain_checked_at", { ascending: true, nullsFirst: true })
    .limit(25);
  if (error) return errorResponse(error.message, 500);

  const results: Array<{ tenant_id: string; status: string }> = [];
  for (const t of rows ?? []) {
    try {
      const r = await checkAndRecord(db, t);
      results.push({ tenant_id: t.id, status: r.status });
    } catch (e) {
      console.error(`custom-domain-run: tenant ${t.id} failed`, e);
      results.push({ tenant_id: t.id, status: "failed" });
    }
  }
  return jsonResponse({ checked: results.length, results });
});
