/**
 * backfill-accounting-sync — Spec §12.
 *
 * Operator clicks "Sync historical data" on Settings → Accounting. The wizard
 * passes { provider, dateFrom, dateTo }. We:
 *   1. Verify the caller is admin/head_admin
 *   2. Verify the tenant has an active connection for `provider`
 *   3. Insert a `backfill_jobs` row with status='pending'
 *   4. Return immediately with the job id — UI polls progress
 *
 * The actual work — finding events in range that don't yet have a sync_state
 * row for the provider, and inserting those rows — is done by the
 * `process-backfill-jobs` cron every 60 seconds.
 *
 * We deliberately don't try to do the work inline (edge function timeout is
 * tight — a 12-month backfill for a busy tenant could be 5k+ events to
 * insert, plus the eventual sync calls themselves).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  provider?: "xero" | "zoho";
  dateFrom?: string | null;   // ISO date or null = all-time
  dateTo?: string;            // ISO date — defaults to today
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    if (!body.provider || !["xero", "zoho"].includes(body.provider)) {
      return errorResponse("provider is required ('xero' or 'zoho')", 400);
    }

    // Resolve caller
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
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);
    if (!appUser.is_super_admin && !["admin", "head_admin"].includes(appUser.role ?? "")) {
      return errorResponse("Only admin or head_admin can run a backfill", 403);
    }
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    // Verify there's an active connection — no point queuing if there isn't.
    const { data: conn } = await supabase
      .from("accounting_connections")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("provider", body.provider)
      .eq("status", "active")
      .maybeSingle();
    if (!conn) {
      return errorResponse(`No active ${body.provider} connection. Connect first, then run the backfill.`, 409);
    }

    // Check there's no already-running backfill for this (tenant, provider).
    // Operator can run multiple, but two simultaneous backfills would just
    // make the worker pick whichever it finds first — surface the conflict.
    const { data: existing } = await supabase
      .from("backfill_jobs")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("provider", body.provider)
      .in("status", ["pending", "running"])
      .maybeSingle();
    if (existing) {
      return errorResponse(`A backfill is already in progress for ${body.provider}. Wait for it to finish or cancel it.`, 409);
    }

    // Pre-count how many events fall in the range — helps the UI render
    // "X events to sync · ~Y minutes" before the operator hits Start.
    let countQuery = supabase
      .from("financial_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (body.dateFrom) countQuery = countQuery.gte("occurred_at", body.dateFrom);
    if (body.dateTo) countQuery = countQuery.lte("occurred_at", body.dateTo);
    const { count } = await countQuery;
    const totalEvents = Number(count ?? 0);

    const dateTo = body.dateTo ?? new Date().toISOString().slice(0, 10);

    const { data: created, error: insErr } = await supabase
      .from("backfill_jobs")
      .insert({
        tenant_id: tenantId,
        provider: body.provider,
        date_from: body.dateFrom ?? null,
        date_to: dateTo,
        total_events: totalEvents,
        status: "pending",
        created_by: appUser.id,
      })
      .select("id")
      .single();
    if (insErr || !created) {
      return errorResponse(insErr?.message ?? "Failed to create backfill job", 500);
    }

    return jsonResponse({
      ok: true,
      backfillJobId: created.id,
      provider: body.provider,
      total_events: totalEvents,
      estimated_minutes: Math.ceil(totalEvents / 100) * 2,  // 100 rows / tick, 2 min between ticks
    });
  } catch (err) {
    console.error("backfill-accounting-sync error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
