/**
 * process-backfill-jobs — Spec §12.2.
 *
 * Cron-triggered every 1 minute. Walks pending `backfill_jobs` rows and for
 * each one inserts `financial_event_sync_state(pending)` rows for every
 * `financial_event` in the date range that doesn't already have one for the
 * target provider.
 *
 * The actual provider calls happen in `process-accounting-sync` afterwards.
 * That cron runs every 2 minutes and respects rate limits, so a 1000-event
 * backfill drains in ~20-40 minutes for Xero.
 *
 * We process one job per tick to avoid contention. Jobs that fail mid-flight
 * (e.g. DB hiccup) get marked `failed` with the error — operator can re-run
 * via the wizard.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const BATCH_SIZE = 500;   // events processed per inner pass before yielding

interface BackfillJobRow {
  id: string;
  tenant_id: string;
  provider: "xero" | "zoho";
  date_from: string | null;
  date_to: string;
  total_events: number;
  processed_events: number;
  failed_events: number;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Pick one pending job (FIFO).
    const { data: jobRaw } = await supabase
      .from("backfill_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const job = jobRaw as BackfillJobRow | null;
    if (!job) {
      return jsonResponse({ note: "no pending jobs" });
    }

    // Claim it — atomic flip pending → running, only if still pending.
    const { data: claimed } = await supabase
      .from("backfill_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) {
      // Another worker beat us to it.
      return jsonResponse({ note: "job already claimed" });
    }

    try {
      const summary = await processOneJob(supabase, job);
      await supabase
        .from("backfill_jobs")
        .update({
          status: "completed",
          processed_events: summary.processed,
          failed_events: summary.failed,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return jsonResponse({ ok: true, jobId: job.id, ...summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("backfill_jobs")
        .update({
          status: "failed",
          last_error: msg.slice(0, 1000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return errorResponse(`backfill job ${job.id} failed: ${msg}`, 500);
    }
  } catch (err) {
    console.error("process-backfill-jobs error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

async function processOneJob(
  supabase: SupabaseClient,
  job: BackfillJobRow,
): Promise<{ processed: number; failed: number; skipped_existing: number }> {
  let processed = 0;
  let failed = 0;
  let skipped_existing = 0;

  // Page through financial_events for this tenant in the date range. We use
  // occurred_at + id as the cursor so we don't lose rows if multiple events
  // share an occurred_at timestamp.
  let lastOccurredAt: string | null = null;
  let lastId: string | null = null;

  while (true) {
    let query = supabase
      .from("financial_events")
      .select("id, occurred_at")
      .eq("tenant_id", job.tenant_id)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (job.date_from) query = query.gte("occurred_at", job.date_from);
    query = query.lte("occurred_at", `${job.date_to}T23:59:59`);
    if (lastOccurredAt && lastId) {
      // Cursor: rows AFTER the previous batch's last (occurred_at, id).
      query = query.or(`occurred_at.gt.${lastOccurredAt},and(occurred_at.eq.${lastOccurredAt},id.gt.${lastId})`);
    }
    const { data: batchRaw, error: batchErr } = await query;
    if (batchErr) throw new Error(`event scan: ${batchErr.message}`);
    const batch = (batchRaw ?? []) as Array<{ id: string; occurred_at: string }>;
    if (batch.length === 0) break;

    const eventIds = batch.map((e) => e.id);

    // Find which of these already have a sync_state for this provider — skip those.
    const { data: existingRaw } = await supabase
      .from("financial_event_sync_state")
      .select("financial_event_id")
      .eq("provider", job.provider)
      .in("financial_event_id", eventIds);
    const existing = new Set(((existingRaw ?? []) as Array<{ financial_event_id: string }>).map((r) => r.financial_event_id));

    const toInsert = batch
      .filter((e) => !existing.has(e.id))
      .map((e) => ({
        financial_event_id: e.id,
        tenant_id: job.tenant_id,
        provider: job.provider,
        state: "pending" as const,
      }));
    skipped_existing += batch.length - toInsert.length;

    if (toInsert.length > 0) {
      const { error: insErr, count } = await supabase
        .from("financial_event_sync_state")
        .insert(toInsert, { count: "exact" });
      if (insErr) {
        // Don't fail the whole job on a single batch insert error — track + continue.
        failed += toInsert.length;
        console.error(`backfill ${job.id}: batch insert error:`, insErr);
      } else {
        processed += count ?? toInsert.length;
      }
    }

    // Persist progress so the wizard polls see live updates.
    await supabase
      .from("backfill_jobs")
      .update({ processed_events: processed, failed_events: failed })
      .eq("id", job.id);

    // Advance cursor.
    const last = batch[batch.length - 1];
    lastOccurredAt = last.occurred_at;
    lastId = last.id;

    if (batch.length < BATCH_SIZE) break;
  }

  return { processed, failed, skipped_existing };
}
