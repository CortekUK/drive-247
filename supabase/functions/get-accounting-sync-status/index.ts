/**
 * get-accounting-sync-status — Spec §12.2 step 4.
 *
 * Lightweight endpoint the backfill wizard polls every 5 seconds while a job
 * is running. Returns the job row + aggregated KPI counts (synced/pending/failed)
 * for the sync_state rows the backfill produced.
 *
 * Without a backfillJobId, returns the tenant-wide KPI snapshot (same numbers
 * as the sync log KPI tiles — but the tiles read direct, so this is mostly
 * for backfill polling).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  provider?: "xero" | "zoho";
  backfillJobId?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return errorResponse("Unauthorised", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    if (body.backfillJobId) {
      const { data: job } = await supabase
        .from("backfill_jobs")
        .select("*")
        .eq("id", body.backfillJobId)
        .maybeSingle();
      if (!job) return errorResponse("Backfill job not found", 404);
      if (!appUser.is_super_admin && job.tenant_id !== tenantId) {
        return errorResponse("Not your tenant's backfill", 403);
      }
      return jsonResponse({ ok: true, job });
    }

    // Tenant-wide snapshot
    if (!body.provider) return errorResponse("provider or backfillJobId required", 400);
    const states = ["synced", "pending", "syncing", "failed", "skipped"] as const;
    const counts: Record<string, number> = {};
    for (const s of states) {
      const { count } = await supabase
        .from("financial_event_sync_state")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("provider", body.provider)
        .eq("state", s);
      counts[s] = count ?? 0;
    }
    return jsonResponse({
      ok: true,
      provider: body.provider,
      synced: counts.synced,
      pending: counts.pending + counts.syncing,
      failed: counts.failed,
      skipped: counts.skipped,
      total: states.reduce((s, st) => s + (counts[st] ?? 0), 0),
    });
  } catch (err) {
    console.error("get-accounting-sync-status error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
