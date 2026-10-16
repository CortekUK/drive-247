// accounting-sync-v2 — sends queued transactions to Xero / Zoho Books.
//
// Called every minute by the pg_cron job `accounting-sync-v2` with the service
// role key (migration 20261017130000). Nobody else may call it. The portal's
// "Sync now" uses the same runner for one tenant (accounting-v2 sync_now).
import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/accounting-v2/caller.ts";
import { processItems } from "../_shared/accounting-v2/runner.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer !== serviceKey) return errorResponse("Forbidden", 403);

  const db = serviceClient();
  const deadline = Date.now() + 45_000;
  const spent = new Map<string, number>();
  const totals = { sent: 0, failed: 0, dropped: 0, deferred: 0, batches: 0 };

  // Batches until the queue is drained or the minute is nearly up.
  while (Date.now() < deadline) {
    const { data: items, error } = await db.rpc("accounting_v2_claim", { p_limit: 60 });
    if (error) return errorResponse(error.message, 500);
    if (!items?.length) break;
    const r = await processItems(db, items as any[], deadline, spent);
    totals.sent += r.sent; totals.failed += r.failed; totals.dropped += r.dropped; totals.deferred += r.deferred;
    totals.batches++;
    // Everything in the batch was deferred (rate limits, reauth): stop for this minute.
    if (r.sent + r.failed + r.dropped === 0) break;
  }
  return jsonResponse(totals);
});
